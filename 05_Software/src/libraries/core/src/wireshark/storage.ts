import { createHash, randomUUID } from "node:crypto";
import { constants, linkSync, lstatSync, renameSync, type Stats, unlinkSync } from "node:fs";
import { type FileHandle, lstat, mkdir, mkdtemp, open, readdir, realpath, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  type CaptureLineageReference,
  type CaptureReference,
  type CaptureSource,
  captureLimits,
  captureLineageLimits,
  captureReferenceSchema,
  hexdumpImportLimits,
} from "@vera/shared";
import type { ToolContext } from "../tools/context.js";
import { toolExcludedRoots } from "../tools/context.js";
import { PathGuard } from "../workbench/path-guard.js";
import type { WriteQueue } from "../workbench/write-queue.js";
import { CaptureError } from "./native.js";

export interface CaptureWriteAccess {
  queue: WriteQueue;
  assertWritable(): void;
}

const provenanceLimits = {
  bytes: hexdumpImportLimits.manifestBytes,
  managedBytes: 1024 * 1024,
  managedFiles: 64,
};
const captureBatches = {
  captures: { limits: captureLimits, pattern: /^[a-f0-9]{64}\.(pcap|pcapng)$/ },
  lineage: { limits: captureLineageLimits, pattern: /^[a-f0-9]{64}\.lineage\.json$/ },
  provenance: { limits: provenanceLimits, pattern: /^[a-f0-9]{64}\.provenance\.json$/ },
};
type CapacityDemand = { files: number; bytes: number };
export type CaptureCapacityReservation = { captures: CapacityDemand; release(): Promise<void> };
const reservations = new WeakMap<WriteQueue, Set<CaptureCapacityReservation>>();

export const managedCaptureDirectory = (workbench: string) => join(workbench, ".vera", "captures");
const key = (path: string) => (process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path));
const changed = () =>
  new CaptureError("capture_changed", "The capture changed. Inspect it again before citing or paging.");
const inaccessible = () =>
  new CaptureError("capture_inaccessible", "Use an accessible capture file inside the workbench.");
const corrupt = () =>
  new CaptureError("invalid_capture", "Select an ordinary, uncompressed PCAP or PCAPNG file.");
const quota = () =>
  new CaptureError(
    "storage_quota",
    "Managed capture storage is full. Free space before saving new captures.",
  );

function matches(a: Stats, b: Stats) {
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.mtimeMs === b.mtimeMs &&
    a.ctimeMs === b.ctimeMs &&
    b.isFile() &&
    b.nlink === 1
  );
}

async function regularFile(path: string) {
  const entry = await lstat(path);
  if (!entry.isFile() || entry.nlink !== 1 || key(await realpath(path)) !== key(path)) throw inaccessible();
  return entry;
}

async function streamFile(
  path: string,
  target: string | undefined,
  signal: AbortSignal,
  maxBytes: number,
  capture: boolean,
) {
  let input: FileHandle | undefined;
  let output: FileHandle | undefined;
  try {
    const before = await regularFile(path);
    if (before.size > maxBytes)
      throw new CaptureError(
        "capture_byte_limit",
        `The capture is larger than ${Math.floor(maxBytes / (1024 * 1024))} MiB. Cut a part out first (editcap -r <in> <out> <first>-<last>, or tshark -r <in> -Y <filter> -w <out>), or read it with tshark directly.`,
      );
    input = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    if (!matches(before, await input.stat())) throw changed();
    if (target) output = await open(target, "wx", 0o600);
    const hash = createHash("sha256");
    const buffer = Buffer.alloc(64 * 1024);
    let bytes = 0;
    let fileFormat: CaptureReference["fileFormat"] | undefined;
    while (bytes < before.size) {
      signal.throwIfAborted();
      const { bytesRead } = await input.read(buffer, 0, Math.min(buffer.length, before.size - bytes), bytes);
      if (!bytesRead) throw changed();
      const chunk = buffer.subarray(0, bytesRead);
      if (capture && bytes === 0) {
        // Read the fixed header in one position-based operation even if the streaming read was short.
        const header = Buffer.alloc(4);
        if ((await input.read(header, 0, header.length, 0)).bytesRead !== header.length) throw corrupt();
        const magic = header.toString("hex");
        if (magic === "0a0d0d0a" && before.size >= 28) fileFormat = "pcapng";
        else if (["a1b2c3d4", "d4c3b2a1", "a1b23c4d", "4d3cb2a1"].includes(magic) && before.size >= 24)
          fileFormat = "pcap";
        else throw corrupt();
      }
      hash.update(chunk);
      await output?.writeFile(chunk);
      bytes += bytesRead;
    }
    if (capture && !fileFormat) throw corrupt();
    if (!matches(before, await input.stat()) || !matches(before, await regularFile(path))) throw changed();
    await output?.sync();
    signal.throwIfAborted();
    return { fileFormat, bytes, sha256: hash.digest("hex") };
  } finally {
    await Promise.all([input?.close(), output?.close()]);
  }
}

