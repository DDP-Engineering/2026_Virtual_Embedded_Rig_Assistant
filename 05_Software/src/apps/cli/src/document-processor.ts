import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDocumentProcessor, createPdfExtractor, EmbeddingHost } from "@vera/core";
/** Locate the local models in the source workspace or beside the installed CLI. */
export function cliResources(): string {
  let path = dirname(fileURLToPath(import.meta.url));
  while (dirname(path) !== path) {
    const sourceModels = join(path, "src/models");
    if (existsSync(join(sourceModels, "model-manifest.json"))) return sourceModels;
    const resources = join(path, "resources");
    if (existsSync(join(resources, "model-manifest.json"))) return join(resources, "models");
    path = dirname(path);
  }
  throw Error("Local model resources unavailable.");
}
export function createDocumentServices(
  models = cliResources(),
  manifestPath = existsSync(join(models, "model-manifest.json"))
    ? join(models, "model-manifest.json")
    : join(dirname(models), "model-manifest.json"),
) {
  const embeddings = new EmbeddingHost(
    new URL("./embedding-worker.js", import.meta.url),
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
