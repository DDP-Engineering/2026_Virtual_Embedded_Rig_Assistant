# TASK-76ca8aa6 - ADV-02 Advanced settings for agent and context

stage: done
type: feature
interaction: autopilot
requirements: REQ-FUNC-1cec8616, REQ-FUNC-8ac5ec27, REQ-FUNC-4e63e8d4, REQ-FUNC-28f652c7, REQ-FUNC-e816fc22, REQ-FUNC-a786b11d, REQ-FUNC-cae0533c, REQ-FUNC-5983a9e0, REQ-FUNC-261cdc27, REQ-FUNC-3e78ae47, REQ-FUNC-73ca575e, REQ-FUNC-eeaf29bd, REQ-FUNC-13068fbb, REQ-UX-91d7a481, REQ-UX-692b8471, REQ-FUNC-902313e0, REQ-DATA-96ef3dd6, REQ-DATA-33a90ef2, REQ-UX-9ea9184f, REQ-FUNC-181db660, REQ-UX-504e0d6d
parent:
branch: master
base: 1f21304d4532c47445d06f8fa49fbe4e211c7c9d
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

Problem: The agent and context-compaction behavior constants (compaction trigger, recent tail, summary
tool-result size, summary passes, calibration margin and switch, background compaction, delegations,
model no-output and header-wait timeouts) are fixed in code; only Tool calls per turn is an Advanced
setting (ADV-01). A session cannot pause automatic compaction or compact on demand. OBSERVED in
core/agent/compaction.ts, core/sessions/service.ts, core/sessions/delegation.ts, core/llm/providers.ts.
Desired outcome: The ADV-02 settings of 00_Planning/advanced-settings.md are Advanced settings at the scopes
the plan names, resolved session > workbench > app > default and applied Live, and a session offers
Compact now. STATED ("Implementeaza si advanced settings"; plan ADV-02 and decisions 1-4).
Actors: the engineer using the desktop app or the CLI; the agent runtime; the session service.
Primary scenario: The engineer sets the compaction trigger to 60 % on a workbench; the next request in any of
its sessions compacts when the context exceeds 60 % of the input budget.
Examples:
- App no-output timeout 900 s: a slow reasoning model streaming nothing for 6 minutes is not cut off.
- Session Automatic compaction off: the session sends full history until the request no longer fits, then
  fails with the context limit instead of summarizing.
- Compact now with history above any size: one summary is made and recorded at once, without a turn.
- Background compaction off on a workbench: no summary request runs after a turn; the next request
  compacts when needed.
Counterexamples:
- A session value for a setting whose plan scope excludes session (e.g. compaction trigger) is refused
  as INVALID, like any unregistered key.
- The safety margin, minimum calibration ratio and summary validity rules stay fixed (plan "Not exposed").
In scope: registry entries, units and ranges from the plan table: app - noOutputTimeout (s), headerWait
(s), backgroundCompaction (switch), summaryToolResultChars, summaryPasses, calibrationMargin (%),
providerTokenCounts (switch), delegations; workbench - compactionTrigger (%), recentTailTokens,
backgroundCompaction, toolCallsPerTurn (exists), where compactionTrigger and recentTailTokens also have an
application value the workbench overrides (RULING, user, 2026-11-21); session - toolCallsPerTurn (exists), autoCompaction
(switch), noOutputTimeout, Compact now action (IPC, desktop session Advanced dialog). Switch kind in
the registry and the Advanced field. Help page rows in en/ro/de/fr. CLI --advanced accepts the new
session-scope keys.
Out of scope: ADV-03..05 settings (separate tasks, plan); custom-endpoint header wait (already its own
endpoint value, plan row "custom endpoints already have their own value"); Compact now in the CLI
(the CLI runs one prompt; INFERRED no interactive surface).
Constraints: on master (default branch); pre-release, no migrations or compatibility code (user rule);
ranges validated by the shared schemas; invalid stored values fall back to the default; targeted
tests only (user instruction).
Success signals: each setting changes the behavior named in its row at its scope; Compact now records a
context.compacted event; settings appear only with Show advanced settings on; help lists them.
Evidence: 00_Planning/advanced-settings.md, ADV-01 registry shared/src/advanced-settings.ts, compaction.ts
constants, service.ts resolveAdvanced and background compaction, providers.ts headerWaitMs 30000.
Assumptions: INFERRED - seconds and percent are stored as integers in the user's units (calibration margin
1.10 is stored as 110 %); a switch stored as a boolean, inherit when absent.
Unknowns: none blocking.
Decision-blocking questions: none.
Proposed behaviors: (not accepted until specify)
- Automatic compaction off keeps an already adopted summary but makes no new one; a request that no
  longer fits fails with the context-limit error.
- Compact now refuses while a turn or compaction runs (BUSY) and on archived or read-only sessions.
- Provider token counts off ignores calibration and uses the conservative estimate.

## Requirement coverage

| Behavior | Requirement | Source |
|---|---|---|
| Compaction trigger per workbench/app | REQ-FUNC-1cec8616 (new) | plan workbench row |
| Recent tail kept verbatim | REQ-FUNC-8ac5ec27 (new) | plan workbench row |
| Summary tool-result size | REQ-FUNC-4e63e8d4 (new) | plan app row |
| Summary passes | REQ-FUNC-28f652c7 (new) | plan app row |
| Calibration margin | REQ-FUNC-e816fc22 (new) | plan app row |
| Provider token counts switch | REQ-FUNC-a786b11d (new) | plan app row |
| Background compaction switch | REQ-FUNC-cae0533c (new) | plan app + workbench rows |
| Session automatic compaction | REQ-FUNC-5983a9e0 (new) | plan session row |
| Delegations at once | REQ-FUNC-261cdc27 (new) | plan app row |
| Model no-output timeout | REQ-FUNC-3e78ae47 (new) | plan app + session rows |
| Hosted header wait | REQ-FUNC-73ca575e (new) | plan app row |
| Compact now | REQ-FUNC-eeaf29bd (new) | plan session row |
| Compact now refused when busy/locked | REQ-FUNC-13068fbb (new) | frame proposed behavior |
| Switch editing | REQ-UX-91d7a481 (new) | frame scope |
| Compact now in the dialog | REQ-UX-692b8471 (new) | plan session row |
| Precedence, storage, invalid values, field, CLI, help | REQ-FUNC-902313e0, REQ-DATA-96ef3dd6, REQ-DATA-33a90ef2, REQ-UX-9ea9184f, REQ-FUNC-181db660, REQ-UX-504e0d6d (reused) | ADV-01 framework |

## Design

**Approach.** Extend the ADV-01 registry instead of adding per-setting plumbing: each new key is one registry
entry, resolved by the existing `resolveAdvanced` (REQ-FUNC-902313e0). A new `switch` kind (boolean, absent =
inherit) covers the three switches (REQ-UX-91d7a481); seconds and percents stay integers in the user's
units, so the calibration margin is 100-150 % (frame assumption). The compactor stops reading module
constants and reads a `CompactionSettings` object the session service assigns before each turn, background
compaction and Compact now, which makes every compaction setting Live. Rejected: a decimal kind (one
setting; an integer percent is exact enough) and a forced-compaction flag consumed at the next turn
(the plan names Compact now as immediate).

**Interfaces and data.**
- shared: `advancedSettings` gains noOutputTimeout, headerWait, backgroundCompaction, summaryToolResultChars,
  summaryPasses, calibrationMargin, providerTokenCounts, delegations, compactionTrigger, recentTailTokens,
  autoCompaction with the plan's scopes, ranges and defaults; `AdvancedValueOf<K>` types the resolved value;
  patch, merge, draft-valid and `parseAdvancedFlag` accept booleans for switches (`true|false|on|off`).
  Session event and state `advanced` records accept number or boolean.
- core: `ContextCompactor.settings` {trigger, tailTokens, toolResultChars, maxPasses, margin, calibrated,
  automatic} with today's values as defaults; `prepare(..., force)` and `ReferenceRuntime.compact(transcript,
  force)` (REQ-FUNC-1cec8616, -8ac5ec27, -4e63e8d4, -28f652c7, -e816fc22, -a786b11d, -5983a9e0, -eeaf29bd).
  Automatic off returns the view uncompacted (keeping an adopted summary); the runtime's existing fits check
  yields CONTEXT_LIMIT. Calibrated off makes `scale()` undefined without dropping the stored calibration.
- service: `compactionSettings(id)` from `resolveAdvanced`; background compaction runs only when the resolved
  switch is on (REQ-FUNC-cae0533c); the delegation cap reads `delegations` (REQ-FUNC-261cdc27); the
  no-output timeout is `host.noOutputTimeoutMs ?? noOutputTimeout * 1000` (REQ-FUNC-3e78ae47).
  `compactNow(id)` refuses BUSY with an active turn or compaction and DENIED when archived or read-only
  (REQ-FUNC-13068fbb), then starts a runtime with the session's prompt, model, masking policy and compactor,
  records its usage and context.compacted events and returns the compaction status.
- llm: `createPiAiGateway` host option `headerWaitMs?: () => number`, used for hosted slots only; desktop main
  and CLI pass the resolved app value (REQ-FUNC-73ca575e).
- IPC `session.compact {sessionId} -> {status}`; mock API mirrors it.
- renderer: `AdvancedField` renders a select Inherit/On/Off for switches with the inherited state and source;
  labels and tooltips for every key; the session dialog adds Compact now with a status line and error
  (REQ-UX-692b8471).

**Files and test seams.** shared advanced-settings.ts/.test.ts, events.ts, session-state.ts, ipc.ts; core
agent/compaction.ts (compaction tests), agent/runtime.ts, sessions/service.ts (sessions/advanced.test.ts),
llm/providers.ts (provider timeout test); desktop main/sessions.ts, main/index.ts, preload bridge test,
renderer advanced-field.tsx, session-advanced.tsx (+tests), mocks, locales; CLI run.ts, args (run-args.test.ts);
help advanced-settings.md x4.

**Risks and open decisions.** Compact now counts without tool specs (no turn assembled the tool list), so its
view is slightly smaller than a turn's; it only summarizes and the next turn recounts. Concurrency: Compact
now holds the per-session compactor's background slot, so a turn admitted meanwhile waits in `prepare`.

**Requirement map.** All new IDs above map to the named seam; REQ-DATA-96ef3dd6, REQ-DATA-33a90ef2 and
REQ-FUNC-181db660 extend to booleans; REQ-UX-9ea9184f and REQ-UX-504e0d6d no design impact beyond new rows.

## Log

- 2026-11-20 frame: journal opened
- 2026-11-20 frame: completed; next specify - scope recorded on autopilot from the accepted ADV plan (7 Done checklist item(s) left unticked)
- 2026-11-20 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-20 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-20 build: red: vitest shared advanced-settings.test.ts exit 1 - the ADV-02 keys and the switch kind are not registered (REQ-FUNC-1cec8616 REQ-FUNC-8ac5ec27 REQ-FUNC-4e63e8d4 REQ-FUNC-28f652c7 REQ-FUNC-e816fc22 REQ-FUNC-a786b11d REQ-FUNC-cae0533c REQ-FUNC-5983a9e0 REQ-FUNC-261cdc27 REQ-FUNC-3e78ae47 REQ-FUNC-73ca575e REQ-UX-91d7a481)
- 2026-11-20 build: green: vitest shared advanced-settings.test.ts 11 pass (registry keys, switch kind, CLI flag words). red: vitest core agent/compaction-settings.test.ts 7 fail - compactor has no settings or force (REQ-FUNC-1cec8616 REQ-FUNC-8ac5ec27 REQ-FUNC-4e63e8d4 REQ-FUNC-28f652c7 REQ-FUNC-e816fc22 REQ-FUNC-a786b11d REQ-FUNC-5983a9e0 REQ-FUNC-eeaf29bd); green after compaction.ts settings: 25 pass with compaction.test.ts. red: sessions/compaction-advanced.test.ts 6 fail and delegation.test.ts 'admits only the resolved Delegated sessions at once' fails - service ignores background/auto switches, trigger, no-output timeout, delegations, and has no compactNow (REQ-FUNC-cae0533c REQ-FUNC-5983a9e0 REQ-FUNC-1cec8616 REQ-FUNC-eeaf29bd REQ-FUNC-13068fbb REQ-FUNC-3e78ae47 REQ-FUNC-261cdc27)
- 2026-11-20 build: green: vitest core sessions/compaction-advanced, delegation, delegation-tools, advanced, service, agent runtime x3, compaction x2 - 10 files 132 pass after runtime.compact(force) outcome and service compactionSettings/backgroundCompaction/delegations/noOutputTimeout/compactNow; compaction-advanced resized to two long turns (three exceed the 56k budget, so auto-off correctly stops at CONTEXT_LIMIT, now asserted) (REQ-FUNC-1cec8616 REQ-FUNC-8ac5ec27 REQ-FUNC-4e63e8d4 REQ-FUNC-28f652c7 REQ-FUNC-e816fc22 REQ-FUNC-a786b11d REQ-FUNC-cae0533c REQ-FUNC-5983a9e0 REQ-FUNC-261cdc27 REQ-FUNC-3e78ae47 REQ-FUNC-eeaf29bd REQ-FUNC-13068fbb)
- 2026-11-20 build: red: vitest core llm/gateway.test.ts -t header-wait test exit 1 - hosted header wait fixed at 30 s, host headerWaitMs ignored (REQ-FUNC-73ca575e)
- 2026-11-20 build: green: vitest core llm/gateway.test.ts 49 pass after GatewayHost.headerWaitMs (hosted slots only; desktop provider-gateway and CLI run pass the resolved app headerWait) (REQ-FUNC-73ca575e). CLI: run-args.test.ts new switch/timeout case passed at once because the shared parseAdvancedFlag already returns booleans; the change in args.ts is the RunOptions type and usage text - type-only, proven by typecheck (REQ-FUNC-181db660)
- 2026-11-20 build: green: vitest desktop renderer session/session-advanced, advanced-settings, workbench-advanced, settings-save - 4 files 18 pass (switch Inherit/On/Off saves booleans at session and workbench, inherited state and source shown, Compact now invokes session.compact, shows the outcome, disabled while the session runs, refusal shown as an error); npm run check:i18n exit 0; npm run typecheck exit 0 (REQ-UX-91d7a481 REQ-UX-692b8471 REQ-UX-9ea9184f REQ-FUNC-eeaf29bd)
- 2026-11-20 build: DEVIATION build: the renderer tests were written after the field and dialog code in the same increment, with no red run - the continuation plan ordered the edits that way; the tests pin the behavior now and fail on any regression
- 2026-11-20 build: green: npm run test:e2e -- tests/e2e/advanced-settings.spec.ts exit 0, 1 pass (switch Inherit On default stored Off and reloaded, Compact now outcome shown without touching the draft; selectors pinned to toolCallsPerTurn since more fields exist); npm run check:help exit 0 (REQ-UX-91d7a481 REQ-UX-692b8471 REQ-UX-504e0d6d)
- 2026-11-20 build: evolution reviewed: 41 paths; every source and test path is a seam the design names (shared registry/events/ipc/session-state, core compaction/runtime/types/service/delegation/index/providers, desktop main index/provider-gateway, renderer field/panel/workbench/session dialog/mock/locales/styles, CLI args/run, help x4). Outside the task: 00_Planning/advanced-settings-continuation.md (ephemeral plan) and the deletion of 00_Planning/code-review-2026-11-17-98946c0b.md, which predates this session and is left as found
- 2026-11-20 build: check --task: errors=0. Remaining task warnings are layout heuristics, not gaps: help/*/advanced-settings.md are outside the configured doc globs (covered by REQ-UX-504e0d6d), and colocated *.test.ts files are classed as uncovered source although each is a linked_test of the ADV requirements; the ADV-01 files show the same warnings
- 2026-11-20 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-20 validate: validate self-review fixes: (1) desktop session.compact ran the whole summary inside the host queue slot, blocking every other session IPC call for its duration - now only admission runs on the queue, as imageCapability does; (2) runtime.compact reported a provider failure before the summary as none - now failed, test added in compaction-advanced.test.ts (written with the fix, it reads none without it); (3) dialog Save disabled while Compact now runs. green: vitest compaction-advanced, compaction-durable, runtime, session-advanced, ipc-router 63 pass (REQ-FUNC-eeaf29bd REQ-UX-692b8471)
- 2026-11-20 validate: review round 1: quality approved (minor, non-blocking: a turn admitted during Compact now can replace the compacting entry - identity-checked, abort still reaches it; shared settings object overwritten per caller - consistent with live; Compact now summary skips the turn fits check - the compactor only sends a fitting candidate). spec changes_required: (1) resolveAdvanced applies a stored value at a scope the setting does not list (hand-edited workbench.yaml delegations etc.); (2) REQ-UX-692b8471 prose says disabled while locked, built behavior shows the DENIED refusal; minor: assert CONTEXT_LIMIT not only stop limit, test force with automatic off, REQ-UX-504e0d6d verification only names the pilot row, REQ-FUNC-181db660/REQ-DATA-96ef3dd6 prose omit switch words and wrong-scope keys, REQ-FUNC-3e78ae47 verification timer part is inspection of timed-gateway tests, recentTailTokens tooltip says never summarized; question for the user: compactionTrigger and recentTailTokens at app scope (plan lists them in the workbench table only)
- 2026-11-20 validate: returned to build - spec review round 1: scope check on resolve, REQ-UX-692b8471 prose, minor test and requirement accuracy items
- 2026-11-20 build: red: vitest shared advanced-settings.test.ts -t scope test exit 1 - a workbench delegations 8 resolved over the application 2 (REQ-DATA-33a90ef2). green after resolveAdvanced skips values at unlisted scopes and reports them: shared advanced-settings, core sessions/advanced, compaction-advanced, cli run-args 37 pass; compaction-settings + compaction-advanced 24 pass with the CONTEXT_LIMIT assertion and force-while-automatic-off case (REQ-FUNC-5983a9e0 REQ-FUNC-eeaf29bd). Text fixes: REQ-UX-692b8471 prose (refusal shown as error), REQ-UX-504e0d6d verification (every setting), REQ-FUNC-181db660 and REQ-DATA-96ef3dd6 prose (wrong scope, switch words, type), REQ-FUNC-3e78ae47 verification (armed timer + inspection of timed-gateway tests), REQ-DATA-33a90ef2 prose and verification (unlisted scope), recentTailTokens tooltip x4, sessions.md resolver note
- 2026-11-21 build: green: typecheck exit 0; check:i18n exit 0; vitest shared advanced-settings, core compaction-settings, compaction-advanced, delegation, advanced, renderer session-advanced, workbench-advanced, advanced-settings, cli run-args - 9 files 75 pass (round 1 fixes)
- 2026-11-21 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-21 validate: review round 2: spec approved, quality approved. Accepted optional: REQ-DATA-96ef3dd6 verification still names only the pilot refusals; the wrong-type and wrong-scope refusals its prose now names are proven by shared advanced-settings.test.ts patch-schema assertions - left as is so the approved candidate does not change
- 2026-11-21 validate: DEVIATION validate: after the round 2 approvals the strict check showed lint findings in ADV-02 files; fixed with formatter-only edits (advanced-field.tsx, session-advanced.test.ts, compaction.ts, compaction-settings.test.ts, service.ts) and AgentRuntime.compact typed Promise<CompactionOutcome> instead of a void union (its only implementation already returns an outcome; service drops the ?? none) - no behavior change, no third review round; proven by biome check on all 65 changed files exit 0, typecheck ok, vitest 7 files 74 pass
- 2026-11-21 validate: final: python .agentic/aegis.py check --task TASK-76ca8aa6 --strict --run exit 1; ran lint FAIL, typecheck ok, i18n ok, help ok (test not in the run list by policy; targeted tests logged above). The lint failure is pre-existing and out of scope: 6 errors in 14 files none of which differs from HEAD (display-documents.test.ts, web-access.ts, plugins.tsx, workbench-create.tsx, workbench-navigation.tsx, mocks/documents.ts, citations.ts, electrical catalog/catalog-tool.test/lighting, knowledge ingest/keyword/search tests, llm/subscription.test.ts); every file this task changed passes biome. Remaining warnings: layout heuristics (help pages outside doc globs, colocated tests counted as source) as explained in build
- 2026-11-21 validate: correction of the previous final line: the lint failure was NOT pre-existing. At error level biome reported one error, the formatting of shared advanced-settings.test.ts (the round 1 scope test); the earlier cross-check used git diff HEAD, which skips untracked files, so this new file was missed. The 14 other files carry only warnings and infos, which do not fail the gate, and are left as they are. Fixed with biome format; biome on all 83 changed and untracked files exit 0; npm run lint exit 0; vitest shared advanced-settings.test.ts 12 pass
- 2026-11-21 validate: final: python .agentic/aegis.py check --task TASK-76ca8aa6 --strict --run exit 0; ran lint ok, typecheck ok, i18n ok, help ok (test not in the run list by policy; targeted vitest and the advanced-settings e2e logged above). Remaining warnings: layout heuristics (help pages outside doc globs, colocated tests counted as source) and repository-wide notes on other requirements, none limiting this candidate. The only post-approval edit is the formatting of advanced-settings.test.ts (DEVIATION logged earlier covers formatter-only edits)
- 2026-11-21 validate: completed; next done (9 Done checklist item(s) left unticked)

## Rulings

- RULING-001 | date=2026-11-21 | decision=Compaction trigger and Recent history kept verbatim are application and workbench settings; the workbench value overrides the application one | reason=plan lists them in the workbench table only; the user chose to keep the built application level too (spec review round 1 question) | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-76ca8aa6.md
changed: 15 created, 6 reused
evidence: check --task TASK-76ca8aa6 --strict --run exit 0
issues: none
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-21)

- stage: validate; type: feature; branch: master
- requirements:
  - REQ-FUNC-1cec8616 - Compact at the resolved compaction trigger
  - REQ-FUNC-8ac5ec27 - Keep the resolved recent history verbatim
  - REQ-FUNC-4e63e8d4 - Bound tool results in summary requests by the resolved size
  - REQ-FUNC-28f652c7 - Bound summary passes by the resolved value
  - REQ-FUNC-e816fc22 - Scale calibrated counts by the resolved margin
  - REQ-FUNC-a786b11d - Count with the conservative estimate when provider token counts are off
  - REQ-FUNC-cae0533c - Skip background compaction when it is off
  - REQ-FUNC-5983a9e0 - Pause automatic compaction for a session
  - REQ-FUNC-261cdc27 - Limit concurrent delegated sessions by the resolved value
  - REQ-FUNC-3e78ae47 - End a silent model stream after the resolved no-output timeout
  - REQ-FUNC-73ca575e - Wait for hosted response headers up to the resolved time
  - REQ-FUNC-eeaf29bd - Compact a session on demand
  - REQ-FUNC-13068fbb - Refuse Compact now while a session is busy or locked
  - REQ-UX-91d7a481 - Edit an Advanced switch with inherit, on and off
  - REQ-UX-692b8471 - Offer Compact now in the session Advanced dialog
  - REQ-FUNC-902313e0 - Resolve Advanced settings by scope precedence
  - REQ-DATA-96ef3dd6 - Store Advanced settings per application, workbench and session
  - REQ-DATA-33a90ef2 - Ignore invalid stored Advanced values
  - REQ-UX-9ea9184f - Edit an Advanced setting with inherit, reset and apply timing
  - REQ-FUNC-181db660 - Accept Advanced settings as CLI flags
  - REQ-UX-504e0d6d - Document Advanced settings in help
- deviations: 2 recorded
  - build: the renderer tests were written after the field and dialog code in the same increment, with no red run - the continuation plan ordered the edits that way; the tests pin the behavior now and fail on any regression
  - validate: after the round 2 approvals the strict check showed lint findings in ADV-02 files; fixed with formatter-only edits (advanced-field.tsx, session-advanced.test.ts, compaction.ts, compaction-settings.test.ts, service.ts) and AgentRuntime.compact typed Promise<CompactionOutcome> instead of a void union (its only implementation already returns an outcome; service drops the ?? none) - no behavior change, no third review round; proven by biome check on all 65 changed files exit 0, typecheck ok, vitest 7 files 74 pass
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base 1f21304: 144 file(s) changed, 6171 line(s) added
- checks: errors=0 warnings=74 notes=40
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended

## Delivery report (2026-11-21)

- stage: validate; type: feature; branch: master
- requirements:
  - REQ-FUNC-1cec8616 - Compact at the resolved compaction trigger
  - REQ-FUNC-8ac5ec27 - Keep the resolved recent history verbatim
  - REQ-FUNC-4e63e8d4 - Bound tool results in summary requests by the resolved size
  - REQ-FUNC-28f652c7 - Bound summary passes by the resolved value
  - REQ-FUNC-e816fc22 - Scale calibrated counts by the resolved margin
  - REQ-FUNC-a786b11d - Count with the conservative estimate when provider token counts are off
  - REQ-FUNC-cae0533c - Skip background compaction when it is off
  - REQ-FUNC-5983a9e0 - Pause automatic compaction for a session
  - REQ-FUNC-261cdc27 - Limit concurrent delegated sessions by the resolved value
  - REQ-FUNC-3e78ae47 - End a silent model stream after the resolved no-output timeout
  - REQ-FUNC-73ca575e - Wait for hosted response headers up to the resolved time
  - REQ-FUNC-eeaf29bd - Compact a session on demand
  - REQ-FUNC-13068fbb - Refuse Compact now while a session is busy or locked
  - REQ-UX-91d7a481 - Edit an Advanced switch with inherit, on and off
  - REQ-UX-692b8471 - Offer Compact now in the session Advanced dialog
  - REQ-FUNC-902313e0 - Resolve Advanced settings by scope precedence
  - REQ-DATA-96ef3dd6 - Store Advanced settings per application, workbench and session
  - REQ-DATA-33a90ef2 - Ignore invalid stored Advanced values
  - REQ-UX-9ea9184f - Edit an Advanced setting with inherit, reset and apply timing
  - REQ-FUNC-181db660 - Accept Advanced settings as CLI flags
  - REQ-UX-504e0d6d - Document Advanced settings in help
- deviations: 2 recorded
  - build: the renderer tests were written after the field and dialog code in the same increment, with no red run - the continuation plan ordered the edits that way; the tests pin the behavior now and fail on any regression
  - validate: after the round 2 approvals the strict check showed lint findings in ADV-02 files; fixed with formatter-only edits (advanced-field.tsx, session-advanced.test.ts, compaction.ts, compaction-settings.test.ts, service.ts) and AgentRuntime.compact typed Promise<CompactionOutcome> instead of a void union (its only implementation already returns an outcome; service drops the ?? none) - no behavior change, no third review round; proven by biome check on all 65 changed files exit 0, typecheck ok, vitest 7 files 74 pass
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base 1f21304: 144 file(s) changed, 6220 line(s) added
- checks: errors=0 warnings=74 notes=40
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended
