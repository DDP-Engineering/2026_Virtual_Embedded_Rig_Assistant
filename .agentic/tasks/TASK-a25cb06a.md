# TASK-a25cb06a - PROV-03 Integrate QwenCloud Standard and Token Plan (#350)

stage: done
type: feature
interaction: autopilot
requirements: REQ-FUNC-66946db8, REQ-FUNC-e7715b06, REQ-FUNC-0f0cd5cb, REQ-FUNC-93eceb65, REQ-FUNC-b66ae6d7, REQ-REL-10a5e0fb, REQ-FUNC-69f843bf, REQ-FUNC-0e51413d, REQ-FUNC-734a5050, REQ-FUNC-2c4c12cf, REQ-UX-12e9f97f
parent:
branch: ddp/epic-338
base: 755d68524a8d24a1af81d1913ad6ab74492dbcdd
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

Problem: STATED #350 needs two separate international QwenCloud presets. OBSERVED the production registry at the recorded base offers the two OpenCode presets only.
Desired outcome: STATED Standard and Token Plan coexist with fixed routes, scoped API keys, eligible model selection and clear connection diagnostics.
Actors: STATED VERA desktop operator with a QwenCloud pay-as-you-go or Token Plan API key.
Primary scenario: STATED Select the matching preset, enter the key and a model discovered for that connection or explicitly entered, save, test and select the model using the shared VERA workflows.
Examples: STATED Use the exact QwenCloud international bases specified by #350. OBSERVED both plan references document qwen3.8-flash as an example with text and image input and function calling.
Counterexamples: STATED Model Studio and Coding Plan belong to #353. A QwenCloud key must not be tried against another plan on failure.
In scope: STATED Discovery where available, explicit model entry, per-model tools/images/thinking, plan quota vs rate diagnostics, streaming, tool continuation and cancellation proved through VERA.
Out of scope: STATED Alternate regional routes, Model Studio, Coding Plan, paid usage and authenticated live requests. Existing provider IDs/paths and format-1 storage remain authoritative.
Constraints: STATED Use the shared provider registry, saved scope, discovery/test and model references. Four-language settings diagnostics, help and release notes. Use only ddp/epic-338 at base 755d68524a8d24a1af81d1913ad6ab74492dbcdd. Coordinator owns the authorized commit.
Success signals: STATED Scripted calls exercise both exact endpoints with isolated credentials, model-list success and manual fallback, unsupported models, wrong-plan keys, quota and throttling, verified metadata, streaming, tool continuation and abort.
Evidence: OBSERVED Qwen Code authentication docs specify the bases and attempt /models for both. QwenCloud DeepSeek Harness docs describe 401 and 404 when catalog is unavailable. Unauthenticated GET returned 401 on both. Authenticated catalog availability remains unverified. OpenAI Chat, Thinking, Function Calling, model/plan lists and Token Plan FAQ specify the chat fields, capability and diagnostic contracts. Pinned pi-ai 1.1.0 Qwen Token Plan bindings use aliased vendor domains outside this ticket, but its generic Chat Completions adapter captures/replays reasoning_content.
Assumptions: INFERRED A 401 on the catalog route alone is inconclusive; Chat Completions verifies whether the scoped key can actually be used.
Unknowns: UNKNOWN Account model entitlements and authenticated catalog/inference behavior. No authenticated acceptance is available under RULING-001.
Decision-blocking questions: None.
Proposed behaviors: None outside the recorded scope.

## Requirement coverage

| Requirement | Behavior | Design |
|---|---|---|
| REQ-FUNC-66946db8 | Route QwenCloud requests by plan | Route scope |
| REQ-FUNC-e7715b06 | Discover QwenCloud models by connection | Plan-local catalog |
| REQ-FUNC-0f0cd5cb | Allow manual QwenCloud model entry | Manual model |
| REQ-FUNC-93eceb65 | Expose documented QwenCloud model capabilities | Documented profiles |
| REQ-FUNC-b66ae6d7 | Continue QwenCloud tool calls with streamed thinking | SSE continuation |
| REQ-REL-10a5e0fb | Cancel QwenCloud requests | Shared cancellation |
| REQ-FUNC-69f843bf | Explain QwenCloud key failures | Plan authentication |
| REQ-FUNC-0e51413d | Explain QwenCloud model eligibility failures | Model rejection |
| REQ-FUNC-734a5050 | Distinguish Token Plan quota exhaustion | Token Plan quota |
| REQ-FUNC-2c4c12cf | Report QwenCloud rate limits | Rate limits |
| REQ-UX-12e9f97f | Expose both QwenCloud plans in Providers | Searchable presets |


## Design

**Approach** — OBSERVED #348 owns registry, route isolation, scoped credentials and typed discovery. Add two QwenCloud bindings with explicit plan metadata and supported exact routes (REQ-FUNC-66946db8, REQ-UX-12e9f97f). Reuse the existing authenticated catalog cache for both QwenCloud bindings, keeping the OpenCode parser and behavior intact (REQ-FUNC-e7715b06).

**Interfaces and data** — STATED Official Qwen Code attempts /models, and official QwenCloud connection docs describe 401/404 from unavailable listing. A successful list provides model IDs. A QwenCloud catalog 401 or unsupported-route response permits explicit entry and skips reachability. Inference authenticates the chosen plan and checks the saved model (REQ-FUNC-0f0cd5cb). The editor offers discovered IDs on success and documented examples otherwise. The session and workbench catalog offers the saved ID and IDs from the scoped authenticated catalog. A discovery success cannot remove an explicitly saved model. Model IDs with no exact documented profile keep unverified capabilities.

**Files and test seams** — Registry profiles for qwen3.8-flash and qwen3.7-max declare documented text/image input and tools. Their binary thinking options send enable_thinking only for explicit choices. The pinned pi-ai adapter parses reasoning_content and serializes the same-model thinking and tool result back into Chat Completions. The short connection probes select Off on those profiles to leave room for a reply under their existing output cap (REQ-FUNC-93eceb65, REQ-FUNC-b66ae6d7). The production ProviderGateway is driven by scripted Fetch for discovery, test, stream, continuation and cancellation (REQ-REL-10a5e0fb). The existing settings layout spec checks both searchable fixed-route forms.

**Risks and open decisions** — STATED Wrong-plan keys may be rejected locally from the documented Token Plan prefix, and rejected inference keys receive the same plan-key diagnostic. Catalog and inference keep isolated credentials, and credential changes during discovery are checked again before inference. QwenCloud model rejection, Token Plan 429 insufficient_quota, and throttling map to distinct diagnostics without returning raw secrets (REQ-FUNC-69f843bf, REQ-FUNC-0e51413d, REQ-FUNC-734a5050, REQ-FUNC-2c4c12cf). Standard's similarly named TPM rate error remains throttling. UNKNOWN Live entitlements and transport under real user accounts. Format-1 settings remain unchanged.

**Requirement map** — The coverage table maps each requirement to its design decision. The existing credential, redirect and cancellation requirements continue to govern the reused seams.

Diagrams: [diagram_TASK-a25cb06a.md](diagram_TASK-a25cb06a.md)

## Log

- 2026-11-20 frame: journal opened
- 2026-11-20 frame: completed; next specify (7 Done checklist item(s) left unticked)
- 2026-11-20 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-20 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-20 build: red: wrapped npx vitest run src/apps/desktop/src/main/qwencloud-presets.test.ts exit 1: all eight projected cases reach real provider settings and report NOT_FOUND because both presets are absent
- 2026-11-20 build: DEVIATION validate: authenticated QwenCloud smoke waived under RULING-001; official documentation and scripted gateway tests establish the available proof
- 2026-11-20 build: green: Windows wrapped Vitest 7 focused files (106 passed), Chromium providers-layout (1 passed), import-boundary cases included, check:release-notes (0 errors); all exit 0. Receipts in 05_Software/evaluation-outputs/qwencloud-350.
- 2026-11-20 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-20 validate: green: Ubuntu WSL2 pinned wrapper with an owned source overlay and identical lockfile passed the same 7 Vitest files (106 tests) and Chromium providers-layout (1 test), both exit 0. Receipt: 05_Software/evaluation-outputs/qwencloud-350/ubuntu-wsl2.txt.
- 2026-11-20 validate: Inspection: exact routes and conditional GET /models in Qwen Code authentication; unavailable 401/404 in QwenCloud DeepSeek Harness docs; model input/tools/limits in QwenCloud text generation and plan lists; enable_thinking and reasoning_content in QwenCloud OpenAI Chat/Thinking; quota code in Token Plan FAQ. Installed pi-ai 1.1.0 Qwen metadata corroborates model identity and generic adapter serialization; its provider route points at a separate service. Public GET without Authorization was HTTP 401 on both routes and established no entitlement.
- 2026-11-20 validate: Review 1: classify QwenCloud's documented model permission and activation errors, clarify that unauthenticated 401 leaves catalog availability unverified, and ensure a superseded same-key catalog response uses the newer published snapshot before model dispatch.
- 2026-11-20 validate: returned to build - Address both independent review findings
- 2026-11-20 build: red review regressions: Windows wrapped Vitest qwencloud-presets.test.ts -t superseded|separates exit 1. Three failures confirm obsolete catalog dispatch and misclassified documented access errors.
- 2026-11-20 build: Inspection: QwenCloud Thinking calls Qwen3.7 Plus hybrid, while QwenCloud Error messages gives it as a thinking-only example. Use Qwen3.8 Flash for the documented vision/hybrid profile on both plans. Its model docs, plan lists and the pinned metadata agree. Qwen3.7 Plus remains available where its ID is listed or explicitly configured with unverified VERA profile information.
- 2026-11-20 build: green review regression: Windows wrapped Vitest qwencloud-presets and opencode-presets 17 passed, exit 0. Covered model permissions and activation, stale same-key refresh and retained OpenCode behavior.
- 2026-11-20 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-20 validate: green review regression: Ubuntu WSL2 wrapped Vitest qwencloud-presets and opencode-presets 17 passed, Chromium providers-layout 1 passed, both exit 0. Receipts: windows-review.txt and ubuntu-wsl2-review.txt.
- 2026-11-20 validate: Independent specification and implementation-quality reviewers approved the complete unstaged candidate in round 2. The documented model errors and superseded catalog dispatch are covered by focused regressions.
- 2026-11-20 validate: strict pre-final: exit 1. Windows lint, i18n and help passed; typecheck exit 2 reports TS2550 for Promise.withResolvers in three test-only call sites. Update the test to the repository-compatible deferred pattern. Also update prior AEGIS paths to the renamed shared catalog cache.
- 2026-11-20 validate: returned to build - Correct test typecheck and reconcile renamed catalog cache traceability
- 2026-11-20 build: green test portability correction: Windows wrapped Vitest qwencloud-presets.test.ts 10 passed, exit 0. Static typecheck will rerun in final strict proof.
- 2026-11-20 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-20 validate: green test portability correction: Ubuntu WSL2 wrapped Vitest qwencloud-presets.test.ts 10 passed, exit 0. Windows and WSL2 receipts end in final-qwencloud.txt.
- 2026-11-20 validate: Independent specification and implementation-quality reviewers approved the fixture portability correction and requirement path updates in round 3.
- 2026-11-20 validate: final: python .agentic/aegis.py check --task TASK-a25cb06a --strict --run exit 0. Lint, typecheck, i18n and help passed. 34 advisory warnings cover pre-existing records, help/release notes/changelog outside layout globs and a colocated test also classified as source. No errors or promoted warnings. Receipt: 05_Software/evaluation-outputs/qwencloud-350/aegis-strict.txt.
- 2026-11-20 validate: Handover: verified base 755d68524a8d24a1af81d1913ad6ab74492dbcdd on ddp/epic-338 and an empty index. git diff --check exit 0. Removed owned WSL2 overlays and helper files; retained original receipts. Coordinator owns the authorized local commit and issue closure.
- 2026-11-20 validate: completed; next done

## Rulings

- RULING-001 | date=2026-11-20 | decision=Ship both presets with scripted proof and documented configuration; omit authenticated live service smoke | reason=User confirmed no authorized service accounts or paid usage for epic #347 | source=user | supersedes=none
- RULING-002 | date=2026-11-20 | decision=Coordinator may make one local ticket commit after verification; implementation leaves the candidate unstaged | reason=Delegated ticket uses the sole assigned checkout at the recorded base | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-a25cb06a.md
changed: International QwenCloud Standard and Token Plan preset candidate
evidence: Strict AEGIS exit 0. Windows and Ubuntu WSL2 each passed 106 focused tests, 17 review regression tests and the final 10-case QwenCloud rerun plus Chromium settings. Release notes passed.
issues: Authenticated QwenCloud smoke waived by user under RULING-001.
spec_compliance: approved
implementation_quality: approved
review_round: 3

## Delivery report (2026-11-20)

- stage: validate; type: feature; branch: ddp/epic-338
- requirements:
  - REQ-FUNC-66946db8 - Route QwenCloud requests by plan
  - REQ-FUNC-e7715b06 - Discover QwenCloud models by connection
  - REQ-FUNC-0f0cd5cb - Allow manual QwenCloud model entry
  - REQ-FUNC-93eceb65 - Expose documented QwenCloud model capabilities
  - REQ-FUNC-b66ae6d7 - Continue QwenCloud tool calls with streamed thinking
  - REQ-REL-10a5e0fb - Cancel QwenCloud requests
  - REQ-FUNC-69f843bf - Explain QwenCloud key failures
  - REQ-FUNC-0e51413d - Explain QwenCloud model eligibility failures
  - REQ-FUNC-734a5050 - Distinguish Token Plan quota exhaustion
  - REQ-FUNC-2c4c12cf - Report QwenCloud rate limits
  - REQ-UX-12e9f97f - Expose both QwenCloud plans in Providers
- deviations: 1 recorded
  - validate: authenticated QwenCloud smoke waived under RULING-001; official documentation and scripted gateway tests establish the available proof
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=3
- diff vs task base 755d685: 41 file(s) changed, 1153 line(s) added
- checks: errors=0 warnings=34 notes=42
- checklist: 9/9 done
