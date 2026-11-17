import { forTextNewlines, type LargeTextSource, TEXT_WINDOW_BYTES, textUnit } from "./large-text-source.js";
import type { TextEncoding } from "./text-encoding.js";

export interface TextWindow {
  offset: number;
  end: number;
  lines: string[];
  starts: number[];
  target: number;
  column: number;
}

export function decodeTextChunk(
  bytes: Uint8Array,
  encoding: TextEncoding,
  replace: boolean,
  offset: number,
  eof: boolean,
  allowNul = false,
) {
  const text = new TextDecoder(encoding, { fatal: !replace, ignoreBOM: offset > 0 }).decode(bytes, {
    stream: !eof,
  });
  if (!replace && !allowNul && text.includes("\0")) throw new TypeError("Binary text");
  return text;
}

/** Maps decoded UTF16 character positions back to physical bytes, including replacement sequences. */
export function textByteOffset(
  bytes: Uint8Array,
  encoding: TextEncoding,
  offset: number,
  characters: number,
) {
  if (characters <= 0) {
    if (offset === 0 && encoding === "utf-8" && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
      return 3;
    if (
      offset === 0 &&
      encoding.startsWith("utf-16") &&
      ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))
    )
      return 2;
    return 0;
  }
  let low = 0,
    high = bytes.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const text = new TextDecoder(encoding, { ignoreBOM: offset > 0 }).decode(bytes.subarray(0, middle), {
      stream: true,
    });
    if (text.length < characters) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Reads a bounded fragment, preserving codepoint boundaries without fetching an entire long line. */
export async function readTextWindow(
  source: LargeTextSource,
  encoding: TextEncoding,
  replace: boolean,
  target: number,
  signal: AbortSignal,
) {
  const { size } = source.file;
  const unit = textUnit(encoding);
  let offset = Math.floor(Math.max(0, Math.min(size, target) - 8192) / unit) * unit;
  const bytes = await source.read(
    offset,
    Math.min(TEXT_WINDOW_BYTES, Math.max(1, size - offset)),
    signal,
    true,
  );
  let skip = 0;
  if (offset > 0 && encoding === "utf-8") while (skip < 3 && ((bytes[skip] ?? 0) & 0xc0) === 0x80) skip++;
  if (offset > 0 && unit === 2) {
    const code =
      encoding === "utf-16le"
        ? (bytes[0] ?? 0) + (bytes[1] ?? 0) * 256
        : (bytes[0] ?? 0) * 256 + (bytes[1] ?? 0);
    if (code >= 0xdc00 && code <= 0xdfff) skip = 2;
  }
  offset += skip;
  const part = bytes.subarray(skip);
  const end = offset + part.length;
  let lines: string[];
  if (bytes.lineEnds) {
    lines = [];
    const decoder = new TextDecoder(encoding, { fatal: !replace, ignoreBOM: offset > 0 });
    let from = 0;
    for (const boundary of bytes.lineEnds) {
      const until = boundary - skip;
      if (until <= 0) continue;
      lines.push(decoder.decode(part.subarray(from, until), { stream: true }).replace(/\r?\n$|\r$/, ""));
      from = until;
    }
    lines.push(decoder.decode(part.subarray(from), { stream: end !== size }));
  } else {
    const text = decodeTextChunk(part, encoding, replace, offset, end === size);
    lines = text.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
  }
  const starts = [offset];
  if (bytes.lineEnds)
    for (const at of bytes.lineEnds) {
      if (at > skip) starts.push(offset + at - skip);
    }
  else forTextNewlines(part, encoding, (at) => starts.push(offset + at));
  if (bytes.lineEnds && end === size && starts.at(-1) === size && lines.at(-1) === "") {
    starts.pop();
    lines.pop();
  }
  const index = Math.max(
    0,
    starts.findLastIndex((start) => start <= target),
  );
  const column = new TextDecoder(encoding, { ignoreBOM: (starts[index] ?? 0) > 0 }).decode(
    part.subarray((starts[index] ?? offset) - offset, Math.max(0, target - offset)),
    { stream: true },
  ).length;
  return { offset, end, lines, starts, target: index + 1, column } satisfies TextWindow;
}
