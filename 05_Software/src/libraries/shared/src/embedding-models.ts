export const defaultEmbeddingModelId = "Xenova/bge-small-en-v1.5";

/** Local embedding models known to the format-1 workbench contract and preparation tooling. */
export const embeddingModelIds = [defaultEmbeddingModelId, "Xenova/multilingual-e5-small"] as const;

export type EmbeddingModelId = (typeof embeddingModelIds)[number];
