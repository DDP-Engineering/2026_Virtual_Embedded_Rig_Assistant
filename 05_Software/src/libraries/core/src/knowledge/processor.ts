import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { lstat, open } from "node:fs/promises";
import { extname, join } from "node:path";
import { z } from "zod";
import { PathGuard } from "../workbench/path-guard.js";
import { chunkDocument, needsOcr } from "./chunk.js";
import type { EmbeddingPort } from "./embedding.js";
import {
  type Extraction,
  extractHtml,
  extractionSchema,
  extractMarkdown,
  extractText,
} from "./extraction.js";
import { type DocumentInput, type DocumentProcessor, PDF_LIMIT, TEXT_LIMIT } from "./ingest.js";
import type { PdfExtractor } from "./worker-host.js";

const cacheSchema = z
  .object({ version: z.literal(1), sha256: z.string().regex(/^[a-f0-9]{64}$/), extraction: extractionSchema })
  .strict();
const CACHE_LIMIT = 128 * 1024 * 1024;
const absent = (e: unknown) => (e as NodeJS.ErrnoException).code === "ENOENT";
function allowed(input: DocumentInput) {
  input.signal.throwIfAborted();
  input.assertWritable();
}
function cachePath(input: DocumentInput, create: boolean, checkOwnership = true): string {
  if (checkOwnership) allowed(input);
  let directory = input.root;
  for (const segment of [".vera", "cache", "extract"]) {
    directory = join(directory, segment);
    try {
      const stat = lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error("Cache directory is redirected.");
    } catch (error) {
      if (!absent(error) || !create) throw error;
      allowed(input);
      mkdirSync(directory);
    }
  }
  return join(directory, `${input.sha256}.json`);
}
function checkCacheFile(path: string) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > CACHE_LIMIT)
    throw Error("Cache file is unsafe.");
  return stat;
}
async function readCache(input: DocumentInput): Promise<Extraction | undefined> {
  let path: string;
  try {
    path = cachePath(input, false);
  } catch (error) {
    if (absent(error)) return;
    throw error;
  }
  let before: ReturnType<typeof checkCacheFile>;
  try {
    before = checkCacheFile(path);
  } catch (error) {
    if (absent(error)) return;
    throw error;
  }
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (opened.ino !== before.ino || opened.dev !== before.dev || opened.size > CACHE_LIMIT)
      throw Error("Cache changed.");
    allowed(input);
    const bytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < bytes.length) {
      allowed(input);
      const read = await handle.read(bytes, offset, Math.min(64 * 1024, bytes.length - offset), offset);
      if (!read.bytesRead) break;
      offset += read.bytesRead;
    }
    allowed(input);
    cachePath(input, false);
    const current = checkCacheFile(path),
      after = await handle.stat();
    if (
      current.ino !== opened.ino ||
      current.dev !== opened.dev ||
      after.size !== opened.size ||
      after.mtimeMs !== opened.mtimeMs ||
      after.ctimeMs !== opened.ctimeMs ||
      offset !== opened.size
    )
      throw Error("Cache changed.");
    try {
      const parsed = cacheSchema.safeParse(JSON.parse(bytes.toString("utf8")));
      if (parsed.success && parsed.data.sha256 === input.sha256 && parsed.data.extraction.kind === input.kind)
        return parsed.data.extraction;
    } catch {
      /* A malformed local cache is regenerated from verified source bytes. */
    }
  } finally {
    await handle.close();
  }
  return;
}
function saveCache(input: DocumentInput, extraction: Extraction) {
  const path = cachePath(input, true);
  try {
    checkCacheFile(path);
  } catch (error) {
    if (!absent(error)) throw error;
  }
  const text = JSON.stringify({ version: 1, sha256: input.sha256, extraction });
  if (Buffer.byteLength(text) > CACHE_LIMIT) throw Error("Extraction cache exceeds budget.");
  const temporary = `${path}.${randomUUID()}.tmp`;
  let owned = false;
  try {
    allowed(input);
    cachePath(input, false);
    const fd = openSync(temporary, "wx", 0o600);
    owned = true;
    try {
      writeFileSync(fd, text, "utf8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    allowed(input);
    cachePath(input, false);
    try {
      checkCacheFile(path);
    } catch (error) {
      if (!absent(error)) throw error;
    }
    renameSync(temporary, path);
    owned = false;
  } finally {
    if (owned) {
      cachePath(input, false, false);
      unlinkSync(temporary);
    }
  }
}
export async function verifyDocumentSource(input: DocumentInput): Promise<Uint8Array> {
  allowed(input);
  const guard = await PathGuard.create(input.root);
  const target = await guard.resolve(input.path);
  const ordinary = async () => {
    const parts = input.path.split("/");
    for (let n = 1; n <= parts.length; n++) {
      const stat = await lstat(join(input.root, ...parts.slice(0, n)));
      if (stat.isSymbolicLink() || (n < parts.length ? !stat.isDirectory() : !stat.isFile()))
        throw Error("Source is redirected.");
    }
    return lstat(target.absolute);
  };
  const before = await ordinary();
  const limit = input.kind === "pdf" ? PDF_LIMIT : TEXT_LIMIT;
  if (before.size > limit) throw Error("Source exceeds budget.");
  const handle = await open(target.absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (
      !opened.isFile() ||
      opened.ino !== before.ino ||
      opened.dev !== before.dev ||
      opened.size !== before.size
    )
      throw Error("Source changed.");
    const bytes = new Uint8Array(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      allowed(input);
      const read = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!read.bytesRead) break;
      offset += read.bytesRead;
    }
    const after = await handle.stat(),
      current = await ordinary();
    allowed(input);
    if (
      offset !== before.size ||
      current.ino !== opened.ino ||
      current.dev !== opened.dev ||
      current.size !== before.size ||
      current.mtimeMs !== before.mtimeMs ||
      current.ctimeMs !== before.ctimeMs ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs ||
      createHash("sha256").update(bytes).digest("hex") !== input.sha256
    )
      throw Error("Source changed.");
    return bytes;
  } finally {
    await handle.close();
  }
}
export function createDocumentProcessor(pdf: PdfExtractor, embeddings?: EmbeddingPort): DocumentProcessor {
  const processor: DocumentProcessor = async (input) => {
    if (!/^[a-f0-9]{64}$/.test(input.sha256)) throw Error("Invalid extraction key.");
    const bytes = await verifyDocumentSource(input);
    let extraction = await readCache(input);
    if (!extraction) {
      if (input.kind === "pdf") extraction = await pdf(bytes, input.signal);
      else {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        extraction =
          input.kind === "markdown"
            ? extractMarkdown(text)
            : input.kind === "html"
              ? extractHtml(text)
              : extractText(text);
      }
      allowed(input);
      if (!extraction) throw Error("Extraction failed.");
      saveCache(input, extraction);
    }
    allowed(input);
    const pages = extraction.kind === "pdf" ? { pages: extraction.pages.length } : {};
    const chunks = needsOcr(extraction)
      ? []
      : chunkDocument(extraction, extname(input.path).toLowerCase() === ".csv", input.embeddings);
    const vectors =
      embeddings && chunks.length
        ? await embeddings.embed(
            input.root,
            chunks.map((c) => c.text),
            input.signal,
          )
        : undefined;
    allowed(input);
    return needsOcr(extraction)
      ? { status: "needs_ocr", reason: "NEEDS_OCR", ...pages, chunks: [] }
      : {
          status: "indexed",
          ...pages,
          chunks,
          derived: { extraction, ...(vectors && embeddings ? { vectors, modelId: embeddings.modelId } : {}) },
        };
  };
  if (embeddings) {
    processor.modelId = embeddings.modelId;
    processor.release = (root) => embeddings.release(root);
  }
  return processor;
}
