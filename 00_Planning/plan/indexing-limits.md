# IDX — Indexing limits for large workbenches

PURPOSE: keep indexing of large repositories fast and its search results clean, by honoring `.gitignore`, letting
the user lower the file size limit and stopping before an unexpectedly large selection is indexed.
STATE: implemented: IDX-01 #275 (186eb701), IDX-02 #276 (debce19c), IDX-03 #277 (f1408b35), IDX-04 #278
(9315d4d5). Product code follows AEGIS, one work package per task.

## Current implementation

- The indexer selects every document-kind file (PDF, Markdown, HTML, Office, `.txt`, `.csv`, `.tsv`) under Include
  minus Exclude (`core/src/knowledge/selection.ts`). Above `docs.maxFiles` (default 10,000) nothing is indexed
  until "Index anyway" (`core/src/knowledge/guard.ts`). Code and logs are never indexed.
- Ignored: `.veraignore` and, always, `.vera`, `.git` and `node_modules` (`core/src/workbench/ignore.ts`). With
  `docs.gitignore` on (the default), the root and nested `.gitignore` files are read too, so virtual
  environments, `build/`, `dist/`, `target/`, coverage reports and generated HTML documentation they list are
  not indexed.
- File size limits: 100 MiB for PDF and Office, 20 MiB for text (`core/src/knowledge/kinds.ts`); `docs.maxFileMB`
  lowers them.
- The New Workbench and workbench editor preview runs the indexer's own selection with a 5 s time limit
  (`core/src/workbench/documents-scan.ts`), so the preview and indexing count the same files; it warns above
  2,000 files or 2 GiB.
- Indexing runs in its own process; the window stays responsive, but a first run over thousands of documents is
  long and the workbench database grows with every chunk and vector.

## Decisions (2026-11-15)

- **`.gitignore` is honored by default.** Documents & RAG gets a "Use .gitignore" switch, on for new workbenches;
  the root `.gitignore` and nested ones apply like Git does, `.veraignore` and the permanent rules still win,
  and a `!` rule in `.veraignore` can bring back a file `.gitignore` drops. The Files tab keeps marking ignored
  entries as it does today.
- **Maximum file size per workbench:** "Maximum file size (MB)" in Documents & RAG, empty by default (the fixed
  limits). It can only lower them.
- **Maximum indexed files as a guard, not a cut:** "Maximum indexed files", default 10,000. When the selection is
  larger, indexing does not start; the workbench shows the count, the ten folders with the most selected files,
  "Index anyway" (for this selection) and "Edit exclusions". Indexing never takes an arbitrary first part of the
  selection.
- **One selection for preview and indexing:** the preview counts with the same rules as the indexer (ignore
  files, size and count limits); the walk bound of the preview stays only as a time limit and says so.
- **Skipped files are visible:** the Documents list shows each skipped file with its reason (too large, over the
  file limit), never silently dropped. Pre-release policy: the new `docs` fields join `workbench.yaml` at format 1.

## Work packages

| WP | Title | Result |
|---|---|---|
| IDX-01 | `.gitignore` in the selection | `docs.gitignore` (default true for new workbenches) read by the ignore policy for indexing, preview and the Files tab marks; nested `.gitignore` files; precedence over `.veraignore` and permanent rules as above |
| IDX-02 | Size and count settings | `docs.maxFileMB` and `docs.maxFiles` in the workbench config; Documents & RAG fields with validation; the selection applies the size limit and reports skipped files with reasons |
| IDX-03 | Count guard | an over-limit selection stops before indexing with the count and top folders; "Index anyway" records an approval for that selection's count; "Edit exclusions" opens Documents & RAG; status in the indexer panel |
| IDX-04 | Preview equals indexing | the preview uses the indexer's selection rules and limits; New Workbench and the editor show the same counts and the guard's warning before saving |

Order: IDX-01 and IDX-02 (independent), then IDX-03, then IDX-04. Help pages (Documents and search) and the
interface texts in en, ro, de and fr are updated inside each work package.

## Verification

- Unit: `.gitignore` rules including nested files, negation and the precedence of `.veraignore` and permanent
  rules; size limit lowering only; the guard's decision at, below and above the limit.
- Integration: a fixture repository with `.venv/`, `htmlcov/` and `build/html/` listed in `.gitignore` indexes
  only its real documents; with the switch off they are indexed; a 30 MB PDF is skipped with "too large" under a
  25 MB limit.
- E2E (native): a generated workbench of 12,000 small Markdown files stops at the guard, shows the top folders,
  and indexes after "Index anyway"; the preview and the indexed count agree.

## Out of scope

- Indexing code or logs (RULING-005), per-folder limits, and a time budget for indexing.
