# TASK-bea71615 - MASK-03 Program runs area masking (#282)

stage: done
type: feature
interaction: autopilot
requirements: REQ-FUNC-2bd4a3a4, REQ-FUNC-7ddb3926, REQ-SEC-ff8ae422, REQ-SEC-65cfbdc5, REQ-SEC-96d0e13d
parent:
branch: master
base: cb8f0bcd15d9895c51d5d222ceb9b33f780daba8
opened: 2026-11-17

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

Problem: STATED issue282: Runs arguments, logs, errors and statuses always mask, hiding local debugging values.
Desired outcome: STATED: Program runs follows the live app/workbench resolver, default off, including user terminal output.
Actors: STATED: local user inspecting runs, provisioning and interactive terminals; consented agent terminal reader.
Primary scenario: STATED MASK-03-A: a real program prints a stored MQTT password; arguments/log/status show it off and redact on.
Examples: STATED: inherited app choice, explicit workbench override and two-workbench ownership; finished full-log tabs refresh after live changes.
Counterexamples: STATED: runs=false does not disable model/terminal_read scrubbing, provider failures, connection tests, credential admission or filtered environment.
In scope: STATED: host Runs/status projection, terminal user snapshots, live renderer cache refresh, focused real Windows acceptance and multilingual help/notes.
Out of scope: STATED coordinator: MASK04 agent/exports policy, MASK05 settings pages, native dependencies/lifecycle changes, delivery rebuilds and full suites.
Constraints: STATED: shared master/default master; full candidate base cb8f0bcd15d9895c51d5d222ceb9b33f780daba8. User authorizes local ticket commits; coordinator alone stages/commits/closes. Preserve unrelated workflow/root payload, bundled-plugins and PERF task. Formats stay1. Scratch evaluation-outputs/mask03 only.
Success signals: STATED: actual stored credential/program output/full viewer toggles; focused boundaries and immediate consumers, statics/strict and both independent reviews.
Evidence: OBSERVED: tea282/279/311; expected HEAD confirmed, MASK02 TASK-cfee41bb done; unconditional main Runs/status projection and TerminalService.publicOutput inspected.
Assumptions: INFERRED: existing validated settings/config IPC suffices until MASK05 pages.
Unknowns: UNKNOWN: native Ubuntu unavailable; WSL2 is separate Linux backend evidence.
Decision-blocking questions: None; coordinator supplied scope and authority.
Proposed behaviors: None beyond stated deliverables.

## Requirement coverage

| Behavior | Requirement | Design | Proof |
|---|---|---|---|
| Conditional run/status presentation | REQ-FUNC-2bd4a3a4 | RunPresentation live projection | focused-final.log106; native-fourth.log1 |
| Live cached presentation refresh | REQ-FUNC-7ddb3926 | Query reset, passive status observations and viewer attempts | status-consumers-final81; action-completion-final7; native-ready1 |
| Current owner refusal | REQ-SEC-ff8ae422 | Publication ownership recheck | focused-final.log106; native-fourth.log1 |
| Separate terminal user/agent projection | REQ-SEC-65cfbdc5 | User bypass only, masked recent agent path | focused-final.log106; native-fourth.log1 |
| Shell metadata and logs | REQ-SEC-96d0e13d | Same run projection | focused-final.log106; native-fourth.log1 |


## Design

### Approach
REQ-FUNC-2bd4a3a4/REQ-SEC-96d0e13d: add a small host RunPresentation adapter around ProgramRunner reads. Resolve live settings/config at publication; preserve raw records/logs and existing process behavior. Reuse the core resolver shared with Display, choosing runs explicitly.
### Interfaces and data
REQ-SEC-ff8ae422: capture the current workbench ID/folder before asynchronous reads and recheck before projecting; stale/foreign ownership is CONFLICT. Global plugin statuses use app defaults without a workbench; scoped statuses use their explicit owner. Projection covers all descriptive status fields, bounded again after masking.
REQ-SEC-65cfbdc5: TerminalService receives a live user masking predicate; output bypasses scrubbing only for the local user when off. Agent recent() always uses the existing held-prefix/VT-safe scrubbed projection and publication leases, never user output. Existing shell environment filtering remains unconditional.
### Files and test seams
Host run-presentation.ts and sibling tests exercise resolver/ownership/list/log/status. main/index.ts composes adapter and runs terminal predicate. program-statuses.ts covers status text bounds. Renderer use-run-presentation hook resets affected query caches on settings/config events and re-reads observed status keys explicitly through passive plugins.programs; unchecked entries stay unchecked. App owns its lifetime. Plugin actions complete independently of query cancellation, retire passive reads again at completion and publish only a fresh passive observation; original action failures propagate. Late archive/check/install replies cannot restore old presentation or replay actions. RunsTab retains selected dialog ID rather than stale metadata. Viewer refresh invalidates run attempts across cached session tab sets. Focused component tests and native run-masking.spec.ts prove immediate consumers/live toggles.
### Risks and open decisions
Raw source authority remains host-only; no raw renderer cache is introduced. Async rechecks prevent policy/owner mixups. Query resets cancel old responses and clear stale content. Native/packaging paths unchanged: reuse TERM proof, no rebuild of selected delivery artifacts. No unresolved product decisions.
### Requirement map
REQ-FUNC-2bd4a3a4: live host projection; REQ-FUNC-7ddb3926: query reset plus viewer attempt invalidation; REQ-SEC-ff8ae422: host owner capture/recheck; REQ-SEC-65cfbdc5: separate user/agent terminal projection; REQ-SEC-96d0e13d: shell fields through same run adapter.
Diagrams: [diagram_TASK-bea71615.md](diagram_TASK-bea71615.md)


