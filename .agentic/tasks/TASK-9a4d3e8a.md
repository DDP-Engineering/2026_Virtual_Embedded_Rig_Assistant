# TASK-9a4d3e8a - PERF-01 Previous-session loading performance regression tests (#91)

stage: build
type: feature
path: full
interaction: autopilot
requirements: REQ-TEST-df5ff0ba, REQ-TEST-a14f8f9b, REQ-TEST-58d27601, REQ-TEST-c0e68f23, REQ-TEST-7cc7bf91, REQ-TEST-5c4d259f, REQ-SEC-4bebe590
parent:
branch: ddp/plugins-discovery-ui
base: 071b274f64f1a95ce37c56310ad2fbf4a3ffc40a
opened: 2026-11-11

Edit Frame, Requirement coverage and Design directly. Write State, Log and
Rulings with `python .agentic/aegis.py` (advance, pause, log, ruling, verdict);
end each session with `advance` or `pause`.

## Done checklist (current stage)

- [ ] each automated increment has a red line before its implementation and a
      green line after; each manual one a logged observation
- [ ] anchor recorded before implementation; evolution reviewed after
- [ ] focused tests green, with the command and its scope logged
- [ ] `affected_paths`, `linked_tests` and `status = "active"` current on every
      requirement, or `retired` with its reason
- [ ] affected docstrings, usage examples and setup instructions updated
- [ ] `check` clean, or each remaining warning explained in the Log

## Frame

Problem: STATED user #91 requests repeatable previous-session performance regressions; OBSERVED the original app delay recovered and its cause remains UNKNOWN.
Desired outcome: STATED implement 00_Planning/plan/performance-regression.md and #91: isolated native persisted-session timings, responsive end condition, calibrated reports/comparisons and repeatable commands.
Actors: STATED VERA developers running the pinned toolchain; native desktop main/renderer; fictional persisted sessions.
Primary scenario: STATED select a previous session via the sidebar after restart or after another session, then type a draft and access history without a provider call.
Examples: STATED planning sizes approximately20/200/2000 messages and a bounded large tool-result variant; quick5/full30 observations per selected case.
Counterexamples: STATED a fast session.get response or placeholder without a usable transcript is not a successful sample; incomplete/incompatible evidence is not a passing comparison.
In scope: STATED deterministic current-format fixtures, native harness/phase probes/watchdog/memory/report identity, explicit baseline calibration and policy/documentation integration.
Out of scope: STATED startup/Plugins/indexing benchmarks, speculative loader optimization, real-model/hardware/network actions, user-data changes and migration/version increments (canonical plan).
Constraints: OBSERVED checkout ddp/plugins-discovery-ui at071b274 with pre-existing UI and #91 planning edits; preserve all unrelated changes and identify them in candidate evidence. No branch switch in the dirty active checkout. STATED local ticket commits are authorized by root AGENTS; no remote publication. Autopilot/full path; focused verification and two independent reviews per02_Tools policy.
Success signals: STATED real loader/IPC/sidebar path; correct persisted fixtures; all samples and responsive interaction timing; calibrated Windows reference and negative-control detection; explicit native-Ubuntu pending when unavailable.
Evidence: OBSERVED git status; canonical plan; #91 via tea; core SessionHub.get replays persisted events, renderer use-session-events requests session.get; desktop native E2E helpers and instrumented build seam.
Assumptions: INFERRED initial native baseline is machine-specific and reports must reject different fixture/build/environment identities.
Unknowns: UNKNOWN root cause and real-session duration; baseline variance/budgets are established by repeated measurements, not invented now; native Ubuntu availability.
Decision-blocking questions: None; user authorized canonical scope. Technical CLI/report choices are documented design decisions within this authorization.
Proposed behaviors: None awaiting product approval; exact implementation choices in Design/spec.
Path and reason:
| Criterion | Holds? | Evidence |
|---|---|---|
| no new externally observable behavior | no | new benchmark CLI/comparison |
| no new interface or data format | no | reports/reference policy |
| no new dependency | yes | existing Node/Playwright/Electron |
| existing requirement fully covers | no | no native session performance suite |
| no security/data-handling change | yes | isolated fictional profiles only |
Full path; one task, no implementation children.

## Requirement coverage

