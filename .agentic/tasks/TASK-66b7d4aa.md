# TASK-66b7d4aa - Browse the workbench as a folder tree in Docs

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-FUNC-889beffd, REQ-UX-c28dde55, REQ-UX-795a7f61, REQ-UX-775eb693, REQ-FUNC-70dc2e8f, REQ-FUNC-2e3fad2d, REQ-UX-9f16abf2, REQ-UX-2d9cdf43, REQ-UX-fdd495b8, REQ-UX-28ad0003, REQ-UX-541a5bee, REQ-FUNC-98e9d760, REQ-UX-4d1b3324
parent:
branch: master
base: 2791fea62e7588f9bf782d3fc22820cbfe9fee42
opened: 2026-11-01

Edit Frame, Requirement coverage and Design directly. Write State, Log and
Rulings with `python .agentic/aegis.py` (advance, pause, log, ruling, verdict);
end each session with `advance` or `pause`.

## Done checklist (current stage)

- [ ] diff reviewed against scope, requirements, design, error paths,
      portability, security and unrequested work
- [ ] knowledge pages of changed components current with the reviewed code
- [ ] project and environment context reconciled with the candidate
- [ ] requirements re-read: status, prose, verification, paths and links true
- [ ] manual or inspection verification recorded where applicable
- [ ] explicit review approved, when enabled
- [ ] final `check --strict --run` result logged truthfully after the last edit
- [ ] remaining warnings and pre-existing failures explained
- [ ] `report` appended

## Frame

Problem:
- STATED (user, 2026-10-31): for workbenches with much documentation the Docs listing is hard to
  follow; a file explorer like Claude desktop's would be better. (2026-11-01: "continuă cu tree
  explorer pentru Docs".)
- OBSERVED: Docs renders the document index as one flat ordered list (renderer
  documents/docs-tab.tsx `ol.documents-list`): path, status/reason, Open and Open externally per
  row; content search results replace it while a query is typed.
- OBSERVED: core `WorkbenchService.files(query)` walks the workbench with .veraignore and
  permanent rules, skips links and returns up to 50 matching paths; `DocumentViewer.openPath`
  opens indexed documents; the viewer content schema has a `text` kind with lines.
Desired outcome: Docs shows the workbench folder as an expandable tree; documents show their
  index status, folders their indexed-document count and a problem marker; clicking a file opens
  it in Source (indexed documents as today, other files as text); a name filter searches the whole
  workbench; the expansion is remembered; the tree is keyboard navigable.
Actors: the desktop user.
Primary scenario: in a large workbench the user expands datasheets/st, sees "stm32g4 (42)" with a
  problem marker, opens a failed PDF's folder, clicks a datasheet that opens in Source, filters by
  "rm0440" to find the reference manual, and later reopens VERA with the same folders expanded.
Examples: `firmware/main.c` appears dimmed among folders and opens as text; `.git`,
  `node_modules`, `.vera` and `.veraignore`'d folders do not appear; a filter with 500 matches
  shows the first 200 and says there are more.
Counterexamples: the content search (search box) keeps its result list; indexing rules and the
  document set do not change; binary non-document files cannot be shown as text.
In scope: a lazily loaded folder tree in Docs (entries listed per folder on expansion); hidden
  set = what VERA ignores; status per indexed document; folder count of indexed documents beneath
  plus a problem marker (failed, needs OCR, unsupported); click/Enter opens in Source (indexed
  documents via the existing viewer, other files as text with size and binary limits); Open in
  default app and Properties from a context menu (RULING-009, RULING-011); a whole-workbench name filter (first 200 matches); expansion
  remembered per workbench; Collapse all; ARIA tree keyboard navigation; locales; tests.
Out of scope: indexing changes (TASK-e5310cdb rules stay); file operations (rename and delete
  follow in a separate task, RULING-010; create); editing files; counting non-indexed files on disk (RULING-007); showing ignored
  entries (RULING-005).
