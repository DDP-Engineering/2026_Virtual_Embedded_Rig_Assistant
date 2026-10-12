import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDocumentProcessor, createPdfExtractor, EmbeddingHost } from "@vera/core";
/** Locate application resources beside the installed CLI or source workspace. */
export function cliResources(): string {
  let path = dirname(fileURLToPath(import.meta.url));
  while (dirname(path) !== path) {
    const resources = join(path, "resources");
    if (existsSync(join(resources, "model-manifest.json"))) return resources;
    path = dirname(path);
  }
  throw Error("Local model resources unavailable.");
}
export function createDocumentServices(resources = cliResources()) {
  const embeddings = new EmbeddingHost(
    new URL("./embedding-worker.js", import.meta.url),
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
