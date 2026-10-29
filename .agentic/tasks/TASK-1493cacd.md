# TASK-1493cacd - Select supported reasoning levels per session and subsequent model request

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-UX-09ed27ff, REQ-FUNC-6014ce37, REQ-FUNC-68b75ba4
parent:
branch: master
base: f1b4ee70e84b843d8061845c86b20fa065ad0420
opened: 2026-10-29

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

Problem: STATED user needs a reasoning selector beside model, with Default and levels accepted by each model; persist choice per session and apply to subsequent requests.
Desired outcome: per-session reasoning override without modifying provider defaults or requests already in flight.
Actors/scenario: user selects model/effort, sends or steers a session, reopens it and finds the saved choice; unsupported models offer no reasoning control.
Examples: ChatGPT authenticated catalog exposes actual native levels; LM Studio uses discovered profile options; Default retains current provider/profile behavior.
Counterexamples: invalid/stale-model effort rejected; read-only workbench cannot save; model change clears an unsupported override; changed capabilities never forward an unsupported effort.
In scope: strict reasoning metadata/set IPC, session.updated optional reasoning preference, existing event-store persistence and cached metadata lookup, native provider dispatch, localized compact picker and focused/offline native tests.
Out of scope: new providers, temperature UI, token-budget policy, database migration/legacy paths, historical journal edits (standing user policy).
Constraints: OBSERVED shared master f1b4ee7; pinned SDK provides OAuth-only public Responses inference; live Codex metadata catalog provides model capabilities; LM Studio profiles already include options/default. STATED AEGIS autopilot and local commits authorized by AGENTS. Use no real credentials/network during automated proof.
Success signals: truthful model-level options + Default, durable independent session choices, next model requests snapshot choice, in-flight object unchanged, valid native wire effort, provider defaults retained, no unsupported effort dispatch.
Evidence: OBSERVED shared session-state/events/IPC; core SessionHub replays existing events; gateway/providers and pi-ai models/native adapters; composer currently has model/mode only.
Assumptions: levels are native model/provider values. Model changes retain compatible preferences and reset incompatible ones to Default; runtime capability changes use effective Default if the stored preference is unavailable.
Unknowns: generic custom endpoints have no verified reasoning metadata, so expose no options; no invented capability levels.
Decision-blocking questions: none; user explicit implementation instruction covers per-session scope and next-request semantics.
Proposed behaviors: user-approved selector and persistence; derived safety behavior follows model-supported-only requirement.
Path and reason:
| Criterion | Holds? | Evidence |
| no new external behavior | no | new selector and dispatch preference |
| no new interface/data format | no | strict metadata/set channels + optional event field |
| no new dependency | yes | pinned SDK and existing event store |
| existing requirement fully covers behavior | no | three scoped requirements |
| no security/data handling change | yes | native ownership/IPC/scrubbing preserved |
Full path. One implementation owner; independent reviews at validate.

## Requirement coverage

| Outcome | Requirement | Verification |
| Supported picker beside model | REQ-UX-09ed27ff | renderer options/default/reset, en/ro/de, compact browser/native |
| Durable isolated next-request preference | REQ-FUNC-6014ce37 | restart/isolation/read-only/race/model-switch tests |
| Native validated dispatch/defaults | REQ-FUNC-68b75ba4 | SDK metadata/null map, loopback OpenAI/LM Studio payload assertions |

## Design

### Approach
REQ-UX-09ed27ff: derive ChatGPT choices from its authenticated live model catalog, with a short account-scoped cache; do not infer levels from model names or SDK tables. The API-key catalog has no declared reasoning capabilities, so it offers Default only; LM Studio exact discovered options; unknown custom endpoints unsupported. A query-backed picker beside Model uses strict session.reasoning.get and .set with expected effective modelRef.
REQ-FUNC-6014ce37: persist nullable optional reasoning in session.updated events, replayed by existing state reducer. A bounded EventsRepository latest-choice query initializes a service cache; update cache after durable commit/before publication, clear on delete/close. No schema migration. During active turns the setter is allowed; each new gateway request snapshots the then-current compatible choice. Model setter retains supported effort or resets it atomically to Default.
REQ-FUNC-68b75ba4: expose optional reasoningOptions in capabilities/catalog, validate setter and gateway dispatch, snapshot primitive into LlmRequest. OpenAI Responses/Codex payload.reasoning.effort uses native values; completions reasoning_effort; LM Studio off/on translation retained. Default omits session override and preserves saved provider defaults. Unknown/stale capability preference becomes effective Default, never an unsupported transmitted level.
The picker offers inference levels, excluding the documented Codex Ultra client-orchestration mode that public Responses does not accept as a native effort. No model-specific allowlist is introduced.

The rich discovery route is the documented Codex models endpoint (protocol version 0.162.1), independently of existing public Responses inference. Its memory cache is scoped to the resolved OAuth token/account, invalidates on identity changes and prevents superseded publication. Shared fetches have their own timeout; caller abort only stops that caller waiting. Gateway prepareModel is awaited by ReferenceRuntime before synchronous budget/capability checks, including a cold restart with no picker opened; metadata getter and stream dispatch prepare too.

### Interfaces and data
Getter(sessionId) -> effective modelRef/options/selected. Setter(sessionId,modelRef,reasoning:string|null) -> same metadata, with writable/current-model validation. Optional reasoning in shared event/state, no SQL columns or migration. Composer receives session identity; picker observes current app/workbench configuration query caches and session preference/model events; defaults resolve in core. Main scrubs response strings, mocks mirror contracts.
### Files and test seams
shared events/state/providers/IPC; core EventsRepository, SessionService, llm gateway/providers, ReferenceRuntime/timed gateway preparation; desktop main dispatch, renderer picker/composer/workspace/mock/catalog/i18n; narrow existing fixture allowlists. Tests: session lifecycle/race, live catalog/native wire payloads, strict IPC/state replay, renderer picker, native loopback model/config persistence. Context knowledge updated in validate.
### Risks and open decisions
Preserve request budgets, credential isolation, stop/approval and queued steering. Getter/setter expected-model guard prevents stale catalog races. No metadata polling/full transcript replay per streamed request. Unknown default/provider errors never invent options. No real model/API spend; actual loopback capture proves transport. No open decisions.
### Requirement map
09ed27ff -> model-native options + picker; 6014ce37 -> optional persisted event/cache/snapshot; 68b75ba4 -> capability and wire validation/default composition.

## Log

