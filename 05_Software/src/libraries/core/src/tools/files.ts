import { lstat, open } from "node:fs/promises";
import type { PathGuard } from "../workbench/path-guard.js";

/** Bound allocation/I/O and verify the opened ordinary file stayed at the guarded path. */
export async function readGuardedFile(guard: PathGuard, path: string, maxBytes: number, signal: AbortSignal) {
  signal.throwIfAborted();
  const target = await guard.resolve(path);
  const handle = await open(target.absolute, "r");
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw Error("Read an ordinary file.");
    if (before.size > maxBytes)
      throw Error(`File exceeds ${maxBytes / 1024} KiB read limit. Use grep or read_doc.`);
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
    return { bytes, target, mtimeMs: after.mtimeMs };
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
