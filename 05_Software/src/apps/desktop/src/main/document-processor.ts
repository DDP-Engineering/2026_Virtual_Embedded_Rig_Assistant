import {
  createDocumentProcessor,
  createOfficeExtractor,
  createPdfExtractor,
  EmbeddingHost,
  readEmbeddingModel,
} from "@vera/core";
export function createDocumentServices(models: string) {
  const embeddings = new EmbeddingHost(
    new URL("./document-embedding-worker.js", import.meta.url),
    models,
    readEmbeddingModel(models),
  );
  return {
    embeddings,
    processDocument: createDocumentProcessor(
      createPdfExtractor(new URL("./pdf-worker.js", import.meta.url)),
      embeddings,
      createOfficeExtractor(new URL("./pdf-worker.js", import.meta.url)),
    ),
  };
}
