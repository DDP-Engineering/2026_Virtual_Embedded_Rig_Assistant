import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import type { PathGuard } from "../workbench/path-guard.js";

/** Opening a FIFO blocks a thread until a writer appears, so special files are refused before the open. */
export async function assertNotSpecialFile(path: string): Promise<void> {
  const info = await lstat(path);
  if (info.isFIFO() || info.isSocket() || info.isCharacterDevice() || info.isBlockDevice())
    throw Error("Read an ordinary file.");
}

export class FileReadLimitError extends Error {
  constructor(maxBytes: number) {
    super(`File exceeds ${maxBytes / 1024} KiB read limit. Use grep or read_doc.`);
  }
}

/** Bound allocation/I/O and verify the opened ordinary file stayed at the guarded path. */
export async function readGuardedFile(guard: PathGuard, path: string, maxBytes: number, signal: AbortSignal) {
  signal.throwIfAborted();
  const target = await guard.resolve(path);
  const seen = await lstat(target.absolute);
  if (!seen.isFile()) throw Error("Read an ordinary file.");
  const handle = await open(
    target.absolute,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
  );
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.dev !== seen.dev || before.ino !== seen.ino)
      throw Error("Read an ordinary file.");
    if (before.size > maxBytes) throw new FileReadLimitError(maxBytes);
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      signal.throwIfAborted();
      const read = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!read.bytesRead) break;
      offset += read.bytesRead;
    }
    const after = await handle.stat();
    const current = await guard.resolve(path);
    const currentStat = await lstat(current.absolute);
    signal.throwIfAborted();
    if (
      offset !== before.size ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs ||
      target.key !== current.key ||
      currentStat.ino !== before.ino ||
      currentStat.dev !== before.dev
    )
      throw Error("File changed while reading. Read it again.");
    guard.assertAuthorized();
    return { bytes, target, mtimeMs: after.mtimeMs, stat: after };
  } finally {
    await handle.close();
  }
}

/** A terminal newline terminates the last line rather than adding a synthetic empty line. */
export function textLines(text: string): string[] {
  if (!text) return [];
  const lines = text.split(/\r\n|\n|\r/);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}
