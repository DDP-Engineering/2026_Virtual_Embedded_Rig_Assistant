import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createModelDocumentServices, embeddingModelManifestPath } from "@vera/core";

/** Locate the local models in the source workspace or beside the installed CLI. */
export function cliResources(): string {
  let path = dirname(fileURLToPath(import.meta.url));
  while (dirname(path) !== path) {
    const sourceModels = join(path, "src/models");
    if (existsSync(embeddingModelManifestPath(sourceModels))) return sourceModels;
    const installedModels = join(path, "resources/models");
    if (existsSync(embeddingModelManifestPath(installedModels))) return installedModels;
    path = dirname(path);
  }
  throw Error("Local model resources unavailable.");
}
export function createDocumentServices(models = cliResources()) {
  return createModelDocumentServices(
    models,
    new URL("./embedding-worker.js", import.meta.url),
    new URL("./pdf-worker.js", import.meta.url),
  );
}
