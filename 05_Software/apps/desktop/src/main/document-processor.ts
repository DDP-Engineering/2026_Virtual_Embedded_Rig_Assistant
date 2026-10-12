import { createDocumentProcessor, createPdfExtractor } from "@vera/core";
export const processDocument = createDocumentProcessor(
  createPdfExtractor(new URL("./pdf-worker.js", import.meta.url)),
);
