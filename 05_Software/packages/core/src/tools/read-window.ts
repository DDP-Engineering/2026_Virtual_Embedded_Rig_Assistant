import { createHash } from "node:crypto";
import { lstat, open } from "node:fs/promises";
import type { PathGuard } from "../workbench/path-guard.js";
import { isBinary } from "./binary.js";

/** Full-file metadata scan stays streaming; only the requested source window is retained. */
export async function readWindow(
  guard: PathGuard,
  path: string,
  offset: number,
  limit: number,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const target = await guard.resolve(path);
  const handle = await open(target.absolute, "r");
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw Error("Read an ordinary file.");
    const hash = createHash("sha256");
    const decoder = new TextDecoder();
    const buffer = Buffer.alloc(64 * 1024);
    const selected: { line: number; text: string }[] = [];
    let totalLines = 0;
    let current = "";
    let hasContent = false;
    let previousCR = false;
    let position = 0;
    let outputCharacters = 0;
    let sourceBytes = 0;
    let clipped = false;
    let retentionEnded = false;
    const wanted = () => !retentionEnded && totalLines + 1 >= offset && totalLines + 1 < offset + limit;
    const endLine = () => {
      totalLines++;
      if (!retentionEnded && totalLines >= offset && totalLines < offset + limit) {
        const prefix = `${totalLines}: `;
        const available = 30000 - outputCharacters - prefix.length - 1;
        if (available >= 0) {
          const text = current.slice(0, available);
          if (text.length < current.length) clipped = true;
          selected.push({ line: totalLines, text });
          outputCharacters += prefix.length + text.length + 1;
        } else clipped = true;
        if (clipped) retentionEnded = true;
      }
      current = "";
      hasContent = false;
    };
    const consume = (text: string) => {
      for (const char of text) {
        if (char === "\n" && previousCR) {
          previousCR = false;
          continue;
        }
        previousCR = false;
        if (char === "\n" || char === "\r") {
          endLine();
          previousCR = char === "\r";
        } else {
          hasContent = true;
          if (wanted()) {
            const bytes = Buffer.byteLength(char);
            if (sourceBytes + bytes <= 256 * 1024 && outputCharacters + current.length < 29980) {
              current += char;
              sourceBytes += bytes;
            } else clipped = true;
          }
        }
      }
    };
    for (;;) {
      signal.throwIfAborted();
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (!bytesRead) break;
      const bytes = buffer.subarray(0, bytesRead);
      if (!position && isBinary(bytes)) throw Error("Cannot read a binary file. Choose a text file.");
      hash.update(bytes);
      consume(decoder.decode(bytes, { stream: true }));
      position += bytesRead;
    }
    consume(decoder.decode());
    if (hasContent) endLine();
    const after = await handle.stat();
    const currentTarget = await guard.resolve(path);
    const currentStat = await lstat(currentTarget.absolute);
    signal.throwIfAborted();
    if (
      position !== before.size ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs ||
      currentTarget.key !== target.key ||
      currentStat.ino !== before.ino ||
      currentStat.dev !== before.dev
    )
      throw Error("File changed while reading. Read it again.");
    return {
      target,
      selected,
      totalLines,
      truncated: clipped || offset - 1 + limit < totalLines,
      sha256: hash.digest("hex"),
      mtimeMs: after.mtimeMs,
    };
  } finally {
    await handle.close();
  }
}
