import { createModelDocumentServices } from "@vera/core";

export function createDocumentServices(models: string) {
  return createModelDocumentServices(
    models,
    new URL("./document-embedding-worker.js", import.meta.url),
    new URL("./pdf-worker.js", import.meta.url),
  );
}
