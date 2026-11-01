# Desktop indexer process

## Routing

Select for the VERA Indexer utility process, its message protocol, crash restart and the Docs
"Indexing stopped" status: `IndexerHost`, `createIndexerHandler`, `indexer-process.ts`,
`indexer.status`/`indexer.restart`. Start at
05_Software/src/apps/desktop/src/main/indexer-host.ts; focused proof is main/indexer-host.test.ts,
main/indexer-handler.test.ts and native tests/e2e/indexer.spec.ts. What is selected and how rows
are written routes to [Background document ingest](knowledge-ingest.md); extraction to
[Document extraction](document-extraction.md); embeddings and ranking to
[Document search](document-search.md).

## Purpose and boundaries

The desktop app runs document selection, source hashing, the document processor (verification,
extraction cache, PDF/office worker threads, chunking) and local embeddings in an Electron
utility process named "VERA Indexer" (TASK-f09609fd). The main process keeps the watcher, the
ingest queue, ownership checks and every SQLite write; it reaches the indexer only through the
`DocumentProcessor` ports (`select`, `inspect`, the processor call, `release`) and the
`EmbeddingPort` that search uses. The CLI keeps the in-process composition.

## Public interface

- `IndexerHost({spawn, modelId, now?, status?})`: `processor` (a `DocumentProcessor` with
  `select`/`inspect`/`release`/`modelId`), `embeddings` (`EmbeddingPort`), `state()`, `pid()`,
  `restart()`, `close()`. The process starts on the first call (utilityProcess needs a ready app).
- `createIndexerHandler(services, send)`: the in-process dispatch of `select`, `inspect`,
  `process`, `embed`, `rank`, `release` and `cancel`; replies `{id, ok, value}` or
  `{id, ok: false, error: {message, code?} | {aborted: true}}`.
- `indexer-process.ts`: the utility entry; arguments `--models=` and `--manifest=`.
- Shared: app event `indexer.status {state: running|stopped}`; channels `indexer.status` and
  `indexer.restart`; Docs shows `[data-indexer-stopped]` with Restart.

## Invariants

- Only data crosses the boundary; signals and ownership callbacks stay on each side. A cancelled
  request's `assertWritable` throws in the indexer, so cache writes stop on cancel; this is best
  effort (RULING-004): the cache is content-addressed and verified on read. Error replies carry
  errno `code`s, so ingest still retries a vanished source (ENOENT).
- A crash rejects every call in flight with `retry: true, crashed: true`; ingest keeps such
  documents pending and reconciles again, but stores a document as failed (PROCESSING) after two
  crashes on the same content (RULING-006). A failed start counts as a crash (RULING-007). Three
  within 60 s stop restarts until `restart()`; a reindex selects before clearing rows, and Docs
  disables Reindex while stopped. Search falls back to keyword results when ranking reports a
  retry error (RULING-005).
- `release(root)` is posted without waiting and never starts an indexer; closing a workbench does
  not wait for the indexer.
- Ranking sends vectors only after the indexer answers `needRows`: the handler passes lazy rows that
  the EmbeddingHost reads only when its epoch cache misses at execution time.
- The e2e network guard patches the main process only; the indexer composes no network code
  (inspection).

## Change map

| Change requested | Start with | Focused verification |
|---|---|---|
| protocol message or reply shape | `createIndexerHandler`, `IndexerHost.call` | indexer-handler.test.ts, indexer-host.test.ts |
| crash/restart policy | `IndexerHost.exited`, `restart` | indexer-host.test.ts "stops after three crashes…" |
| process composition or arguments | main/index.ts `new IndexerHost`, indexer-process.ts | tests/e2e/indexer.spec.ts |
| stopped status UI | docs-tab.tsx `indexer.status` query | documents.test.ts "shows stopped indexing…" |

## Key behaviors

- `REQ-FUNC-f9d5ae8d` — documents are hashed, verified, extracted, chunked and embedded in the
  indexer; main persists the results.
- `REQ-FUNC-362ebed9` — selection runs in the indexer with the same rules.
- `REQ-FUNC-276a5da8` — search embeddings and ranking run in the indexer.
- `REQ-REL-6a962d80` — a crash keeps VERA running, restarts the indexer and retries in-flight
  documents.
- `REQ-REL-08946818` — three crashes within a minute stop restarts.
- `REQ-UX-f6c347b8` — Docs shows stopped indexing with Restart.
- `REQ-REL-4761ac1e` — close/switch cancels pending work and releases embeddings without waiting.
- `REQ-FUNC-5e627a51` — keyword fallback when the indexer cannot rank.
- `REQ-REL-cb8c082d` — a document that crashed the indexer twice is failed until it changes.

## Files

- `05_Software/src/apps/desktop/src/main/indexer-host.ts` — main-side host: ids, cancel, restart
  policy, processor and embedding ports.
- `05_Software/src/apps/desktop/src/main/indexer-handler.ts` — indexer-side protocol dispatch.
- `05_Software/src/apps/desktop/src/main/indexer-process.ts` — utility process entry composing
  the document services, `selectDocuments` and `inspectSource`.
- `05_Software/src/apps/desktop/src/main/index.ts` — composition, status event, channels, test pid
  hook.
- `05_Software/src/apps/desktop/electron.vite.config.ts` — `indexer-process` build entry.
- `05_Software/src/apps/desktop/src/renderer/components/documents/docs-tab.tsx` — stopped status
  and Restart.
- `05_Software/src/apps/desktop/src/main/indexer-host.test.ts` — host protocol, crash and restart.
- `05_Software/src/apps/desktop/src/main/indexer-handler.test.ts` — handler dispatch and cancel.
- `05_Software/tests/e2e/indexer.spec.ts` — native process, kill and recovery, search.
