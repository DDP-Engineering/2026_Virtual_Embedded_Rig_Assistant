# EMB — A multilingual embedding model

PURPOSE: let a workbench whose documents are not in English (Romanian, German, French specifications, notes and
reports) find them by meaning, by offering a second local embedding model chosen per workbench.
STATE: planned 2026-11-15. Product code follows AEGIS, one work package per task.

## Today (2026-11-15)

- One embedding model exists: `Xenova/bge-small-en-v1.5`, q8, 384 dimensions, English only. The workbench schema
  allows only it (`z.literal` in `shared/src/workbench.ts`), and Edit workbench > Indexing shows it as the only
  choice.
- Main reads one manifest (`src/models/model-manifest.json`) and runs one embedder for the whole app
  (`desktop/src/main/index.ts`, `core/src/knowledge/embedding.ts`). The manifest schema already carries the
  query and passage prefixes and the pooling; it fixes 384 dimensions and 512 tokens.
- Stored vectors already record their `model_id` (`embeddings` table), and search filters on it.
- Chunks are cut to 512 tokens with the BGE tokenizer (`core/src/knowledge/token-budget.ts`), whatever the model.
- Hybrid search (keywords and meaning) partly covers other languages today through the keyword half only.

## Decisions (2026-11-15)

- **Second model: `Xenova/multilingual-e5-small`** (q8, about 120 MB, MIT), 384 dimensions and 512 tokens like
  BGE Small, with the prefixes `query: ` and `passage: `. It covers about 100 languages including ro, de and fr.
  `bge-m3` was rejected for size (about 570 MB, 1024 dimensions) and speed on CPU.
- **BGE Small EN stays the default**: datasheets and reference manuals are almost all English, and it is smaller
  and faster. The choice is per workbench in Edit workbench > Indexing, named "BGE Small EN v1.5 (English)" and
  "Multilingual E5 Small (100 languages)". No language detection and no automatic switch.
- **Both models ship in every package** (offline install stays complete); the Windows and Linux packages grow by
  about 120 MB. The delivery scripts ([delivery.md](delivery.md)) verify both manifests.
- **Changing the model rebuilds the workbench's vectors** after a confirmation that names the document count; the
  extracted text and keyword index stay. The old vectors are deleted, not kept (pre-release policy, no migration).
- **Chunking follows the chosen model's tokenizer**, so no chunk exceeds 512 tokens of that model.

## Work packages

| WP | Title | Result |
|---|---|---|
| EMB-01 | Model registry | `src/models/<model-id>/model-manifest.json` per model, both fetched and checked by `npm run prepare:model`; a registry in core listing the known models; the workbench schema accepts any registered id (format stays 1) |
| EMB-02 | Embedder per model | main starts an embedder worker per model in use, on demand, and stops an idle one; indexing and search of a workbench use its model; the token budget uses that model's tokenizer |
| EMB-03 | Switching | Edit workbench > Indexing lists both models; Save with a changed model asks for confirmation, deletes the workbench's vectors of the old model and re-embeds in the background with the usual progress; search keeps working on keywords until vectors are back |
| EMB-04 | Delivery and licences | both models in the Windows and Linux packages and their licence notices; `delivery:verify` checks both manifests' hashes |

Order: EMB-01, EMB-02, EMB-03; EMB-04 with EMB-01. Help pages (Documents and search) and the interface texts in
en, ro, de and fr are updated inside each work package.

## Verification

- Unit: registry and manifest validation; the E5 prefixes applied to queries and passages; chunking by each
  tokenizer stays within 512 tokens.
- Integration: a Romanian and a German fixture document: with E5 a paraphrased query in the same language and an
  English query find them by meaning; with BGE the meaning half misses and the keyword half still finds exact
  terms; switching models replaces all vectors of the workbench and nothing else.
- E2E (native): switch a workbench to Multilingual E5, confirm, watch the rebuild finish, search in Romanian.
- Performance: indexing speed and memory of E5 against BGE on the session performance machine, recorded in
  `06_SoftwareDocu/`.

## Out of scope

- Cloud embedding providers, larger local models (bge-m3) and per-folder model choices; translating documents or
  queries.