## Log

- 2026-11-17 frame: journal opened
- 2026-11-17 frame: User local-commit authorization recorded; coordinator owns final verification, staging and commit. Base full HEAD cb8f0bcd15d9895c51d5d222ceb9b33f780daba8 on master. Predecessor MASK02 completed/committed; no competing implementation task. Preserve external workflow payload/root instructions, user bundled-plugins and PERF TASK-9a4d3e8a.
- 2026-11-17 frame: completed; next specify (7 Done checklist item(s) left unticked)
- 2026-11-17 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-17 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-17 build: red: focused terminals/program-statuses Vitest exit1 (2 expected failures,13passed), evaluation-outputs/mask03/red-host.log. User off still holds secret prefix; version/range/path remain unmasked. REQ-SEC-65cfbdc5 and REQ-FUNC-2bd4a3a4.
- 2026-11-17 build: green: host terminal/status focused15 exit0 green-host.log. red: focused renderer new cases exit1 (3 expected failures) red-renderer.log: stale dialog metadata and cached full-log sessions after app/workbench changes (REQ-FUNC-7ddb3926).
- 2026-11-17 build: green: focused-final.log 11files106tests exit0; includes terminal VT partial CSI/OSC/DCS regression, separate agent path and leases, run/status ownership and resolver, live caches/dialogs/viewer. hook-final2.log 1test exit0. Native-fourth.log sandboxed Windows Electron1passed actual stored MQTT secret output, run args/canonical cwd, status, running dialog, finished full viewer, live overrides, terminal snapshots and two-workbench isolation. Original receipt evaluation-outputs/mask03/native/receipt.json. Agent approved-command regression3passed in agent-regression.log. No native dependency or selected delivery changes.
- 2026-11-17 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-17 validate: WSL2 bundled current-source probe8assertions exit0 wsl2-ready.log, pinned Linux Node24.21.0. Native Ubuntu unavailable. Admission1passed exit0 admission.log. Reused unchanged TERM physical PTY/process/native packaging proof; no delivery rebuilt.
- 2026-11-17 validate: DEVIATION validate: official-plugin suite explicitly deferred by coordinator; focused desktop status/projection and native fixture program prove this presentation-only change, while plugin execution/provisioning contracts and manifests stay unchanged. Full suites and exact-source delivery gate remain coordinator-owned and deferred.
- 2026-11-17 validate: Current knowledge/context/requirements and plan reconciled; MASK02 predecessor commit cb8f0bcd15d9895c51d5d222ceb9b33f780daba8 recorded. Owned path list evaluation-outputs/mask03/owned-paths.txt excludes externally changed workflow/root instructions and user bundles. No edits to unrelated PERF or native dependency paths.
- 2026-11-17 validate: Review round1 findings: disabled plugin-programs observers reset to unchecked instead of refreshing; late archive direct cache writes can republish stale presentation. Fix only these: re-read already observed statuses through passive plugins.programs, never replay cached action queryFns; keep action completion independent of presentation cancellation and publish only a fresh passive read.
- 2026-11-17 validate: returned to build - Both independent reviews require observed status refresh and late archive publication fix
- 2026-11-17 build: red: actual Plugins card consumer regressions2failed expected, red-status-consumers.log. Disabled observer loses status on settings event; late archive response writes private-status after privacy reset. Scope extends existing Plugins and WorkbenchPlugins action publication only, preserving explicit dependency-check behavior.
- 2026-11-17 build: Round1 fixes implemented: already observed disabled program-status keys refresh through passive plugins.programs, never cached action queryFns. Actions complete independently of presentation resets and publish fresh passive reads; late archive direct results discarded. Actual Global Plugins regression2green green-status-consumers2.log; WorkbenchPlugins late archive1green workbench-status-final.log. Existing action mocks updated to model passive state after checks/reinstall; no production manifest/native changes.
- 2026-11-17 build: green round1 fixes: status-consumers-final.log4files81passed exit0, native-ready.log Windows Electron1passed with actual visible checked program-status row refreshing app/workbench choices; native/receipt.json updated. Prior focused106/agent3/admission1/IPC1/WSL2eight proof remains valid for unchanged host/terminal paths. typecheck-round2.log exit0; candidate-biome-round2.log22files0errors (11existing test warnings,1existing info).
- 2026-11-17 build: completed; next validate
- 2026-11-17 validate: Round2 independent reviews found completion deduplication race: passive status read started during an action can be reused on success or swallow its failure. Fix scoped action completion to retire the pending presentation before fresh publication and preserve the original action error; add deferred success/failure regression.
- 2026-11-17 validate: returned to build - Round2 pending passive status read can outlive and override action completion
- 2026-11-17 build: red round2 completion race: deferred success/failure tests2failed as expected red-action-completion.log; stale missing status survived success and action failure was swallowed. Scoped fix cancels current presentation again at completion, forces fresh passive read, records readiness failure and always rethrows original action error.
- 2026-11-17 build: green round2 fix: action-completion-final.log3files7passed (63unselected) exit0, including deferred success/failure, original-error identity, disabled Global/Workbench archive consumers and stale-ready failure behavior. typecheck-round3-ready.log0 and biome-round3.log0; only final test Promise annotation changed after run. Prior status81/native1/focused106/agent3/admission1/IPC1/WSL2eight remain valid for unchanged paths.
- 2026-11-17 build: completed; next validate
- 2026-11-17 validate: Both independent exact-candidate round3 reviews approved (review-spec-round3.md/review-quality-round3.md). No remaining findings; original proof logs retained under evaluation-outputs/mask03. Owned tmp cache cleanup was rejected by automatic approval review as blocked by policy; no deletion occurred, ignored caches remain. No staging/commit; coordinator owns local commit.
- 2026-11-17 validate: final: check --task TASK-bea71615 --strict --run exit1 strict-final.log. Lint reports exactly2known baseline format errors; narrow known-lint-baseline.log confirms exactly2 in user bundled-plugins/index.json and unchanged shared/workbench-create-ipc.test.ts blob953b4ea3eb9f249b88acc4202f42a2930273f04b. Strict typecheck/i18n/help0. Candidate Biome22files0errors plus final helper2files0; release-notes0. Strict advisory1commanderror69warnings38notes,0promoted. No candidate changes after round3 approvals; only journal records follow.
- 2026-11-17 validate: DEVIATION validate: final strict exit1 accepted solely preserved known global lint baseline under coordinator assignment. Candidate source checks pass; existing test non-null warnings/useless-fragment info, context-size/layout/legacy-journal/test-source overlap heuristics and synthetic MQTT fixture warning are advisory and do not limit scoped proof. Native Ubuntu, full/plugin suites and exact-source final delivery gate remain deferred. Owned tmp cleanup blocked by automatic approval review; caches remain ignored. No selected deliverable updated.
- 2026-11-17 validate: completed; next done - Scoped candidate complete; assignment accepts preserved known global lint baseline

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-bea71615.md
changed: MASK-03 complete;48owned files uncommitted on master; coordinator owns local commit
evidence: Focused106/status81/finalrace7, agent3/admission1/IPC1, native1/WSL2eight; reviews3approved; statics0; strict1knownbaseline
issues: Known lint2baseline preserved; native Ubuntu/full/plugin suites/final delivery gate deferred; owned tmp cleanup blocked by automatic approval review
spec_compliance: approved
implementation_quality: approved
review_round: 3

## Delivery report (2026-11-17)

- stage: validate; type: feature; branch: master
- requirements:
  - REQ-FUNC-2bd4a3a4 - Program run presentation follows live area masking
  - REQ-FUNC-7ddb3926 - Cached run presentation refreshes on privacy changes
  - REQ-SEC-ff8ae422 - Run presentation refuses foreign workbench ownership
  - REQ-SEC-65cfbdc5 - Terminal environment and output masking
  - REQ-SEC-96d0e13d - Masked shell run presentation
- deviations: 2 recorded
  - validate: official-plugin suite explicitly deferred by coordinator; focused desktop status/projection and native fixture program prove this presentation-only change, while plugin execution/provisioning contracts and manifests stay unchanged. Full suites and exact-source delivery gate remain coordinator-owned and deferred.
  - validate: final strict exit1 accepted solely preserved known global lint baseline under coordinator assignment. Candidate source checks pass; existing test non-null warnings/useless-fragment info, context-size/layout/legacy-journal/test-source overlap heuristics and synthetic MQTT fixture warning are advisory and do not limit scoped proof. Native Ubuntu, full/plugin suites and exact-source final delivery gate remain deferred. Owned tmp cleanup blocked by automatic approval review; caches remain ignored. No selected deliverable updated.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=3
- diff vs task base cb8f0bc: 79 file(s) changed, 2465 line(s) added; 9 file(s) not content-scanned
- checks: errors=0 warnings=69 notes=38
- checklist: 9/9 done
