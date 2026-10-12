# Background ingest contract

The workbench owns one chokidar watcher and one serialized ingest queue while it
has writable storage. A root watcher sees new included directories and root
.veraignore changes; permanent ignored segments and links are excluded. Each
batch reconciles docs.include minus docs.exclude through confined discovery after
a trailing 1000 ms debounce. Config saves request reconciliation. Reopen also
reconciles stale persisted paths. Empty include means an empty selection.
File-event admission matches the same picomatch engine as tinyglobby, so writes
outside selection cannot reset document debounce. Policy edits refresh admission.
One shared normalization expands directory selectors and folds single-negated
includes into exclusions, following pinned tinyglobby semantics; discovery disables
its second expansion and consumes these same positive patterns/exclusions.
Manual reindex is admitted by the lifecycle queue and awaits ingest completion
outside that queue, allowing close/switch to abort its processor.

Eligible ordinary files are hashed with SHA-256 using bounded asynchronous reads.
An unchanged successful/pending/unsupported record is skipped. Failed records
retry. Changed content invalidates derived rows before becoming pending. PDF
limit is 100 * 1024 * 1024 bytes and other supported text limit is 20 * 1024 *
1024 bytes, inclusive. Larger files and unknown extensions become unsupported
with stable reason codes. Errors become failed with a scrubbed code, never raw
filesystem exception text. The existing first8KiB binary classifier makes
binary text inputs unsupported with BINARY; PDF bytes remain opaque to ingest.

Supported inputs are classified pdf, markdown, html or text. The processor seam
receives path/kind/hash and AbortSignal, and returns indexed, failed, unsupported
or needs_ocr plus optional pages/reason. The initial composition leaves supported
inputs pending until a processor is supplied. No extraction/search result is
invented. Close stops admission, aborts processing, closes the watcher and drains
the queue before lock/database disposal; synchronous mutations recheck ownership.

docs.reindex has a strict empty request and response; it clears derived rows and
documents in its queue, then rebuilds the current selection. index.document has
path and document (null for removal); index.progress has pending/done/failed safe
integer batch counters. Observers cannot roll back storage. Deletion and content
invalidation clear external-content FTS rows before chunks, embeddings associated
with those chunks, then chunks; absent downstream tables are normal.

Validation uses real FS watcher and SQLite integration, size/error/hash cases,
reindex/deletion with synthetic downstream tables, config/ignore/link boundaries,
ownership loss, close/switch, and strict shared IPC/event schemas on Windows and
native Ubuntu. No extraction, FTS creation, embedding, retrieval, or Docs UI is
part of this contract.
