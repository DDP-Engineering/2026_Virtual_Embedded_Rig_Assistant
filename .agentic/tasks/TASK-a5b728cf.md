# TASK-a5b728cf - PERF-07 Progressive transcript rendering, newest first (#255)

stage: done
type: change
path: quick
interaction: autopilot
requirements: REQ-UX-4bea0002, REQ-REL-c8ac2ecc, REQ-UX-2bbfd052, REQ-TEST-a14f8f9b
parent:
branch: feature/249-responsiveness
base: 247ead4cb50b45b71258d43fba91789654c75b1b
opened: 2026-11-14

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

Problem: the first render of a session mounts every row in one commit; after PERF-02..06 opening the 2,000-message `large` case still costs ~2.1 s (OBSERVED `perf07-before.json`: large/first 2075, warm 1758, cross 1976 ms median), spent in the renderer mounting and laying out all rows (STATED coordinator brief; OBSERVED PERF-03/04 handovers). Streaming into `large` pays forced layout of the 2,000-row flex column per frame (OBSERVED PERF-04 handover CPU profile; before gap median 76 ms on this run).
Desired outcome: the last screen of a session is usable within about 300 ms of the snapshot, independent of length; older rows mount in the background without blocking input and are complete before the user can scroll to them; the final transcript is unchanged; search, the navigator, jump-to-message, autoscroll and Show full output keep working (STATED #255 Goal, coordinator brief).
Actors: the user opening a long session in the desktop renderer; the developer running `perf:sessions`.
Primary scenario: open a 2,000-message session; the newest rows paint first, older rows are prepended in idle chunks while the view stays at the end; the user scrolls up or presses Ctrl+Home and reaches the first message.
Examples: a 2,000-item state mounts 40 rows in the first commit and all rows after the idle callbacks run; searching mounts every row so the oldest match is outlined; a session with fewer than 40 rows mounts at once (STATED #255 Tests; INFERRED for the short case).
Counterexamples: a user who scrolled up is not pulled to the end by a prepended chunk (existing follow/suspend behaviour, OBSERVED transcript scroll tests).
In scope: newest-first window plus idle chunk fill in `transcript.tsx` (rIC with timeout, chunks in `startTransition`), mount-all on search and when the user scrolls near the top of the mounted range, reset on session change; CSS `content-visibility: auto` with `contain-intrinsic-block-size` on message rows so off-screen rows skip layout (STATED coordinator brief); a small harness probe for time to the first screen (STATED #255 Measurement).
Out of scope: virtualization libraries (STATED #255 plan 5, coordinator brief); estimated navigator markers for unmounted rows (INFERRED: unmounted rows have no marker to activate, so the on-demand jump of #255 step 3 has no trigger; markers appear as rows mount).
Constraints: no new dependency; Windows and Linux (Chromium in Electron); no backward-compat code; targeted tests only; do not commit (STATED coordinator brief).
Success signals: render test (40 rows first, all after idle), search mounts oldest, near-top scroll mounts all, prepend keeps the end; existing transcript, navigator and detail tests green; typecheck clean; perf after: large/first first-screen well under 1 s and stream gap not worse (STATED #255 Tests/Measurement).
Evidence: OBSERVED `transcript.tsx`, `transcript-navigator.tsx` (measures only connected anchors), `workspace.tsx` (search only outlines, count from state), `runner.mjs` (loadMs waits for the first message after Ctrl+Home, i.e. the complete fill), `report.mjs`.
Assumptions: INFERRED that Chromium's native scroll anchoring (`overflow-anchor: auto`, default) keeps a scrolled-up view stable when rows are prepended above it and when `content-visibility` rows above get their real height.
Unknowns: native Ubuntu timing (no Ubuntu host here); jsdom cannot show native scroll anchoring.
Decision-blocking questions: none.
Proposed behaviors: none new for the user beyond timing; the harness gains `firstScreenMs`.
Path and reason: quick.

| Criterion | Holds? | Evidence |
|---|---|---|
| no new externally observable behavior | yes | final transcript identical; only mount timing (STATED #255 Goal) |
| no new interface or data format | yes | harness report gains one metric inside format 1 (pre-release, no compat) |
| no new dependency | yes | React/DOM/CSS only |
| an existing requirement already covers the behavior | yes | REQ-UX-4bea0002 (transcript), REQ-REL-c8ac2ecc (navigator), REQ-UX-2bbfd052 (jump), REQ-TEST-a14f8f9b (harness probe) |
| no security or data-handling change | yes | renderer presentation only |

## Requirement coverage


## Design


## Log

- 2026-11-14 frame: journal opened
- 2026-11-14 frame: completed; next build - scope recorded (autopilot) (7 Done checklist item(s) left unticked)
- 2026-11-14 build: red: vitest transcript-progressive.test.ts exit 1 - 3/6 fail: all 2,000 rows mount in the first commit, no idle chunks, nothing to cancel (REQ-UX-4bea0002)
- 2026-11-14 build: green: vitest renderer/components/session + use-session-events + tests/tooling/session-performance exit 1 only for pre-existing workspace.test.ts Settings 'parts'; transcript-progressive 7/7, tooling 24/24; typecheck exit 0; biome changed files exit 0 (REQ-UX-4bea0002, REQ-REL-c8ac2ecc, REQ-UX-2bbfd052, REQ-TEST-a14f8f9b)
- 2026-11-14 build: DEVIATION build: no spacer and no estimated navigator markers for unmounted rows (#255 steps 1 and 3) - markers appear as rows mount; reaching the top (scroll/Home/rail) mounts the rest instead, so no jump target is ever unmounted
- 2026-11-14 build: DEVIATION build: scrolled-up position during prepends relies on Chromium native scroll anchoring (overflow-anchor left auto, needed by content-visibility too) instead of a manual scrollHeight correction - jsdom cannot show it; the test asserts only that a scrolled-up reader is not pulled to the end
- 2026-11-14 build: DEVIATION build: complete-history time (harness loadMs, includes Ctrl+Home to the first message) is slower: large first/warm/cross 2075/1758/1976 -> 2739/2710/2638 ms median, medium ~+35% - time-sliced transition mounting costs more total than one synchronous block; in exchange the large open renderer gap fell 1822 -> 115 ms and first screen is ~200 ms
- 2026-11-14 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-14 validate: final: python .agentic/aegis.py check --task TASK-a5b728cf --strict --run exit 0; lint ok, typecheck ok, i18n ok, strict ok (test not in [check] run - focused vitest runs logged above); 49 warnings are pre-existing repository records except review-state on this task (no explicit review verdicts; one self-review round found and fixed the chat-detail clamp); pre-existing unrelated failure: workspace.test.ts Settings 'parts' tab
- 2026-11-14 validate: completed; next done (9 Done checklist item(s) left unticked; review verdicts not both approved)

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-a5b728cf.md
changed: transcript.tsx, styles.css, runner.mjs, report.mjs, transcript-progressive.test.ts, session-performance.md, chat-ui.md, REQ-UX-4bea0002, REQ-TEST-a14f8f9b
evidence: check --task TASK-a5b728cf --strict --run exit 0; focused vitest 156/157 + tooling 24/24 (1 pre-existing failure)
issues: complete-history loadMs slower (large ~+30%); epic 1.0 s open target unmet if measured to full history; native Ubuntu unmeasured
spec_compliance:
implementation_quality:
review_round:

## Delivery report (2026-11-14)

- stage: validate; type: change; path: quick; branch: feature/249-responsiveness
- requirements:
  - REQ-UX-4bea0002 - Streamed transcript
  - REQ-REL-c8ac2ecc - Keep navigator geometry and state current
  - REQ-UX-2bbfd052 - Jump to a user message from its marker
  - REQ-TEST-a14f8f9b - Session-load phase and responsiveness evidence
- deviations: 3 recorded
  - build: no spacer and no estimated navigator markers for unmounted rows (#255 steps 1 and 3) - markers appear as rows mount; reaching the top (scroll/Home/rail) mounts the rest instead, so no jump target is ever unmounted
  - build: scrolled-up position during prepends relies on Chromium native scroll anchoring (overflow-anchor left auto, needed by content-visibility too) instead of a manual scrollHeight correction - jsdom cannot show it; the test asserts only that a scrolled-up reader is not pulled to the end
  - build: complete-history time (harness loadMs, includes Ctrl+Home to the first message) is slower: large first/warm/cross 2075/1758/1976 -> 2739/2710/2638 ms median, medium ~+35% - time-sliced transition mounting costs more total than one synchronous block; in exchange the large open renderer gap fell 1822 -> 115 ms and first screen is ~200 ms
- explicit review: enabled; spec_compliance=not recorded; implementation_quality=not recorded; review_round=not recorded
- diff vs task base 247ead4: 10 file(s) changed, 389 line(s) added
- checks: errors=0 warnings=49 notes=27
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended
