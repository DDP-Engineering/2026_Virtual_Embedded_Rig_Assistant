import { createHash, randomUUID } from "node:crypto";
import { constants, lstatSync, renameSync, type Stats } from "node:fs";
import { type FileHandle, lstat, mkdir, open, readdir, realpath, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  type CaptureReference,
  type CaptureSource,
  captureLimits,
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

async function streamCapture(path: string, target: string | undefined, signal: AbortSignal) {
  let input: FileHandle | undefined;
  let output: FileHandle | undefined;
  try {
    const before = await regularFile(path);
    if (before.size > captureLimits.captureBytes)
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
      if (bytes === 0) {
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
    if (!fileFormat) throw corrupt();
    if (!matches(before, await input.stat()) || !matches(before, await regularFile(path))) throw changed();
    await output?.sync();
    signal.throwIfAborted();
    return { fileFormat, bytes, sha256: hash.digest("hex") };
  } finally {
    await Promise.all([input?.close(), output?.close()]);
  }
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
) {
  const input = "reference" in source ? source.reference : undefined;
  try {
    const identity = input?.source ?? { kind: "workbench", path: "path" in source ? source.path : "" };
    if (identity.kind === "managed") {
      if (!input) throw inaccessible();
      const path = join(await managedFolder(ctx.root), fileName(input));
      const actual = await streamCapture(path, target, signal);
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
    const actual = await streamCapture(bound.absolute, target, signal);
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
  authorize: () => Promise<void>,
): Promise<CaptureReference> {
  return access.queue.run(async () => {
    try {
      access.assertWritable();
      signal.throwIfAborted();
      const folder = await managedFolder(root, true);
      const target = join(folder, fileName(reference));
      const managed: CaptureReference = { ...reference, source: { kind: "managed" } };
      try {
        const actual = await streamCapture(target, undefined, signal);
        if (!sameCapture(managed, actual)) throw changed();
        await authorize();
        access.assertWritable();
        return managed;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const entries = (await readdir(folder)).filter((name) => /^[a-f0-9]{64}\.(pcap|pcapng)$/.test(name));
      if (entries.length >= captureLimits.managedFiles) throw quota();
      let bytes = managed.bytes;
      for (const name of entries) {
        signal.throwIfAborted();
        bytes += (await regularFile(join(folder, name))).size;
        if (bytes > captureLimits.managedBytes) throw quota();
      }
      const stage = join(folder, `.${randomUUID()}.tmp`);
      try {
        const copied = await streamCapture(input, stage, signal);
        if (!sameCapture(managed, copied)) throw changed();
        await authorize();
        const before = await regularFile(stage);
        const staged = await streamCapture(stage, undefined, signal);
        if (!sameCapture(managed, staged)) throw changed();
        if (key(await managedFolder(root)) !== key(folder)) throw inaccessible();
        if (!matches(before, lstatSync(stage))) throw changed();
        try {
          lstatSync(target);
          throw changed();
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        access.assertWritable();
        signal.throwIfAborted();
        renameSync(stage, target);
        return managed;
      } finally {
        await unlink(stage).catch(() => {});
      }
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof CaptureError) throw error;
      throw new CaptureError(
        "storage_inaccessible",
        "Managed capture storage is unavailable. Check workbench write access.",
      );
    }
  });
}
