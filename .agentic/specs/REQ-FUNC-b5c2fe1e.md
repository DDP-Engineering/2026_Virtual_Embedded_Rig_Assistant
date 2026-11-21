# REQ-FUNC-b5c2fe1e — Workbench retrieval coverage

Each reply describes the committed index used for that search. Scanning, indexing, a guarded or interrupted selection, and a selection completed with exceptions yield partial coverage. A settled selection at admission and return yields complete coverage of eligible sources. Read-only snapshots and sources without a live phase report unknown coverage. A search that exhausts its revision attempts also reports unknown coverage.

## Response contract

`coverage` is `complete`, `partial` or `unknown`. `usage` carries the actual ranking:

- `{ mode: "keyword" }` for a keyword search. A substituted keyword search sets `fallbackReason` to `embedding-rebuild`, `semantic-unavailable` or `revision-conflict`.
- `{ mode: "semantic" }` or `{ mode: "hybrid" }` when that ranking ran.
- `{ mode: null, reason: "no-candidates" }` when the settled selection is empty or the path filter excludes all published candidates.
- `{ mode: null, reason: "index-not-ready" }` when no searchable chunks have published and the selection's coverage is partial or unknown.
- `{ mode: null, reason: "revision-conflict" }` when three attempts failed to obtain a coherent revision.

A ranked search can return an empty `results` array at any coverage. Pending sources can hold matches when coverage is partial. Invalid arguments, cancellations and unexpected ranking errors keep their error behavior.

`docs.search` uses the same metadata with a matching `workbenchId`. It validates hits against the current source hash, status, kind and locator before accepting the attempt revision. Successful `search_docs` records the structural `documentSearch` field in the corresponding `tool.done` event and folded tool item. Consumers read that field for past turns. The tool's model-facing JSON keeps `coverage` and `usage` through Agent masking. Display masking still scrubs summary text.

## Live scope

`WorkbenchService.documentIndexPhase(id, db?)` returns the current phase for the live workbench. Supplying the database used by a session also validates that lease. Initial scan and queued reconciliation are unsettled. The Files and sidebar status snapshot adds
measured progress and independent searchable counts for the current activation. The transcript uses
stored per-search metadata. During active publication, an invalidated semantic attempt that spent at
least 150 ms moves directly to a fresh keyword attempt. Cheap conflicts retain the requested-mode retry.