| Requirement | Behavior | Design | Verification |
|---|---|---|---|
| REQ-TEST-df5ff0ba | open a deterministic current-format persisted session through the native sidebar in first-open, warm-reopen or cross-session mode and verify the selected usable conversation without submitting a turn. | isolated runner/probes/report module | native runner and focused tooling |
| REQ-TEST-a14f8f9b | report storage, snapshot construction, IPC round trip, presentation, payload size, main and renderer responsiveness gaps and memory context using correlated measurements without subtracting independent clocks. | isolated runner/probes/report module | native runner and focused tooling |
| REQ-TEST-58d27601 | preserve raw samples and a human-readable summary with fixture, environment, build, commit and dirty candidate identities and quick median/maximum or full median/p95/maximum statistics. | isolated runner/probes/report module | native runner and focused tooling |
| REQ-TEST-c0e68f23 | fail for a configured absolute-budget exceedance or a calibrated relative regression with an absolute noise allowance. | isolated runner/probes/report module | native runner and focused tooling |
| REQ-TEST-7cc7bf91 | return an invalid-evidence outcome distinct from a passing comparison. | isolated runner/probes/report module | native runner and focused tooling |
| REQ-TEST-5c4d259f | retain a failed sample and terminate its owned application process without requiring an in-app callback. | isolated runner/probes/report module | native runner and focused tooling |
| REQ-SEC-4bebe590 | use only owned fictional profiles and workbenches with outbound traffic blocked and its opt-in native and renderer probes omitted from ordinary release builds. | isolated runner/probes/report module | native runner and focused tooling |


## Design

### Approach
REQ-TEST-df5ff0ba/REQ-SEC-4bebe590: isolated VERA_BUILD_ROOT and opt-in test-only probe modules. Main probe wraps existing exported SessionHub.get/EventsRepository.list and IPC registration without changing core loader behavior. Renderer probe wraps mutable api.invoke only in the performance build. Real native UI is measured by a Node Playwright runner.

### Interfaces and data
REQ-TEST-58d27601/REQ-TEST-c0e68f23/REQ-TEST-7cc7bf91: run/calibrate/compare commands, exclusive JSON/Markdown output and strict format1 report/ref protocol per spec. Invalid evidence exits2, failed measured outcomes exit1. Baseline requires two compatible30-sample runs and explicit budgets. No automatic promotion. Probe records contain only numeric metrics and fictional session ids. REQ-TEST-a14f8f9b: nested storage/snapshot durations and API/presentation clocks stay local, overlaps documented. REQ-TEST-5c4d259f: runner deadline owns kill/cleanup even when main blocks.

### Files and test seams
05_Software/scripts/eval-performance-harness/{report,fixtures,runner}.mjs and scripts/perf-sessions.mjs; package command. Main session-performance.ts installed behind a compile-time performance&&test gate before IPC handlers; its static import has no module-level side effects and unused probe code is erased from ordinary builds. Renderer api/session-performance.ts similarly gated; config provides constant. Focused tests/tooling/session-performance.test.ts covers report math/compatibility and fixture shape; native runner provides acceptance/negative controls. docs and verification policy describe exact runs.

### Risks and open decisions
Large histories may expose existing slowness: retain failed budgets and report cause only with evidence, no speculative fixes. Full runs are serial and potentially long. Native Ubuntu unavailable until actual host evidence. Pre-existing UI candidate is preserved and included in dirty identity, not silently committed with #91. Release output must omit probe markers. No new dependencies or compatibility readers.

### Requirement map
All7 requirements map to the approach/interfaces/files above and the coverage table. Details are in specs/REQ-TEST-df5ff0ba.md.
Diagrams: [diagram_TASK-9a4d3e8a.md](diagram_TASK-9a4d3e8a.md)


## Log