Constraints: on master (default branch); no commits unless asked; reads stay confined to the
  workbench with PathGuard, ignore rules and no links; main stays responsive on large folders
  (listing is per folder; the filter walk is bounded).
Success signals: renderer tests for tree rendering, counts/markers, opening, filter, memory,
  collapse all and keyboard; core tests for listing, filter and text reading (ignore rules, links,
  limits); native e2e that browses a folder tree and opens an indexed and a non-indexed file.
Evidence: renderer docs-tab.tsx, viewer-context.tsx; core workbench/service.ts files(),
  knowledge/viewer.ts; shared documents.ts viewer schema, ipc.ts docs channels.
Assumptions: none.
Unknowns: the per-folder entry cap and the text size limit (design proposes values); how
  binary files are reported in Source (design).
Decision-blocking questions: none open. Answered by the user (RULING-001..008).
Proposed behaviors (accepted by RULING-001..008):
- Show the whole workbench folder (RULING-001), hiding what VERA ignores (RULING-005).
- Click opens in Source (RULING-002); non-indexed files open as text (RULING-006).
- Folders show the indexed-document count beneath and a problem marker (RULING-003, RULING-007).
- Name filter over the whole workbench, first 200 matches (RULING-004, RULING-008); expansion
  remembered; Collapse all; arrow-key navigation (RULING-004).
Path and reason: full.
  | Criterion | Holds? | Evidence |
  |---|---|---|
  | no new externally observable behavior | no | new tree, filter, text view |
  | no new interface or data format | no | listing, filter and read channels |
  | no new dependency | yes | none planned |
  | an existing requirement already covers the behavior | no | REQ-UX-28ad0003 covers a flat list |
  | no security or data-handling change | no | reads of non-indexed workbench files |

## Requirement coverage

| Behavior | Requirement | Source in Frame |
|---|---|---|
| folder entries listed per folder, hidden set excluded, capped | REQ-FUNC-889beffd | RULING-001, RULING-005 |
| tree in Docs, lazy expansion, status per document, other files dimmed | REQ-UX-c28dde55 | RULING-001, RULING-002 |
| folder count of indexed documents and problem marker | REQ-UX-795a7f61 | RULING-003, RULING-007 |
| click/Enter opens in Source | REQ-UX-775eb693 | RULING-002, RULING-006 |
| non-indexed text files read with limits | REQ-FUNC-70dc2e8f | RULING-006 |
| whole-workbench name search, first 200 | REQ-FUNC-2e3fad2d | RULING-004, RULING-008 |
| filter shows matches with folders expanded and a more note | REQ-UX-9f16abf2 | RULING-004, RULING-008 |
| expansion remembered per workbench; Collapse all | REQ-UX-2d9cdf43 | RULING-004 |
| ARIA tree keyboard navigation | REQ-UX-fdd495b8 | RULING-004 |
| status and reason per document, search, Reindex, progress, states | REQ-UX-28ad0003 (reused) | observed Docs panel |
| context menu with Open, Open in default app, Properties | REQ-UX-541a5bee | RULING-009 |
| entry properties from the workbench | REQ-FUNC-98e9d760 | RULING-011 |
| Properties view | REQ-UX-4d1b3324 | RULING-011 |

Revised: REQ-UX-775eb693 (Open in default app moves from the row into the context menu, RULING-009). REQ-UX-f5d6e9e4 (done task) keeps its wording: in Docs its named action is now the row menu's item. REQ-UX-28ad0003 keeps its wording: each document's status and reason are now shown on its tree row. Values set here for the Frame unknowns: 5,000 entries per folder, 5 MiB text view, 50,000-entry filter walk.

## Design

**Approach.**
- Core `workbench/tree.ts` (pure, rooted at the workbench folder, ignore policy from the shared
  `readIgnorePolicy`): `listFolder(root, path)` checks every segment is an ordinary folder
  (no links), refuses hidden or outside paths, reads one directory, drops links and hidden entries
  (folders tested as "dir/"), sorts folders then files with a numeric, case-insensitive collator
  and caps at 5,000 with `truncated`. `findFiles(root, fragment)` walks visible folders breadth
  first, stops after 50,000 entries or 200 matches, and reports `truncated`. `readText(root,
  path)` reads an ordinary visible file up to 5 MiB, refuses binary (first 8 KiB probe or invalid
  UTF-8) and larger files with `INVALID` and message keys `documents.textBinary` /
  `documents.textTooLarge`, and returns viewer `text` content (ref null, all lines, start 1).
- `WorkbenchService.listFolder/findFiles/readText(workbenchId, ...)` check the active workbench
  (CONFLICT otherwise) and run the pure functions on its folder. They do not need storage, so a
  read-only workbench browses too.
- IPC: `docs.tree {workbenchId, path}` -> `{workbenchId, path, entries: [{name, path, type:
  folder|file}], truncated}`; `docs.find {workbenchId, query}` -> `{workbenchId, paths,
  truncated}`; `docs.read {workbenchId, path}` -> `{workbenchId, content}` (viewer content,
  scrubbed like docs.open).
- Renderer: new `documents/docs-tree.tsx` replaces the flat list in `DocsTab` while no content
  search is typed. Folder entries come from `docs.tree` queries enabled when a folder is
  expanded. Documents from `docs.list` are indexed by path; folder counts and problem markers are
  aggregated from them (RULING-007). File rows: a status icon with the localized status and reason as
  tooltip and screen-reader text (RULING-012), other files dimmed (`data-indexed=false`); Open in default app is in the row menu (RULING-009).
  Activation opens `{path}` for documents with status indexed or needs_ocr and `{textPath}` for
  everything else; `ViewerTarget` gains `{textPath}` served by `docs.read`.
- Navigation: a name filter (250 ms debounce) calls `docs.find`; while it has text the tree shows
  only the matched files and their ancestor folders, all expanded, with a "more matches" note.
  Expanded folders persist in localStorage per workbench (`vera.docs.tree.<id>`); Collapse all
  clears them. ARIA tree: role tree/treeitem/group, aria-level, aria-expanded, aria-selected, one
  roving tabindex; ArrowUp/Down, Home/End, ArrowRight (expand, then first child), ArrowLeft
  (collapse, then parent), Enter opens a file.
- Rejected: one recursive listing of the whole folder (117k files, RULING-001 needs laziness);
  counting files on disk (RULING-007); a tree library dependency.

**Interfaces and data.**
- Shared: `docsTreeEntrySchema`, three channels; ViewerTarget `{textPath}` (renderer only).
- Locales: tree labels (Collapse all, filter, more matches, folder count/problem labels, text
  errors).
- `data-document` stays on file rows of indexed documents; `data-tree-path` on every row.

**Files and test seams.**
- core workbench/tree.ts (+ tree.test.ts), service.ts; shared documents.ts, ipc.ts
  (+ documents-ipc.test.ts); main index.ts, ipc-router/bridge lists.
- renderer documents/docs-tree.tsx, docs-tab.tsx, viewer-context.tsx, mockApi (tree from mock
  documents plus firmware files), styles, locales; documents.test.ts.
- e2e: documents.spec selectors move to the tree; new native docs-tree.spec.

**Risks and open decisions.**
- Very large single folders show 5,000 entries and a truncated note.
- Filter walks run on main asynchronously and are bounded (50,000 entries).
- No open product decisions.

