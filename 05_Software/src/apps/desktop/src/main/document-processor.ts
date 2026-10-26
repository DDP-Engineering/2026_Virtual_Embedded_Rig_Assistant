import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createDocumentProcessor, createPdfExtractor, EmbeddingHost } from "@vera/core";
export function createDocumentServices(models: string, manifestPath = join(models, "model-manifest.json")) {
  const embeddings = new EmbeddingHost(
    new URL("./document-embedding-worker.js", import.meta.url),
    models,
    JSON.parse(readFileSync(manifestPath, "utf8")),
  );
  return {
    embeddings,
    processDocument: createDocumentProcessor(
      createPdfExtractor(new URL("./pdf-worker.js", import.meta.url)),
      embeddings,
    ),
  };
}