- 2026-11-11 frame: journal opened
- 2026-11-11 frame: User authorized implementation of #91 and local per-ticket commit under root AGENTS. Existing UI/planning changes are preserved; no publication. Continue active branch to avoid moving dirty shared work.
- 2026-11-11 frame: completed; next specify
- 2026-11-11 specify: completed; next design
- 2026-11-11 design: completed; next build
- 2026-11-11 build: red: focused session-performance tooling test exit1, missing repeatable command (REQ-TEST-df5ff0ba).
- 2026-11-11 build: User requested merge of latest remote develop into active local branch during build; interrupted quick matrix is not accepted proof. Preserve in-progress candidate and resume after integration.
- 2026-11-11 build: Requested correction: merged origin/master71cde06 in dd2a273, not develop. Three conflicts resolved preserving both streams and classifying five new official packages. Merge-focused17/17 tests, typecheck and i18n passed; original uncommitted UI/PERF candidate restored without conflicts.
- 2026-11-11 build: Review round1: bound all preparation/telemetry, verify complete snapshot content outside timer, assert true history viewport access, validate diagnostic samples, compare maxima and render useful comparison differences. Interrupted development matrix is not final proof.
- 2026-11-11 build: green: tooling22/22 and typecheck exit0; native small15/15 tested full response hashes and true scroll. Remaining full matrix/reference, controlled stalls, release omission and final reviews are pending.
- 2026-11-11 build: DEVIATION build: after the first command red test, related harness/probe increments were built as a group before adding all negative oracles; focused failure tests and real native acceptance cover the behavior, but not every atomic requirement has its own recorded initial-red cycle.
- 2026-11-11 build: Review round2: include explicit injection-control metadata and verify complete content at the renderer API boundary as well as main; original watchdog/scroll/max/Markdown findings fixed.
- 2026-11-11 build: User explicitly requested stop for computer shutdown. Work remains uncommitted. Latest focused tooling22/22 and delivered-API content probes2/2 pass; initial small native pilots passed. Release omission build interrupted/not accepted unless completed output recorded. Full repeated references/calibration, negative controls, final reviews and strict proof remain pending. Merge origin/master is committed as dd2a273, user UI adjustments preserved.
- 2026-11-11 build: Shutdown checkpoint correction: ordinary-build probe omission finished before cancellation, exit0, all30 JS bundles contain none of the three performance markers. API content probes2/2 exit0. Retain original cache proof; cleanup interrupted owned temporary roots on resume if any remain.
- 2026-11-12 build: User explicitly resumed #91 on2026-11-12. Branch/candidate preserved after shutdown. Resume build; recorded round2 findings have implementation fixes, awaiting final native/calibration evidence and fresh review.
- 2026-11-12 build: User narrowed immediate scope on2026-11-12 to descriptive measurement of existing behavior only. Full A360/360 valid Windows samples (external/provider0) delivered under06_SoftwareDocu/performance/session-loading-2026-11-12-windows.md and .json, raw bytes preserved. Second sweep interrupted and excluded. No loader/rendering optimization, calibrated reference, mandatory gate or final regression acceptance; policy additions removed and planning/guide clarified. #91 remains open/uncommitted for any later regression phase.
- 2026-11-12 build: User explicitly authorized local commits on 2026-11-12 (commite ce e deja implementat). Prepare checkpoint commits of existing UI, experimental measurement harness/results and planning only; do not resume deferred #91 calibration or implement #110. UI checkpoint f24b0cf committed; existing 67 component and native/browser UI proof reused. Independent spec and quality reviewers approve the complete current candidate for checkpoint commits only, not final #91 acceptance. Renamed harness/output paths validated; three affected harness files formatted; focused tooling/API tests24/24, typecheck, i18n, Biome error-level checks and scoped strict AEGIS exit0. AEGIS reports0 errors,105 non-promoted historical/merge/out-of-scope warnings; no unrelated remediation. Raw360-sample SHA2566634ad12bab2e00463b696fd820697c7a4bd2bff36ecfa649c1bb8cf3e430759 preserved.

## Rulings


## State

status: waiting
reported: build - paused
next: Measurement-only checkpoint prepared for authorized local commit. Resume broader #91 calibration/comparison/control acceptance only when explicitly requested.
must_read: .agentic/tasks/TASK-9a4d3e8a.md, .agentic/steps/4_build.md
changed: Renamed experimental harness and output paths; prepared validated descriptive measurement checkpoint; UI committed as f24b0cf.
evidence: Focused24/24, typecheck, i18n, Biome and scoped strict AEGIS exit0; both independent checkpoint reviews approve; raw360-sample hash unchanged.
issues: Broader #91 incomplete: calibration, native controls, final regression acceptance and Ubuntu measurements deferred. #110 remains planning only/on hold. Historical strict warnings are non-promoted.
spec_compliance: changes_required
implementation_quality: changes_required
review_round: 2
