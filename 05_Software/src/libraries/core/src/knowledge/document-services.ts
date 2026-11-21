import { defaultEmbeddingModelId, type EmbeddingModelId } from "@vera/shared";
import { EmbeddingHost, readEmbeddingModel } from "./embedding.js";
import type { DocumentProcessor } from "./ingest.js";
import { createDocumentProcessor } from "./processor.js";
import { createPassageBudget, type PassageBudget } from "./token-budget.js";
import { createOfficeExtractor, createPdfExtractor } from "./worker-host.js";

/**
 * The application's document limits, read as each extraction or idle period starts: the Document extraction
 * time limit (REQ-FUNC-aa35b135) and the Embedding worker idle time (REQ-FUNC-bfbd70b6).
 */
export interface DocumentLimits {
  extractionMs?: number;
  embeddingIdleMs?: number;
}

/** Share model-bound processing and embedding workers between native document hosts. */
export function createModelDocumentServices(
  models: string,
  embeddingWorker: URL,
  extractionWorker: URL,
  limits: () => DocumentLimits = () => ({}),
) {
  const services = new Map<EmbeddingModelId, { embeddings: EmbeddingHost; processor: DocumentProcessor }>();
  const extractionMs = () => limits().extractionMs ?? 120000;
  const pdf = createPdfExtractor(extractionWorker, extractionMs);
  const office = createOfficeExtractor(extractionWorker, extractionMs);

  function forModel(id: EmbeddingModelId) {
    let service = services.get(id);
    if (!service) {
      const model = readEmbeddingModel(models, id);
      const embeddings = new EmbeddingHost(
        embeddingWorker,
        models,
        model,
        undefined,
        undefined,
        () => limits().embeddingIdleMs ?? 60000,
      );
      let budget: PassageBudget | undefined;
      const processor = createDocumentProcessor(pdf, embeddings, office, (text) => {
        budget ??= createPassageBudget(models, model);
        return budget(text);
      });
      service = { embeddings, processor };
      services.set(id, service);
    }
    return service;
  }

  const processDocument: DocumentProcessor = async (input) =>
    forModel(input.embeddings?.model ?? defaultEmbeddingModelId).processor(input);
  processDocument.modelId = (id) => forModel(id).embeddings.modelId;
  const release = async (root: string) => {
    await Promise.all([...services.values()].map(({ embeddings }) => embeddings.release(root)));
  };
  processDocument.release = release;
  return {
    processDocument,
    embeddings: (id: EmbeddingModelId) => forModel(id).embeddings,
    release,
    async dispose() {
      await Promise.all([...services.values()].map(({ embeddings }) => embeddings.dispose()));
    },
  };
}
