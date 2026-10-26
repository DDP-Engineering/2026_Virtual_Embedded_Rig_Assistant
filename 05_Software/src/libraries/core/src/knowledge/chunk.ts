import { z } from "zod";
import type { Extraction } from "./extraction.js";
import { CHUNK_TOKEN_LIMIT, countChunkTokens } from "./token-budget.js";

export const CHUNK_CHARS = 1400;
export const locatorSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("page"), page: z.number().int().positive() }).strict(),
  z
    .object({
      type: z.literal("lines"),
      start: z.number().int().positive(),
      end: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      type: z.literal("heading"),
      path: z.array(z.string()),
      slug: z.string(),
      start: z.number().int().positive().optional(),
      end: z.number().int().positive().optional(),
    })
    .strict(),
]);
export const chunkSchema = z
  .object({
    text: z
      .string()
      .max(CHUNK_CHARS)
      .refine((text) => countChunkTokens(text) < CHUNK_TOKEN_LIMIT),
    locator: locatorSchema,
  })
  .strict();
export type Chunk = z.infer<typeof chunkSchema>;

/** Prefer paragraphs, then whitespace; preserve every character, including long unbroken strings. */
function split(text: string, limit: number, prefix = ""): string[] {
  if (limit < 2 || countChunkTokens(prefix) >= CHUNK_TOKEN_LIMIT)
    throw Error("Heading or CSV prefix exceeds chunk budget.");
  const result: string[] = [];
  while (text) {
    let ceiling = Math.min(limit, text.length);
    if (countChunkTokens(prefix + text.slice(0, ceiling)) >= CHUNK_TOKEN_LIMIT) {
      let low = 0,
        high = ceiling;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (countChunkTokens(prefix + text.slice(0, middle)) < CHUNK_TOKEN_LIMIT) low = middle;
        else high = middle - 1;
      }
      ceiling = low;
    }
    let end = ceiling === text.length ? ceiling : text.lastIndexOf("\n\n", ceiling - 2);
    if (end !== text.length && end >= ceiling / 2) end += 2;
    else if (end !== text.length) {
      end = text.lastIndexOf(" ", ceiling - 1);
      if (end < ceiling / 2) end = ceiling;
      else end++;
    }
    // Do not split a UTF16 surrogate pair.
    if (end > 0 && /[\uD800-\uDBFF]/.test(text[end - 1] ?? "")) end--;
    // WordPiece boundaries are not monotonic (long words can become UNK).
    while (end > 0 && countChunkTokens(prefix + text.slice(0, end)) >= CHUNK_TOKEN_LIMIT) {
      end = Math.floor(end / 2);
      if (end > 0 && /[\uD800-\uDBFF]/.test(text[end - 1] ?? "")) end--;
    }
    if (!end) throw Error("Heading or CSV prefix leaves no chunk budget.");
    result.push(text.slice(0, end));
    text = text.slice(end);
  }
  return result;
}
export function needsOcr(extraction: Extraction): boolean {
  return (
    extraction.kind === "pdf" &&
    extraction.pages.reduce((n, page) => n + page.trim().length, 0) / extraction.pages.length < 20
  );
}
export function chunkDocument(extraction: Extraction, csv = false): Chunk[] {
  const result: Chunk[] = [];
  if (extraction.kind === "pdf") {
    if (needsOcr(extraction)) return result;
    extraction.pages.forEach((text, index) => {
      for (const part of split(text, CHUNK_CHARS))
        if (part.trim()) result.push({ text: part, locator: { type: "page", page: index + 1 } });
    });
  } else if (extraction.kind === "text") {
    const { lines } = extraction;
    const first = csv ? 1 : 0;
    const prefix = csv && lines.length ? `${lines[0]}\n` : "";
    // A header is repeated verbatim; a header wider than the budget is an extraction failure.
    if (prefix.length > CHUNK_CHARS - 2) throw Error("CSV header exceeds chunk budget.");
    if (countChunkTokens(prefix) >= CHUNK_TOKEN_LIMIT) throw Error("CSV header exceeds token budget.");
    if (csv && lines.length === 1)
      result.push({ text: lines[0] ?? "", locator: { type: "lines", start: 1, end: 1 } });
    for (let start = first; start < lines.length; start += 50) {
      const end = Math.min(start + 60, lines.length);
      const text = lines.slice(start, end).join("\n");
      let lineStart = start + 1;
      for (const part of split(text, CHUNK_CHARS - prefix.length, prefix)) {
        const lineEnd = lineStart + (part.replace(/\n$/, "").match(/\n/g)?.length ?? 0);
        if (part.trim())
          result.push({ text: prefix + part, locator: { type: "lines", start: lineStart, end: lineEnd } });
        lineStart += part.match(/\n/g)?.length ?? 0;
      }
      if (end === lines.length) break;
    }
  } else {
    for (const section of extraction.sections) {
      const heading = section.path.join(" > ");
      const prefix = heading ? `${heading}\n` : "";
      let start = section.start;
      for (const part of split(section.text, CHUNK_CHARS - prefix.length, prefix)) {
        const end = start + (part.replace(/\n$/, "").match(/\n/g)?.length ?? 0);
        if (part.trim())
          result.push({
            text: prefix + part,
            locator: {
              type: "heading",
              path: section.path,
              slug: section.slug,
              ...(extraction.kind === "markdown" ? { start, end } : {}),
            },
          });
        start += part.match(/\n/g)?.length ?? 0;
      }
    }
  }
  return result;
}
