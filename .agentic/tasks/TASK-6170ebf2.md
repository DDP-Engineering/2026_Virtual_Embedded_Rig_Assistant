# TASK-6170ebf2 - MASK-01 Masking settings and resolver (#280)

stage: done
type: feature
interaction: autopilot
requirements: REQ-DATA-13eeeac5, REQ-DATA-9b9ac01e, REQ-FUNC-dd574280, REQ-DATA-4a030001
parent:
branch: master
base: f0ba3040bac0c76fbd2de72d836ce9d21ee2378c
opened: 2026-11-16

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

Problem: STATED (#280): unconditional masking has no area configuration or authoritative resolver.
Desired outcome: STATED: implement MASK-01 infrastructure only, with app and portable workbench privacy.mask contracts and live resolution.
Actors: STATED: desktop/CLI hosts and subsequent masking consumers.
Primary scenario: STATED: a workbench area set to default follows the current app default; explicit on/off overrides it.
Examples: STATED: omitted Display resolves false; Agent resolves true; Display on overrides false.
Counterexamples: STATED: misspelled privacy areas/values are invalid, not preserved extensions.
In scope: STATED: four areas, strict bounded privacy schemas, partial saves/reopen preserving unrelated data, resolver and focused proof, current records.
Out of scope: STATED: MASK-02 #281 Display, MASK-03 #282 Runs, MASK-04 #283 Agent/exports, MASK-05 #284 pages; unchanged provider-error/connection-test scrubbing; delivery builds/full suites/publication.
Constraints: STATED: shared master/default master, base f0ba3040bac0c76fbd2de72d836ce9d21ee2378c; coordinator owns staging/local commit/issue closure. User authorizes local ticket commit after validation; implementer hands back uncommitted. Preserve external workflow/root edits, bundled-plugins and PERF TASK-9a4d3e8a. Formats stay1, no migrations. One owned scratch root evaluation-outputs/mask01.
Success signals: STATED: all24 app on/off x workbench default/on/off x four-area matrix cases, omitted choices, invalid contracts and actual invalidYaml, persistence without losing TERM grants/extensions, live app defaults, both reviews and statics.
Evidence: OBSERVED: tea issues280/279/311 (ddp repo), plan secret-masking.md, settings.ts/workbench.ts and settings/workbench service tests; git HEAD/base and master match assignment. TERM #311 closed; predecessor f0ba3040 is integrated.
Assumptions: INFERRED: optional privacy blocks represent deliberate omission and use documented defaults, consistent with other optional settings; no legacy detection.
Unknowns: none affecting scope.
Decision-blocking questions: none.
Proposed behaviors: none beyond assignment.

## Requirement coverage

Existing REQ-DATA-4a030001 retains first-run identity/format behavior; its spec now includes the masking defaults.


| Behavior | Requirement | Design | Proof |
|---|---|---|---|
| Partial area saves retain unrelated config at format1 | REQ-DATA-13eeeac5 | strict optional privacy contracts and nested merge | settings/workbench persistence |
| Invalid area/key/value fails configuration validation | REQ-DATA-9b9ac01e | strict privacy and mask objects | schemas and actual WorkbenchService open |
| Effective masking follows explicit choice or live default | REQ-FUNC-dd574280 | injected live getter returning maskingFor | exhaustive matrix/omission/live update |

## Design

### Approach
Add shared privacy.ts contracts, used by existing settings/workbench storage and IPC patches. Core settings/masking.ts exports createMaskingResolver(getSettings), returning the authoritative maskingFor(workbench, area); binding the live getter avoids globals and stale copied settings (REQ-FUNC-dd574280).
### Interfaces and data
Privacy/mask objects and per-area fields are optional. App booleans omit to false,false,true,true (exported immutable defaults); workbench choices omit to default. Both privacy levels use strict zod objects, rejecting unknown keys/values (REQ-DATA-9b9ac01e). App first-run defaults explicitly persist all four booleans. Merge privacy.mask per area; unrelated settings and loose workbench extensions, TERM prefixes and folders survive (REQ-DATA-13eeeac5). Formats stay1 by repository policy.
### Files and test seams
Shared privacy.ts, settings.ts/workbench.ts and barrel; core settings/masking.ts and barrel. Add privacy.test.ts and masking.test.ts; extend existing service tests for save/reopen and invalidYaml. Update software README inventory, CHANGELOG and planning/current knowledge. No consumer behavior changes or release note needed.
### Risks and open decisions
No consumer uses the resolver until its assigned successor; documentation must not claim masking switches apply yet. Type-level composition accepts validated settings/workbench privacy projections, no module global state. No open decisions.
### Requirement map
REQ-DATA-13eeeac5: deep area merge and persistence tests.
REQ-DATA-9b9ac01e: strict nested schemas, typed INVALID/CONFIG_INVALID through existing boundaries.
REQ-FUNC-dd574280: live callback and full24-case matrix plus omission and isolation.
Diagrams: [diagram_TASK-6170ebf2.md](diagram_TASK-6170ebf2.md)

## Focused proof

Original logs: `05_Software/evaluation-outputs/mask01/` (owned ignored root).
- `focused.log`: five explicitly selected schema/settings/workbench/resolver files, 130 passed / 2 failed; invalid test channel corrected; unchanged ownership case timed out at5s.
- `settings-correction.log`: corrected persistence case1 passed.
- `focused-correction.log`: new/affected privacy/IPC/WorkbenchService cases28 passed; unchanged ownership case timed out at5s.
- `ownership-retry.log`: only unchanged ownership case1 passed with --testTimeout=20000, no source change.
- `merge-boundary-green.log`: shared privacy and settings service files50 passed after exported merge validation correction.
- `red-noop.log`: review regression2failed/3passed before fix; `noop-green.log`: final privacy/workbench-schema/settings files64passed; `workbench-final.log`: final3masking service cases passed. Omitted masks remain absent on no-op updates.
- Matrix26 tests (24 combinations plus omission/live isolation), workbench schema9 tests and other service regressions reuse passing focused.log proof for unchanged source/assertions.
- Windows pinned Node24.21.0; no platform-specific implementation changed. Native Ubuntu unavailable; existing TERM Windows/WSL2 physical/native paths remain unchanged and their proof is reused.
- No release note: backend infrastructure only. CHANGELOG accurately describes preparation, not completed masking controls/consumer policies.

## Log

- 2026-11-16 frame: journal opened
- 2026-11-16 frame: User authorizes local ticket commit after validation; coordinator owns stage/commit/issue closure. Candidate base f0ba3040bac0c76fbd2de72d836ce9d21ee2378c on master. External workflow/root payload and bundled-plugins/PERF are excluded.
- 2026-11-16 frame: completed; next specify - Assigned scope recorded in autopilot (7 Done checklist item(s) left unticked)
- 2026-11-16 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-16 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-16 build: red: focused privacy/settings/workbench cases exit1 (16failed,11passed,96skipped); missing defaults/patch acceptance/strict privacy rejection. Original evaluation-outputs/mask01/red.log. All three requirements covered; matrix red separately.
- 2026-11-16 build: red: resolver matrix exit1, expected missing resolver assertion; evaluation-outputs/mask01/red-resolver.log. Anchor completed before implementation.
- 2026-11-17 build: Focused run:130passed/2failed. Invalid new test fixture channel beta corrected to pre-release and its single case passed. Existing lost-token test exceeds its5s deadline on this host; rerun only that case with20s deadline, no source change. No new runtime defect observed.
- 2026-11-17 build: red: exported settings merge boundary accepts unknown privacy key; privacy.test.ts -t exported merge exit1; original red-merge-boundary.log (REQ-DATA-9b9ac01e).
- 2026-11-17 build: green: final shared privacy/settings50passed; resolver matrix26 and workbench schema/service passing assertions reused from focused.log; actual invalid YAML and TERM grant save/reopen3passed; ownership1passed with20s deadline. Complete original logs in evaluation-outputs/mask01.
- 2026-11-17 build: completed; next validate
- 2026-11-17 validate: Review round1: spec approved; quality requests preserving omitted mask for legal privacy:{} so update({}) remains no-write/no-event. Both reviewed23owned paths and original proof, no test runs or edits.
- 2026-11-17 validate: returned to build - Round1 quality P2: preserve omitted mask blocks for no-op settings updates
- 2026-11-17 build: Autopilot assignment explicitly authorizes scoped review corrections without routine questions; build return follows bounded review.md loop, not a new product decision. Red no-op regression confirms empty privacy materializes mask and emits; no-op tests before fix in red-noop.log.
- 2026-11-17 build: green round1 fix: omitted privacy/mask blocks preserved in both merge helpers; final privacy/workbench schema/settings64passed, actual workbench masking3passed. Review regressions assert identical snapshots/bytes, zero writes/events. No unrequested source changes.
- 2026-11-17 build: completed; next validate
- 2026-11-17 validate: Independent round2 spec/quality both approved complete23owned-path candidate against base f0ba3040bac0c76fbd2de72d836ce9d21ee2378c. Quality P2 corrected;64+3passing final focused tests, matrix26reused unchanged. No review edits/tests. Release-notes check exit0, backend-only warning accepted; no visible controls/consumer behavior claimed.
- 2026-11-17 validate: DEVIATION validate: final strict --run exit1 solely global lint baseline2formatting errors (user untracked src/bundled-plugins/index.json and unchanged shared/workbench-create-ipc.test.ts blob953b4ea3eb9f249b88acc4202f42a2930273f04b); accepted by assignment. Candidate Biome10files exit0; typecheck/i18n/help exit0; release-notes exit0 with backend-only changelog warning. No new errors/promoted warnings; unrelated existing50advisories retained. Narrow known-lint-baseline.log proves exactly2expected errors.
- 2026-11-17 validate: final: python .agentic/aegis.py check --task TASK-6170ebf2 --strict --run exit1; lint exit1 known baseline; typecheck0/i18n0/help0; no broad tests run per verification-policy. candidate-biome-validated.log exit0, release-notes.log exit0; final-strict.log original. Both independent round2 approvals cover current stable candidate; no candidate edits after review. Final handover complete within authorized scope despite accepted lint baseline, coordinator owns commit/issue closure.
- 2026-11-17 validate: completed; next done

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-6170ebf2.md
changed: MASK-01 strict contracts, live resolver, no-op preserving persistence and current records;23owned files
evidence: Final focused64+3passed; matrix26reused; both round2reviews approved; candidate Biome/typecheck/i18n/help/release-notes0; final strict1 solely known lint baseline
issues: Accepted global lint2file formatting baseline; native Ubuntu unavailable; full suites and final exact-source delivery gate deferred to coordinator
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-17)

- stage: validate; type: feature; branch: master
- requirements:
  - REQ-DATA-13eeeac5 - Masking preferences persist partial area updates
  - REQ-DATA-9b9ac01e - Invalid masking preferences are rejected
  - REQ-FUNC-dd574280 - Resolve workbench masking from live app defaults
  - REQ-DATA-4a030001 - Create versioned application settings
- deviations: 1 recorded
  - validate: final strict --run exit1 solely global lint baseline2formatting errors (user untracked src/bundled-plugins/index.json and unchanged shared/workbench-create-ipc.test.ts blob953b4ea3eb9f249b88acc4202f42a2930273f04b); accepted by assignment. Candidate Biome10files exit0; typecheck/i18n/help exit0; release-notes exit0 with backend-only changelog warning. No new errors/promoted warnings; unrelated existing50advisories retained. Narrow known-lint-baseline.log proves exactly2expected errors.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base f0ba304: 54 file(s) changed, 1765 line(s) added; 9 file(s) not content-scanned
- checks: errors=0 warnings=50 notes=38
- checklist: 9/9 done
