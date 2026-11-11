# TASK-d5791e9a - PLG-24 #87 Searchable Available/Installed plugin library

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-UX-28a74094, REQ-UX-41da0f4f, REQ-UX-85399085, REQ-UX-2697c05c, REQ-UX-b99b1695, REQ-UX-7c215eb1, REQ-UX-72a349a1, REQ-UX-c55a0fe1, REQ-UX-28503c97, REQ-UX-27a41e3d
parent:
branch: ddp/plugins-discovery-ui
base: a67012a36cff15d83badb0f4d6bee21d077747c9
opened: 2026-11-11

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

Problem: OBSERVED plugins.tsx/plugin-catalog.tsx mix installed rows and catalog pack checkbox lists without discovery controls.
Desired outcome: STATED PLG-24 and accepted ui-redesign.md require one scalable Available/Installed list below retained top management controls.
Actors: STATED engineer using the sidebar Plugins destination.
Primary scenario: STATED discover a plugin with combined filters, review/install it, inspect its real installed readiness, separately enable it in workbench settings.
Examples: STATED ESP32 + Build narrows catalog; recent sorts use factual dates and unknown dates last; Check all reports partial failures without installing.
Counterexamples: STATED no workbench activation controls, duplicate Packs list, synthetic production dates or hidden version probes from browsing.
In scope: STATED PLG-24 library, management controls, metadata-only discovery, localization and focused acceptance, existing action retention.
Out of scope: STATED PLG-25 workbench editor changes; metadata publishing already implemented by PLG-23; hosting, new plugins, migrations and permission changes excluded by plan.
Constraints: STATED user requires single ddp/plugins-discovery-ui branch from origin/master; base a67012a. Local ticket commits authorized, coordinator owns commits. OBSERVED AEGIS full workflow and focused policy apply; formats stay1.
Success signals: STATED 30+ fixtures prove search/filter/count/sort/page interactions and preserved actions, no implicit execution/enablement, en/ro/de and responsive keyboard UI.
Evidence: OBSERVED current source/components/tests, shared catalog fields from #86, existing API/controller and current root journal.
Assumptions: INFERRED query cache can hold in-session filters and explicit dependency observations without persistent settings.
Unknowns: UNKNOWN native Ubuntu host unavailable; Windows browser/Electron focused checks available.
Decision-blocking questions: None; accepted plan determines behavior.
Proposed behaviors: None beyond accepted plan.
Path and reason:
| Criterion | Holds | Evidence |
|---|---|---|
| no new externally observable behavior | no | new library controls |
| no new interface/data format | yes | renderer only |
| no new dependency | yes | current React/Query/i18n |
| existing requirement covers all behavior | no | new discovery controls |
| no security/data handling change | yes | no policy change, passive browsing |
Full path selected.

## Requirement coverage

| Requirement | Design | Verification |
|---|---|---|
| REQ-UX-28a74094 | library controls/model and retained actions | renderer/component/E2E tests |
| REQ-UX-41da0f4f | library controls/model and retained actions | renderer/component/E2E tests |
| REQ-UX-85399085 | library controls/model and retained actions | renderer/component/E2E tests |
| REQ-UX-2697c05c | library controls/model and retained actions | renderer/component/E2E tests |
| REQ-UX-b99b1695 | library controls/model and retained actions | renderer/component/E2E tests |
| REQ-UX-7c215eb1 | library controls/model and retained actions | renderer/component/E2E tests |
| REQ-UX-72a349a1 | library controls/model and retained actions | renderer/component/E2E tests |
| REQ-UX-c55a0fe1 | library controls/model and retained actions | renderer/component/E2E tests |
| REQ-UX-28503c97 | library controls/model and retained actions | renderer/component/E2E tests |
| REQ-UX-27a41e3d | library controls/model and retained actions | renderer/component/E2E tests |

## Design

### Approach
OBSERVED existing manager owns hash-bound review/action lifecycle. Reuse it; split catalog settings/row rendering from a pure library projection and reusable localized controls. One selected list replaces duplicate lists. REQ-UX-28a74094/72a349a1.
### Interfaces and data
Library model accepts catalog entries, installed summaries and passive explicit-check observations. QueryClient caches independent global UI state. No new IPC or persisted data. Dates use UTC day ages0..29 and unknowns last. Counts honor other filters. REQ-UX-41da0f4f/85399085/2697c05c.
### Files and test seams
Add plugin-library.ts for pure projection/filter/order and plugin-library-controls.tsx for forms/count/page controls; plugins.tsx remains review/action owner; plugin-catalog.tsx exports source/settings and individual catalog rows. Reuse disabled program Query observers: no version probes on expand. Tests exercise30+fixtures and actual managers; existing native/browser consumers update tabs. REQ-UX-b99b1695/7c215eb1.
### Risks and open decisions
No behavior decision open. Highest risk is losing existing trust/install/manual SDK actions or probing while filtering; retain backend controllers and explicitly test absent calls. Installed projection matches catalog metadata only for actual catalog-source packages, not local/trial/scoped id coincidences. No workbench edits (#88).
### Requirement map
Six new requirements cover tab projection, filters, chronology, pagination/state, passive observation and partial check-all; revised existing UI requirements retain review/dependency and action semantics.
Diagrams: [diagram_TASK-d5791e9a.md](diagram_TASK-d5791e9a.md)


## Log

- 2026-11-11 frame: journal opened
- 2026-11-11 frame: completed; next specify - Accepted PLG-24 scope recorded in autopilot (7 Done checklist item(s) left unticked)
- 2026-11-11 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-11 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-11 build: red: pinned Vitest plugin-library.test.ts exit1, six expected failures missing library tabs/controls (REQ-UX-28a74094/41da0f4f/85399085/2697c05c/b99b1695/7c215eb1)
- 2026-11-11 build: red: failed explicit recheck test exit 1; cached Ready survived rejection. Route explicit operations through fetchQuery with retry false so passive observers retain unavailable/error distinctly.
- 2026-11-11 build: green: pinned Vitest targeted plugin-library/plugins/plugin-catalog/workbench-plugins exit 0, 55/55 assertions; initial early i18n/typecheck passed. Windows Electron catalog and four plugins-ui cases passed; affected builder and Chromium matrix rerun passed 2/2. Final ZIP picker and extra-small matrix gap checks in progress.
- 2026-11-11 build: inspection: all ten task requirements re-read active with current linked tests; source identities use catalog install state and only actual catalog sources receive metadata/update joins. Browsing queries are disabled observers; explicit cache errors supersede stale Ready. No workbench source/editor changes, backend/risk/format changes, fabricated production dates or pack-data removal. Knowledge/context, accepted UI architecture/spec and PLG-24 outcome note reconciled.
- 2026-11-11 build: green: final gap checks pinned test:e2e (plugins-ui/plugins-mock grep installs.*review screen) exit 0, two cases: native folder and ZIP picker review/cancel/install/run; Chromium en/ro/de x light/dark x all six 0.75..1.5 scales with overflow measurements. Latest library test exit 0, 8/8, including keyboard tab focus and UTC boundaries. Reuse other five unchanged native flows from e2e/e2e-affected logs; total seven focused flows passed.
- 2026-11-11 build: DEVIATION validate: no native Ubuntu execution in this Windows session - renderer-only scope uses pinned Windows Electron and Chromium focused proof; no backend/platform contract edits and no full-suite gate required by verification-policy.
- 2026-11-11 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-11 validate: review round 1: both roles require UI state retention beyond default five-minute GC; quality also requires no page-clamp write before selected query has a loaded snapshot. No other blocking findings. Correct inherited PLG-24 tracking task id and trace test paths in same bounded fix.
- 2026-11-11 validate: returned to build - Independent review: UI state GC lifetime and premature clamp during deferred reload; bounded fix with delayed remount regression
- 2026-11-11 build: red: new delayed-remount regression after six controlled minutes loses Installed tab; deferred catalog-cache reload regression resets page2 to1. Both fail for independent review findings (REQ-UX-2697c05c). Bounded autonomous corrections continue under existing sequential implementation authorization.
- 2026-11-11 build: green: review fixes targeted Vitest library/plugins/catalog exit 0, 47/47 incl new six-minute and deferred-reload regressions. Existing ten unchanged WorkbenchPlugins consumer cases reused (57 focused tests total). UI-only gcTime Infinity and loaded-snapshot clamp satisfy retained-state contract; native/UI action paths unchanged, reuse seven focused E2E flow proofs.
- 2026-11-11 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-11 validate: review round 2: spec approved; quality requires Installed clamp also await pending catalog metadata used by activity/update/search projection. Keep offline usable when catalog fails. No other blocking findings.
- 2026-11-11 validate: returned to build - Bounded quality review correction: Installed projection requires settled catalog metadata before page clamping
- 2026-11-11 build: red: Installed activity-filter deferred catalog reload test exit 1, retained page2 reset to1 before metadata returns (REQ-UX-2697c05c).
- 2026-11-11 build: green: round3 targeted library test exit 0, 11/11 including delayed Installed activity reload, Available reload, six-minute retention and offline catalog failure. Clamp now waits for catalog to settle for Installed; ordinary failures permit offline list. Reuse unchanged36 Plugins/catalog and10 WorkbenchPlugins tests, total58 focused cases; seven focused E2E flows unchanged.
- 2026-11-11 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-11 validate: proof count clarification: current11 library tests +37 unchanged Plugins/catalog tests +10 unchanged WorkbenchPlugins tests =58 focused cases; prior log accidentally said36 unchanged. All stated58 total is correct. Original logs retained in02_Tools/cache/plg24-TASK-d5791e9a.
- 2026-11-11 validate: Coordinator source review after round3 found retained-action regression: global folder/ZIP/trial entries must retain authoritative catalog updates, while scoped collisions must not. Keep metadata/trust source restrictions but preserve global update filter/action with installed-version agreement; add regression and both-role round4 review before proof.
- 2026-11-11 validate: returned to build - Coordinator correction: preserve existing catalog update actions for global manual imports while excluding scoped collisions
- 2026-11-11 build: red: two manual global update regressions (folder/local and ZIP/trial with same-id scoped collisions) exit1 because Updates filter hid the imported global package. Tests also require reviewed action without implicit trust/install and reject stale installed-version catalog observation.
- 2026-11-11 build: green: global manual-update regression first red2/2 then fixed. Latest catalog component file12/12 exit0 (catalog-round4.log) covers folder/local and ZIP/trial Updates filter/action, same-id scoped exclusion, no metadata/tier borrowing, required review/cancel, no enabling/install and stale installed-version refusal. Round4 combined run had library11 +Plugins27 +oldcatalog10 green; newcatalog fixture mutation corrected before12/12 proof. Reuse unchanged WorkbenchPlugins10:60 focused passing cases total. Seven E2E flow proofs retained.
- 2026-11-11 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-11 validate: Independent spec and quality reviews both APPROVED round4 on complete current candidate; prior findings resolved. No candidate edits remain. Focused proofs cover60 cases and7native/browser flows; final strict run owns lint/typecheck/i18n only per verification-policy, not full suites.
- 2026-11-11 validate: final: python .agentic/aegis.py check --task TASK-d5791e9a --strict --run exit0 after both round4 approvals; lint4.1s, typecheck19.0s, i18n1.2s all ok; complete test suite explicitly skipped per verification-policy, focused60 cases and7E2E flows already proven. errors0/warnings48/notes20. Remaining warnings are existing stale requirement paths/unlinked tests/ticket-reference heuristics and older journal headers outside this ticket; no current-task uncovered paths/review warning. Native Ubuntu limitation recorded; no real hardware/network/model spend. No source/test/doc edits after proof.
- 2026-11-11 validate: All nine validate Done items explicitly checked after report/proof; first generated report captured unticked boxes despite completed evidence, now checklist reflects logged completion. Owned E2E profiles/output cleaned by existing finally/reporter; retained original logs only under task cache. Coordinator handover has no staging/commit/push.
- 2026-11-11 validate: completed; next done
- 2026-11-11 done: Journal-only coordinator correction after local commit4fd439d: inspected current validate checklist, all9 items already truthfully checked from original proof/reviews/report. The earlier Delivery report was generated before completed boxes were ticked and remains historical; append a fresh report reflecting done stage and9/9 checklist. No implementation, tests, proof or verdict changed; no tests/reviews rerun per verification-policy.

## Rulings

- RULING-001 | date=2026-11-11 | decision=Implement #87 on ddp/plugins-discovery-ui from remote master with one authorized local commit per validated ticket, coordinator-owned | reason=Explicit latest user instruction overrides generic master rule; #86 committed a67012a | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-d5791e9a.md
changed: PLG-24 global searchable Available/Installed library, retained management/review actions, passive readiness, mixed checks, session retention and authoritative global updates; docs/requirements/tests current
evidence: Strict --run exit0 after both round4 approvals;60 focused component cases and7 Windows Electron/Chromium flows passed with unchanged proofs reused
issues: No blockers; native Ubuntu not run in this Windows renderer-only ticket (recorded deviation)
spec_compliance: approved
implementation_quality: approved
review_round: 4

## Delivery report (2026-11-11)

- stage: validate; type: feature; path: full; branch: ddp/plugins-discovery-ui
- requirements:
  - REQ-UX-28a74094 - Present one plugin library per selected tab
  - REQ-UX-41da0f4f - Filter plugin library locally
  - REQ-UX-85399085 - Sort plugin library by factual chronology
  - REQ-UX-2697c05c - Paginate and retain plugin library state
  - REQ-UX-b99b1695 - Browse plugin metadata without probing programs
  - REQ-UX-7c215eb1 - Report all dependency check outcomes
  - REQ-UX-72a349a1 - Review selected catalog plugin with required dependencies
  - REQ-UX-c55a0fe1 - Catalog list and updates on the Plugins page
  - REQ-UX-28503c97 - List installed plugins with their programs
  - REQ-UX-27a41e3d - Compact plugin management with grouped controls
- deviations: 1 recorded
  - validate: no native Ubuntu execution in this Windows session - renderer-only scope uses pinned Windows Electron and Chromium focused proof; no backend/platform contract edits and no full-suite gate required by verification-policy.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=4
- diff vs task base a67012a: 37 file(s) changed, 1872 line(s) added
- checks: errors=0 warnings=48 notes=20
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended

## Delivery report (2026-11-11)

- stage: done; type: feature; path: full; branch: ddp/plugins-discovery-ui
- requirements:
  - REQ-UX-28a74094 - Present one plugin library per selected tab
  - REQ-UX-41da0f4f - Filter plugin library locally
  - REQ-UX-85399085 - Sort plugin library by factual chronology
  - REQ-UX-2697c05c - Paginate and retain plugin library state
  - REQ-UX-b99b1695 - Browse plugin metadata without probing programs
  - REQ-UX-7c215eb1 - Report all dependency check outcomes
  - REQ-UX-72a349a1 - Review selected catalog plugin with required dependencies
  - REQ-UX-c55a0fe1 - Catalog list and updates on the Plugins page
  - REQ-UX-28503c97 - List installed plugins with their programs
  - REQ-UX-27a41e3d - Compact plugin management with grouped controls
- deviations: 1 recorded
  - validate: no native Ubuntu execution in this Windows session - renderer-only scope uses pinned Windows Electron and Chromium focused proof; no backend/platform contract edits and no full-suite gate required by verification-policy.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=4
- diff vs task base a67012a: 37 file(s) changed, 1896 line(s) added
- checks: errors=0 warnings=48 notes=20
- checklist: 9/9 done
