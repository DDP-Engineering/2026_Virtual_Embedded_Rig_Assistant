# ADR-0006: Local embeddings with a bundled model

Date: 2026-10-09
Status: Accepted; implemented — model selected by ADR-0015 (WP-24)

## Context
Semantic search over datasheets and notes needs embeddings. The ChatGPT subscription offers no
embeddings endpoint, many local OpenAI-compatible servers offer none either, and indexing through a
remote API would send every document off the machine. The package must start offline and download
nothing at run time (L5).

## Decision
Embeddings are computed locally with `@huggingface/transformers` on the onnxruntime-node backend, in a
worker thread. The model files ship in the package under `resources/models/`; remote model loading is
disabled. Candidates: `bge-small-en-v1.5` and `multilingual-e5-small` (384 dimensions). WP-24
measures size, speed and recall@5 on the demo corpus and files the choice as a new ADR. Search is
hybrid: exact identifiers come from the keyword index, so retrieval does not depend on embeddings alone.

## Alternatives considered
- Provider embeddings (OpenAI `text-embedding-3-small`): unavailable to subscription and most local
  users, and documents leave the machine.
- Keyword search only: misses paraphrased questions.
- Embeddings from a local Ollama: requires a separate installation, against self-containment.

## Consequences
- The package grows by the model size (tens of MB up to about 120 MB, measured by WP-24).
- First indexing of large PDF sets takes CPU time; it runs in the background with progress.
- Changing the model re-embeds every workbench on open.
- The same ONNX runtime can later serve a local speech-to-text model for voice.

## Implementation status (2026-11-01)
- Implemented as decided: transformers 4.3.1 on onnxruntime-node 1.30.0
  (`src/apps/desktop/package.json:9,18`), CPU, in a worker thread
  (`src/libraries/core/src/knowledge/embedding.ts:123`, `knowledge/embedding-worker.ts:26`).
- Remote model loading and filesystem/browser caches are off (`embedding-worker.ts:13-17`). Model
  files ship from `src/models` to `resources/models` through `extraResources`
  (`src/apps/desktop/electron-builder.yml`, `scripts/package.mjs:149-153`,
  `src/apps/desktop/src/main/index.ts:84-89`).
- Model: `Xenova/bge-small-en-v1.5` q8 (ADR-0015), the only value the workbench schema accepts
  (`src/libraries/shared/src/workbench.ts:11`).
- Hybrid search fuses keyword and semantic ranks with RRF (`knowledge/search.ts:161-170,264`).
  Ingest re-embeds when the current model's vectors are missing (`knowledge/ingest.ts:438-445`).
- On desktop, the embedding worker runs inside the "VERA Indexer" utility process, not in main
  (see ADR-0009).
- L5 (no run-time downloads) is superseded by ADR-0017 for plugins only; the embedding model is
  still bundled. Open: speech-to-text on the same runtime.