- 2026-10-29 frame: journal opened
- 2026-10-29 frame: Autopilot/local commit authorized by repository AGENTS. Source-of-truth capability metadata: pinned SDK getSupportedThinkingLevels/thinkingLevelMap and LM Studio discovered profiles. User requires session persistence/next requests. Use existing event store, no migration or real network/API keys. Historical journals and optional-companions.md excluded.
- 2026-10-29 frame: completed; next specify
- 2026-10-29 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-10-29 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-10-29 build: Red: two focused tests fail as expected: session reasoning API absent and LM Studio capabilities omit discovered reasoning options.
- 2026-10-29 build: User steering: avoid SDK/local reasoning model lists becoming obsolete. Official OpenAI model/list documents supportedReasoningEfforts/defaultReasoningEffort; current ChatGPT catalog schema verified from local Codex catalog metadata (supported_reasoning_levels). Change design to authenticated public /v1/models catalog with account-scoped short cache, dynamic models/native efforts; no guessed efforts for API-key catalogs lacking capabilities. No inference request or real credential used.
- 2026-10-29 build: Independent preflight reviews found rich-catalog contract ambiguity, cold-cache validation, shared abort and identity-cache risks. Fix discovery using explicitly documented Codex metadata endpoint only (public Responses inference retained), per-caller cancellation over shared fetch, identity invalidation and provider-neutral prepareModel before runtime budgeting. Review fixes and add regressions before final verdicts.
- 2026-10-29 build: DEVIATION build: extended provider-neutral runtime readiness before budgeting to preserve saved reasoning on cold restart; scoped to live metadata preparation and covered by direct send without picker. Independent preflight findings corrected; inference endpoint remains unchanged.
- 2026-10-29 build: Focused proof: 71 core/session/runtime/gateway/subscription tests passed; one independently established pre-existing compaction test excluded. Added red regressions for default model selection from live catalog and avoiding a second metadata fetch after a committed preference. Native functional assertions passed through restart/dispatch/default; responsive check found viewport emulation conflicted with Electron native minWidth=1024, so test actual native 1280/1024 and browser 760 independently.
- 2026-10-29 build: Native wire contract inspection: official GPT-6.1 Sol API docs permit low/medium/high/xhigh/max; official Models docs define Ultra as client subagent orchestration. Filter this Codex client mode (not a model-specific allowlist), preserving arbitrary future native levels from catalog. Browser 760px acceptance and typecheck passed; corrected reasoning icon to stay inline after visual inspection.
- 2026-10-29 build: Green: 136 tests passed in nine-file focused run; only the new read-only parameter case had a duplicate mock-folder setup conflict. Isolated folder per parameter corrected it; both cases passed. Four reasoning session regressions re-passed after fixing reset-to-unconfigured-default. Combined focused coverage: 137 distinct passing tests, one known baseline compaction exclusion. Native Electron acceptance plus browser 760px passed; screenshots visually inspected, icon inline and all controls reachable. No live account/inference spend; Windows proof only, Ubuntu not run. AEGIS advisory: 0 errors/24 pre-existing warnings; historical journals retained.
- 2026-10-29 build: completed; next validate
- 2026-10-29 validate: Formal independent specification and quality reviews approved complete candidate after preflight corrections. Only README trailing blank line removed after review, no semantic change. Final proof uses project check run list (lint/typecheck/i18n), reusing focused/native evidence per verification policy. Limitations: Ubuntu native not run; one previously reproduced baseline compaction failure excluded from focused scope; no live ChatGPT credentials/inference used.
- 2026-10-29 validate: final: python .agentic/aegis.py check --task TASK-1493cacd --strict --run exit 0; lint/typecheck/i18n passed, strict ok, 0 errors and 24 pre-existing warnings. Focused/native/browser proof retained as above; no full suite repeated per project policy. Historical journals and optional-companions.md unchanged. User requested normal VERA launch; npm run dev launched with current source.
- 2026-10-29 validate: completed; next done (9 Done checklist item(s) left unticked)
- 2026-10-29 done: Delivery: all validation checklist items confirmed from recorded proof; one local commit authorized by AGENTS, no push. User requested VERA open; detached normal development launch used so the application persists independently of this command session.

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-1493cacd.md
changed: Reasoning UI, durable preference, live catalog, preparation and native transport implemented; focused and visual proof complete
evidence: Strict exit 0; both independent approvals; 137 focused tests plus native Electron/browser acceptance; Windows verified, Ubuntu not run
issues:
spec_compliance: approved
implementation_quality: approved
review_round: 1

## Delivery report (2026-10-29)

- stage: validate; type: feature; path: full; branch: master
- requirements:
  - REQ-UX-09ed27ff - Offer model-supported session reasoning beside the model selector
  - REQ-FUNC-6014ce37 - Persist session reasoning preference and isolate subsequent requests
  - REQ-FUNC-68b75ba4 - Dispatch validated native reasoning efforts with provider defaults
- deviations: 1 recorded
  - build: extended provider-neutral runtime readiness before budgeting to preserve saved reasoning on cold restart; scoped to live metadata preparation and covered by direct send without picker. Independent preflight findings corrected; inference endpoint remains unchanged.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=1
- diff vs task base f1b4ee7: 42 file(s) changed, 1529 line(s) added
- checks: errors=0 warnings=24 notes=3
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended
