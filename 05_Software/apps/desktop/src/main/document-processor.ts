import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createDocumentProcessor, createPdfExtractor, EmbeddingHost } from "@vera/core";
export function createDocumentServices(resources: string) {
  const embeddings = new EmbeddingHost(
    new URL("./document-embedding-worker.js", import.meta.url),
    join(resources, "models"),
    JSON.parse(readFileSync(join(resources, "model-manifest.json"), "utf8")),
  );
  return {
    embeddings,
    processDocument: createDocumentProcessor(
      createPdfExtractor(new URL("./pdf-worker.js", import.meta.url)),
      embeddings,
    ),
  };
}
