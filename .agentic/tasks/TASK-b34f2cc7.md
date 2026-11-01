# TASK-b34f2cc7 - Docs panel: one search box, compact tools and the full workbench tree

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-FUNC-889beffd, REQ-FUNC-2e3fad2d, REQ-FUNC-70dc2e8f, REQ-FUNC-98e9d760, REQ-UX-c28dde55, REQ-UX-9f16abf2, REQ-UX-4d1b3324, REQ-UX-ed65cbbc, REQ-UX-2504362b, REQ-UX-d455531b
parent:
branch: master
base: b53d1420fbd9eb4c6d85373ce900d901c6e0bdb0
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

Problem: STATED: the Docs panel has two text boxes ("Search documents" and "Filter files")
  where one should do, and Reindex and Collapse all sit on separate rows ("vrem sa castigam cat
  mai mult spatiu"). STATED: the tree should show all folders "inclusiv cele ignorate (ca un
  filetree normal)"; OBSERVED: today it hides `.vera`, `.git`, `node_modules` and .veraignore
  entries (TASK-66b7d4aa RULING-005, core workbench/tree.ts `listFolder`).
Desired outcome: one search box; while it has text the tree shows the files whose names match
  and, below the tree, the matching passages of indexed documents (RULING-001). Reindex and
  Collapse all share one row (RULING-006). The tree lists every entry, ignored ones dimmed;
  ignored files open as text and show Properties, the name filter does not search inside
  ignored folders, and what the agent and the indexer see is unchanged (RULING-002).
Actors: the desktop user in the right panel's Docs tab; main IPC handlers; core tree reads.
Primary scenario: the user types "power": after the debounce the tree narrows to files whose
  path contains "power" with their folders expanded, and an "In documents" list under it shows
  the keyword hits with snippets and Open. Clearing the box restores the browsing tree. The user
  expands `node_modules` (dimmed), its entries load dimmed, and clicking a `.js` file opens it as
  text in Source.
Examples: OBSERVED in the user's screenshot: "Search documents" input, a full-width Reindex,
  "Index: 325 done, 0 pending, 0 failed", then "Filter files" with Collapse all; the root lists
  .agentic, .claude, .codex, .ruff_cache, 00_Planning... and no .git or .vera.
Counterexamples: filtering "config" does not list `.git/config` (ignored folders stay outside the
  filter, RULING-002); a link or junction is still not listed and Windows path aliases are still
  refused (TASK-66b7d4aa confinement, RULING-013 there); the agent's file tools still refuse
  ignored paths and ignored files are still not indexed.
In scope:
- Docs tab layout: one search input; Reindex and Collapse all in one row; index status kept.
- Unified search: the input drives the tree's name filter (docs.find) and the content search
  (docs.search) together, content hits shown below the tree.
- Tree listing of ignored entries with an `ignored` flag (inherited inside ignored folders),
  their text view and Properties; a dimmed style distinct from "not indexed".
- Revising TASK-66b7d4aa requirements that say hidden entries are excluded or refused.
- Tests: core, contract, renderer, native and browser e2e; knowledge pages.
Out of scope: the context-menu actions Attach as context, Copy paths, Open in and Show in
  Explorer (next task, RULING-007); Rename and Delete (later, TASK-66b7d4aa RULING-010);
  indexing and agent ignore rules (RULING-002); links and junctions in the tree (confinement,
  TASK-66b7d4aa Frame).
Constraints: on the default branch master, uncommitted; the developer decides branches and
  commits ("Nu fa commit"). LF endings; en/ro/de locales; browser e2e needs port 5173 free, so
  a running VERA dev app is stopped only with the user's consent.
Success signals: the Docs tab has one search input; Reindex and Collapse all are on one row;
  `.git`, `.vera`, `node_modules` and .veraignore'd entries are listed and dimmed; an ignored
  text file opens in Source; the filter returns no ignored path; content hits appear under the
  filtered tree.
Evidence: screenshot of the Docs panel; renderer components/documents/docs-tab.tsx (search
  input replaces the tree with `.documents-list`), docs-tree.tsx (filter input, Collapse all);
  core workbench/tree.ts (`ordinary` refuses ignored segments, `listFolder` skips them);
  knowledge/selection.ts `readIgnorePolicy` shared by ingest and the tree; credentials live in
  userData/credentials.json, not in `.vera` (main/index.ts).
Assumptions: INFERRED: "dimmed" must differ from the existing dim of non-indexed files, which
  are also shown in the muted colour. INFERRED: reading an ignored file in the user's own panel
  does not widen what the agent or a provider can see.
Unknowns: the empty-result wording of each half of the unified search; whether the content
  hits need their own heading.
Decision-blocking questions: none; the user answered the search box and ignored-entry
  questions (RULING-001, RULING-002).
Proposed behaviors (not accepted):
- Content hits appear under the tree with the heading "In documents", up to the existing 20.
- Ignored rows use a lower opacity than non-indexed rows plus screen-reader text "Ignored by
  VERA"; Properties shows "Ignored by VERA" as their index status.
- Ignored folders expand and are remembered like any other folder.
- One 250 ms debounce feeds both searches.
Path and reason:

| Criterion | Holds? | Evidence |
|---|---|---|
| no new externally observable behavior | no | one search box, ignored entries listed |
| no new interface or data format | no | docs.tree entries gain an ignored flag |
| no new dependency | yes | none needed |
| an existing requirement already covers the behavior | no | TASK-66b7d4aa requirements exclude hidden entries |
| no security or data-handling change | no | tree reads reach ignored entries |

Full path: new behavior, a changed IPC entry format and a confinement change.

## Requirement coverage

| Behavior | Requirement | Source in Frame |
|---|---|---|
| folder listing includes ignored entries, flagged, links still excluded | REQ-FUNC-889beffd (revised) | RULING-002 |
| name find skips ignored and linked entries | REQ-FUNC-2e3fad2d (revised) | RULING-002 |
| ignored text files read like others; binary, large, link, outside refused | REQ-FUNC-70dc2e8f (revised) | RULING-002 |
| properties of ignored entries | REQ-FUNC-98e9d760 (revised) | RULING-002 |
| tree shown while the search box is empty | REQ-UX-c28dde55 (revised) | RULING-001, RULING-009 |
| search box text filters the tree by name | REQ-UX-9f16abf2 (revised) | RULING-001 |
| Properties says an entry is ignored | REQ-UX-4d1b3324 (revised) | RULING-002 |
| ignored entries in italic with faded icons, announced, expandable and openable | REQ-UX-ed65cbbc | RULING-002, RULING-010 |
| document hits listed under the filtered tree | REQ-UX-2504362b | RULING-001 |
| Reindex and Collapse all on one row under one search box; Collapse all off while searching | REQ-UX-d455531b | RULING-006, RULING-008 |

Review round 1 also revised REQ-UX-541a5bee and REQ-UX-f5d6e9e4 (done task): Open in default app
is offered only for files VERA does not ignore, since PathGuard refuses the rest. RULING-011
records that RULING-002 also replaces the hidden-entry part of TASK-66b7d4aa RULING-013.

Revised (all from TASK-66b7d4aa): REQ-FUNC-889beffd, REQ-FUNC-2e3fad2d, REQ-FUNC-70dc2e8f,
REQ-FUNC-98e9d760 (ignored entries are listed, read and inspected; links, outside paths and
Windows aliases stay refused), REQ-UX-c28dde55 and REQ-UX-9f16abf2 (the single search box
replaces the separate content search and name filter), REQ-UX-4d1b3324 (ignored status).
REQ-UX-28ad0003 keeps its wording: Docs still has a search box with keyword snippet results and
Open. Accepted proposals: the "In documents" heading, "Ignored by VERA" text and rows set apart (italic with faded icons, RULING-010),
one 250 ms debounce, ignored folders remembered like others.

## Design

**Approach.**
- Core `workbench/tree.ts`: the ignore rules stop being a refusal and become a mark.
  `ordinary()` keeps refusing links, wrong kinds, outside paths and Windows aliases but no
  longer checks `ignored`; `listFolder` keeps every non-link entry and sets `ignored` when the
  entry (file form, or `dir/` for folders) or any ancestor of the listed folder is ignored
  (REQ-FUNC-889beffd). `readText` and `statEntry` drop their ignore checks (REQ-FUNC-70dc2e8f,
  REQ-FUNC-98e9d760). `findFiles` is unchanged and still skips ignored entries
  (REQ-FUNC-2e3fad2d, RULING-002).
- Renderer: `DocsTab` owns the single search input (`data-docs-search`, aria-label and
  placeholder "Search files and documents") and one 250 ms debounce; the debounced text goes to
  `DocsTree` as `query` (name filter through docs.find, REQ-UX-9f16abf2) and to the existing
  docs.search query, whose hits render below the tree under "In documents" with their own
  loading, empty and error states (REQ-UX-2504362b). The tree stays mounted while searching
  (REQ-UX-c28dde55).
- Collapse all moves out of the tree: a `useTreeExpansion(workbenchId)` hook in docs-tree.tsx
  owns the expanded set and its localStorage memory; DocsTab renders Reindex and Collapse all in
  one `.docs-actions` flex row that wraps only when too narrow, and passes the expansion to
  DocsTree (REQ-UX-d455531b).
- Ignored rows: `data-ignored="true"`, italic muted text that keeps AA contrast and faded
  icons (RULING-010; the selected row keeps its colours), screen-reader text "Ignored by VERA"
  in place of "Not indexed", and no Open in default app (PathGuard refuses ignored paths);
  they expand, are remembered and open as text like other rows (REQ-UX-ed65cbbc). Properties
  shows "Ignored by VERA" as the index status of an ignored row (REQ-UX-4d1b3324).
- Rejected: keeping two inputs with a shared state (the user asked for one box); a separate
  "show ignored" toggle (the user asked for a normal tree); searching inside ignored folders
  (RULING-002).

**Interfaces and data.**
- Shared `docsTreeEntrySchema` gains a required `ignored: boolean`; docs.tree responses carry
  it; docs.find, docs.read and docs.stat formats are unchanged.
- Main handlers unchanged: docs.tree still drops entries the credential scrub would change and
  docs.read still scrubs text, which now also covers ignored files such as `.git/config`.
- Renderer: `DocsTree` props become `{workbenchId, documents, describe, query, expansion}`;
  filtered entries built from docs.find paths are `ignored: false`.
- Locales: `documents.search` now reads "Search files and documents"; new
  `documents.inDocuments` and `documents.ignored`; the existing `documents.noMatches` ("No files
  match.") and `documents.noResults` ("No matching documents.") are reused; `moreMatches` says
  "search" instead of "filter"; `documents.filterFiles` is removed.

**Files and test seams.**
- core tree.ts/tree.test.ts; shared documents.ts, documents-ipc.test.ts.
- renderer docs-tab.tsx, docs-tree.tsx, tree-properties.tsx, styles.css, locales, mockApi.ts
  (tree adds `.git/config`, `.vera/workbench.yaml`, `node_modules/pkg/index.js`, marked
  ignored; find skips them); docs-tree.test.ts, documents.test.ts.
- e2e: docs-tree.spec (ignored rows, open `.git/config`, search box), documents.spec (layout and
  the search box), citations.spec and office-documents.spec (search box selector).

**Risks and open decisions.**
- Security: ignored files become readable in the user's own panel only; the agent's PathGuard,
  ingest selection and providers are untouched, and credentials are not stored in `.vera`.
  Links, outside paths and Windows aliases stay refused.
- Large ignored folders (`node_modules`, `.git/objects`) load per folder with the existing
  5,000 cap and truncated note.
- No open product decisions.

**Requirement map.** As in the coverage table; each row's decision is cited above.

Diagrams: [diagram_TASK-b34f2cc7.md](diagram_TASK-b34f2cc7.md)

## Log

- 2026-11-01 frame: journal opened
- 2026-11-01 frame: completed; next specify (7 Done checklist item(s) left unticked)
- 2026-11-01 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-01 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-01 build: tests first: tree.test (ignored listed/read/stat, find skips), documents-ipc (ignored required), docs-tree.test (one box + hits, actions row, ignored rows, properties, keys) fail before implementation; 15 others pass; e2e specs updated
- 2026-11-01 build: green: tree.test, documents-ipc, docs-tree.test (all new and revised tests), documents.test pass except pre-existing 'bounds large text DOM'; mockApi/workspace/router/bridge pass except pre-existing Settings tabs; tsc -b, biome, check:i18n clean; e2e citations, docs-tree, documents (one row in en/ro/de, no overflow at all scales), office-documents, pdf-download pass
- 2026-11-01 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-01 validate: review round 1 findings: (1) Open in default app offered for ignored files but main PathGuard refuses (tree menu and Source header; mock too lenient); (2) ignored rows at opacity 0.6 fail AA contrast REQ-UX-4a040007 and override the selected-row colour; (3) tests miss the hit snippet, hits-after-tree order and a single-input count linked to REQ-UX-9f16abf2; (4) journal cites RULING-003/004 for RULING-006/007, and RULING-002 also reverses TASK-66b7d4aa RULING-013's hidden part; (5) stale comments/knowledge ('newly ignored', 'visible'), dead .docs-tab > label CSS, no live region for 'No matching documents.'
- 2026-11-01 validate: returned to build - review round 1: ignored Open in default app, AA contrast, missing assertions, ruling citations, stale comments
- 2026-11-01 build: round 1 fixes green: no Open in default app for ignored files (menu, Source header via ViewerTarget textPath+ignored, mock denies ignored); ignored rows italic + faded icons at AA (selected keeps colours); Collapse all disabled while searching; tests for snippet, hits-after-tree, single input, ignored README menu/Source; documents.spec contrast check (opacity 1, italic, >=4.5:1 light/dark); REQ-UX-ed65cbbc/541a5bee/f5d6e9e4 revised; citations fixed; stale comments, dead CSS, live region; focused vitest pass except pre-existing; tsc, biome, i18n clean; 5 Docs e2e pass
- 2026-11-01 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-01 validate: review round 2: spec - RULING-008 (Collapse all disabled while searching) missing from REQ-UX-d455531b text; 'fainter' wording left in a test title, knowledge line and journal; quality approved
- 2026-11-01 validate: returned to build - review round 2: RULING-008 into REQ-UX-d455531b; 'fainter' wording
- 2026-11-01 build: round 2 fixes: REQ-UX-d455531b now states and verifies Collapse all disabled while searching (RULING-008); test title 'in italic with faded icons' and its 3 linked_tests entries, knowledge and journal wording; docs-tree.test 12 pass
- 2026-11-01 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-01 validate: DEVIATION build: no evolution anchor taken before build - 'evolution' cannot run; both reviewers reviewed the diff from the journal's file list instead
- 2026-11-01 validate: final: python .agentic/aegis.py check --task TASK-b34f2cc7 --strict --run exit 0 (typecheck, lint, i18n ok; tests not in [check] run); full vitest after the last edit: 1111 passed, 4 failed, all pre-existing and out of scope (sessions compaction transcript, write-edit registry, documents 'bounds large text DOM', workspace 'Settings selects one page'); e2e citations, docs-tree, documents, office-documents, pdf-download passed after the last code change; 175 check warnings are repository-wide legacy notes; evolution not run (no anchor, logged deviation)
- 2026-11-01 validate: completed; next done (9 Done checklist item(s) left unticked)
- 2026-11-01 done: commit: the user authorized committing all uncommitted work as one local commit on master (2026-11-01)

## Rulings

- RULING-001 | date=2026-11-01 | decision=One search box: while it has text the tree shows files whose names match and the matching passages of indexed documents are listed below the tree | reason=user chose 'Names + content together' | source=user | supersedes=none
- RULING-002 | date=2026-11-01 | decision=The Docs tree lists every entry including .vera, .git, node_modules and .veraignore'd ones, dimmed; they open as text and show Properties, the name filter does not search inside them, Attach as context is disabled for them; indexing and the agent's ignore rules are unchanged (replaces TASK-66b7d4aa RULING-005 for the tree) | reason=user asked for a normal file tree with ignored folders and chose 'Shown dimmed, outside the filter' | source=user | supersedes=none
- RULING-006 | date=2026-11-01 | decision=Reindex and Collapse all sit on one row to save vertical space | reason=user: 'Buton reindex si colapse all - pe aceeasi linie vrem sa castigam cat mai mult spatiu' | source=user | supersedes=none
- RULING-007 | date=2026-11-01 | decision=The context-menu actions (Attach as context, Copy paths, Open in, Show in Explorer) are the next task; Rename and Delete follow after | reason=one feature per task; the user's request splits into panel layout/tree and menu actions | source=technical | supersedes=none
- RULING-008 | date=2026-11-01 | decision=Collapse all is disabled while the search box has text | reason=user chose 'Disabled while searching' | source=user | supersedes=none
- RULING-009 | date=2026-11-01 | decision=The single search box accepts up to 200 characters, the name filter's limit, for both searches | reason=user chose 'Yes, 200 is enough' | source=user | supersedes=none
- RULING-010 | date=2026-11-01 | decision=Ignored rows keep the muted text colour at AA contrast and stand out by italic text and faded icons instead of transparency | reason=user chose 'Italic + faded icons' to keep REQ-UX-4a040007 | source=user | supersedes=none
- RULING-011 | date=2026-11-01 | decision=Tree reads no longer refuse ignored entries (TASK-66b7d4aa RULING-013's hidden part); links, outside paths and Windows aliases keep one DENIED | reason=follows the user's RULING-002 (ignored entries open as text and show Properties) | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-b34f2cc7.md
changed: 3 created, 7 revised
evidence: check --strict --run exit 0; e2e 5 passed; vitest only pre-existing failures
issues:
spec_compliance: approved
implementation_quality: approved
review_round: 3

## Delivery report (2026-11-01)

- stage: validate; type: feature; path: full; branch: master
- requirements:
  - REQ-FUNC-889beffd - List the entries of a workbench folder
  - REQ-FUNC-2e3fad2d - Find workbench files by name
  - REQ-FUNC-70dc2e8f - Read a non-indexed workbench file as text
  - REQ-FUNC-98e9d760 - Report the properties of a workbench entry
  - REQ-UX-c28dde55 - Show the workbench folder as a tree in Docs
  - REQ-UX-9f16abf2 - Filter the Docs tree from the search box
  - REQ-UX-4d1b3324 - Show the properties of a Docs tree item
  - REQ-UX-ed65cbbc - Mark entries ignored by VERA in the Docs tree
  - REQ-UX-2504362b - List document matches under the filtered Docs tree
  - REQ-UX-d455531b - Keep the Docs actions on one row
- deviations: 1 recorded
  - build: no evolution anchor taken before build - 'evolution' cannot run; both reviewers reviewed the diff from the journal's file list instead
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=3
- diff vs task base b53d142: 282 file(s) changed, 18383 line(s) added; 7 file(s) not content-scanned
- checks: errors=0 warnings=175 notes=4
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended
