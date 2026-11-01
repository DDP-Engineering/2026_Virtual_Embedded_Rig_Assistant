# TASK-3e78d66b - Configurable retrieval defaults

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-DATA-4992f40c, REQ-FUNC-724d3fcc, REQ-UX-d048dbdd
parent: TASK-581e6591
branch: master
base: 33e72b8c7611d3c36c287ca49dae0b6474338c8f
opened: 2026-10-31

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

Problem: The agent's document search uses fixed defaults: search_docs returns 8 results in hybrid mode unless the model passes k or mode (OBSERVED: core knowledge/search.ts searchDocsSchema defaults 8 and "hybrid"). A workbench cannot tune them (OBSERVED: shared workbench.ts has no retrieval section).
Desired outcome: workbench.yaml holds retrieval defaults - results per search and search mode - editable in the configuration form's Indexing section on New Workbench and in the editor, and search_docs uses them when the model does not pass its own values (STATED: parent In scope item 3 "Configurable retrieval defaults in workbench.yaml, consumed by document search"; user request "setari rag si indexare").
Actors: the embedded engineer configuring a workbench; the agent calling search_docs.
Primary scenario: the engineer sets results per search to 12 and mode to keyword, saves, and the next search_docs call without k/mode returns up to 12 keyword results.
Examples: retrieval {results: 12, mode: keyword}; search_docs {query: "VREF"} searches keyword with k=12; search_docs {query: "VREF", k: 3} returns at most 3.
Counterexamples: the Docs tab's own search box (keyword, 20 results) is a UI search, not the agent's tool, and is unchanged (OBSERVED: service.ts searchDocuments uses keyword k=20).
In scope: shared schema/patch/merge/warnings for retrieval; core DocumentKnowledge defaults from the workbench; SessionHost wiring in desktop and CLI; Indexing section controls (create and edit); locales; tests.
Out of scope: chunking and embedding settings (already configurable); fusion constant, read_doc limits and other internal bounds (parent design: not exposed); office formats (child 4).
Constraints: tool argument limits stay 1-20 and the three modes (OBSERVED: searchDocsSchema); explicit tool arguments win over defaults; no compatibility paths (STATED: AGENTS.md); implementation on master (STATED: AGENTS.md).
Success signals: shared/core tests for schema and default resolution; renderer test for the controls; native e2e writes retrieval to workbench.yaml.
Evidence: search.ts, tools/documents.ts, sessions/service.ts SessionHost, main/sessions.ts getters, cli run.ts.
Assumptions: none.
Unknowns: none.
Decision-blocking questions: none.
Proposed behaviors: (not accepted) YAML keys `retrieval.results` (default 8) and `retrieval.mode` (default hybrid).
Path and reason: full.

  | Criterion | Holds? | Evidence |
  |---|---|---|
  | no new externally observable behavior | no | new settings and tool defaults |
  | no new interface or data format | no | workbench.yaml retrieval section |
  | no new dependency | yes | none |
  | an existing requirement already covers the behavior | no | none covers retrieval defaults |
  | no security or data-handling change | yes | no new data paths |

## Requirement coverage

| Frame outcome | Atomic behavior | Requirement | Verification | Design decision or no impact |
|---|---|---|---|---|
| Stored defaults | retrieval section with bounds, defaults, patch, warnings | REQ-DATA-4992f40c | shared tests | workbenchRetrievalSchema in shared/workbench.ts |
| Search uses defaults | missing k/mode take workbench values; explicit wins | REQ-FUNC-724d3fcc | core search tests | DocumentKnowledge defaults provider; SessionHost.retrieval |
| Editable defaults | Indexing controls on create and edit | REQ-UX-d048dbdd | renderer, native e2e | WorkbenchConfigForm Indexing section |


## Design

**Approach.** Add a `retrieval` section to the workbench schema (REQ-DATA-4992f40c). Make `search_docs` arguments k and mode optional, and resolve them in `DocumentKnowledge.search` from a defaults provider given at construction. The provider falls back to 8/hybrid, so the CLI, the Docs tab and the tests keep their behavior without one (REQ-FUNC-724d3fcc). SessionService passes `host.retrieval` as the provider. Desktop supplies it through a live getter on the reloaded config, the way `mode` and `disabledTools` already work; the CLI passes the snapshot's values. The Indexing section of `WorkbenchConfigForm` gains two controls, and create and editor include `retrieval` in their patch (REQ-UX-d048dbdd). Rejected: keeping schema defaults and overriding after parse, because a parsed default cannot be told apart from an explicit 8/hybrid.

**Interfaces and data.**
- `workbenchRetrievalSchema = { results: int 1..20 = 8, mode: enum = hybrid }`.
- The patch takes the optional full section; `mergeWorkbench` merges it; `configWarnings` knows its keys.
- `searchDocsSchema` k and mode have no default. `DocumentKnowledge(root, db, embeddings?, defaults?: () => {results, mode} | undefined)` resolves the effective `k = args.k ?? defaults.results ?? 8` and `mode = args.mode ?? defaults.mode ?? "hybrid"`.
- `SessionHost.retrieval?: {results, mode}`.

**Files and test seams.**
- shared: workbench.ts (+ workbench.test.ts).
- core: knowledge/search.ts (+ search.test.ts), tools/documents.ts, sessions/service.ts.
- main: sessions.ts.
- cli: run.ts.
- renderer: workbench-config-form.tsx, workbench-create.tsx, workbench-editor.tsx, locales, workspace.test.ts.
- e2e: workbench.spec.ts.

**Risks and open decisions.**
- The tool's JSON schema loses its "default" annotations; the description states that unspecified values follow the workbench settings.
- No migration: existing YAML without retrieval takes the defaults (STATED: AGENTS.md no compatibility paths are needed; the schema default covers absence).

**Requirement map.** As in the coverage table's last column.

Diagrams: [diagram_TASK-3e78d66b.md](diagram_TASK-3e78d66b.md)


## Log

- 2026-10-31 frame: journal opened
- 2026-10-31 frame: completed; next specify - scope recorded (autopilot) (7 Done checklist item(s) left unticked)
- 2026-10-31 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-10-31 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-10-31 build: red: npmw npx vitest run shared workbench.test + core search.test -t retrieval exit 1 - no retrieval section; search ignores defaults (REQ-DATA-4992f40c, REQ-FUNC-724d3fcc)
- 2026-10-31 build: green: npmw npx vitest run shared workbench.test + core search.test exit 0 for the new tests; core tools/sessions fail only on 2 pre-existing tests (write-edit registry list, compaction transcript) that fail on the clean tree too; typecheck 0 after the events sanitizer keeps retrieval (REQ-DATA-4992f40c, REQ-FUNC-724d3fcc)
- 2026-10-31 build: red: npmw npx vitest run workspace.test.ts -t 'retrieval defaults' exit 1 - Indexing has no retrieval controls (REQ-UX-d048dbdd)
- 2026-10-31 build: green: renderer workspace.test.ts retrieval test passes; renderer+main vitest fail only on pre-existing tests (main reveal test, documents bounds, Settings tabs - all fail on the clean tree); VERA_TEST=1 e2e workbench (4), workbench-tools, workbench-navigation pass incl. retrieval in YAML; lint 0 errors; typecheck 0; i18n ok (REQ-UX-d048dbdd, REQ-DATA-4992f40c)
- 2026-10-31 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-10-31 validate: accepted review notes (non-blocking): numeric fields (results, chunk size, overlap) accept out-of-range drafts that saving rejects with a generic error - existing form precedent, follow-up proposed; SessionHost.retrieval comment says settings apply at once, they apply from the next session operation like mode/disabledTools; fallback k=8 and sanitizer extension keys lack dedicated tests
- 2026-10-31 validate: final: python .agentic/aegis.py check --task TASK-3e78d66b --strict --run exit 0; lint, typecheck, i18n ok; focused vitest and VERA_TEST=1 e2e logged above; remaining warnings are pre-existing repository records
- 2026-10-31 validate: completed; next done (9 Done checklist item(s) left unticked)
- 2026-11-01 done: commit: the user authorized committing all uncommitted work as one local commit on master (2026-11-01)

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-3e78d66b.md
changed: retrieval defaults in workbench.yaml, search_docs defaults, Indexing controls
evidence: aegis check --strict --run exit 0; focused vitest only pre-existing failures; VERA_TEST=1 e2e workbench specs pass
issues: numeric fields accept out-of-range drafts until save (follow-up)
spec_compliance: approved
implementation_quality: approved
review_round: 1

## Delivery report (2026-10-31)

- stage: validate; type: feature; path: full; branch: master
- requirements:
  - REQ-DATA-4992f40c - Store retrieval defaults in workbench.yaml
  - REQ-FUNC-724d3fcc - Search documents with the workbench retrieval defaults
  - REQ-UX-d048dbdd - Edit retrieval defaults in the Indexing section
- deviations: none recorded
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=1
- diff vs task base 33e72b8: 84 file(s) changed, 4163 line(s) added
- checks: errors=0 warnings=78 notes=3
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended
