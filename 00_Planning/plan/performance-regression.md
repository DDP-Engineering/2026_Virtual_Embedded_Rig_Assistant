# Performance regression — previous-session loading

Date: 2026-11-11. Status updated 2026-11-12: initial current-behavior measurement delivered;
broader regression implementation paused at the user's request to measure only for now.
Work package: **PERF-01**. One implementation ticket covers this first bounded increment.
Tracking: [Gitea #91 — PERF-01 Previous-session loading performance regression tests](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/91).
Canonical planning file: `00_Planning/plan/performance-regression.md`.

## Current authorized phase — 2026-11-12

The user narrowed the immediate scope to measuring the existing behavior. One complete Windows
native sweep produced360/360 valid samples. The repeated sweep/calibration was stopped; no
regression reference or mandatory performance gate is established, and no loader/rendering
optimization was made. The measurement-only implementation is saved in local checkpoint commit
`672e094`; ticket #91 remains open for the deferred regression phase. The compact Plugins follow-up
is committed separately as `f24b0cf`.

Results: [current-behavior evaluation](../../06_SoftwareDocu/eval-performance-outputs/session-loading-2026-11-12-windows.md)
and [all360 raw samples](../../06_SoftwareDocu/eval-performance-outputs/session-loading-2026-11-12-windows.json).
Harness: `05_Software/scripts/eval-performance-harness/` with entrypoint `05_Software/scripts/perf-sessions.mjs`.
The remaining requirements below describe the deferred regression phase, not completed acceptance.

The agreed future harness/output layout is tracked separately in
[REPO-01 / #110](tooling-tests-evaluators-layout.md). That reorganization is planned only and on hold;
the paths above describe the current implementation. It does not resume regression calibration or
change the recorded historical measurements.

## Problem and first outcome

On 2026-11-11 the user opened a workbench and clicked a previous session. Loading eventually
completed, but during the delay Windows reported the VERA window as not responding. The elapsed
time was not measured and the cause is unknown. This is an observed symptom, not evidence of a
particular SQLite, IPC or rendering defect, and not evidence that a particular recent feature caused it.

Existing Electron session/restart and scrolling tests verify behavior. Ingest and embedding scripts
contain some timing measurements, but there is no common UI performance regression command or
calibrated previous-session baseline. A functional test passing before its timeout is not a latency budget.

Deliver a repeatable native Electron benchmark for opening saved sessions through the real sidebar,
with phase diagnostics, responsiveness measurements, a reference report and an automated comparison.
Start here before adding application startup, general workbench navigation, Plugins or background
indexing benchmarks. Those are later extensions, not extra tickets or acceptance work in PERF-01.

## Scope

- Reuse the repository's pinned Node/Electron/Playwright tooling, current session persistence and
  network guard. Use a compiled application without Vite watch/HMR; record the build mode. A browser
  mock can test the harness but cannot supply the native persistence/IPC performance baseline.
- Generate deterministic fictional workbenches and persisted sessions at current format/schema
  version **1**. Use isolated temporary profiles and folders; never seed or modify the user's active
  profile/workbench. Generate data outside the timed region and close writers before measuring.
- Initial data tiers: approximately **20, 200 and 2,000 conversation messages**, with a fixed,
  documented mixture of Markdown, code, completed tool calls/results, citations and artifact metadata.
  Include a bounded large-result variant to exercise payload size independently of message count.
  Freeze the exact generator, seed, message/item counts and payload sizes in a versioned fixture
  manifest before recording the baseline. No real model, API credentials, hardware or outbound traffic.
- Use the real stored-session loader, preload/IPC bridge, renderer and sidebar selection path.
  Do not substitute an in-memory mock or preloaded session for the measured operation.
- Keep the harness reusable for later scenarios without implementing a general monitoring platform.
  Any instrumentation is opt-in, narrowly scoped, and must not expose session contents in reports or
  add test/debug behavior to release builds.

## Scenarios and timing boundaries

| Scenario | Setup outside the session-load timer | Measured operation |
|---|---|---|
| First open after restart | Launch a fresh app process with a previously persisted fixture; open its workbench and wait for its session list | Click an unvisited previous session and wait until that conversation is usable |
| Warm reopen | Open fixture session A, switch to B and settle | Select A again and wait until A is usable |
| Cross-session selection | Settle in one saved session | Select a different session of the requested data tier and wait until it is usable |

Each first-open sample uses a fresh process and an unvisited session. Do not warm that same session
before its first-open sample. This is process/cache state, **not** proof of an empty operating-system
disk cache; do not flush OS caches or require administrator access. Keep restart/workbench preparation
durations as separate context so they do not silently enter the session-load metric.

The end condition must establish the selected session identity, expected visible conversation content
and a usable composer. Exercise draft typing without submitting a turn, and scrolling/history access
where applicable. Respect the product's rendering/pagination strategy: do not require every historical
message to exist in the DOM. Verify persisted counts/content outside the timed interval so a missing
or truncated conversation cannot produce an apparently faster pass.

Record at least:

- User-visible selection-to-usable duration. Start timing before dispatching the real click, including
  any blocked delivery; document automation overhead. Do not start the timer after an awaited click
  or stop it merely because `session.get` resolved or a loading placeholder painted.
- Loader/storage and snapshot-construction phases, snapshot payload bytes, IPC round trip, and
  renderer work through usable presentation. Report overlap explicitly; phases need not sum to the
  user-visible duration. Correlate main/renderer measurements without subtracting unrelated clocks.
- Maximum observed main-process and renderer responsiveness gaps during loading; distinguish these
  from phase duration. Measure interaction responsiveness, not only total completion time.
- Main and renderer memory before/after repeated selections, with the measurement method identified.
  Record trends for diagnosis; do not label normal heap growth a leak without supporting evidence.
- A runner-side deadline/watchdog that can report a frozen app even if in-app timing callbacks stop.
  A timeout, crash or incomplete measurement is a failed run, never a fast or omitted sample.

## Repetitions, baseline and regression policy

- Provide one documented command with quick and baseline/full modes, using the repository runtime
  wrapper. Proposed command family: `npm run perf:sessions -- ...`; this does **not exist yet**.
- Quick mode targets the affected session-loading scenarios, with at least **5 measured samples**
  per selected case and median/maximum reporting. It does not claim a meaningful p95 from five samples.
- Baseline/full mode uses at least **30 measured samples** per case and reports sample count, median,
  p95 and maximum, retaining every raw sample and documenting the percentile calculation.
- Perform preparation/warm-up separately from measured samples, preserving first-open semantics.
  Run serially on an otherwise idle reference host. Record OS, CPU/RAM, runtime versions, viewport,
  text scale, build mode and fixture identity. Compare like-for-like environments; Windows and native
  Ubuntu have separate references. Do not run this measurement concurrently with builds or other suites.
- Reference/report identity includes commit plus dirty candidate patch hash where applicable,
  fixture manifest hash, harness/report format and all scenario settings. Never compare a dirty candidate
  as if it were its clean HEAD, or silently compare different fixture sizes/build modes/machines.
- Calibrate normal variation with repeated baseline runs. Record justified absolute usability/stall
  budgets and relative regression tolerances with an absolute noise allowance; no arbitrary universal
  milliseconds or uncalibrated percentage is declared accepted by this plan.
- The baseline is diagnostic, not permission to accept an already poor experience. Mark existing
  unacceptable latency/stalls explicitly, with reproduction and a bounded follow-up recommendation.
  PERF-01 does not require speculative loader/rendering optimizations or claim the reported delay fixed.
- Comparison mode returns failure for exceeded configured budgets or regressions. Missing or
  incompatible references, insufficient samples and broken measurements must be distinguished from
  a passing comparison. A baseline must be explicitly selected/recorded; never overwrite it during a
  feature check or automatically bless a slower candidate. Explain reference updates in review.
- Preserve a compact human-readable summary and machine-readable report with raw timings, reference
  differences and failure diagnostics, without copying conversation text or sensitive filesystem paths.
  Keep performance artifacts separate from routine E2E output cleanup; clean owned temporary profiles
  after process shutdown, retaining only the documented reports and relevant failure evidence.

## When to run it after new features

For changes to session persistence, snapshot/IPC delivery, session hooks, sidebar selection or chat
rendering, run the affected quick scenarios and attach the comparison to the ticket's validation.
If that run finds a regression or approaches a budget, run the affected full cases to establish the
result. Unrelated features do not automatically trigger every performance scenario.

At the existing milestone gates, run the complete currently implemented performance matrix once,
with one owner and environment-specific references. Integrate this into the documented verification
policy during implementation; do not introduce a complete functional-suite run for every feature,
duplicate handover testing, a scheduled automation or continuous profiling of the user's app.

## Existing entry points to inspect during implementation

- `05_Software/src/libraries/core/src/sessions/service.ts` and the current storage implementation.
- `05_Software/src/apps/desktop/src/main/index.ts` (`session.get`) and the typed preload/IPC path.
- `05_Software/src/apps/desktop/src/renderer/hooks/use-session-events.ts` and session workspace/chat
  components under `renderer/components/session/`, plus the real sidebar selection owner.
- `05_Software/tests/e2e/chat-detail.spec.ts`, `session-scroll.spec.ts`, `navigation-actions.spec.ts`,
  `network-guard.ts`, and the existing fixture/replay helpers. Reuse relevant behavioral proof.
- `05_Software/scripts/test-e2e.mjs`, `package.json`, `00_Planning/architecture/08-quality.md` and
  `02_Tools/verification-policy.md` for command and validation integration.

These are investigation starting points, not a diagnosis or a prescribed rewrite.

## Done when

- [ ] A documented single command can seed fixtures, run selected quick/full native session-loading
  scenarios, save a report and compare a candidate with an explicitly selected reference.
- [ ] All three data tiers and timing scenarios use the actual persistence/IPC/UI path; sessions are
  correct after restart and opening them sends no provider request or external traffic.
- [ ] The report contains complete samples, phase/payload/responsiveness measurements, memory context,
  environment/fixture/build identities and unambiguous pass/fail/incompatible-reference outcomes.
- [ ] Repeated Windows native runs produce an initial reference and documented calibration/budgets.
  Native Ubuntu proof is recorded separately; unavailable platform proof is explicitly pending, never
  inferred from Windows or browser runs. Cross-platform readiness is not claimed without both.
- [ ] A controlled delayed/stalled test proves that the comparison/watchdog detects the regression;
  focused harness tests also reject incompatible references and incomplete/insufficient results.
- [ ] Existing poor performance, if found, is reported with evidence and an actionable next step rather
  than hidden by reference creation. No optimization or cause is claimed without measurements.
- [ ] Relevant focused checks, static checks and the repository's independent reviews are complete;
  commands, artifacts and feature/milestone run rules are documented. No full functional-suite rerun
  is added outside its existing gate.

Planning and ticket creation do not start an AEGIS task, implementation, an automatic agent cycle,
baseline collection or a change to the running application. Product implementation follows the
repository workflow when requested. No migration, format increment or user-data conversion is in scope.
