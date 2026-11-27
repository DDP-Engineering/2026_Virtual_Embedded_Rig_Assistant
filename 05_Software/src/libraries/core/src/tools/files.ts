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

/**
 * The first `length` bytes of an ordinary file the guard has just resolved (`absolute` is its canonical
 * path), to classify it before reading it whole: a search over a build folder then costs a few kilobytes
 * per object file instead of the file. Content that is kept is still read through `readGuardedFile`.
 */
export async function readFilePrefix(absolute: string, length: number, signal: AbortSignal) {
  signal.throwIfAborted();
  const handle = await open(
    absolute,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
  );
  try {
    const bytes = Buffer.alloc(length);
    const { bytesRead } = await handle.read(bytes, 0, length, 0);
    return bytes.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * Bound allocation/I/O and verify the opened ordinary file stayed at the guarded path. With `allowGrowth` a
 * file that was only appended to meanwhile (a log being written) returns the bytes it had when opened.
 */
export async function readGuardedFile(
  guard: PathGuard,
  path: string,
  maxBytes: number,
  signal: AbortSignal,
  options: { allowGrowth?: boolean } = {},
) {
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
    const grew = options.allowGrowth === true && after.size > before.size;
    if (
      offset !== before.size ||
      (!grew &&
        (before.size !== after.size ||
          before.mtimeMs !== after.mtimeMs ||
          before.ctimeMs !== after.ctimeMs)) ||
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
