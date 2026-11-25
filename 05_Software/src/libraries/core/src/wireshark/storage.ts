import { createHash, randomUUID } from "node:crypto";
import { constants, linkSync, lstatSync, renameSync, type Stats, unlinkSync } from "node:fs";
import { type FileHandle, lstat, mkdir, open, readdir, realpath, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  type CaptureLineageReference,
  type CaptureReference,
  type CaptureSource,
  captureLimits,
  captureLineageLimits,
  captureReferenceSchema,
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

export const managedCaptureDirectory = (workbench: string) => join(workbench, ".vera", "captures");
const key = (path: string) => (process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path));
const changed = () =>
  new CaptureError("capture_changed", "The capture changed. Inspect it again before citing or paging.");
const inaccessible = () =>
  new CaptureError("capture_inaccessible", "Use an accessible capture file inside the workbench.");
const corrupt = () =>
  new CaptureError("invalid_capture", "Select an ordinary, uncompressed PCAP or PCAPNG file.");
const quota = () =>
  new CaptureError("storage_quota", "Managed capture storage is full. Free space before importing.");

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
        "The capture exceeds the host byte limit. Select a smaller capture.",
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
    const guard = await PathGuard.create(
      ctx.root,
      ctx.root,
      "workbench",
      undefined,
      toolExcludedRoots(ctx),
      [],
      { refuseLinks: true },
    );
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

type ManagedEntry = { input: string; reference: CaptureReference | CaptureLineageReference };

function isCapture(reference: ManagedEntry["reference"]): reference is CaptureReference {
  return "fileFormat" in reference;
}

async function checkManaged(
  entry: ManagedEntry,
  path: string,
  target: string | undefined,
  signal: AbortSignal,
) {
  const { reference } = entry;
  const capture = isCapture(reference);
  const limit = capture ? captureLimits.captureBytes : captureLineageLimits.bytes;
  const actual = await streamFile(path, target, signal, limit, capture);
  if (
    actual.bytes !== reference.bytes ||
    actual.sha256 !== reference.sha256 ||
    (capture && actual.fileFormat !== reference.fileFormat)
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
      const candidates: ManagedEntry[] = [...files, ...(options.lineage ? [options.lineage] : [])];
      for (const entry of candidates) {
        const { reference } = entry;
        const target = join(folder, isCapture(reference) ? fileName(reference) : lineageName(reference));
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
        const batches = [
          { limits: captureLimits, pattern: /^[a-f0-9]{64}\.(pcap|pcapng)$/ },
          { limits: captureLineageLimits, pattern: /^[a-f0-9]{64}\.lineage\.json$/ },
        ];
        for (const { limits, pattern } of batches) {
          const added = [...missing].filter(([path]) => pattern.test(path.slice(folder.length + 1)));
          if (!added.length) continue;
          const entries = names.filter((name) => pattern.test(name));
          if (entries.length + added.length > limits.managedFiles) throw quota();
          let bytes = added.reduce((total, [, file]) => total + file.reference.bytes, 0);
          for (const name of entries) {
            signal.throwIfAborted();
            bytes += (await regularFile(join(folder, name))).size;
            if (bytes > limits.managedBytes) throw quota();
          }
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
