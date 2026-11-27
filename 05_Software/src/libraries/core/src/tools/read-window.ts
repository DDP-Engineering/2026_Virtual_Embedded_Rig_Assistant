import { createHash } from "node:crypto";
import { lstat, open } from "node:fs/promises";
import { fileRevision } from "../workbench/file-revision.js";
import type { PathGuard } from "../workbench/path-guard.js";
import { isBinary, utf16Bom } from "./binary.js";
import { assertNotSpecialFile } from "./files.js";

class LegacyText extends Error {
  constructor(
    readonly key: string,
    readonly revision: string,
  ) {
    super("Legacy text encoding");
  }
}
type ReadWindowOptions = {
  utf8Log?: boolean;
  maxChars?: number;
  /**
   * Accept a file that was only appended to while it was read (a serial capture, a running build's log):
   * the window, line count and hash then describe the bytes it had when opened, and `growing` is set.
   */
  allowGrowth?: boolean;
  /**
   * Also hash the first this many bytes: what parse_log analysed of a log that has grown since. The
   * lines it cited are unchanged exactly when that prefix still has the analysed hash.
   */
  prefixBytes?: number | undefined;
};

/**
 * Full-file metadata scan stays streaming; only the requested source window is retained. `maxChars` bounds
 * the returned text (the read tool's Read output size, REQ-FUNC-f041ba07); the source bytes kept follow it.
 */
export async function readWindow(
  guard: PathGuard,
  path: string,
  offset: number,
  limit: number,
  signal: AbortSignal,
  options: ReadWindowOptions = {},
) {
  try {
    return await scanWindow(guard, path, offset, limit, signal, options);
  } catch (error) {
    if (!(error instanceof LegacyText)) throw error;
    return scanWindow(guard, path, offset, limit, signal, options, error);
  }
}

async function scanWindow(
  guard: PathGuard,
  path: string,
  offset: number,
  limit: number,
  signal: AbortSignal,
  options: ReadWindowOptions,
  fallback?: LegacyText,
) {
  signal.throwIfAborted();
  const maxChars = options.maxChars ?? 30000;
  const maxSourceBytes = Math.max(256 * 1024, maxChars * 4);
  const target = await guard.resolve(path);
  await assertNotSpecialFile(target.absolute);
  const handle = await open(target.absolute, "r");
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw Error("Read an ordinary file.");
    const revision = fileRevision(before);
    if (fallback && (target.key !== fallback.key || revision !== fallback.revision))
      throw Error("File changed while reading. Read it again.");
    const latin1 = fallback !== undefined;
    const hash = createHash("sha256");
    let encoding: "utf-8" | "utf-16le" | "utf-16be" | "latin1" = latin1 ? "latin1" : "utf-8";
    // A log is read as parse_log read it: stray bytes become replacement characters.
    let decoder = new TextDecoder("utf-8", { fatal: !options.utf8Log });
    const prefix = options.prefixBytes === undefined ? undefined : createHash("sha256");
    const decode = (bytes?: Buffer) => {
      if (latin1) return bytes?.toString("latin1") ?? "";
      try {
        return decoder.decode(bytes, { stream: bytes !== undefined });
      } catch (error) {
        if (encoding === "utf-8" && !options.utf8Log) throw new LegacyText(target.key, revision);
        throw error;
      }
    };
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
    let lineClipped = false;
    let retentionEnded = false;
    const wanted = () => !retentionEnded && totalLines + 1 >= offset && totalLines + 1 < offset + limit;
    const endLine = () => {
      totalLines++;
      if (!retentionEnded && totalLines >= offset && totalLines < offset + limit) {
        const prefix = `${totalLines}: `;
        const available = maxChars - outputCharacters - prefix.length - 1;
        if (available >= 0) {
          const text = current.slice(0, available);
          lineClipped = clipped || text.length < current.length;
          clipped = lineClipped;
          selected.push({ line: totalLines, text });
          outputCharacters += prefix.length + text.length + 1;
        } else clipped = true;
        if (clipped) retentionEnded = true;
      }
      current = "";
      hasContent = false;
    };
    const retain = (text: string, start: number, end: number) => {
      if (start === end) return;
      hasContent = true;
      if (clipped || !wanted()) return;
      for (const char of text.slice(start, end)) {
        const bytes = Buffer.byteLength(char);
        if (sourceBytes + bytes > maxSourceBytes || outputCharacters + current.length >= maxChars - 20) {
          clipped = true;
          break;
        }
        current += char;
        sourceBytes += bytes;
      }
    };
    const newline = /\r\n|[\r\n]/g;
    const consume = (text: string) => {
      if (!text.length) return;
      let start = previousCR && text.startsWith("\n") ? 1 : 0;
      previousCR = text.endsWith("\r");
      newline.lastIndex = start;
      for (let match = newline.exec(text); match; match = newline.exec(text)) {
        retain(text, start, match.index);
        endLine();
        start = newline.lastIndex;
      }
      retain(text, start, text.length);
    };
    for (;;) {
      signal.throwIfAborted();
      // With growth allowed the read stops at the size the file had when opened, so the snapshot is stable.
      const length = options.allowGrowth ? Math.min(buffer.length, before.size - position) : buffer.length;
      if (length <= 0) break;
      const { bytesRead } = await handle.read(buffer, 0, length, position);
      if (!bytesRead) break;
      if (options.utf8Log && position + bytesRead > 50 * 1024 * 1024)
        throw Error("Log exceeds the 50 MiB source limit.");
      const bytes = buffer.subarray(0, bytesRead);
      if (!position) {
        const bom = utf16Bom(bytes);
        if (bom) {
          if (latin1) throw Error("File changed while reading. Read it again.");
          encoding = bom;
          decoder = new TextDecoder(bom, { fatal: !options.utf8Log });
        } else if (!options.utf8Log && isBinary(bytes)) {
          throw Error("Cannot read a binary file. Choose a text file.");
        }
      }
      hash.update(bytes);
      if (prefix && options.prefixBytes !== undefined && position < options.prefixBytes)
        prefix.update(bytes.subarray(0, options.prefixBytes - position));
      consume(decode(bytes));
      position += bytesRead;
    }
    const after = await handle.stat();
    const growing = options.allowGrowth === true && after.size > before.size;
    try {
      consume(decode());
    } catch (error) {
      // The snapshot of a growing file may end inside a character the writer has not finished.
      if (!growing) throw error;
    }
    if (hasContent) endLine();
    const currentTarget = await guard.resolve(path);
    const currentStat = await lstat(currentTarget.absolute);
    signal.throwIfAborted();
    if (
      position !== before.size ||
      (!growing &&
        (before.size !== after.size ||
          before.mtimeMs !== after.mtimeMs ||
          before.ctimeMs !== after.ctimeMs)) ||
      currentTarget.key !== target.key ||
      currentStat.ino !== before.ino ||
      currentStat.dev !== before.dev
    )
      throw Error("File changed while reading. Read it again.");
    guard.assertAuthorized();
    return {
      target,
      encoding,
      selected,
      totalLines,
      truncated: clipped || offset - 1 + limit < totalLines,
      lineClipped,
      growing,
      sha256: hash.digest("hex"),
      ...(prefix && options.prefixBytes !== undefined && position >= options.prefixBytes
        ? { prefixSha256: prefix.digest("hex") }
        : {}),
      mtimeMs: after.mtimeMs,
      modified: after.mtime.toISOString(),
      size: after.size,
      revision: fileRevision(after),
    };
  } finally {
    await handle.close();
  }
}
