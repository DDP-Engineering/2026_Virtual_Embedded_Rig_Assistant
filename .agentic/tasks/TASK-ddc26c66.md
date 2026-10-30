# TASK-ddc26c66 - Show historical per-prompt token consumption and estimated context in Agent activity

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-DATA-e31bdc18, REQ-UX-bc9adf3a
parent:
branch: master
base: cf0db579de5697b85976ded57629793bcf1af563
opened: 2026-10-30

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

Problem: STATED: Agent activity lacks the requested per-prompt consumption and historical context line.
Desired outcome: STATED: input/output token counts and estimated context at that moment, in a discreet line for each prompt.
Actors: STATED: VERA users inspecting their agent's activity.
Primary scenario: STATED: submit prompts, inspect activity and compare each prompt's consumption and initial context without later messages replacing old values.
Examples: STATED from accepted proposal: Input 2450, output 380, initial context approximately 12 percent (illustrative, not a measured result).
Counterexamples: OBSERVED: existing state.usage is overwritten by usage.updated and cannot be copied onto every historical prompt. A queued message is not yet processed; multiple admitted messages can share a single request.
In scope: STATED: historical per-prompt actual input/output and estimated initial context, localized compact presentation, existing durable replay and focused verification. OBSERVED: steering can admit a batch into one request; shared consumption must be marked rather than pretending it is independently measurable.
Out of scope: STATED from accepted analysis: no additional model calls or full-history retokenization. INFERRED from the bounded statistics request: no pricing/billing dashboard, new tokenizer or migration.
Constraints: OBSERVED: shared master checkout and root-authorized local ticket commit, no push; preserve historical journals and all baseline changes (three LLM files, permission-picker.tsx, styles.css, bypass.spec.ts, optional-companions.md). Current data contracts authoritative; no compatibility/migrations. Tests focused per 02_Tools/verification-policy.md.
Success signals: INFERRED from requested statistics: two prompts retain different context snapshots and independent token totals; multiple tool steps aggregate once; unavailable usage is not represented as fabricated zero; replay reproduces the line; compact translated UI and existing context meter still work.
Evidence: OBSERVED: shared/events.ts usage.updated already carries cumulative per-turn input/output plus budgets; core/agent/runtime.ts resets totals each send and budgets each dispatch; shared/session-state.ts retains only latest usage; SessionHub persists usage events; ActivityLog in session-inspector.tsx renders user rows.
Assumptions: INFERRED: initial context means the first normal request including that prompt, not an internal history-summary request. Input/output belong to processing the prompt, including subsequent model calls until another admitted prompt takes over; a batch's total is explicitly shared.
Unknowns: OBSERVED: SDK zero usage cannot distinguish a missing provider report from a genuinely empty report; no positive reported count is shown as unavailable rather than claiming a measurement.
Decision-blocking questions: None; the user accepted the preceding proposal, including aggregation and honest unavailable/estimated labels.
Proposed behaviors: None outside accepted scope.
Path and reason:

| Criterion | Holds? | Evidence |
|---|---|---|
| no new observable behavior | no | New historical statistics line |
| no new interface/data format | no | Prompt ownership on usage events and derived user statistics |
| no new dependency | yes | Existing event reducer, runtime and i18next |
| existing requirement already covers behavior | no | Global meter does not specify per-prompt history |
| no security/data handling change | no | Persisted usage attribution metadata |

Full path; one integrated task. Two independent read-only final reviews per AEGIS review policy.

## Requirement coverage

| Behavior | Requirement | Design | Verification |
|---|---|---|---|
| Historical attributed consumption and initial context | REQ-DATA-e31bdc18 | Runtime-owned prompt IDs; reducer accumulation and immutable snapshot | Runtime, reducer, session replay/native |
| Compact translated activity line and honest labels | REQ-UX-bc9adf3a | Prompt row secondary text with estimate/unavailable/shared markers | Renderer and native/browser UI |


## Design

### Approach
REQ-DATA-e31bdc18: extend existing durable usage events with runtime-owned promptIds; no extra model requests or per-token sampling. Track the current admitted prompt group through normal model/tool iterations. Initially the initiating prompt and any first admitted batch share ownership; a subsequent admitted group takes over subsequent calls. A normal preflight and terminal usage update carry ownership; internal summary preflights do not become initial user context.
### Interfaces and data
REQ-DATA-e31bdc18: add optional promptIds on usage.updated because internal/global updates need no owner; derived user items gain optional usage (input/output, contextTokens/window/estimated, shared). Reset per-turn global counters at turn.started to mirror runtime resets. Fold positive cumulative counter deltas once into the attributed users; all-zero/unreported consumption stays absent. Include SDK cached reads/writes in input counts so input means all reported input tokens, not billing price. Capture each user's first normal budget only; later tools/model changes do not overwrite it. Mark shared batch totals explicitly, without claiming independently measurable per-message shares. Admit queue before attributing normal budgets; leave undelivered queue without statistics on failure/limit. Existing durable events naturally replay the projection; no migrations.
REQ-UX-bc9adf3a: one muted, wrapping secondary line below each activity prompt disclosure. Localize input/output/initial context/unavailable/shared labels in en/ro/de. Use locale-aware numbers, approximate marker for estimates, percentage only when capacity is known and token count otherwise. Missing data displays a dash. Keep prompts/replies/tools and existing context indicator intact.
### Files and test seams
REQ-DATA-e31bdc18: shared/events.ts, session-state.ts and tests; core/agent/runtime.ts, types.ts and focused new runtime tests. SessionHub and transport reused unchanged; native restart verifies actual persisted projection.
REQ-UX-bc9adf3a: renderer/session/session-inspector.tsx, locales and styles.css; existing workspace tests plus new activity-usage tests; browser/native prompt-usage.spec.ts verifies real activity and replay.
### Risks and open decisions
Existing steering batch ambiguity is surfaced as shared usage rather than fabricated independent totals. Default token counter remains conservative and marked estimated. Missing/all-zero reports show unavailable consumption; available terminal partial usage is recorded once on provider errors, cancellation and done-before-abort. Summary completion/error accounts in finally without adopting partial summaries. No compatibility paths, no provider contact, no costs dashboard. Preserve all baseline uncommitted hunks, especially the permission option CSS in the shared stylesheet; stage only this feature's hunk at commit.
### Requirement map
REQ-DATA-e31bdc18 -> runtime ownership, delta folding, immutable initial snapshots, replay tests.
REQ-UX-bc9adf3a -> compact translated secondary line, honest labels, UI/native proof.


## Log

- 2026-10-30 frame: journal opened
- 2026-10-30 frame: completed; next specify
- 2026-10-30 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-10-30 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-10-30 build: red: focused shared/core prompt-usage tests exit 1 (4 expected failures): usage schema rejects promptIds and runtime emits no prompt ownership. REQ-DATA-e31bdc18. Anchor recorded before production edits.
- 2026-10-30 build: green: focused shared/core prompt-usage plus existing reducer/steering tests exit 0 (12 passed), REQ-DATA-e31bdc18. red: activity-usage renderer tests exit 1 (3 expected failures): activity has no statistics lines, REQ-UX-bc9adf3a.
- 2026-10-30 build: Validation scope: native deterministic numeric consumption needs declared replay counts; extend ReplayGateway's existing test/CLI fixture seam with optional validated input/output usage, preserving zero defaults. Read llm-gateway knowledge; no live provider calls or changes to baseline provider URL fixes.
- 2026-10-30 build: green: renderer activity statistics and existing workspace/meter/runtime/compaction regressions exit 0 (65 passed). red: declared replay token usage test exit 1, expected supplied values are currently ignored; validate this seam before native numeric replay.
- 2026-10-30 build: green: shared/core ownership+reducer+steering 12 passed; activity/workspace/meter/runtime/compaction 65 passed; replay usage validation 4 passed; current memoized activity rendering 3 passed. Native replay UI passed two real file-tool turns with 320/22 and 540/37 tokens, different frozen initial context, en/ro/de labels, 1024x640 layout and identical statistics after restart. Screenshot vera-prompt-usage-ddc26c66.png inspected: discreet readable wrapping line. Initial native harness restart needed New Workbench navigation before Open recent; corrected, no product behavior weakened. Typecheck exit 0. All requirements active/traced; evolution reviewed. Advisory 28 warnings are baseline metadata/unrelated changes.
- 2026-10-30 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-10-30 validate: Review finding P2: available SDK terminal partial usage on provider error/cancellation and done-before-abort must be counted once, including summary failures/cache input. No user exclusion exists; add focused coverage and preserve existing unknown/all-zero handling.
- 2026-10-30 validate: returned to build - Preserve available reported terminal usage on error/abort exactly once
- 2026-10-30 build: red review fix: three terminal partial/error/abort cases and one failed-summary case fail for missing positive reported usage, with correct existing stop/summary behavior. REQ-DATA-e31bdc18.
- 2026-10-30 build: green review fix: focused runtime/reducer/steering/compaction regressions exit 0 (39 passed), including positive provider-error, provider-abort, done-before-abort and failed-summary measurements. Terminal consumption accounted once, caches included, partial summary never adopted. Existing native successful replay/restart proof retained; current exact runtime rebuilt native check is running.
- 2026-10-30 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-10-30 validate: final: python -X utf8 .agentic/aegis.py check --task TASK-ddc26c66 --strict --run exit 0; lint/typecheck/i18n all passed, 28 accepted baseline advisory warnings (24 historical metadata, 4 unrelated source paths), no promoted warning. Fresh current instrumented native replay/restart E2E exit 0 after error-accounting fix. Both reviews approved round 2. Original screenshot retained as useful visual proof; native owned fixture scratch cleaned by its test. Normal local VERA responding. Historical task journals and baseline corrections preserved. Root AGENTS authorizes this local ticket commit; no push.
- 2026-10-30 validate: completed; next done

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-ddc26c66.md
changed: Runtime-owned usage attribution, reducer snapshots and compact activity line; diagram_TASK-ddc26c66.md
evidence: Strict exit 0; focused units and native replay/restart passed; spec and quality approved round 2
issues:
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-10-30)

- stage: validate; type: feature; path: full; branch: master
- requirements:
  - REQ-DATA-e31bdc18 - Preserve attributed per-prompt consumption and initial context snapshots
  - REQ-UX-bc9adf3a - Show discreet localized per-prompt statistics in Agent activity
- deviations: none recorded
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base cf0db57: 31 file(s) changed, 1166 line(s) added
- checks: errors=0 warnings=28 notes=3
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended
