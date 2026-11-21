import { createModelDocumentServices, type DocumentLimits } from "@vera/core";

export function createDocumentServices(models: string, limits?: () => DocumentLimits) {
  return createModelDocumentServices(
    models,
    new URL("./document-embedding-worker.js", import.meta.url),
    new URL("./pdf-worker.js", import.meta.url),
    limits,
  );
}