async function streamCapture(
  path: string,
  target: string | undefined,
  signal: AbortSignal,
  maxBytes: number = captureLimits.captureBytes,
) {
  const actual = await streamFile(path, target, signal, maxBytes, true);
  if (!actual.fileFormat) throw corrupt();
  return { ...actual, fileFormat: actual.fileFormat };
}

async function verifyDirectory(path: string, create = false) {
  if (create) {
    try {
      await mkdir(path, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  if (!(await lstat(path)).isDirectory() || key(await realpath(path)) !== key(path)) throw inaccessible();
}

async function managedFolder(root: string, create = false) {
  const canonical = await realpath(root);
  const folder = managedCaptureDirectory(canonical);
  await verifyDirectory(dirname(folder));
  await verifyDirectory(folder, create);
  return folder;
}

/** Private live capture staging under the existing managed path boundary. */
export async function createLiveCaptureDirectory(root: string) {
  return mkdtemp(join(await managedFolder(root, true), ".dumpcap-"));
}

function reservedCapacity(
  queue: WriteQueue,
  batch: keyof typeof captureBatches,
  using?: CaptureCapacityReservation,
): CapacityDemand {
  let files = 0;
  let bytes = 0;
  for (const reservation of reservations.get(queue) ?? []) {
    if (reservation === using || batch === "lineage") continue;
    files += batch === "captures" ? reservation.captures.files : 1;
    bytes += batch === "captures" ? reservation.captures.bytes : provenanceLimits.bytes;
  }
  return { files, bytes };
}

async function assertCapacity(
  folder: string,
  names: string[],
  batch: keyof typeof captureBatches,
  added: CapacityDemand,
  existingReservations: CapacityDemand,
  signal: AbortSignal,
) {
  const { limits, pattern } = captureBatches[batch];
  const entries = names.filter((name) => pattern.test(name));
  if (entries.length + added.files + existingReservations.files > limits.managedFiles) throw quota();
  let bytes = added.bytes + existingReservations.bytes;
  for (const name of entries) {
    signal.throwIfAborted();
    bytes += (await regularFile(join(folder, name))).size;
  }
  if (bytes > limits.managedBytes) throw quota();
}

/** Reserve managed bytes and slots before the approved run opens an interface. */
export function reserveLiveCaptureCapacity(
  root: string,
  access: CaptureWriteAccess,
  captures: CapacityDemand,
  signal: AbortSignal,
) {
  const { queue } = access;
  return queue.run(async () => {
    access.assertWritable();
    signal.throwIfAborted();
    const folder = await managedFolder(root, true);
    const names = await readdir(folder);
    await assertCapacity(folder, names, "captures", captures, reservedCapacity(queue, "captures"), signal);
    await assertCapacity(
      folder,
      names,
      "provenance",
      { files: 1, bytes: provenanceLimits.bytes },
      reservedCapacity(queue, "provenance"),
      signal,
    );
    signal.throwIfAborted();
    access.assertWritable();
    let held = reservations.get(queue);
    if (!held) {
      held = new Set();
      reservations.set(queue, held);
    }
    const entries = held;
    const reservation: CaptureCapacityReservation = {
      captures,
      release: () =>
        queue.run(async () => {
          entries.delete(reservation);
        }),
    };
    entries.add(reservation);
    return reservation;
  });
}

const fileName = (reference: CaptureReference) => `${reference.sha256}.${reference.fileFormat}`;
const lineageName = (reference: CaptureLineageReference) => `${reference.sha256}.lineage.json`;

/** Read only the complete companion bound to a managed lineage reference. */
export async function snapshotCaptureLineage(
  root: string,
  reference: CaptureLineageReference,
  target: string,
  signal: AbortSignal,
) {
  try {
    const path = join(await managedFolder(root), lineageName(reference));
    const actual = await streamFile(path, target, signal, captureLineageLimits.bytes, false);
    if (actual.bytes !== reference.bytes || actual.sha256 !== reference.sha256) throw changed();
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof CaptureError && error.reason === "capture_changed") throw error;
    throw new CaptureError(
      "capture_lineage_unavailable",
      "Use the lineage report reference from a completed operation in this workbench.",
    );
  }
}

function sameCapture(reference: CaptureReference, actual: Omit<CaptureReference, "format" | "source">) {
  return (
    reference.sha256 === actual.sha256 &&
    reference.bytes === actual.bytes &&
    reference.fileFormat === actual.fileFormat
  );
}

function workbenchSourceGuard(ctx: ToolContext) {
  return PathGuard.create(ctx.root, ctx.root, "workbench", undefined, toolExcludedRoots(ctx), [], {
    refuseLinks: true,
  });
}

/** Snapshot a TLS key log of the workbench, so TShark reads the bytes that were hashed. */
export async function snapshotKeyLog(ctx: ToolContext, path: string, target: string, signal: AbortSignal) {
  try {
    const guard = await workbenchSourceGuard(ctx);
    const bound = await guard.resolve(path);
    const { bytes, sha256 } = await streamFile(bound.absolute, target, signal, 4 * 1024 * 1024, false);
    if ((await guard.resolve(path)).absolute !== bound.absolute) throw changed();
    return { bytes, sha256 };
  } catch {
    signal.throwIfAborted();
    throw new CaptureError(
      "keylog_inaccessible",
      "Use a TLS key log file inside the workbench, 4 MiB at most (the file a client writes for SSLKEYLOGFILE).",
    );
  }
}

/** Snapshot and hash an exact hexdump file without giving the native converter its original path. */
export async function snapshotHexdump(ctx: ToolContext, path: string, target: string, signal: AbortSignal) {
  try {
    const guard = await workbenchSourceGuard(ctx);
    const bound = await guard.resolve(path);
    const { bytes, sha256 } = await streamFile(
      bound.absolute,
      target,
      signal,
      hexdumpImportLimits.inputBytes,
      false,
    );
    if ((await guard.resolve(path)).absolute !== bound.absolute) throw changed();
    return { bytes, sha256 };
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof CaptureError) {
      if (error.reason === "capture_byte_limit")
        throw new CaptureError("hexdump_input_limit", "Select a smaller hexdump, at most 4 MiB.");
      if (error.reason === "capture_changed")
        throw new CaptureError("hexdump_changed", "The hexdump changed during import. Select it again.");
    }
    throw new CaptureError("hexdump_inaccessible", "Use an accessible hexdump file inside the workbench.");
  }
}

/** Open only an authorized source and snapshot the exact bytes that the native tool will receive. */
export async function snapshotCapture(
  ctx: ToolContext,
  source: CaptureSource,
  target: string | undefined,
  signal: AbortSignal,
  maxBytes?: number,
) {
  const input = "reference" in source ? source.reference : undefined;
  try {
    const identity = input?.source ?? { kind: "workbench", path: "path" in source ? source.path : "" };
    if (identity.kind === "managed") {
      if (!input) throw inaccessible();
      const path = join(await managedFolder(ctx.root), fileName(input));
      const actual = await streamCapture(path, target, signal, maxBytes);
      if (!sameCapture(input, actual)) throw changed();
      return input;
    }
    const guard = await workbenchSourceGuard(ctx);
    const bound = await guard.resolve(identity.path);
    const actual = await streamCapture(bound.absolute, target, signal, maxBytes);
    const rechecked = await guard.resolve(identity.path);
    if (rechecked.absolute !== bound.absolute || (input && !sameCapture(input, actual))) throw changed();
    return captureReferenceSchema.parse({
      format: 1,
      source: { kind: "workbench", path: bound.relative },
      ...actual,
    });
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof CaptureError) throw error;
    throw inaccessible();
  }
}

/** Validate same-directory staging and atomically publish under workbench write admission. */
export async function publishCapture(
  root: string,
  access: CaptureWriteAccess,
  input: string,
  reference: CaptureReference,
  signal: AbortSignal,
  authorize: () => Promise<unknown>,
): Promise<CaptureReference> {
  const [managed] = await publishCaptures(root, access, [{ input, reference }], signal, authorize, {
    preserveImportRename: true,
  });
  if (!managed) throw inaccessible();
  return managed;
}

type CompanionFile = { input: string; reference: { bytes: number; sha256: string } };
type ManagedEntry =
  | { input: string; reference: CaptureReference }
  | (CompanionFile & { kind: "lineage" | "provenance" });

async function checkManaged(
  entry: ManagedEntry,
  path: string,
  target: string | undefined,
  signal: AbortSignal,
) {
  const { reference } = entry;
  const limit =
    "kind" in entry
      ? entry.kind === "lineage"
        ? captureLineageLimits.bytes
        : provenanceLimits.bytes
      : captureLimits.captureBytes;
  const actual = await streamFile(path, target, signal, limit, !("kind" in entry));
  if (
    actual.bytes !== reference.bytes ||
    actual.sha256 !== reference.sha256 ||
    ("fileFormat" in reference && actual.fileFormat !== reference.fileFormat)
  )
    throw changed();
}

