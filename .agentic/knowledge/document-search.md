# Local semantic retrieval and document tools

## Routing

Select for persisted embeddings, semantic/hybrid ranking, search_docs/read_doc,
CLI index/search and the production retrieval gate. Start at core knowledge/
{embedding,embedding-worker,search}.ts and storage/schema.ts.
[Ingest](knowledge-ingest.md) owns source admission/publication and locks;
[extraction](document-extraction.md) owns locators/cache/chunks;
[keyword](keyword-search.md) owns lexical candidates;
[sessions](sessions.md) owns tool execution and issued citation projection.

## Purpose and boundaries

Core supplies a local CPU embedding host/worker and read-only DocumentKnowledge
over a workbench database. Desktop and CLI choose resource paths and independently
compiled worker entrypoints. WorkerPool continues to own grep; embedding operations
use their own persistent host because their payloads, lifetimes and caches differ.

## Public interface

- EmbeddingHost(entry, models, manifest, deadlineMs=120000) embeds passages in
  batches32 and ranks normalized cosine top50. embed/rank accept root and signal;
  rank accepts vectors or a lazy vector provider evaluated at serialized admission;
  cached tests an epoch/model/filter key; release(root)/dispose terminate/drain.
- DocumentKnowledge(root,db,embeddingPort?) supplies search(query,k8,hybrid,
  pathGlob?) and read(path,page/pageEnd,heading,lineStart/lineEnd). Strict schemas
  bound k1..20, query1000 and prevent unknown fields. Results carry ref/path/
  typed locator/snippet<=300/score. Empty index suggests grep; unavailable model
  vectors suggest reindex or keyword/grep.
- read verifies confined current source SHA256 and reads full persisted extraction.
  PDF defaults page1; text defaults all lines; headings default first section.
  Families and bounds are checked; complete ranges shrink to the actual returned
  ref within12000 characters and JSON budget. Oversized single units fail actionably.
- Registry offers both as read-class tools and respects disabled names/permissions.
  SessionService binds the workbench knowledge port. validDocumentRef resolves PDF
  pages/ranges and Markdown/HTML heading slugs through current guarded source SHA256,
  indexed metadata and matching persisted extraction bounds independently of output
  caps. validPdfRef retains the page-only compatibility entrypoint. Shared refs.ts
  owns syntax/format/labels; sessions owns successful-tool provenance and current
  text-line/session-artifact validation; transcript chips own presentation.
- CLI index reindexes a writable workbench and returns document statuses; search
  reads current owned/protected snapshots in three modes. Both drain workbench/
  worker/settings/temp resources on all exits. eval:retrieval uses production
  migrated storage/worker/search over the frozen ordered corpus and raw questions.

## Invariants

- EmbeddingHost disables native ONNX telemetry in the real parent before Worker
  initialization, covering desktop and CLI local inference.
- Manifest identity includes model/revision/dtype/descriptor/assets. Local assets
  are hash/length verified in the worker; Transformers disables remote loading,
  caches and inference fetch. Pinned q8 CPU ORT uses one thread, CLS/L2 float32
  dim384. Full prefixed inputs including specials must remain below512 tokens.
- Host admission deadlines include queue time. Abort/deadline/crash/early exit
  settle active work after termination; subsequent calls replace the worker.
  Serialized per-root workers cache vectors by epoch/model/filter. Root disposal
  clears cache and drains queued operations before owned resources disappear.
- Migration3 adds embeddings with FK cascade and full document_extractions.
  DocumentsRepository validates extraction/vector count/finite/dimension/norm and
  atomically replaces chunks, full extraction and vectors in ingest publication.
  SQL triggers advance embedding_epoch for vector/chunk mutations and invalidate
  updated chunk vectors. Existing migration SQL/checksums remain immutable.
- Unchanged indexed sources reprocess when current-model vector coverage differs;
  file change/delete/reindex shares established ownership/abort invalidation.
  Protected read-only snapshots run no ingest/migration; legacy lexical availability
  is preserved and unavailable semantic/extraction data has an explicit error.
- Lexical and cosine lists cap50, ties use numeric ids; hybrid uses one-based
  RRF60 and deduplication. Validated path glob filters before candidate limits.
  Search checks epoch across async ranking/path guards and rejects concurrent
  index changes. Main reads only lightweight candidate paths plus selected text;
  worker retains the vector matrix.
- Frozen gate: hybrid24/28 overall,14/14 EN,11/14 RO; keyword/semantic reported
  separately. Locator matches use exact path/page/heading with top5 chunks.

## Architecture

```mermaid
flowchart LR
  Host[Desktop / CLI resources] --> EmbeddingHost
  EmbeddingHost --> Worker[Local model / per-root vector cache]
  Ingest[Owned ingest queue] --> Processor[Extraction / chunks / local embeddings]
  Processor --> EmbeddingHost
  Ingest --> Repository[Atomic documents / chunks / extraction / vectors]
  Repository --> DB[(SQLite / vector epoch)]
  Tools[Read tools / CLI search] --> Knowledge[DocumentKnowledge]
  Knowledge --> DB
  Knowledge --> Lexical[KeywordSearch]
  Knowledge --> EmbeddingHost
  Knowledge --> Guard[PathGuard / current source verification]
```

## Change map

| Change | Start | Focused proof |
|---|---|---|
| local descriptor/batches/cache/termination | embedding.ts, embedding-worker.ts | embedding.test.ts; real eval |
| atomic lifecycle/schema | storage/schema.ts, DocumentsRepository, processor/ingest | embedding-schema, embedding-ingest, ingest tests |
| modes/RRF/glob/snippets/read bounds | search.ts, keyword.ts | search.test.ts, keyword.test.ts |
| registry/replay/citations | tools/documents.ts, SessionService | registry/search replay and document-cli tests |
| citation page/heading bounds and current source | search.ts validDocumentRef; shared refs.ts | search.test.ts; agent/citations.test.ts; tests/e2e/citations.spec.ts |
| host/CLI/bundles | document-processor, entrypoints/builds | document-hosts/document-cli, build-mode/packaging and native ingest |

## Key behaviors

REQ-DATA-154fb0af atomic embedding lifecycle; REQ-FUNC-0e93fa45 deterministic
bounded retrieval; REQ-FUNC-cc209d7e guarded document tools and owned CLI.
REQ-FUNC-51165496 verifies issued document bounds against current source/extraction.

## Files

Under05_Software: core knowledge/{embedding,embedding-worker,embedding-ingest,
search,processor,ingest}; storage/{schema,repos/documents};
tools/documents; CLI {args,documents,document-processor,embedding-worker}; desktop
{document-processor,document-embedding-worker,index,sessions}; scripts/{eval-retrieval,
retrieval/product-eval,build-cli,package}; corresponding focused tests and ingest E2E.
