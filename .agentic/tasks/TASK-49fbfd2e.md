# TASK-49fbfd2e - PROV-01 provider preset registry and connection workflow (#348)

stage: done
type: feature
interaction: autopilot
requirements: REQ-UX-2f454a64, REQ-DATA-4b2972de, REQ-SEC-c8d0ae29, REQ-SEC-ba662d06, REQ-SEC-1f2e8558, REQ-FUNC-efa9e25e, REQ-FUNC-c0a762cd, REQ-REL-8acab0c0, REQ-UX-bfbeca0c
parent:
branch: ddp/epic-338
base: eb58c84ac533d11c98cf0e93862c40dc675972f4
opened: 2026-11-20

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

Problem: STATED (#348): Settings needs a shared preset and connection workflow before the provider batches.
Desired outcome: STATED (#348): searchable presets, independently saved connections, bound credential routing, typed discovery and tests, and visible per-model metadata.
Actors: STATED (#347): a VERA user connecting and selecting a service or plan.
Primary scenario: STATED (#348): search, add, discover or enter a model, save, test, select in a workbench or session.
Examples: STATED (#348): two fixture presets for different plans or endpoints coexist and select independently.
Counterexamples: STATED (#347): a key or model for one plan does not make VERA switch to another.
In scope: STATED: shared registry, connection UI, gateway and model pickers, four locales and focused regressions.
Out of scope: STATED: third-party shipments and live smokes, full suites, physical microphone, Git publication and Gitea writes.
Constraints: STATED: pre-release schemas stay at 1; coordinator commits once after handover; work only in the assigned checkout.
Success signals: STATED (#348): fixture coexistence and credential isolation, typed workflow and unknown tool metadata, existing connections and session switches regressions.
Evidence: OBSERVED: branch ddp/epic-338 at eb58c84ac533d11c98cf0e93862c40dc675972f4 began clean; shared providers.ts, main ProviderSettings and core createPiAiGateway already provide the extension seams.
Assumptions: INFERRED from #347 and #349–#355: the shared base needs independent route and catalog URLs and an extensible adapter choice; each provider ticket supplies its service-specific metadata.
Unknowns: UNKNOWN: provider-specific verified model lists and live account contracts reserved for subsequent tickets.
Decision-blocking questions: None.
Proposed behaviors: None.

## Requirement coverage

| Behavior | Requirement | Design |
|---|---|---|
| STATED (#348): Search the provider preset selector | REQ-UX-2f454a64 | provider-preset-selector |
| STATED (#348): Store independent curated provider connections | REQ-DATA-4b2972de | provider-settings |
| STATED (#348): Bind curated keys to the connection and service routes | REQ-SEC-c8d0ae29 | provider-settings |
| STATED (#348): Refuse redirected curated provider requests | REQ-SEC-ba662d06 | providers |
| STATED (#348): Keep curated credentials out of public provider output | REQ-SEC-1f2e8558 | provider-settings |
| STATED (#348): Return a typed curated model discovery outcome | REQ-FUNC-efa9e25e | provider-gateway |
| STATED (#348): Test curated connections on their saved model | REQ-FUNC-c0a762cd | provider-gateway |
| STATED (#348): Cancel curated provider requests | REQ-REL-8acab0c0 | providers |
| STATED (#348): Show model capabilities alongside provider identity | REQ-UX-bfbeca0c | model-catalog |

## Design

**Approach** — OBSERVED: the renderer, Settings service, credential file and pi-ai gateway can reuse the custom connection path. The shared registry describes the existing choices and typed curated API choices. The shipped curated catalog is empty for this ticket, per the coordinator. Tests inject their own immutable definitions.

**Interfaces and data** — REQ-DATA-4b2972de, REQ-SEC-c8d0ae29: a managed connection uses the existing custom model-reference format with a fresh reserved slug and stores the selected preset/binding plus its exact registered inference base. Main validates the binding on save and enforces immutability on edit. The credential slot includes the connection and service/binding/route identity. Core resolves the same binding before auth. The renderer supplies IDs to curated discovery, with explicit draft keys or a matching saved slot. Generic settings IPC cannot mutate provider records.
REQ-SEC-ba662d06, REQ-SEC-1f2e8558, REQ-REL-8acab0c0: catalog and inference use separate exact URLs, no redirects, propagated abort, bounded catalog reads and secret-safe results. Inference reuses pi-ai Chat Completions with one scoped credential snapshot. Later protocol-specific behavior belongs to the provider tickets.
REQ-FUNC-efa9e25e, REQ-FUNC-c0a762cd: typed discovery outcomes offer selection or explicit entry; authenticated inference remains available when listing is unavailable. Test uses the existing four-step workflow for the saved model.
REQ-UX-2f454a64, REQ-UX-bfbeca0c: add a search filter to the existing selector, and share model catalog queries and localized option labels between session and workbench. Curated model profiles supply verified metadata; configured limits are the budget for unknown models.

**Files and test seams** — Shared provider contracts and registry; Core curated binding/catalog and gateway; Desktop provider settings/discovery, editor, and selectors. A single fixture harness traverses settings and real pi-ai serialization using injected fetch with fake keys. Renderer tests exercise search and capability labels. Existing suites preserve the previous paths and session override behavior.

**Risks and open decisions** — Endpoint IDs and persisted model references must remain stable after edits. Explicit binding changes require a new connection. A missing preset or changed inference URL fails closed. Real-provider contracts, regional rules and additional adapters belong to the integration tickets.

**Requirement map** — The decisions above identify all requirements; see the coverage table for their first code seams.

Diagrams: [diagram_TASK-49fbfd2e.md](diagram_TASK-49fbfd2e.md)

## Log

- 2026-11-20 frame: journal opened
- 2026-11-20 frame: completed; next specify
- 2026-11-20 specify: completed; next design
- 2026-11-20 design: completed; next build
- 2026-11-20 build: red: focused Vitest provider-settings curated setup exit 1 - managed presets rejected as INVALID before save (REQ-DATA-4b2972de, REQ-SEC-c8d0ae29, REQ-FUNC-c0a762cd, REQ-UX-bfbeca0c)
- 2026-11-20 build: red: focused Vitest typed discovery and cancellation cases exit 1 - the gateway had no curated discovery operation (REQ-SEC-ba662d06, REQ-SEC-1f2e8558, REQ-FUNC-efa9e25e, REQ-REL-8acab0c0)
- 2026-11-20 build: red: npm run test:e2e -- providers-layout.spec.ts exit 1 - Add Provider did not expose a search field (REQ-UX-2f454a64)
- 2026-11-20 build: green: wrapped Vitest exit 0 on Windows (162 across credentials, provider settings/discovery/presets, gateway/subscription, schemas, IPC/preload/mock, import boundaries; affected subset rerun 72 pass) and WSL2 Ubuntu (78 across provider settings/discovery/presets and gateway/subscription)
- 2026-11-20 build: green: npm run test:e2e -- providers-layout.spec.ts (1), session-reasoning.spec.ts providers.spec.ts (5), and workbench-tools.spec.ts (1), all exit 0 on Windows; checked preset search, existing setup, session selection and workbench metadata
- 2026-11-20 build: WSL2 focused runner reused the checkout and four temporary Linux platform modules, verified against the pinned lockfile and removed after the run
- 2026-11-20 build: completed; next validate
- 2026-11-20 validate: Review 1: text/tool delta redaction must use the request-scoped key; validate effective selected model budgets at save, align editor limits, and isolate non-default model fallback budgets
- 2026-11-20 validate: returned to build - Address scoped-delta redaction and effective curated model budget review findings
- 2026-11-20 build: red review regressions: provider-presets.test.ts -t short scoped keys|effective limits exit 1; observed a short credential in streamed text and an invalid effective budget accepted at save
- 2026-11-20 build: red terminal tool regression: focused short-key case exit 1; unregistered scoped key remained in raw terminal tool arguments after masked deltas. Preserve ordinary tool authority and reject this unsafe terminal response when masking is enabled.
- 2026-11-20 build: green review 1 fixes: wrapped Vitest on Windows, six provider settings/discovery/presets/gateway/subscription/shared provider files, 81 pass; providers-layout.spec.ts browser 1 pass; both exit 0. Short-key text/tool deltas and terminal behavior and independent partial model budgets asserted.
- 2026-11-20 build: completed; next validate
- 2026-11-20 validate: green after review fixes: WSL2 Ubuntu wrapped Vitest targeted five provider settings/discovery/presets and gateway/subscription files, 80 tests pass, exit 0. Verified temporary links to pinned Linux packages removed after process exit.
- 2026-11-20 validate: Review 2: scoped masking and effective limits pass. Narrow terminal detection to provider-controlled strings so a short key cannot match a JSON field or primitive that the provider did not return as credential text.
- 2026-11-20 validate: returned to build - Restrict terminal credential matching to provider-controlled values
- 2026-11-20 build: red review 2 regression: wrapped Vitest ordinary terminal tool call case exit 1; one-character key falsely matched protocol JSON despite no credential echo
- 2026-11-20 build: green review 2 fix: wrapped Vitest provider-presets.test.ts gateway.test.ts subscription.test.ts, 62 tests, exit 0. Ordinary tool call succeeds with one-character key and boolean argument; short credential echo is masked/rejected.
- 2026-11-20 build: completed; next validate
- 2026-11-20 validate: green review 2 fix on WSL2: 56 focused Vitest tests across provider-presets and gateway, exit 0
- 2026-11-20 validate: Review 3: ordinary tool call passes; numeric credentials can still be echoed verbatim as scalar arguments, so match exact scalar values without matching protocol syntax or arbitrary substrings of primitives.
- 2026-11-20 validate: returned to build - Protect exact scalar credential echoes in terminal tool arguments
- 2026-11-20 build: red review 3 regression: wrapped Vitest terminal scalar cases exit 1, three exact credential echoes were accepted as tool argument values and the ordinary Boolean case passed
- 2026-11-20 build: green review 3: Windows wrapped Vitest provider-presets.test.ts gateway.test.ts subscription.test.ts, 65 passed, exit 0, including ordinary Boolean argument and exact numeric/Boolean/null credential echoes
- 2026-11-20 build: completed; next validate
- 2026-11-20 validate: green review 3 WSL2 Ubuntu: wrapped Vitest provider-presets.test.ts and gateway.test.ts, 59 passed, exit 0; temporary native package links removed
- 2026-11-20 validate: final attempt: check --strict --run exit 1. Lint and help passed; typecheck rejected new model data structural type and test helper targets; i18n rejected dynamic translation calls. Release notes check exit 0.
- 2026-11-20 validate: returned to build - Correct strict TypeScript and i18n findings, then review and reprove
- 2026-11-20 build: green static repair targeted behavior: wrapped Vitest provider-presets/provider-settings/gateway/subscription 78 passed, exit 0; providers-layout browser 1 passed, exit 0
- 2026-11-20 build: completed; next validate
- 2026-11-20 validate: final: python .agentic/aegis.py check --task TASK-49fbfd2e --strict --run exit 0; lint, typecheck, i18n and help pass. 33 repository advisories for legacy journal headers, references, context size and layout; no task errors. Wrapped npm run check:release-notes exit 0.
- 2026-11-20 validate: Done criteria met: independent plan fixture saves and references, verified route and credential isolation; typed discovery/manual/test outcomes and explicit unknown tools; OpenAI, ChatGPT, custom/local, workbench and session switching regressions with version-1 settings. Release integrations own live acceptance.
- 2026-11-20 validate: completed; next done

## Rulings

- RULING-001 | date=2026-11-20 | decision=The coordinator may make one local commit for the validated #348 candidate | reason=Repository implementation authorization and coordinating chat instructions; implementation checkout remains unstaged | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-49fbfd2e.md
changed: Provider presets, scoped routing and credentials, model pickers, four-language help and release notes
evidence: Strict AEGIS and release notes exit 0; Windows 78 and WSL2 59 final affected tests; 7 targeted UI cases passed
issues: 33 pre-existing AEGIS advisories
spec_compliance: approved
implementation_quality: approved
review_round: 5

## Delivery report (2026-11-20)

- stage: validate; type: feature; branch: ddp/epic-338
- requirements:
  - REQ-UX-2f454a64 - Search the provider preset selector
  - REQ-DATA-4b2972de - Store independent curated provider connections
  - REQ-SEC-c8d0ae29 - Bind curated keys to the connection and service routes
  - REQ-SEC-ba662d06 - Refuse redirected curated provider requests
  - REQ-SEC-1f2e8558 - Keep curated credentials out of public provider output
  - REQ-FUNC-efa9e25e - Return a typed curated model discovery outcome
  - REQ-FUNC-c0a762cd - Test curated connections on their saved model
  - REQ-REL-8acab0c0 - Cancel curated provider requests
  - REQ-UX-bfbeca0c - Show model capabilities alongside provider identity
- deviations: none recorded
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=5
- diff vs task base eb58c84: 53 file(s) changed, 2182 line(s) added
- checks: errors=0 warnings=33 notes=42
- checklist: 9/9 done