**Context menu and Properties (RULING-009..011).**
- Approach: rows lose the `OpenExternally` button. `onContextMenu` on a row, and Shift+F10 or the
  ContextMenu key in its key handler, open `documents/tree-menu.tsx`: a fixed-position
  `role="menu"` at the pointer (below the row for keys) whose `role="menuitem"` buttons are Open
  (the row's activation), Open in default app (only when `canOpenExternally(path)`, through
  `app.openPath`; a failure shows under the tree tools) and Properties. It focuses its first
  item; ArrowUp/Down wrap, Home/End move, Enter/Space run, Escape and Tab close; a pointer down
  outside, scroll or resize closes it; Escape and items return focus to the row
  (REQ-UX-541a5bee, REQ-UX-775eb693). No menu library: the repo has none and its `<details>`
  menus cannot open at a pointer.
- Properties: `documents/tree-properties.tsx`, a modal `<dialog>` like ConsentDialog (focus back
  to the row on close) with a `<dl>`: path, type, size (`useBytes`) and modified time (Intl
  date-time in the UI language) from a `docs.stat` query; for a document in `docs.list` its
  status and reason (`describe`) and pages; for a folder its indexed count from
  `folderSummaries` (REQ-UX-4d1b3324, RULING-007).
- Interfaces: core `statEntry(root, path)` in tree.ts reuses `segments` and the visibility checks
  (visible ordinary ancestors, the file-form ignore check before lstat, the folder form after
  it, links refused) and returns `{path, type, size: number | null, modified: ISO}`;
  `WorkbenchService.statEntry(workbenchId, path)` (CONFLICT when not active); IPC `docs.stat
  {workbenchId, path}` -> `{workbenchId, properties}` with `docsEntryPropertiesSchema`
  (REQ-FUNC-98e9d760). The path is the renderer's own, so nothing is scrubbed.
- Test seams: tree.test.ts (stat of file, folder and refused paths), documents-ipc.test.ts
  (contract), docs-tree.test.ts (menu items per row kind, keyboard, Properties contents),
  mockApi `docs.stat`, docs-tree.spec (right click -> Properties, Open in default app absent from
  rows).
- Review round 1: tree paths also pass `validateRelativePath` (PathGuard's Windows alias rules:
  trailing dot or space, streams, device names) so no alias reaches a hidden entry; a saved
  folder whose listing fails with NOT_FOUND or DENIED is dropped from the expanded set instead
  of showing a lasting error; a cut-off top listing shows the truncated note; `docs.find`
  results are not kept after the filter changes (gcTime 0) and index events invalidate them;
  the menu's Open in default app is named after the file (REQ-UX-f5d6e9e4).
- Rename and Delete stay out (RULING-010).

**Requirement map.** As in the coverage table; REQ-UX-541a5bee, REQ-FUNC-98e9d760 and
REQ-UX-4d1b3324 as above.

Diagrams: [diagram_TASK-66b7d4aa.md](diagram_TASK-66b7d4aa.md)

## Log

- 2026-11-01 frame: journal opened
- 2026-11-01 frame: completed; next specify - scope set by user answers RULING-001..008 (7 Done checklist item(s) left unticked)
- 2026-11-01 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-01 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-01 build: red: vitest core workbench/tree.test.ts exit 1 - module missing (REQ-FUNC-889beffd, REQ-FUNC-2e3fad2d, REQ-FUNC-70dc2e8f)
- 2026-11-01 build: green (backend): vitest core workbench/tree.test 4 (listing order/hidden/links/cap, find bounded with flag, readText limits and errors), shared documents-ipc tree channels, router/bridge lists - 115 passed; tsc -b exit 0. WorkbenchService listFolder/findFiles/readText check the active workbench; main drops paths a redaction would change and scrubs text like docs.open
- 2026-11-01 build: red: vitest renderer documents/docs-tree.test.ts exit 1 - docs-tree module missing (REQ-UX-c28dde55, REQ-UX-795a7f61, REQ-UX-775eb693, REQ-UX-9f16abf2, REQ-UX-2d9cdf43, REQ-UX-fdd495b8)
- 2026-11-01 build: scope change during build (user, 2026-11-01): a tree context menu with Open, Open in default app and Properties replaces the row button (RULING-009, RULING-011); Rename/Delete go to a separate later task (RULING-010). Returning to specify. e2e so far: citations.spec passes; docs-tree.spec body ran but cleanup hit EBUSY on the PDF (retry needed); documents.spec could not start because port 5173 is used by the user's running VERA
- 2026-11-01 build: returned to specify - user scope change: context menu and Properties (RULING-009..011)
- 2026-11-01 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-01 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-01 build: tests first (RULING-009..011): tree.test statEntry, documents-ipc docs.stat, docs-tree context menu and Properties fail before implementation; 17 existing pass
- 2026-11-01 build: green (RULING-009..011): tree.test + documents-ipc + docs-tree + documents tests pass (only pre-existing 'bounds large text DOM' fails); native docs-tree.spec passes with right-click Properties, Shift+F10 menu and rm retries; tsc -b, biome, check:i18n clean
- 2026-11-01 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-01 validate: review round 1 findings: Q1 Windows path aliases (trailing dot/space, ADS, device names) bypass tree.ts hidden checks -> use validateRelativePath; Q2/S3 stale expanded folder leaves permanent error -> prune on NOT_FOUND/DENIED; Q3 docs.find cached under staleTime Infinity; S1 REQ-UX-f5d6e9e4 named Open in default app lost in menu item; S2 linked_tests empty, affected_paths gaps; S4 root truncation silent; S5 RULING-002 icon vs text label, RULING-009 supersedes; S6 weak assertions (reason text, per-workbench memory, ArrowUp); S7 folderCount plurals
- 2026-11-01 validate: returned to build - review round 1: path aliases, stale expanded folders, find staleness, named menu item, linked tests, root truncation, ruling bookkeeping, test assertions, plurals
- 2026-11-01 build: round 1 fixes green: tree.test (Windows aliases DENIED on list/read/stat), docs-tree.test 9 pass (stale folder pruning, root truncation, status icon text, per-workbench memory, ArrowUp, named menu item), documents.test named item; tsc -b, biome, check:i18n clean; native docs-tree.spec passes. Open question for the user: REQ-FUNC-70dc2e8f 'distinct stable errors' vs one DENIED for link/hidden/outside
- 2026-11-01 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-01 validate: final: python .agentic/aegis.py check --task TASK-66b7d4aa --strict --run exit 0 (typecheck, lint, i18n ok; tests not in [check] run); full vitest after the last edit: 1108 passed, 4 failed, all pre-existing and outside scope (sessions compaction transcript, write-edit registry, documents 'bounds large text DOM', workspace 'Settings selects one page'); e2e VERA_TEST=1 npm run test:e2e -- documents, docs-tree, citations, office-documents, pdf-download: 5 passed; 169 check warnings are repository-wide legacy stale-path/no-linked-test notes, none on this task's requirements
- 2026-11-01 validate: completed; next done (9 Done checklist item(s) left unticked)
- 2026-11-01 done: commit: the user authorized committing all uncommitted work as one local commit on master (2026-11-01)

## Rulings

