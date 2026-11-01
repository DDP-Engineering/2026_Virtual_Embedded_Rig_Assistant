# Background document ingest

## Routing

Select for document discovery, watcher/hash/size states, index events, reindex
and source invalidation. Start at core knowledge/ingest.ts and
storage/repos/documents.ts under05_Software. Focused proof is ingest.test.ts,
shared documents-ipc.test.ts and native tests/e2e/ingest.spec.ts. Workbench lifecycle
and locks route to [Workbench](workbench.md), the database schema to
[Storage](workbench-storage.md), transport/redaction to [IPC](ipc-boundary.md).

## Purpose and boundaries

WorkbenchService owns one Ingester while storage is writable. Ingester observes
the filesystem, reconciles configured selection and persists document metadata;
DocumentsRepository invalidates derived rows. Desktop and CLI share the core
composition. Desktop/CLI composition supplies the [document processor](document-extraction.md)
for extraction, cache and chunks; bare core composition can supply its own processor.

## Public interface

createPdfExtractor accepts optional Node worker resourceLimits; existing ingest callers retain their current defaults. Downloaded PDFs use a separately capped worker and stay in .vera/downloads, outside the ingest/RAG boundary; see [PDF downloads](pdf-downloads.md).


- WorkbenchService.reindexDocuments serializes an owned rebuild. Strict empty
  docs.reindex IPC invokes it through desktop main; the mock enforces ownership.
- Ingester.request coalesces changes with trailing1000ms debounce; reindex selects
  first, then clears and reconciles in the same queue (a failed selection leaves the index
  intact, TASK-f09609fd); close stops/aborts/drains before disposal.
- DocumentProcessor receives root/path/kind/hash/AbortSignal/ownership callback and returns
  indexed/failed/unsupported/needs_ocr with optional pages/stable reason and ordered chunks. The
  processor must settle on abort; publication checks file identity and ownership,
  then atomically persists status and validated chunks before emitting events.
- index.document carries path and a typed record, null for removal;
  index.progress carries pending/done/failed counters for the reconciliation
  batch, including skipped paths. Main redacts paths and preserves protocol fields.
- DocumentProcessor may carry `select` and `inspect` ports; without them the Ingester uses the
  in-process `selectDocuments` (knowledge/selection.ts) and `inspectSource` (knowledge/inspect.ts).
  The desktop app supplies them from the [indexer process](indexer-process.md). An error with
  `retry: true` (indexer interrupted) keeps a document pending and requests reconciliation
  instead of storing PROCESSING/IO, except that two errors marked `crashed` on the same content
  store it as failed (PROCESSING) and skip it while the workbench stays open (RULING-006); `WorkbenchService.refreshDocuments()` requests one after the
  indexer restarts (TASK-f09609fd). Shared helpers (limits, documentKind, documentSelection)
  live in knowledge/kinds.ts and are re-exported from ingest.ts.
- index.volume {files, bytes} follows every selection; Ingester.volume() and
  WorkbenchService.documentVolume() return the last one (null before the first) and
  docs.volume exposes it. The renderer warns above shared documentVolumeLimit (more
  than 2,000 files or 2 GiB) in Docs and the Documents section; indexing continues
  (TASK-e5310cdb). Docs reads docs.volume again on every mount, since events reach only
  a mounted tab. The Documents section preview, which runs before indexing, has its own
  wording and also warns when its bounded scan stopped early, as "at least N files"
  (RULING-004).
- DocumentsRepository list/get/save/remove/clearDerived/replaceChunks uses the current schema (schema_version 1).
  Invalidation clears associated embeddings and chunks before source deletion
  or replacement. Schema chunk triggers atomically maintain chunks_fts/chunks_tri;
  [keyword search](keyword-search.md) reads persisted candidates and locators.

Policy reads .vera/.veraignore with ordinary-parent checks. The watcher admits events
for .vera/workbench.yaml and .vera/.veraignore (Windows case aliases included),
while .vera content stays permanently excluded from indexed documents.

## Invariants

- Chokidar5.0.0 and picomatch4.0.7 are exactly pinned. File-event admission uses
  picomatch include/exclude and ignore rules; unrelated writes do not reset debounce.
  Shared normalization expands directory selectors and folds negative includes
  into exclusions before both admission and discovery.
  Tinyglobby resolves include minus exclude;
  PathGuard/shared ignore policies and ordinary ancestor checks confine input.
  Permanent .vera/.git/node_modules segments and symlink/junction aliases are
  excluded. Root .vera/.veraignore edits and saved configuration trigger reconciliation.
- REQ-REL-2512a455: watcher registrations use positive-include literal prefixes and
  the two policy files, rather than recursively monitoring unrelated workbench trees.
  Root-wide globs intentionally watch the root. Missing source roots remain targets;
  explicit nested targets stop at existing symlink ancestors. Invalid globs keep only
  policy monitoring and are rejected by reconciliation. Changed roots close the old
  watcher and create a replacement through a serialized queue; readiness reconciles
  any registration gap. Cancelled readiness settles before a watcher closes; waitIdle
  follows the current watcher generation. Close cancels replacements and releases
  the current watcher.
- documentKind maps .pdf, Markdown, HTML, .txt/.csv/.tsv text and the modern office
  formats (.docx/.odt document, .pptx/.odp presentation, .xlsx/.ods spreadsheet);
  code, logs, data files, legacy .doc/.ppt/.xls and RTF are other. Only non-other
  paths are selected: other files are never opened, hashed or recorded, and stored
  rows of such paths leave on the next reconciliation (TASK-e5310cdb). Discovery
  passes tinyglobby an fs adapter whose readdir drops folders rejected by
  .veraignore, the permanent rules or docs.exclude and files of other kinds, so
  excluded trees are never listed; the chokidar ignored callback applies the same
  rules to directories and files, and a .veraignore or pattern change re-registers
  the watcher. Folders are matched only in their "dir/" form, so an allowlist
  .veraignore ("*", "!*/", "!*.pdf") keeps them; when chokidar has no stats yet a
  path is skipped only if ignored in both forms. Bounded asynchronous SHA-256 reads cap
  input at 100MiB for binary kinds (PDF, office) and 20MiB for text; binary kinds
  skip the text check. Exact limits are allowed. Binary text and oversized files
  carry BINARY/SIZE_LIMIT (TYPE_UNSUPPORTED stays a valid stored reason). Raw errors become
  IO/PROCESSING codes; an office archive over its entry/size limits is SIZE_LIMIT.
- Same hash skips completed/pending/unsupported content; failed content retries.
  Supported input starts pending, and indexedAt is set only for a successful
  supplied processor. A changed source during processing schedules reconciliation.
- Ownership is checked before synchronous SQLite mutations. Read-only workbenches
  keep private snapshots and run no watcher. Close/switch aborts and drains ingest
  before lock release/storage close; failed release restores observation.
- The schema supplies embeddings and full extraction storage. Current-model vector coverage controls unchanged-file
  reprocessing; atomic publication includes validated derived data. See
  [document search](document-search.md) for model/worker/ranking contracts.
- Manual reindex admits work on the lifecycle queue and waits for completion
  outside that queue so close/switch can abort active processing.

## Change map

| Change | Start | Focused verification |
|---|---|---|
| Selection/hash/limits/status/processing | Ingester | ingest.test.ts |
| Invalidation/publication/indexes | DocumentsRepository | real schema FTS/synthetic embedding cases and processor/watcher/search integration |
| Lifecycle | WorkbenchService | ingest and workbench service tests |
| IPC/event shape/redaction | shared contracts, main/events | documents-ipc and main events tests; native ingest |

## Key behaviors

- REQ-FUNC-a93d863d — background selection/hash/status/events with owned lifecycle.
- REQ-DATA-05172f94 — atomic invalidation on delete/change/reindex/deselection.

## Files

- src/libraries/core/src/knowledge/{ingest.ts,ingest.test.ts} — queue and integration.
- src/libraries/core/src/storage/repos/documents.ts — metadata and derived cleanup.
- src/libraries/core/src/workbench/service.ts — ownership/lifecycle/reindex.
- src/libraries/shared/src/{documents.ts,documents-ipc.test.ts,events.ts,ipc.ts} — contracts.
- src/apps/desktop/src/main/{index.ts,events.ts,events.test.ts} — IPC and scrubbed events.
- src/apps/desktop/src/renderer/mocks/{mockApi.ts,mockApi.test.ts} — mock reindex.
- tests/e2e/ingest.spec.ts — native sandboxed host acceptance.
