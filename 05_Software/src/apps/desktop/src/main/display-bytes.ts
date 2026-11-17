import type { ByteReadSource } from "@vera/core";
import { DOCS_BYTE_CONTEXT_LIMIT } from "@vera/shared";

const singleByteMaps = ["windows-1252", "iso-8859-2"].map((encoding) => {
  const decoder = new TextDecoder(encoding);
  const map = new Map<string, number>();
  for (let byte = 0; byte < 256; byte++) map.set(decoder.decode(Uint8Array.of(byte)), byte);
  return map;
});

function* representations(token: string): Generator<Buffer> {
  yield Buffer.from(token, "utf8");
  yield Buffer.from(token, "utf16le");
  yield Buffer.from(token, "utf16le").swap16();
  if ([...token].every((char) => (char.codePointAt(0) as number) <= 255)) yield Buffer.from(token, "latin1");
  for (const map of singleByteMaps) {
    const bytes: number[] = [];
    for (const char of token) {
      const byte = map.get(char);
      if (byte === undefined) break;
      bytes.push(byte);
    }
    if (bytes.length === [...token].length) yield Buffer.from(bytes);
  }
}

/** Linear matching includes overlaps without repeatedly overwriting a large matching span. */
function maskMatches(input: Buffer, pattern: Buffer, output: Buffer, from: number) {
  const prefix = new Int32Array(pattern.length);
  for (let i = 1, matched = 0; i < pattern.length; i++) {
    while (matched && pattern[i] !== pattern[matched]) matched = prefix[matched - 1] as number;
    if (pattern[i] === pattern[matched]) matched++;
    prefix[i] = matched;
  }
  let maskedEnd = 0;
  for (let i = 0, matched = 0; i < input.length; i++) {
    while (matched && input[i] !== pattern[matched]) matched = prefix[matched - 1] as number;
    if (input[i] === pattern[matched]) matched++;
    if (matched !== pattern.length) continue;
    const start = Math.max(maskedEnd, 0, i + 1 - pattern.length - from);
    const end = Math.min(output.length, i + 1 - from);
    if (end > start) {
      output.fill(42, start, end);
      maskedEnd = end;
    }
    matched = prefix[matched - 1] as number;
  }
}

/** Byte-preserving Display masking; context stays host-only, and overlong secrets mask the entire window. */
export function maskByteWindow(source: ByteReadSource, length: number, secrets: readonly string[]): Buffer {
  const from = source.offset - source.start;
  const count = Math.min(length, Math.max(0, source.size - source.offset));
  const output = Buffer.from(source.bytes.subarray(from, from + count));
  if (!output.length) return output;
  for (const secret of secrets) {
    if (!secret) continue;
    if (secret.length * 2 > DOCS_BYTE_CONTEXT_LIMIT) return output.fill(42);
    const escaped = JSON.stringify(secret).slice(1, -1);
    for (const token of secret === escaped ? [secret] : [secret, escaped]) {
      if (
        token.length * 2 > DOCS_BYTE_CONTEXT_LIMIT ||
        Buffer.byteLength(token, "utf8") > DOCS_BYTE_CONTEXT_LIMIT
      )
        return output.fill(42);
      for (const pattern of representations(token)) maskMatches(source.bytes, pattern, output, from);
    }
  }
  return output;
}