- RULING-001 | date=2026-11-01 | decision=The Docs tree shows the whole workbench folder, with indexed documents marked | reason=user chose 'Tot folderul workbench-ului' | source=user | supersedes=none
- RULING-002 | date=2026-11-01 | decision=Clicking a file in the tree opens it in the Source tab; status shows as an icon with a tooltip; Open in default app stays a small row button | reason=user chose 'Se deschide in tab-ul Sursa' | source=user | supersedes=none
- RULING-003 | date=2026-11-01 | decision=Folders show a count and a problem marker for failed, needs-OCR or unsupported documents beneath | reason=user chose 'Numar + semnal de probleme' | source=user | supersedes=none
- RULING-004 | date=2026-11-01 | decision=Navigation: name filter, expansion remembered per workbench, Collapse all, arrow-key tree navigation | reason=user chose all four navigation options | source=user | supersedes=none
- RULING-005 | date=2026-11-01 | decision=The tree hides what VERA ignores: .vera, .git, node_modules and .veraignore entries | reason=user chose 'Ce ignora si VERA' | source=user | supersedes=none
- RULING-006 | date=2026-11-01 | decision=Clicking a non-indexed file opens it as text in Source (new read channel with size limits) | reason=user chose 'Il deschide ca text in Sursa' | source=user | supersedes=none
- RULING-007 | date=2026-11-01 | decision=A folder's count is the number of indexed documents beneath it (from the index, no disk walk) | reason=user chose 'Documentele indexate din el' | source=user | supersedes=none
- RULING-008 | date=2026-11-01 | decision=The name filter searches the whole workbench except hidden entries and shows the first 200 matches, saying when there are more | reason=user chose 'In tot workbench-ul, primele 200' | source=user | supersedes=none
- RULING-009 | date=2026-11-01 | decision=In the Docs tree a context menu (right click, Shift+F10 or the Menu key) offers Open, Open in default app and Properties and replaces the row's Open in default app button | reason=user asked for a right-click menu; chose 'Meniul acum, Rename/Delete separat' | source=user | supersedes=none
- RULING-010 | date=2026-11-01 | decision=Rename and Delete of files and folders come in a separate task after this one; Delete moves to the Recycle Bin after confirmation | reason=user chose 'Meniul acum, Rename/Delete separat', 'Muta in Recycle Bin, cu confirmare', 'Fisiere si foldere' | source=user | supersedes=none
- RULING-011 | date=2026-11-01 | decision=Properties shows path, type, size and modified time, plus index status, reason and pages for documents and the indexed-document count for folders | reason=user chose 'Detalii fisier + index' | source=user | supersedes=none
- RULING-012 | date=2026-11-01 | decision=Clicking a file in the tree opens it in the Source tab; document status shows as an icon with a tooltip (Open in default app moved to the context menu by RULING-009) | reason=RULING-002 restated without its row button, which RULING-009 replaced | source=user | supersedes=RULING-002
- RULING-013 | date=2026-11-01 | decision=Tree reads refuse links, hidden entries, Windows aliases and paths outside the workbench with one DENIED; binary and too-large text keep their own message keys | reason=user chose 'Same denied for all three': an error never reveals whether a hidden entry exists | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-66b7d4aa.md
changed: 3 created, 1 revised (REQ-UX-775eb693)
evidence: check --strict --run exit 0; e2e 5 passed; vitest only pre-existing failures
issues:
spec_compliance: approved
implementation_quality: approved
review_round: 3

## Delivery report (2026-11-01)

- stage: validate; type: feature; path: full; branch: master
- requirements:
  - REQ-FUNC-889beffd - List the entries of a workbench folder
  - REQ-UX-c28dde55 - Show the workbench folder as a tree in Docs
  - REQ-UX-795a7f61 - Mark folders with their indexed documents and problems
  - REQ-UX-775eb693 - Open a file from the Docs tree in Source
  - REQ-FUNC-70dc2e8f - Read a non-indexed workbench file as text
  - REQ-FUNC-2e3fad2d - Find workbench files by name
  - REQ-UX-9f16abf2 - Filter the Docs tree by name
  - REQ-UX-2d9cdf43 - Remember expanded folders and collapse them all
  - REQ-UX-fdd495b8 - Navigate the Docs tree with the keyboard
  - REQ-UX-28ad0003 - Expose the live document index in Docs
  - REQ-UX-541a5bee - Offer a context menu on Docs tree items
  - REQ-FUNC-98e9d760 - Report the properties of a workbench entry
  - REQ-UX-4d1b3324 - Show the properties of a Docs tree item
- deviations: none recorded
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=3
- diff vs task base 2791fea: 276 file(s) changed, 17556 line(s) added; 7 file(s) not content-scanned
- checks: errors=0 warnings=169 notes=3
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended
