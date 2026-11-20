# TASK-95ab9d2a - Calibrated, durable context compaction

stage: done
type: change
interaction: autopilot
requirements: REQ-FUNC-e5b6a1c9, REQ-NFR-8767cf78, REQ-DATA-e2eba20d, REQ-NFR-4721c12f, REQ-FUNC-bd5e5e8d, REQ-DATA-d9ca38e5, REQ-FUNC-99acfc19, REQ-UX-d1b480e0
parent:
branch: master
base: b05bf2b2d66a0f927e80c99bb5ec0cfe31d6e016
opened: 2026-11-20

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

Problem: In a long agent session VERA compacts the context at every new message, and each compaction delays the first answer by about 1.5-1.7 minutes (STATED: "a ajuns la 92% si la fiecare nou mesaj face o compactare. Asta face ca noile mesaje sa dureze foarte mult"). OBSERVED in this workbench's `.vera/vera.db`, latest session, model `chatgpt/gpt-6.2-sol`, window 500,000, input budget 458,616:
(a) The fallback `conservativeCounter` counts UTF-8 request bytes as tokens (`core/src/agent/context.ts:29`). Its estimates were 4.4-5.5 times the provider-reported input tokens: 449,042 estimated vs 100,003 reported at 18:10:00, and 457,522 vs 83,094 at 18:11:43. So the 80% trigger fires at about 17% of the real window, and M1 reduction drops whole old tool results at about 100k real tokens.
(b) `completedExchanges` (`compaction.ts:32`) accepts only user-to-assistant-stop segments. Segments split by delivered queued steering, plus aborted and limit turns, are retained verbatim forever: segments 4-6 hold about 264 KB in this session. After compaction the view stays at about 75-80% of the estimate, so the next turn crosses 80% again.
(c) Summaries are session-local memory only (spec REQ-FUNC-e5b6a1c9 step 6, decided 2026-11-01). After each app restart the first message re-summarizes from scratch, in two passes of about 45 s each (18:07:42 to 18:09:20).
(d) Summary requests carry full tool results, about 55-60k real tokens each.
Desired outcome: Compaction starts only when the real context nears the budget. Every historical turn, including split, aborted and limit turns, can be summarized. The most recent ~20k tokens stay verbatim. Summary requests are small. A summary survives app restart. A long session therefore compacts rarely, and a compaction costs one short summary call.
Actors: The user running agent turns in a desktop or CLI session; the SessionService and ReferenceRuntime that build model requests.
Primary scenario: The user works on a repository for many turns with large tool outputs. The context meter tracks provider-calibrated tokens. When the view crosses 80% of the input budget, one summary call condenses the older history (with tool outputs cut to 2,000 characters) into a durable summary and keeps the last ~20k tokens verbatim. Later messages reuse that summary until the context nears the budget again, including after an app restart.
Examples: With the session above, the meter shows about 20% instead of 92% and no compaction runs (INFERRED from (a)). A session whose history contains a turn split by a queued message summarizes that turn like any other (STATED proposal 2). After restarting VERA, the first message reuses the saved summary and makes no summary call while the history still matches it (STATED proposal 3). In the summary request, a 90,000-character file read is cut to 2,000 characters (STATED: user chose 2,000).
Counterexamples: The durable transcript, citation provenance and stored tool results never change (REQ-FUNC-e5b6a1c9, REQ-DATA-e2eba20d). The current turn's instructions are never summarized away (existing rule). A summary saved for a different history prefix is never reused (INFERRED from the existing fingerprint rule).
In scope: (1) a token count calibrated from provider-reported input usage, with a 10% margin and the existing estimate kept as a fallback; (2) cut points by whole turns and message boundaries so steering-split, aborted and limit history can be summarized, never cutting inside a tool call/result pair; (3) a durable compaction record as a new internal session event, reused after restart while its fingerprint matches; (4) the last ~20k tokens of completed history kept verbatim; (5) tool results cut to 2,000 characters in summary requests.
Out of scope: Idle-time clearing of tool results (proposal 6; the user chose 1-5). A different summary model. Changes to the M1 reduction rule beyond what the calibrated count changes.
Constraints: Work on master (STATED: "incepe direct cu aegis pe master"). Database and schema changes are allowed without migration code (STATED: "you are allowed to change the database or schemas ... without migration code"); the event option was kept because a new required table makes `checkDatabase` refuse every existing workbench database (OBSERVED `storage/schema.ts:132`), including the session that reproduces this problem. Trigger stays above 80% of the input budget (STATED: user kept 80%). Targeted tests only during the work; the full suite is run at the end when the user asks (STATED earlier today).
Success signals: Replaying a long session with provider usage reports counts within the calibrated margin of reported usage. A steering-split history compacts below the trigger. A restarted session reuses the saved summary without a summary call. Summary requests carry tool results of at most 2,000 characters. The last ~20k tokens remain verbatim. All existing compaction safety rules still hold.
Evidence: OBSERVED the SQL queries above on `.vera/vera.db` (read-only), `core/src/agent/{context,compaction,runtime}.ts`, `storage/schema.ts`, spec `specs/REQ-FUNC-e5b6a1c9.md`, and requirements REQ-FUNC-e5b6a1c9, REQ-NFR-8767cf78, REQ-DATA-e2eba20d. Research on 2026-11-20 into Codex (`codex-rs` compact.rs, 90% trigger, provider usage plus estimate, 20k recent user messages), pi coding agent (reserveTokens 16384, keepRecentTokens 20000, last usage plus chars/4, persisted CompactionEntry, 2,000-character tool results) and Qwen Code (provider count plus chars/4, persisted compression record).
Assumptions: Provider-reported input usage covers the whole request (input plus cacheRead plus cacheWrite, as the runtime already sums). This is INFERRED from runtime.ts:178 and the matching ratios.
Unknowns: How stable the bytes-per-token ratio is across providers without usage reports (local models that report none fall back to the conservative estimate).
Decision-blocking questions: Trigger, recent tail, tool-output length and storage were answered by the user: keep 80% with a 10% margin, ~20k tokens, 2,000 characters, and an internal session event included in the JSON export but not shown in the chat or the Markdown export.
Proposed behaviors: (accepted) proposals 1-5 as listed in In scope.

## Requirement coverage

| Behavior | Requirement | Note |
|---|---|---|
| Calibrated request count from provider-reported input (+10%, capped, kept across restart) | REQ-NFR-4721c12f | new (proposal 1) |
| Whole-history cut points, 20k verbatim tail, split/aborted/limit turns eligible, 80% trigger, 5 passes | REQ-FUNC-e5b6a1c9 | revised (proposals 2, 4); spec updated |
| Tool results cut to 2,000 characters in summary requests, refs kept | REQ-FUNC-bd5e5e8d | new (proposal 5) |
| Durable compaction record, lazy restore at the first request, hidden from chat and Markdown | REQ-DATA-d9ca38e5 | new (proposal 3) |
| Background compaction right after a turn; a send waits for it | REQ-FUNC-99acfc19 | new (RULING-005) |
| Whole-request count components and budget formula | REQ-NFR-8767cf78 | unchanged; calibration applies on top |
| M1 reduction of tool results | REQ-DATA-e2eba20d | unchanged rule; runs on calibrated counts |
| Meter shows compaction status and request-view tokens | REQ-UX-d1b480e0 | unchanged; values are now calibrated |

## Design

**Approach**: The session-scoped `ContextCompactor` becomes the single owner of three things: the derived summary, the calibration ratio and an in-flight background compaction. The runtime and the session gateway read calibration from it. The compaction logic stays in `compaction.ts`, but its selection changes from "valid exchanges" to "valid cut indices". Rejected alternatives:
- A new vera.db table for summaries: allowed by the user, but `checkDatabase` would then refuse every existing workbench database, including the one reproducing this problem (RULING-004).
- A "last usage + delta" count, as in pi and Codex: the view changes between requests (M1 reduction, compaction), so a ratio over the whole view is simpler and stays valid across those changes (REQ-NFR-4721c12f).

**Interfaces and data**:
- `ContextPolicy.prepare(input, caps, reduce, scrub?, scale?)` gains an optional `scale`. When the counter reports `estimated`, tokens become `min(raw, ceil(raw * scale))`, used for fit, M1 reduction and `contextTokens`. `ContextView` gains `rawTokens`, the unscaled count. The runtime strips it before spreading the budget into `usage.updated`, whose schema is strict. `MaskingContextPolicy` forwards `scale` (REQ-NFR-4721c12f).
- Calibration:
  - `ContextCompactor.calibration?: { modelRef, ratio }`; `scale(model)` returns `ratio * 1.1` for the same model, otherwise undefined.
  - After each normal response with reported input (input + cacheRead + cacheWrite) > 0 and an estimated view, the runtime sets `ratio = reported / view.rawTokens`, capped at 1.
  - It emits the ratio on that response's `usage.updated` as the optional `calibration: { modelRef, ratio }` (a shared schema addition, ratio > 0 and <= 1).
- Durable record:
  - New `SessionEvent` `context.compacted { covered, fingerprint, note, refs, images }`. `note` is the derived-context text, bounded by the summary output reserve.
  - The runtime emits it as a `RuntimeEvent` after an adopted pass. `SessionService.process` records it with `hub.record` inside its existing transaction, so it is one durable write; a thrown write is logged and ignored.
  - The reducer and the Markdown export skip it; the JSON export carries it (REQ-DATA-d9ca38e5).
- Restore:
  - `SessionService.startTurn` restores a fresh compactor once, at the first turn after open, with two indexed queries on `events`: the latest `context.compacted`, and the latest `usage.updated` with `calibration`.
  - Nothing runs at session open or list. The fingerprint is checked lazily in `prepare`, as today (RULING-006).
- Cut selection (REQ-FUNC-e5b6a1c9):
  - `validCuts(messages, end)` returns the indices where the pending tool-call set is empty and `messages[i].role !== "toolResult"`.
  - The tail start is found by walking back from `historicalEnd`, summing per-message `bytes * scale` until 20,000 tokens.
  - The candidate loop iterates over valid cuts in `(covered, tailCut]` and keeps the largest one whose summary request fits.
  - `retained` disappears: everything before the cut is summarized.
  - The fingerprint uses `JSON.stringify` of the built prefix. Stored messages round-trip through JSON in the same key order, so an in-memory prefix and a reloaded one hash alike; a mismatch only costs a new summary.
- Summary input (REQ-FUNC-bd5e5e8d): `summarizeMessage` cuts each `toolResult` text block to 2,000 characters plus `\n[tool result truncated: N characters omitted]`. Refs are still collected from the uncut history.
- Background (REQ-FUNC-99acfc19):
  - `AgentRuntime.compact?(messages?)` on `ReferenceRuntime` runs `compactor.prepare` over the given stored transcript (current start = end) with the same summarizer and its own AbortController, through `compactor.background(task)`.
  - `compactor.prepare` first awaits `settled()` unless it is the background caller.
  - `SessionService` calls it after every turn ending in `end` or `limit`, passing `this.transcript(id)` (masked). The compactor decides whether a summary call is needed; below the trigger it makes none.
  - The service keeps that turn's event listener until the compaction settles, then removes it.
  - `stop(id)`, `delete` (abort and await before the rows go) and `close` call `compactor.abort()`.
  - `waitIdle` stays turn-only; tests await the new `waitCompaction(id)`.

**Files and test seams**:
- `core/src/agent/context.ts` (scale, rawTokens, per-message size): `context.test.ts`.
- `core/src/agent/compaction.ts` (cuts, tail, truncation, calibration, record, inflight): `compaction.test.ts`.
- `core/src/agent/runtime.ts` and `types.ts` (ratio, calibration usage field, `context.compacted` and `compact()`): `runtime-edge.test.ts` and `steering.test.ts`.
- `core/src/sessions/service.ts` (restore, gateway fit with scale, background start/abort, `waitCompaction`) and `masking.ts`: a new `sessions/compaction-durable.test.ts`, plus the existing `service.test.ts` compaction cases.
- `shared/src/events.ts` and `session-state.ts` (`context.compacted` event, usage `calibration`): `session-state.test.ts`.
- Markdown export: the record is skipped through the reducer, with no `export.ts` change; tested in `sessions/compaction-durable.test.ts`.
- `apps/cli/src/session-output.ts` (scrub note, refs and images): `session-output.test.ts`.

**Risks and open decisions**:
- Concurrency: the background compaction and a new turn share the compactor. `inflight` serializes them, and the runtime's summarize closure belongs to the finished turn's runtime, whose listener the service keeps alive.
- Calibration with providers that report no usage (local models) keeps today's conservative behaviour.
- A ratio capped at 1 and the 1.1 margin bound the error; the session gateway's final fit check prevents an oversized dispatch.
- No version bumps (no-backward-compat rule).
- No open product decisions.

**Requirement map**:
- REQ-NFR-4721c12f: scale in ContextPolicy, ratio from reports, calibration usage field, restore.
- REQ-FUNC-e5b6a1c9: valid cuts, 20k tail, eligibility of split/aborted/limit turns.
- REQ-FUNC-bd5e5e8d: truncation in `summarizeMessage`.
- REQ-DATA-d9ca38e5: the `context.compacted` event, lazy restore, export filtering.
- REQ-FUNC-99acfc19: `compact()`, `inflight`, abort paths.
- REQ-NFR-8767cf78, REQ-DATA-e2eba20d, REQ-UX-d1b480e0: no design impact beyond receiving calibrated counts.

## Log

- 2026-11-20 frame: journal opened
- 2026-11-20 frame: completed; next specify - scope recorded (autopilot); user answered the four blocking questions (7 Done checklist item(s) left unticked)
- 2026-11-20 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-20 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-20 build: red: vitest context.test.ts -t calibrated exit 1 - no scale parameter or rawTokens (REQ-NFR-4721c12f)
- 2026-11-20 build: red: vitest runtime-calibration.test.ts exit 1 - no calibration usage field or scaled count; vitest sessions/compaction-durable.test.ts (restart calibration) exit 1 - first request after restart counted conservatively 30201 (REQ-NFR-4721c12f)
- 2026-11-20 build: green: vitest context.test.ts runtime-calibration.test.ts sessions/compaction-durable.test.ts exit 0 (8+1 passed); compaction-durable restart case fails 30201 vs <11916 with service.ts stashed (REQ-NFR-4721c12f)
- 2026-11-20 build: red: vitest compaction.test.ts exit 1 - split/aborted/limit history not summarized, tool results not cut, repaired interrupted history retained (REQ-FUNC-e5b6a1c9, REQ-FUNC-bd5e5e8d)
- 2026-11-20 build: green: vitest compaction.test.ts exit 0 (17 passed); targeted core/agent + core/sessions + shared exit 1 only in prompt-usage.test.ts (estimated counter now calibrated) - counter made exact there since that test covers attribution; rerun exit 0 (REQ-FUNC-e5b6a1c9, REQ-FUNC-bd5e5e8d)
- 2026-11-20 build: design refinement: recent tail = min(20,000 tokens, 20% of the input budget), as Qwen Code bounds it, so small windows still compact; passes continue while the view stays above the trigger (status kept when a later pass finds nothing)
- 2026-11-20 build: red: vitest sessions/compaction-durable.test.ts exit 1 - 6 failed: no waitCompaction/background compaction, no context.compacted record or restore (REQ-FUNC-99acfc19, REQ-DATA-d9ca38e5)
- 2026-11-20 build: green: vitest sessions/compaction-durable.test.ts exit 0 (7 passed) after context.compacted record, lazy restore, background compaction and abort; service.test.ts awaits waitCompaction (36 passed); session-state.test.ts covers the new event; cli session-output.test.ts note scrub red exit 1 then green exit 0 (REQ-DATA-d9ca38e5, REQ-FUNC-99acfc19)
- 2026-11-20 build: green: targeted vitest core/agent core/sessions shared desktop main/events main/session-export usage-meter exit 0 (770 passed, 1 skipped); npm run typecheck exit 0 (all REQs)
- 2026-11-20 build: design refinement: when the unreduced view is over budget, the recent tail may be summarized too, so an oversized history never ends the turn with a limit; the background compaction emits usage only when a summary call ran
- 2026-11-20 build: DEVIATION build: full unit suite and cli integration tests not run - user instruction: targeted tests only, full run at the end
- 2026-11-20 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-20 validate: review round 1 findings - spec: REQ-FUNC-e5b6a1c9 prose/spec miss the tail cap, over-budget tail and above-trigger passes; cut rule prose differs from spec; untested verification claims (large-window tail, close abort, below-trigger no summary, running after turn.done, restart no summary); design names stale. quality: no calibration floor (partial reports from prefix-caching local servers disable compaction); background fingerprints from unmasked transcript; refs/images saved unmasked; delete does not await/abort background first; tail measured in bytes with exact counters; waits-test uses a sleep
- 2026-11-20 validate: returned to build - review round 1: changes required by both reviewers
- 2026-11-20 build: round 2 fixes: calibration floor 0.12 (red: runtime-calibration floor test exit 1 with floor 0, green exit 0); background compaction over the stored masked transcript (red: masking test 5 vs 3 summaries without transcript, green); record masked; CLI scrubs refs/images; delete aborts and awaits; tail counted with the request policy; timeline replaces sleep; new tests for large-window tail, close abort, below-trigger, running after turn.done, restart no summary
- 2026-11-20 build: green: targeted vitest core/agent core/sessions shared desktop main events/session-export usage-meter cli session-output exit 0 (779 passed, 1 skipped); npm run typecheck exit 0; requirement/spec/design/diagram text updated to the built behavior
- 2026-11-20 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-20 validate: review round 2: spec approved, quality approved; spec reviewer's non-blocking note (tail test tolerance vs 'at least 20,000') resolved by aligning the verification wording to 'within per-message framing' (requirement text only)
- 2026-11-20 validate: final: check --task TASK-95ab9d2a --strict --run exit 0 (lint, typecheck, i18n, help); unit tests are not part of the [check] run - targeted vitest 779 passed logged in build; warnings: test files reported uncovered-source, sessions.md/file-tools.md above page_kb, other tasks' journal records - pre-existing kinds, accepted
- 2026-11-20 validate: completed; next done (9 Done checklist item(s) left unticked)
- 2026-11-20 done: The user explicitly authorized this local commit on master. The coordinator checked the candidate against b05bf2b2 and reused the recorded focused-test, strict-check and round-two review results. Only release metadata and this authorization record were added at handover; check:release-notes and git diff --check passed. The unrelated local planning note is excluded. No push authorized.

## Rulings

- RULING-001 | date=2026-11-20 | decision=Implement compaction proposals 1-5: calibrated token count, whole-turn cut points, durable summary, about 20k verbatim recent tail, 2000-character tool results in summary requests | reason=User asked to implement proposals 1-5 with AEGIS on master | source=user | supersedes=none
- RULING-002 | date=2026-11-20 | decision=Keep the compaction trigger above 80 percent of the input budget, on calibrated counts with a 10 percent margin | reason=User answer: Keep 80% | source=user | supersedes=none
- RULING-003 | date=2026-11-20 | decision=Keep about 20k tokens of the most recent history verbatim; cut tool results to 2000 characters in summary requests | reason=User answers: 20k tokens; 2000 characters | source=user | supersedes=none
- RULING-004 | date=2026-11-20 | decision=Persist the compaction summary as a new internal session event, in the JSON export, hidden from chat and Markdown export; replaces the 2026-11-01 decision to regenerate summaries after restart | reason=User answer: Session event; proposal 3. Schema changes without migration are allowed, but a new required table would refuse existing workbench databases | source=user | supersedes=none
- RULING-005 | date=2026-11-20 | decision=Run a needed compaction in the background right after a turn ends; a message sent meanwhile waits for it and then starts without another summary call | reason=User answer: Right after a turn | source=user | supersedes=none
- RULING-006 | date=2026-11-20 | decision=Design for responsiveness: no compaction or fingerprint work when a session opens after restart, atomic single-write persistence, calibration retained across restart | reason=User: take into account session load time on restart, atomicity; VERA must be very responsive | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-95ab9d2a.md
changed: calibrated count, whole-history cuts with 20k tail, 2000-char tool results in summaries, durable context.compacted record, background compaction after a turn
evidence: check --task TASK-95ab9d2a --strict --run exit 0
issues: full unit suite, cli integration and e2e not run (user: targeted only, full run at the end); not checked live in the app
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-20)

- stage: validate; type: change; branch: master
- requirements:
  - REQ-FUNC-e5b6a1c9 - Bounded whole-history compaction with a verbatim recent tail
  - REQ-NFR-8767cf78 - Count whole model request
  - REQ-DATA-e2eba20d - Reduce transient tool results
  - REQ-NFR-4721c12f - Calibrate the request token count from provider-reported usage
  - REQ-FUNC-bd5e5e8d - Cut tool results in summary requests
  - REQ-DATA-d9ca38e5 - Persist and reuse the compaction summary across restart
  - REQ-FUNC-99acfc19 - Compact in the background after a turn
  - REQ-UX-d1b480e0 - Compaction context meter
- deviations: 1 recorded
  - build: full unit suite and cli integration tests not run - user instruction: targeted tests only, full run at the end
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base b05bf2b: 28 file(s) changed, 1637 line(s) added
- checks: errors=0 warnings=33 notes=40
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended
