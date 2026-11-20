# TASK-e5612dfd - Configurable response timeout for custom model connections

stage: done
type: change
interaction: autopilot
requirements: REQ-NFR-83ac0a94, REQ-FUNC-f19cac5e, REQ-NFR-543124b7, REQ-REL-25ceaa1d, REQ-FUNC-25254fe8, REQ-UX-2ccfac13
parent:
branch: master
base: bb55180dc737f7d8fdba52b51acc0c9dcac3b36e
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

Problem: Custom (OpenAI-compatible) connections such as Ollama, LM Studio and llama.cpp get the same
fixed waits as hosted providers. OBSERVED: `core/src/llm/providers.ts` passes `timeoutMs: 30000` for
every model, and the OpenAI SDK clears that timer once the response headers arrive, so it limits the
wait for headers only. `core/src/sessions/service.ts:1136` wraps every request in `timedGateway(...,
300000)`, which stops a request after 5 minutes without a gateway event. OBSERVED: pi-ai's completions
adapter turns `reasoning_content`/`reasoning`/`reasoning_text` deltas into `thinking_delta` events
(`pi-ai/dist/api/openai-completions.js:396-419`), but the VERA gateway yields only text, tool, done and
error events (`providers.ts` stream loop). So a model that streams only reasoning for 5 minutes counts as
silent and is stopped with the generic `PROVIDER` error. INFERRED (from the transport catch setting
`failure.offline` and `mapProviderError`): a header wait past 30 s is reported as `OFFLINE`, "Cannot
reach <endpoint>", although the server was reached.
Desired outcome: A slow local model, including one with high reasoning, finishes as long as it keeps
working. The engineer sets how long VERA waits for each custom connection, and a timeout is reported as a
timeout.
Actors: The engineer editing a custom or LM Studio connection in Settings > Providers. The session
engine (desktop and CLI) sending model requests.
Primary scenario: The engineer connects LM Studio with a large local model and reasoning set to high. The
first request loads the model and processes a long prompt, then the model reasons for several minutes
before writing text. VERA keeps waiting while reasoning arrives, and gives up only after the connection's
limit passes with nothing received.
Examples: STATED (user, 2026-11-20): "daca se folosesc modele locale setate cu reasoning high - crezi ca e
suficient? tinand cont ca un model local poate rula muult mai lent." With a limit of `N` seconds: reasoning
that keeps streaming for 7 minutes completes; a server that sends nothing for longer than `N` seconds
stops the request with a timeout error.
Counterexamples: OpenAI API and ChatGPT subscription requests keep 30 s for headers and 5 minutes of
silence. No limit on total turn duration exists or is added (OBSERVED: none in timed-gateway.ts).
In scope: A per-connection response timeout on custom connections, both protocols. Every provider stream
event, reasoning included, counts as output for the silence limit (all providers). A distinct timeout error.
The Settings > Providers editors, en/ro/de/fr text and help.
Out of scope: Changing the OpenAI/ChatGPT limits (INFERRED: hosted endpoints answer quickly; the user's
ChatGPT question was answered without a change). A CLI flag (INFERRED: CLI custom connections get the
default; not requested). The 30 s `/models` listing limit (INFERRED: listing does not load a model).
Showing reasoning text.
Constraints: Work is on `master`, the default branch, beside an uncommitted context-meter fix; this
task touches different files so the two commit separately. OBSERVED memory: pre-release, settings
format stays version 1 with no migration. Settings and provider schemas are strict. UI text in
en/ro/de/fr; no helper texts in settings forms (user UI rules).
Success signals: Focused tests show the header wait and the silence limit follow the connection's
setting, reasoning events keep a request alive, out-of-range values are refused, and both editors save
the value. Typecheck, lint, `check:i18n`, `check:help` and focused tests pass.
Evidence: OBSERVED files above; `.agentic/requirements/nfr/REQ-NFR-83ac0a94.toml` states the five-minute
no-model-output timeout; `.agentic/knowledge/llm-gateway.md` states "Timeout30s, retry0". OBSERVED
`agent/runtime.ts:339`: any event other than text/tool/done is handled as an error.
Assumptions: none.
Unknowns: UNKNOWN whether Ollama and LM Studio send headers before loading the model and processing
the prompt (not run here). UNKNOWN whether every local server streams its reasoning.
Decision-blocking questions: (1) The default limit for custom connections when unset, and the allowed
range. (2) Whether a timeout gets its own localized message.
Proposed behaviors (not accepted): Default 300 s for custom connections, applied to both the header
wait and the silence limit, range 10-3600 s. A timeout error naming the limit in seconds.

## Requirement coverage

| Behavior | Requirement | Design |
|---|---|---|
| Custom connection stores an optional response timeout, 10-3600 whole seconds, out-of-range refused | REQ-FUNC-f19cac5e (revised) | `responseTimeoutSeconds` in shared `configFields` |
| Header wait follows the connection (300 s unset), 30 s for OpenAI/ChatGPT | REQ-NFR-543124b7 | `timeoutMs` from `customResponseTimeoutMs` in providers.ts |
| Silence limit follows the connection (300 s unset), five minutes otherwise | REQ-NFR-83ac0a94 (revised) | optional `LlmGateway.responseTimeoutMs`, read by timedGateway per request |
| Reasoning deltas count as model output | REQ-REL-25ceaa1d | `LlmRequest.onActivity` called per provider event; timedGateway re-arms |
| A timed-out request ends with PROVIDER reason timeout naming the seconds | REQ-FUNC-25254fe8 | `timeoutError`; transport marks SDK aborts as timeout; error event `params` |
| Editors offer and save the timeout field | REQ-UX-2ccfac13 | number field in custom and LM Studio editors |

## Design

**Approach.** One per-connection value, `responseTimeoutSeconds`, drives both waits for a custom
connection (ruling: 300 s default, 10-3600 s). The provider gateway already holds the connection
snapshot per request, so it computes the header wait and exposes the silence limit through a new
optional gateway method. timedGateway stays the single owner of the silence timer. Rejected: a new
`activity` stream event, because `agent/runtime.ts:339` handles every unknown event as an error, and
consumers that skip timedGateway (connection tests) would see it. A request callback reaches only the
timer. Rejected: a field on `ModelCapabilities`, because that schema is the renderer catalog contract.

**Interfaces and data.**
- shared `providers.ts`: `configFields.responseTimeoutSeconds: int 10..3600, optional`. It flows
  through save, list and settings with no other change. Settings format stays 1 (no migration).
- core `gateway.ts`: `LlmRequest.onActivity?: () => void`; `LlmGateway.responseTimeoutMs?(reference)`
  returns ms or undefined (use the session default).
- core `llm/errors.ts`: `ProviderFailure.timeout?: number` (seconds) and `timeoutError(milliseconds)` give
  `{ code: PROVIDER, messageKey: provider.timeout, params: { reason: timeout, seconds } }`
  (REQ-FUNC-25254fe8). The transport catch sets `timeout` when the SDK's own signal aborted and the
  caller's did not; a caller abort keeps the aborted path.
- timedGateway: limit = `gateway.responseTimeoutMs?.(model) ?? default`. One timer, re-armed on each
  yielded event and on each `onActivity` while a `next()` is pending (REQ-REL-25ceaa1d). Timeout
  yields `timeoutError(limit)`, which rounds to whole seconds.
- shared `events.ts` error event and the reducer's error item gain optional `params`. The runtime
  forwards only `{ seconds }` for reason timeout, so no provider text or endpoint reaches stored events.
  ErrorRow passes `params` to `t()`.

**Files and test seams.** shared providers.ts and events.ts, session-state.ts (error item);
core llm/{gateway,errors,providers}.ts, sessions/timed-gateway.ts, agent/runtime.ts; desktop
main/index.ts (test composite forwards the method); renderer providers.tsx, lmstudio-editor.tsx,
transcript error row, locales en/ro/de/fr; help en/ro/de/fr providers.md. Tests: new
`sessions/timed-gateway.test.ts` (per-model limit, activity, timeout error); gateway.test.ts (timeoutMs
45000/300000/30000, header-timeout mapping, caller abort); shared providers.test.ts (bounds); tests/e2e/providers.spec.ts
(editor round-trip).

**Risks and open decisions.** session-state.ts and its test already carry the uncommitted
context-meter fix; the `params` hunk is separate, so the commits must be staged by hunk. Whether
Ollama/LM Studio send headers before prefill stays UNKNOWN; the configurable header wait covers both.

**Requirement map.** REQ-FUNC-f19cac5e: schema field. REQ-NFR-543124b7: timeoutMs. REQ-NFR-83ac0a94:
responseTimeoutMs + timedGateway. REQ-REL-25ceaa1d: onActivity. REQ-FUNC-25254fe8: timeoutError, transport,
event params, locales. REQ-UX-2ccfac13: editors, locales, help.

## Log

- 2026-11-20 frame: journal opened
- 2026-11-20 frame: completed; next specify - scope accepted (7 Done checklist item(s) left unticked)
- 2026-11-20 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-20 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-20 build: DEVIATION design: no structure/sequence/state diagrams drawn - the change is two timers and one settings field; the design note names every seam
- 2026-11-20 build: red: vitest run shared/providers.test.ts exit 1 - strict custom schema refuses responseTimeoutSeconds (REQ-FUNC-f19cac5e)
- 2026-11-20 build: red: vitest run core/sessions/timed-gateway.test.ts exit 1 - no per-model limit, activity ignored, generic PROVIDER error (REQ-NFR-83ac0a94, REQ-REL-25ceaa1d, REQ-FUNC-25254fe8)
- 2026-11-20 build: red: vitest run core/llm/gateway.test.ts -t 'response headers|reasoning delta' exit 1 - no responseTimeoutMs, fixed 30 s header wait, no activity callback (REQ-NFR-543124b7, REQ-REL-25ceaa1d, REQ-FUNC-25254fe8)
- 2026-11-20 build: red: vitest run core/sessions/service.test.ts -t 'no-output timeout' exit 1 - stored error has errors.PROVIDER and no params (REQ-FUNC-25254fe8)
- 2026-11-20 build: green: vitest run shared/providers.test.ts, core/sessions/timed-gateway.test.ts, core/llm/gateway.test.ts exit 0; vitest run core/src/sessions core/src/agent shared exit 0, 728 passed (REQ-FUNC-f19cac5e, REQ-NFR-543124b7, REQ-NFR-83ac0a94, REQ-REL-25ceaa1d, REQ-FUNC-25254fe8)
- 2026-11-20 build: red: npm run test:e2e -- providers.spec.ts lmstudio.spec.ts -g 'response timeout|LM Studio discovers' exit 1 - no Response timeout (s) field in either editor (REQ-UX-2ccfac13)
- 2026-11-20 build: green: npm run test:e2e -- providers.spec.ts lmstudio.spec.ts providers-layout.spec.ts exit 0, 6 passed (REQ-UX-2ccfac13; main provider list now returns responseTimeoutSeconds)
- 2026-11-20 build: green: npm test exit 1 - 3345 passed, 3 failed; the same 3 (workbench pinned-save closing, CLI local Git clone hash review, plugin-builder CLI help draft) fail identically on HEAD with local changes stashed, so they predate this task
- 2026-11-20 build: green: npm run typecheck exit 0; biome check on 28 changed files exit 0 (1 older useTemplate info); check:i18n and check:help exit 0
- 2026-11-20 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-20 validate: knowledge pages updated - llm-gateway (header wait per connection, onActivity, timeout mapping), sessions (per-model silence limit, re-arm, change map), providers (Response timeout field; legacy Architecture section removed), agent-runtime (only {seconds} params stored), chat-ui (ErrorRow params); project/environment context have no timeout claims, unchanged; six requirements re-read and match the build
- 2026-11-20 validate: quality review round 1 approved; non-blocking: timed-gateway.test.ts does not pin caller abort, timer cleanup or activity outside a pending read
- 2026-11-20 validate: spec review round 1 changes_required - (1) REQ-FUNC-25254fe8 verification claims a gateway caller-abort test that does not exist; (2) it names a 10 s header wait, test uses 45/300/30; non-blocking: Design says timeoutError(seconds) and provider-settings.test bounds; gateway reasoning test passes without reasoning; service.test params uses toMatchObject; REQ-UX-2ccfac13 affected_paths miss ro/de/fr help; REQ-REL wording; llm-gateway page should say OpenAI/ChatGPT header timeouts now report provider.timeout
- 2026-11-20 validate: returned to build - Spec review round 1: add gateway caller-abort test, align REQ-FUNC-25254fe8 verification, tighten reasoning and params assertions, fix requirement paths/wording and Design text
- 2026-11-20 build: round-1 fixes - gateway caller-abort test (aborted, no provider.timeout); reasoning test compares with/without reasoning (+3 activity); service.test stored params toEqual {seconds:1}; REQ-FUNC-25254fe8 verification matches 45/300/30 and caller abort; REQ-UX-2ccfac13 paths add ro/de/fr help; REQ-REL wording; Design text timeoutError(milliseconds), shared providers.test bounds; llm-gateway page notes OpenAI/ChatGPT header timeouts report provider.timeout
- 2026-11-20 build: green: vitest run gateway/timed-gateway/service/shared providers tests exit 0, 88 passed; npm run typecheck exit 0; biome format on gateway.test.ts (1 older useTemplate info in service.test.ts)
- 2026-11-20 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-20 validate: final: python .agentic/aegis.py check --task TASK-e5612dfd --strict --run exit 0; ran lint, typecheck, i18n, help (test not in [check] run); then vitest core sessions/agent/llm + shared + main provider-settings exit 0, 804 passed 1 skipped; e2e providers+lmstudio+layout 6 passed at build with production code unchanged since; 39 warnings: older journals/ticket refs, help outside layout globs, and uncovered meter-fix files (not this task); 3 older npm test failures predate this task
- 2026-11-20 validate: DEVIATION validate: strict check --run does not run tests in this repo's [check] config - covered by focused vitest after the last edit; full npm test and e2e not rerun after the round-1 test-only edits
- 2026-11-20 validate: completed; next done (9 Done checklist item(s) left unticked)

## Rulings

- RULING-001 | date=2026-11-20 | decision=Custom connections default to a 300 s response timeout, used for both the header wait and the silence limit; configurable per connection from 10 to 3600 s | reason=Local models load and prefill slowly; one value is simpler to set | source=user | supersedes=none
- RULING-002 | date=2026-11-20 | decision=A timed-out model request reports a dedicated localized message naming the limit in seconds | reason=Users must know to raise the limit instead of suspecting the connection | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-e5612dfd.md
changed: Per-connection response timeout built and focused-green; nothing committed
evidence: aegis check --task TASK-e5612dfd --strict --run exit 0; vitest touched components 804 passed
issues: User stopped for shutdown before review; 3 older unit/integration failures also fail on HEAD; meter fix and this task share session-state.ts uncommitted on master
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-20)

- stage: validate; type: change; branch: master
- requirements:
  - REQ-NFR-83ac0a94 - Enforce session turn limits
  - REQ-FUNC-f19cac5e - Safe provider configuration operations
  - REQ-NFR-543124b7 - Wait for custom connection response headers per connection
  - REQ-REL-25ceaa1d - Count reasoning deltas as model output
  - REQ-FUNC-25254fe8 - Report timed-out model requests as timeouts
  - REQ-UX-2ccfac13 - Edit the response timeout of custom connections
- deviations: 2 recorded
  - design: no structure/sequence/state diagrams drawn - the change is two timers and one settings field; the design note names every seam
  - validate: strict check --run does not run tests in this repo's [check] config - covered by focused vitest after the last edit; full npm test and e2e not rerun after the round-1 test-only edits
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base bb55180: 50 file(s) changed, 901 line(s) added
- checks: errors=0 warnings=39 notes=40
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended
