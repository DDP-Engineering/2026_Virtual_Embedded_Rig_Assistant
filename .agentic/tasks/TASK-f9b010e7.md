# TASK-f9b010e7 - PROV-02 OpenCode Console and OpenCode Go (#349)

stage: done
type: feature
interaction: autopilot
requirements: REQ-FUNC-5fcdc730, REQ-FUNC-8d07ac69, REQ-FUNC-0a099f39, REQ-REL-9f59b403, REQ-FUNC-9baa2007, REQ-FUNC-06a7076c, REQ-FUNC-74eac91c, REQ-FUNC-25e41e3e, REQ-UX-dd1c1f1b
parent:
branch: ddp/epic-338
base: 0908664de1e2438318ac452fa756f60a318abc5b
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

Problem: STATED (#349): VERA needs OpenCode Console and OpenCode Go connections using the shared registry.
Desired outcome: STATED (#349): each plan has its own credential scope, catalog and Chat Completions route, with model metadata and actionable diagnostics.
Actors: STATED (#347): VERA users connecting and selecting a model service or plan.
Primary scenario: STATED: add a Console or Go connection, discover and select an eligible model, then test and use it for an agent session.
Examples: OBSERVED: the published Console and Go catalogs each list glm-5.3 with the provider ID unchanged.
Counterexamples: STATED: a rejected key or model never reroutes a request to the other plan.
In scope: STATED: presets, routing, catalog metadata, diagnostics, four-language surfaces and scripted gateway tool continuation and cancellation.
Out of scope: STATED: paid or authenticated live verification, changes to unrelated providers, Git and Gitea writes.
Constraints: STATED: use branch ddp/epic-338 at 0908664d; coordinator makes the authorized local commit; retain schema version 1.
Success signals: STATED: independent routes and credential records; eligible choices and safe metadata; plan, auth, budget and rate-limit failures; streamed tool round trip and usable session after cancellation.
Evidence: OBSERVED: official OpenCode Harnesses and Model list API documentation, public GETs to both inference catalogs, and installed pi-ai 1.1.0 OpenCode session/model code. Go requires x-opencode-session; one workspace can cover both plans.
Assumptions: None.
Unknowns: UNKNOWN: authenticated service behavior and individual model tool, image and reasoning behavior beyond provider metadata and the scripted transport.
Decision-blocking questions: None.
Proposed behaviors: None.

## Requirement coverage

| Behavior | Requirement | Design |
|---|---|---|
| STATED (#349): Route OpenCode requests by plan | REQ-FUNC-5fcdc730 | Preset binding and scoped transport |
| STATED (#349): List eligible OpenCode model profiles | REQ-FUNC-8d07ac69 | Inference catalog and live profiles |
| STATED (#349): Use a stable OpenCode conversation header | REQ-FUNC-0a099f39 | OpenCode session header |
| STATED (#349): Recover an OpenCode session after cancellation | REQ-REL-9f59b403 | Propagated abort and fresh request |
| STATED (#349): Explain OpenCode authentication failures | REQ-FUNC-9baa2007 | Operation-specific auth |
| STATED (#349): Explain OpenCode plan and model restrictions | REQ-FUNC-06a7076c | Plan and model access |
| STATED (#349): Explain OpenCode budget exhaustion | REQ-FUNC-74eac91c | Billing and allowance |
| STATED (#349): Explain OpenCode rate limits | REQ-FUNC-25e41e3e | Retry-After |
| STATED (#349): Identify the OpenCode plan in provider and model settings | REQ-UX-dd1c1f1b | Registry and shared labels |

## Design

**Approach** — Extend the shared registry and bounded catalog loader for OpenCode’s inference lists. Keep Console and Go on independent exact HTTPS GET/POST routes and their existing route-scoped credential slots (REQ-FUNC-5fcdc730, REQ-FUNC-8d07ac69).

**Interfaces and data** — Parse the provider’s model fields into VERA profiles. Preserve IDs, drop non-chat and known free Console entries, and expose supported display name, context/output limits, image and tool metadata, plus declared Chat Completions reasoning efforts. Keep sparse metadata unknown and keep the saved manual model available for an inference-only key. Read saved catalogs before picker display and model preparation. Cache successful profiles briefly inside the gateway per connection and credential, with no change to persisted data. Bind VERA’s conversation ID to x-opencode-session, using a request ID for standalone connection probes (REQ-FUNC-8d07ac69, REQ-FUNC-0a099f39, REQ-REL-9f59b403).

**Files and test seams** — Registry, core OpenCode catalog parser and cache, errors and pi-ai gateway, with desktop scripted tests on production presets and existing Settings and picker labels (REQ-UX-dd1c1f1b). Localized messages cover auth, catalog access, plan permissions, budget exhaustion and rate limits (REQ-FUNC-9baa2007, REQ-FUNC-06a7076c, REQ-FUNC-74eac91c, REQ-FUNC-25e41e3e). Verify request URLs, unchanged provider IDs, matching tool-call/result IDs, cancellation and retry.

**Risks and open decisions** — Catalog and inference authorization are distinct. Allow an explicitly saved manual ID on the bound route while surfacing catalog failures in discovery and Test. Provider metadata is descriptive; authenticated live behavior remains unobserved under RULING-001. Provider-side Go Extra Usage follows the user’s workspace billing configuration.

**Requirement map** — The coverage table points to each decision; the existing credential, cancellation and no-redirect requirements continue to apply.

Diagrams: [diagram_TASK-f9b010e7.md](diagram_TASK-f9b010e7.md)

## Log

- 2026-11-20 frame: journal opened
- 2026-11-20 frame: completed; next specify (7 Done checklist item(s) left unticked)
- 2026-11-20 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-20 design: completed; next build
- 2026-11-20 build: red: wrapped npx vitest run src/apps/desktop/src/main/opencode-presets.test.ts exit 1: five cases reached real setup and failed with NOT_FOUND because the production registry does not contain either preset
- 2026-11-20 build: red: wrapped Vitest OpenCode -t billing exit 1 on both plans; the documented HTTP 429 policy budget message was treated as a request-rate limit (REQ-FUNC-74eac91c)
- 2026-11-20 build: green: wrapped Vitest 6 focused provider/settings/gateway/catalog files, Windows and Ubuntu WSL2, 85 passed on each, exit 0; covers REQ-FUNC-5fcdc730, REQ-FUNC-8d07ac69, REQ-FUNC-0a099f39, REQ-REL-9f59b403, REQ-FUNC-9baa2007, REQ-FUNC-06a7076c, REQ-FUNC-74eac91c, REQ-FUNC-25e41e3e. WSL2 used an owned temporary source overlay and identical lockfile with pinned Node/dependencies.
- 2026-11-20 build: green: npm run test:e2e -- providers-layout.spec.ts, Windows Chromium 1 passed, exit 0 (REQ-UX-dd1c1f1b). npm run check:release-notes exit 0.
- 2026-11-20 build: DEVIATION validate: authenticated service smoke skipped - user RULING-001 authorizes scripted proof and documented setup because no authorized service accounts are available. Verified public catalog GETs and official references only.
- 2026-11-20 build: completed; next validate
- 2026-11-20 validate: Inspection: official OpenCode Harnesses, Model list API, Go and Budgets docs plus public Console and Go catalog GETs establish route and display contracts. Installed pi-ai 1.1.0 opencode headers, model metadata, and completions adapter establish wire behavior without using ambient auth.
- 2026-11-20 validate: Review 1: use VERA User-Agent, preserve Retry-After through chat, repair record encoding, filter non-chat before validating catalog limits, preserve usable output reservation, enforce input caps in preflight, and guard POST dispatch after key rotation during catalog GET.
- 2026-11-20 validate: returned to build - Correct both independent review findings
- 2026-11-20 build: red review regressions: wrapped Vitest opencode-presets, context, runtime-edge and transcript-detail exit 1; seven failures confirm catalog, agent cap, identifying header, stale POST and retry hint gaps.
- 2026-11-20 build: green review 1 corrections: Windows and Ubuntu WSL2 wrapped Vitest 12 files 166/166 each, providers-layout Chromium 1/1 each, all exit 0; Windows wrapped typecheck exit 0. Existing WSL React act diagnostics occur in unchanged transcript cases.
- 2026-11-20 build: Inspection: compiled production parser accepted public, unauthenticated Console and Go catalog GETs, excluding 31 entries from 103 Console records and parsing all 31 Go records on 2026-11-20. Seven Console and four Go profiles declared a maximum output equal to context.
- 2026-11-20 build: completed; next validate
- 2026-11-20 validate: Review 2: use the unconditional secret scrubber for retained retry hints when content masking is off; round 1 findings resolved.
- 2026-11-20 validate: returned to build - Protect retained retry hints independent of privacy settings
- 2026-11-20 build: red review 2 regression: desktop events -t retry hints exit 1. Content masking disabled returned a retained rate hint equal to a registered secret.
- 2026-11-20 build: green review 2 correction: wrapped Vitest events, session-bookmarks and session-export 20/20 on Windows and Ubuntu WSL2, exit 0; safe hints survive and matching secrets are omitted regardless of content masking. Windows import-boundaries tests/tooling/boundaries.test.ts 17/17 exit 0.
- 2026-11-20 build: completed; next validate
- 2026-11-20 validate: Independent spec and quality review round 3 approved the complete unstaged candidate.
- 2026-11-20 validate: final: python .agentic/aegis.py check --task TASK-f9b010e7 --strict --run exit 0. Lint, typecheck, i18n and help passed. 39 advisory warnings cover existing records, help/release notes outside layout globs, tests also classified as source, and a synthetic bearer-token fixture. No errors.
- 2026-11-20 validate: completed; next done

## Rulings

- RULING-001 | date=2026-11-20 | decision=Ship both presets with scripted proof and documented configuration; skip authenticated live service smoke | reason=User confirmed no authorized service accounts, keys or paid usage for epic #347 | source=user | supersedes=none
- RULING-002 | date=2026-11-20 | decision=Coordinator may make one local ticket commit after verification; implementation chat leaves the candidate unstaged | reason=Delegated ticket uses the sole assigned checkout at the recorded base | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-f9b010e7.md
changed: OpenCode Console and Go presets, scoped catalogs and localized diagnostics
evidence: Strict AEGIS exit 0. Windows and Ubuntu WSL2 each passed 166 focused tests, 20 targeted projection tests and 1 Chromium test.
issues: Authenticated OpenCode smoke waived under RULING-001.
spec_compliance: approved
implementation_quality: approved
review_round: 3

## Delivery report (2026-11-20)

- stage: validate; type: feature; branch: ddp/epic-338
- requirements:
  - REQ-FUNC-5fcdc730 - Route OpenCode requests by plan
  - REQ-FUNC-8d07ac69 - List eligible OpenCode model profiles
  - REQ-FUNC-0a099f39 - Use a stable OpenCode conversation header
  - REQ-REL-9f59b403 - Recover an OpenCode session after cancellation
  - REQ-FUNC-9baa2007 - Explain OpenCode authentication failures
  - REQ-FUNC-06a7076c - Explain OpenCode plan and model restrictions
  - REQ-FUNC-74eac91c - Explain OpenCode budget exhaustion
  - REQ-FUNC-25e41e3e - Explain OpenCode rate limits
  - REQ-UX-dd1c1f1b - Identify the OpenCode plan in provider and model settings
- deviations: 1 recorded
  - validate: authenticated service smoke skipped - user RULING-001 authorizes scripted proof and documented setup because no authorized service accounts are available. Verified public catalog GETs and official references only.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=3
- diff vs task base 0908664: 52 file(s) changed, 1351 line(s) added
- checks: errors=0 warnings=39 notes=42
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended
