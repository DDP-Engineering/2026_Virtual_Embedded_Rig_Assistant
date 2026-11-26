import type { LargeTextIndex } from "./large-text-index.js";
import {
  forTextNewlines,
  type LargeTextSource,
  TEXT_SCAN_BYTES,
  textUnit,
  yieldTextScan,
} from "./large-text-source.js";
import { decodeTextChunk, textByteOffset } from "./large-text-window.js";
import type { TextEncoding } from "./text-encoding.js";

export interface LargeTextMatch {
  offset: number;
  line: number;
}
export interface LargeTextMatches {
  hit?: LargeTextMatch;
  current: number;
  total: number;
}

const cachedMatches = new WeakMap<LargeTextSource, { key: string; hits: LargeTextMatch[] }>();
const MAX_CACHED_HITS = 10_000;

/** Counts matching source lines with scalar first/last/selected hits, wrapping without a file-wide list. */
export async function findLargeText(
  source: LargeTextSource,
  index: LargeTextIndex,
  encoding: TextEncoding,
  replace: boolean,
  query: string,
  fromLine: number,
  forward: boolean,
  signal: AbortSignal,
  reveal: (hit: LargeTextMatch) => Promise<void>,
): Promise<LargeTextMatches> {
  if (!query) return { current: 0, total: 0 };
  const cacheKey = JSON.stringify([encoding, replace, query]);
  const cached = cachedMatches.get(source);
  if (!source.file.verified && cached?.key === cacheKey) {
    await source.verify(signal);
    const { hits } = cached;
    if (!hits.length) return { current: 0, total: 0 };
    const found = forward
      ? hits.findIndex((hit) => hit.line > fromLine)
      : hits.findLastIndex((hit) => hit.line < fromLine);
    const at = found < 0 ? (forward ? 0 : hits.length - 1) : found;
    const hit = hits[at];
    if (hit) await reveal(hit);
    return { ...(hit ? { hit } : {}), current: at + 1, total: hits.length };
  }
  const expression = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  let total = 0,
    current = 0,
    line = 1,
    offset = 0;
  let matched = false;
  let hits: LargeTextMatch[] | undefined = source.file.verified ? undefined : [];
  let carry = new Uint8Array(0);
  let first: LargeTextMatch | undefined,
    last: LargeTextMatch | undefined,
    selected: LargeTextMatch | undefined;
  while (offset < source.file.size) {
    const bytes = await source.read(offset, Math.min(TEXT_SCAN_BYTES, source.file.size - offset), signal);
    index.ingest(offset, bytes);
    if (
      !source.file.verified &&
      !query.includes("\n") &&
      encoding === "utf-8" &&
      bytes.every((byte) => byte === 10)
    ) {
      line += bytes.length;
      matched = false;
      carry = new Uint8Array(0);
      offset += bytes.length;
      await yieldTextScan(signal);
      continue;
    }
    const ends: number[] = [];
    forTextNewlines(bytes, encoding, (end) => ends.push(end));
    const newlineCount = ends.length;
    if (ends.at(-1) !== bytes.length) ends.push(bytes.length);
    let start = 0;
    for (let e = 0; e < ends.length; e++) {
      const end = ends[e] ?? bytes.length;
      const fragment = bytes.subarray(start, end);
      if (!source.file.verified && carry.length === 0 && fragment.length === 1 && fragment[0] === 10) {
        line++;
        matched = false;
        start = end;
        if (e % 1024 === 1023) await yieldTextScan(signal);
        continue;
      }
      const raw = new Uint8Array(carry.length + fragment.length);
      raw.set(carry);
      raw.set(fragment, carry.length);
      let rawStart = offset + start - carry.length;
      let skip = 0;
      if (rawStart > 0 && encoding === "utf-8") while (skip < 3 && ((raw[skip] ?? 0) & 0xc0) === 0x80) skip++;
      if (rawStart > 0 && encoding.startsWith("utf-16")) {
        const code =
          encoding === "utf-16le" ? (raw[0] ?? 0) + (raw[1] ?? 0) * 256 : (raw[0] ?? 0) * 256 + (raw[1] ?? 0);
        if (code >= 0xdc00 && code <= 0xdfff) skip = 2;
      }
      const part = raw.subarray(skip);
      rawStart += skip;
      const text = decodeTextChunk(
        part,
        encoding,
        replace,
        rawStart,
        offset + end === source.file.size,
        source.file.verified !== undefined,
      );
      const match = matched ? null : expression.exec(text);
      if (match) {
        matched = true;
        total++;
        const hit = { offset: rawStart + textByteOffset(part, encoding, rawStart, match.index), line };
        if (hits) {
          if (hits.length < MAX_CACHED_HITS) hits.push(hit);
          else hits = undefined;
        }
        first ??= hit;
        last = hit;
        if ((forward && selected === undefined && line > fromLine) || (!forward && line < fromLine)) {
          selected = hit;
          current = total;
          if (forward) await reveal(hit);
        }
      }
      const isEnd = e < newlineCount;
      if (isEnd) {
        line++;
        matched = false;
        carry = new Uint8Array(0);
      } else {
        const keep = Math.max(0, raw.length - (query.length * 4 + 4));
        carry = raw.slice(Math.floor(keep / textUnit(encoding)) * textUnit(encoding));
      }
      start = end;
      if (e % 1024 === 1023) await yieldTextScan(signal);
    }
    offset += bytes.length;
    await yieldTextScan(signal);
  }
  await source.verify(signal);
  if (hits) cachedMatches.set(source, { key: cacheKey, hits });
  if (selected === undefined) {
    selected = forward ? first : last;
    current = selected ? (forward ? 1 : total) : 0;
  }
  if (selected) await reveal(selected);
  return { ...(selected ? { hit: selected } : {}), current, total };
}