/** Stage the complete group before granting any managed reference to the caller. */
export async function publishCaptures(
  root: string,
  access: CaptureWriteAccess,
  files: { input: string; reference: CaptureReference }[],
  signal: AbortSignal,
  authorize: () => Promise<unknown>,
  options: {
    preserveImportRename?: boolean;
    lineage?: { input: string; reference: CaptureLineageReference };
    provenance?: CompanionFile;
    reservation?: CaptureCapacityReservation;
  } = {},
): Promise<CaptureReference[]> {
  return access.queue.run(async () => {
    const staged: { target: string; path: string; entry: ManagedEntry; stamp?: Stats }[] = [];
    const published: { target: string; stamp: Stats }[] = [];
    try {
      access.assertWritable();
      signal.throwIfAborted();
      const folder = await managedFolder(root, true);
      const managed = files.map(
        ({ reference }): CaptureReference => ({
          ...reference,
          source: { kind: "managed" },
        }),
      );
      const missing = new Map<string, ManagedEntry>();
      const existing = new Map<string, Stats>();
      const candidates: ManagedEntry[] = [...files];
      if (options.lineage) candidates.push({ ...options.lineage, kind: "lineage" });
      if (options.provenance) candidates.push({ ...options.provenance, kind: "provenance" });
      for (const entry of candidates) {
        const name =
          "kind" in entry
            ? entry.kind === "lineage"
              ? lineageName(entry.reference)
              : `${entry.reference.sha256}.provenance.json`
            : fileName(entry.reference);
        const target = join(folder, name);
        try {
          const before = await regularFile(target);
          await checkManaged(entry, target, undefined, signal);
          if (!matches(before, await regularFile(target))) throw changed();
          existing.set(target, before);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          missing.set(target, entry);
        }
      }
      if (missing.size) {
        const names = await readdir(folder);
        for (const batch of ["captures", "lineage", "provenance"] as const) {
          const { pattern } = captureBatches[batch];
          const added = [...missing].filter(([path]) => pattern.test(path.slice(folder.length + 1)));
          if (!added.length) continue;
          const bytes = added.reduce((total, [, file]) => total + file.reference.bytes, 0);
          await assertCapacity(
            folder,
            names,
            batch,
            { files: added.length, bytes },
            reservedCapacity(access.queue, batch, options.reservation),
            signal,
          );
        }
      }
      for (const [target, entry] of missing) {
        const path = join(folder, `.${randomUUID()}.tmp`);
        staged.push({ target, path, entry });
        await checkManaged(entry, entry.input, path, signal);
      }
      await authorize();
      for (const entry of staged) {
        entry.stamp = await regularFile(entry.path);
        await checkManaged(entry.entry, entry.path, undefined, signal);
      }
      if (!options.preserveImportRename && staged.length) await authorize();
      if (key(await managedFolder(root)) !== key(folder)) throw inaccessible();
      for (const [target, before] of existing) if (!matches(before, lstatSync(target))) throw changed();
      for (const { path, target, stamp } of staged) {
        if (!stamp || !matches(stamp, lstatSync(path))) throw changed();
        try {
          lstatSync(target);
          throw changed();
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      access.assertWritable();
      signal.throwIfAborted();
      for (const { path, target, stamp } of staged) {
        if (!stamp) throw changed();
        if (options.preserveImportRename) renameSync(path, target);
        else {
          linkSync(path, target);
          published.push({ target, stamp });
          unlinkSync(path);
        }
      }
      return managed;
    } catch (error) {
      let rollbackFailed = false;
      for (const { target, stamp } of published) {
        try {
          const present = lstatSync(target);
          if (present.isFile() && present.dev === stamp.dev && present.ino === stamp.ino) unlinkSync(target);
        } catch (rollbackError) {
          if ((rollbackError as NodeJS.ErrnoException).code !== "ENOENT") rollbackFailed = true;
        }
      }
      if (rollbackFailed)
        throw new CaptureError(
          "capture_storage_rollback",
          "Managed storage could not remove an unfinished capture. Check filesystem access.",
        );
      signal.throwIfAborted();
      if (error instanceof CaptureError) throw error;
      if (
        !options.preserveImportRename &&
        ["ENOSYS", "ENOTSUP", "EOPNOTSUPP"].includes((error as NodeJS.ErrnoException).code ?? "")
      )
        throw new CaptureError(
          "capture_storage_unsupported",
          "Use managed storage on a filesystem that supports exclusive hard-link publication.",
        );
      throw new CaptureError(
        "storage_inaccessible",
        "Managed capture storage is unavailable. Check workbench write access.",
      );
    } finally {
      await Promise.all(staged.map(({ path }) => unlink(path).catch(() => {})));
    }
  });
}
