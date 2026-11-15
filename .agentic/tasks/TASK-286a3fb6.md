# TASK-286a3fb6 - IDX-01 Honor .gitignore in the document selection (#275)

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-FUNC-eade110e, REQ-FUNC-2336bfd2, REQ-FUNC-ed6a4de8, REQ-UX-adae0c2f
parent:
branch: master
base: 680807079bee22d408accfcaea04911c91e8e8e1
opened: 2026-11-15

Edit Frame, Requirement coverage and Design directly. Write State, Log and
Rulings with `python .agentic/aegis.py` (advance, pause, log, ruling, verdict);
end each session with `advance` or `pause`.

## Done checklist (current stage)

- [x] diff reviewed against scope, requirements, design, error paths,
      portability, security and unrequested work
- [x] knowledge pages of changed components current with the reviewed code
- [x] project and environment context reconciled with the candidate
- [x] requirements re-read: status, prose, verification, paths and links true
- [x] manual or inspection verification recorded where applicable
- [x] explicit review approved, when enabled
- [x] final `check --strict --run` result logged truthfully after the last edit
- [x] remaining warnings and pre-existing failures explained
- [x] `report` appended

## Frame

Problem: The indexer, the preview and the Files tab ignore only .veraignore and the permanent
directories (.vera, .git, node_modules); a repository's .gitignore is not read, so virtual
environments, build output, coverage reports and generated docs are indexed (STATED #275, OBSERVED
libraries/core/src/workbench/ignore.ts, knowledge/selection.ts readIgnorePolicy).
Desired outcome: With `docs.gitignore` on (default for new workbenches), the root and nested
.gitignore files exclude paths from the document selection, the New Workbench/editor scan and
preview, and the Files tab marks; precedence permanent > .veraignore (incl. `!`) > .gitignore
(STATED #274 Decisions, #275 Deliverables).
Actors: workbench user (Documents & RAG editor, New Workbench, Files tab); desktop indexer process.
Primary scenario: A repository with `.venv/`, `htmlcov/`, `build/html/` in .gitignore is opened as a
workbench with include `**`; only its real documents are selected and indexed.
Examples: IDX-01-A..C of #275 (STATED): fixture with .venv/, htmlcov/, build/html/ ignored selects
only real documents, switch off selects them; nested docs/.gitignore applies only below docs/;
`!docs/gen.md` in .veraignore brings back a file .gitignore drops; .git/node_modules stay ignored.
Counterexamples: a `!` line in .gitignore cannot re-include .git or node_modules content; a
.veraignore `!file` cannot bring back a file inside a folder .gitignore excludes unless the folder is
re-included too (Git semantics: an excluded folder is not entered) (INFERRED from Git docs).
In scope: shared schema `docs.gitignore` boolean (default true) and patch field; ignore policy reading
root + nested .gitignore with Git semantics; selection, scan, preview, Files tab list/find marks;
ingest watcher reacting to .gitignore edits; IPC scanDocs/previewDocs carry the switch; "Use
.gitignore" checkbox in Documents & RAG (New Workbench and editor); help "Documents and search" in
en/ro/de/fr; CHANGELOG + release notes.
Out of scope: the agent's PathGuard and file tools, composer @-completion (they keep .veraignore
only: the ticket names indexing, preview and Files tab marks - INFERRED from #275 Deliverables);
.git/info/exclude and core.excludesFile (#275 names root and nested .gitignore only - INFERRED);
size/count limits (IDX-02..04, STATED #274 Children).
Constraints: pre-release, workbench.yaml stays format 1, no migration (STATED CLAUDE.md); interface
text en/ro/de/fr, no helper texts (STATED task brief); on master in shared checkout, targeted tests
only (STATED task brief).
Success signals: IDX-01-A..C tests pass (unit for ignore policy/selection/tree/scan, renderer or
service test for saving the switch); typecheck, biome, check:i18n green.
Evidence: OBSERVED ignore.ts uses `ignore` 7.0.12 (`test()` gives ignored/unignored); selection.ts
readIgnorePolicy used by selectDocuments, Ingester.refreshPolicy, tree.listFolder/findFiles;
service.ignoreRules feeds scanDocuments/previewDocuments/relativeFolder; create stringifies the
full parsed config, so a schema default is written into new workbench.yaml.
Assumptions: schema default true also applies to existing workbench.yaml without the field
(pre-release: no compatibility rule - INFERRED from CLAUDE.md pre-release policy).
Unknowns: none decision-blocking.
Decision-blocking questions: none.
Proposed behaviors: as Desired outcome; settled by #274/#275 decisions, not new choices.
Path and reason: full.

| Criterion | Holds? | Evidence |
|---|---|---|
| no new externally observable behavior | no | new switch, new exclusions |
| no new interface or data format | no | docs.gitignore field, IPC request fields |
| no new dependency | yes | `ignore` already a dependency |
| an existing requirement already covers the behavior | no | new behavior |
| no security or data-handling change | yes | read-only rule files |

## Requirement coverage

| Behavior | Requirement |
|---|---|
| .gitignore (root + nested, Git rules) drops paths from selection, scan, preview while docs.gitignore is true | REQ-FUNC-eade110e |
| Precedence permanent > .veraignore (incl. `!`) > .gitignore | REQ-FUNC-2336bfd2 |
| Files tab marks .gitignored entries and its search skips them | REQ-FUNC-ed6a4de8 |
| "Use .gitignore" checkbox, default on for new workbenches, saved as docs.gitignore (format 1) | REQ-UX-adae0c2f |

## Design

**Approach.** `workbench/ignore.ts` gains `createGitignoreRules(read)`: lazily loads one `ignore`
instance per folder from `read(dir)` (the folder's `.gitignore` text or undefined) and decides an
entry deepest level first, first decisive (`ignored`/`unignored`) result wins, as Git does
(REQ-FUNC-eade110e). `createIgnoreRules(text, gitignored?)` becomes the single combined policy: it
walks the path's folder prefixes, then the entry; per step permanent -> .veraignore `test()`
(ignored wins; an explicit negation turns .gitignore off for that step and everything below it) ->
.gitignore (REQ-FUNC-2336bfd2). So an excluded folder is never entered, and `!build/` in
.veraignore brings build/ back. Rejected: running .gitignore through the .veraignore instance
(one file loses nested scoping) and private node-ignore internals for parent-free matching.
`readIgnorePolicy(root, gitignore)` (selection.ts) supplies a reader that accepts only an ordinary,
non-link `.gitignore`; missing or unreadable files add no rules.

**Interfaces and data.** Shared `docs.gitignore: boolean`, default `true` (new workbenches write it
through the stringified parsed config; workbench.yaml stays format 1); patch `docs.gitignore`
optional (REQ-UX-adae0c2f). IPC `workbench.scanDocs` and `workbench.previewDocs` requests carry a
required `gitignore` boolean. Core: `selectDocuments` uses `docs.gitignore`; service
`scanDocuments(folder, gitignore)`, `previewDocuments(folder, docs)`, `listFolder`/`findFiles` pass
the active config's switch to `tree.ts` (REQ-FUNC-ed6a4de8). The agent PathGuard, composer
completion and `relativeFolder` keep .veraignore only (Frame out of scope). Ingester: policy key
includes the switch; root and include-ancestor `.gitignore` files are watch targets, any
`.gitignore` event refreshes the policy, bumps a generation in the watcher key and requests a run.

**Files and test seams.** shared `workbench.ts`, `ipc.ts`; core `ignore.ts` (+ new
`ignore.test.ts`), `selection.ts`, `ingest.ts`, `documents-scan.ts` (unchanged signature),
`tree.ts`, `service.ts`; desktop main `index.ts`, renderer `workbench-documents.tsx`,
`workbench-create.tsx`, `workbench-editor.tsx`, `mocks/mockApi.ts`, i18n en/ro/de/fr; help
documents page x4. Tests: ignore.test.ts (precedence, nested, negation), ingest-selection.test.ts
(IDX-01-A/B fixture), documents-scan.test.ts (scan/preview), tree.test.ts (marks), shared schema
test + service.test.ts (create/save writes the switch).

**Risks and open decisions.** Sync lazy reads during async walks: one small file per visited
folder, cached per policy. A policy is rebuilt per selection/listing, so .gitignore edits take
effect on the next run. No migration (pre-release policy).

**Requirement map.** REQ-FUNC-eade110e: gitignore reader + selection/scan/preview wiring.
REQ-FUNC-2336bfd2: combined prefix walk. REQ-FUNC-ed6a4de8: tree.ts switch. REQ-UX-adae0c2f:
schema default, IPC fields, checkbox.

Diagrams: [diagram_TASK-286a3fb6.md](diagram_TASK-286a3fb6.md)

## Log

- 2026-11-15 frame: journal opened
- 2026-11-15 frame: completed; next specify - scope recorded (autopilot) (7 Done checklist item(s) left unticked)
- 2026-11-15 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-15 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-15 build: red: vitest ignore.test.ts tree.test.ts shared workbench.test.ts exit 1 - createGitignoreRules missing, no gitignore marks, no docs.gitignore default (REQ-FUNC-eade110e REQ-FUNC-2336bfd2 REQ-FUNC-ed6a4de8 REQ-UX-adae0c2f)
- 2026-11-15 build: green: npm run typecheck exit 0; vitest ignore/tree/shared workbench/ingest-selection/documents-scan/service/ingest/indexer-host/events/documents/path-guard tests exit 0, 11 files 165 passed 2 skipped (REQ-FUNC-eade110e REQ-FUNC-2336bfd2 REQ-FUNC-ed6a4de8 REQ-UX-adae0c2f)
- 2026-11-15 build: DEVIATION build: the renderer test for the Use .gitignore checkbox was written after the component change, not red-first - the shared/core tests for the same requirement were red first; the renderer test passes against the change
- 2026-11-15 build: decision: a .veraignore negation that brings back a folder .gitignore drops brings back its contents too (Git never enters an excluded folder, so a folder-only re-include would bring back nothing); an allowlist .veraignore with !*/ therefore re-includes gitignored folders - documented in help
- 2026-11-15 build: check: errors=0; remaining warnings are other tasks' journal headers and outside-layout for help pages, release notes and CHANGELOG, which the repository rules require this task to change
- 2026-11-15 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-15 validate: review round 1 findings (spec): 1 no test for the Ingester reacting to .gitignore edits; 2 no renderer test that create/editor save payloads carry docs.gitignore; 3 service scan/preview test lacks the full .venv/htmlcov/build/html + docs/.gitignore fixture; 4 troubleshooting help step names only .veraignore
- 2026-11-15 validate: returned to build - review round 1: four spec findings (watcher test, save payload tests, fuller scan/preview fixture, troubleshooting help)
- 2026-11-15 build: green: vitest service.test.ts ingest-selection.test.ts workbench-plugins.test.ts exit 0 (69 passed) - fixes for review round 1: live .gitignore watcher test, editor/create payload tests, full scan/preview fixture, troubleshooting help in en/ro/de/fr, fr/ro workbench terms aligned (REQ-FUNC-eade110e REQ-UX-adae0c2f)
- 2026-11-15 build: DEVIATION validate: reviewer questions (allowlist .veraignore negations override .gitignore; schema default turns the switch on for existing workbenches too) are not put to the user inside the loop - both follow the epic's stated precedence and the pre-release no-compatibility rule; they are reported to the coordinating session as open questions
- 2026-11-15 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-15 validate: DEVIATION validate: final proof is check --task --strict without --run plus targeted commands, because --run executes the full npm test and lint, which the standing instruction forbids (the user runs the full suite at the end); not covered: unrelated suites, e2e and native Electron UI
- 2026-11-15 validate: final: check --task TASK-286a3fb6 --strict exit 0; npm run typecheck exit 0; vitest 12 targeted files exit 0 (187 passed, 2 skipped); biome on changed files exit 0; check:i18n, check:help, check:release-notes exit 0; remaining warnings: outside-layout (help, release notes, CHANGELOG required by repo rules), uncovered-source on test files (linked tests, not sources), other tasks' journal headers and ticket-ref in older requirements
- 2026-11-15 validate: completed; next done

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-286a3fb6.md
changed: ignore policy with .gitignore, docs.gitignore switch, Files tab marks, watcher, Use .gitignore checkbox, help en/ro/de/fr, CHANGELOG, release notes
evidence: check --task TASK-286a3fb6 --strict exit 0; typecheck exit 0; vitest 12 targeted files exit 0 (187 passed, 2 skipped); biome, check:i18n, check:help, check:release-notes exit 0
issues: full suite, e2e and native UI not run (by instruction); open questions: allowlist .veraignore negations override .gitignore; switch defaults on for existing workbenches
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-15)

- stage: validate; type: feature; path: full; branch: master
- requirements:
  - REQ-FUNC-eade110e - Honor gitignore files in the document selection
  - REQ-FUNC-2336bfd2 - Ignore precedence over gitignore
  - REQ-FUNC-ed6a4de8 - Mark gitignored entries in the Files tab
  - REQ-UX-adae0c2f - Use gitignore switch in Documents and RAG
- deviations: 3 recorded
  - build: the renderer test for the Use .gitignore checkbox was written after the component change, not red-first - the shared/core tests for the same requirement were red first; the renderer test passes against the change
  - validate: reviewer questions (allowlist .veraignore negations override .gitignore; schema default turns the switch on for existing workbenches too) are not put to the user inside the loop - both follow the epic's stated precedence and the pre-release no-compatibility rule; they are reported to the coordinating session as open questions
  - validate: final proof is check --task --strict without --run plus targeted commands, because --run executes the full npm test and lint, which the standing instruction forbids (the user runs the full suite at the end); not covered: unrelated suites, e2e and native Electron UI
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base 6808070: 46 file(s) changed, 865 line(s) added
- checks: errors=0 warnings=45 notes=38
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended
