# Active workbench indexing status

A positive process-local lease identifies one workbench activation. The current-workbench response carries the lease with the workbench id. A status request validates both, and every update carries the same identity and a nondecreasing revision. A consumer subscribes before retrieving its snapshot and applies only strictly newer updates for its mounted lease. A mismatch is a conflict. Read-only activations get their own lease. A different folder receives a new lease even when it shares a copied workbench id. When the renderer adopts a new activation, it drops cached Files results for that id before showing the folder.

## Selection state

- Scanning covers initial watcher readiness, selection, and queued reconciliation. It has no progress denominator, including the gap between passes when a follow-up is pending.
- Indexing reports an accepted selection. The denominator counts selected and explicitly skipped document paths. Processed counts terminal path results in that pass, including exceptions. A pending or retried path does not count as processed. Exceptional counts include skipped, needs OCR and failed paths. Searchable counts published indexed documents with at least one passage, including retained passages during rebuild.
- Embedding rebuild is a distinct state while model replacement is pending or active. Its progress is indeterminate during selection. Published passages remain available to keyword search when retained.
- Ready means a settled, exception-free selection with searchable documents. Exceptions means a settled selection with known exceptions. Empty means a settled, exception-free selection with zero searchable documents.
- Count guard identifies the blocked selection and provides its existing approval and exclusions controls. Watcher loss and other blocking errors expose Files and Reindex where available. Reindex retries failed watcher registration. Readiness from a healthy replacement clears the watcher failure. Stopped exposes the existing Restart control. Count guard and stopped have no active progress denominator. A read-only state describes the retained snapshot and has no live scan progress.

## Delivery

Files and the active sidebar indicator share the same status source. Status goes to the two status consumers, outside transcript, session list and retrieval. Count updates may be coalesced. New queries read current measured state. Updates contain no per-document details. The persisted retrieval metadata continues to describe what the tool used at search time.
