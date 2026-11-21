# TASK-db834e2a - PROV-04 DeepSeek, Moonshot AI and Kimi For Coding (#351)

stage: done
type: feature
interaction: autopilot
requirements: REQ-FUNC-1ce2090f, REQ-FUNC-bcb2eae2, REQ-FUNC-81351d20, REQ-FUNC-8e38f83e, REQ-FUNC-19e50545, REQ-REL-67dd99f1, REQ-UX-734fc12d
parent:
branch: ddp/epic-338
base: 55d762ddaa789e24dcedc13b76c81f34a0bb9cde
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

Problem: STATED #351 adds three independent provider connections. OBSERVED the production registry at the recorded base has OpenCode and QwenCloud presets.
Desired outcome: STATED Users can configure, test and select DeepSeek, Moonshot AI international and Kimi For Coding with service-scoped API keys and verified model information.
Actors: STATED VERA desktop users who hold a key for the selected service.
Primary scenario: STATED Choose a service in Settings, use catalog discovery where available or enter a model ID, save the API key, run Test and choose a model for a workbench or chat.
Examples: OBSERVED DeepSeek Flash accepts text and image; V4 Pro accepts text. Moonshot Kimi K3 and Kimi Code kimi-for-coding use distinct service credentials and wire formats.
Counterexamples: STATED A Moonshot key cannot be read from a saved Moonshot slot when configuring Kimi Code. Catalog IDs without a verified profile carry unknown capabilities.
In scope: STATED Exact documented international routes, API keys, typed discovery or manual entry, documented agent model profiles, streaming, tool continuation, authentication errors and cancellation.
Out of scope: STATED Account sign-in, other regional routes, authenticated live requests and paid usage. Existing provider IDs and persisted format version 1 stay authoritative.
Constraints: STATED Reuse #348, pinned pi-ai and four language user-facing material. Work only on ddp/epic-338 at the recorded base. The coordinator owns the authorized local commit and issue closure.
Success signals: STATED Scripted production gateway tests verify fixed routes, credential routing, published input and limits, reasoning and tool results, failed authentication and abort. Focused proof on Windows and Ubuntu WSL2 plus static checks and independent reviews.
Evidence: OBSERVED Ticket #351, epic #347, architecture 04, curated registry, pinned pi-ai 1.1.0 provider implementations and public API docs for each service.
Assumptions: INFERRED VERA can represent the documented text and image modalities with its existing model input contract.
Unknowns: UNKNOWN Live account entitlements and service behavior with authenticated requests under the user ruling.
Decision-blocking questions: None.
Proposed behaviors: None outside the recorded scope.

## Requirement coverage

| Requirement | Behavior | Design |
|---|---|---|
| REQ-FUNC-1ce2090f | Route three provider presets to their registered API | Route and credentials |
| REQ-FUNC-bcb2eae2 | Discover models for DeepSeek and Moonshot AI | Catalog or explicit model |
| REQ-FUNC-81351d20 | Publish verified model capabilities | Exact profiles |
| REQ-FUNC-8e38f83e | Preserve reasoning in provider tool continuations | Protocol adapters |
| REQ-FUNC-19e50545 | Report provider key rejection | Shared auth error |
| REQ-REL-67dd99f1 | Cancel provider inference | Shared cancellation |
| REQ-UX-734fc12d | Offer DeepSeek Moonshot AI and Kimi For Coding in Providers | Shared preset editor |


## Design

**Approach** — Add DeepSeek and international Moonshot AI through the pinned Chat Completions adapter and Kimi For Coding through the pinned Anthropic Messages adapter. Use exact service routes, existing immutable bindings and the stored API key slot (REQ-FUNC-1ce2090f). The Anthropic adapter receives the Kimi key as an x-api-key header and identifies the client as VERA.

**Interfaces and data** — DeepSeek and Moonshot list through their own OpenAI-style model catalogs; Kimi Code offers explicit model IDs (REQ-FUNC-bcb2eae2). A successful catalog limits unsaved choices. Typed catalog metadata and exact profiles disclose supported VERA input types, context and available reasoning. Kimi leaves tool support unverified after probes for unprofiled manual IDs because the service can fall back to a different model. DeepSeek's model-list reference gives exact limits of 1,048,576 and 393,216, while the SDK catalog rounds these. Moonshot K3 keeps its 1,048,576 provider output ceiling visible and uses the standard 16,384 OpenAI-class VERA reservation because reserving the full ceiling would leave no input. Kimi Code offers kimi-for-coding and k3-256k with limits from the service model table and pinned metadata (REQ-FUNC-81351d20).

**Files and test seams** — The shared registry carries bindings and profiles; direct-catalog.ts validates each service's documented listing fields; curated-adapters.ts holds protocol-specific compatibility and reasoning based on pinned adapters. DeepSeek uses the thinking toggle and effort; Moonshot K3 uses reasoning_effort and keeps thinking enabled; Kimi Code uses adaptive Messages thinking and output_config.effort. Each adapter preserves its own streamed reasoning in tool continuation (REQ-FUNC-8e38f83e). The production desktop gateway tests each wire flow with injected Fetch, including image requests, status 401, abort and recovery. DeepSeek probes with thinking disabled. Moonshot K3 and Kimi Code probe with low effort and up to 4096 output tokens to allow a short reasoning pass. The Settings browser spec checks the three fixed-route forms (REQ-UX-734fc12d).

**Risks and open decisions** — The exact POST route is validated before Fetch and redirects are rejected. Auth rejection is localized through the shared authentication error; cancellation stays request-scoped (REQ-FUNC-19e50545, REQ-REL-67dd99f1). No live entitlements were checked. Saved formats stay at 1. Video and file uploads are outside VERA's current text and image model contract.

**Requirement map** — Each requirement's design decision appears in the coverage table.

Diagrams: [diagram_TASK-db834e2a.md](diagram_TASK-db834e2a.md)


## Log

- 2026-11-20 frame: journal opened
- 2026-11-20 frame: DEVIATION validate: authenticated live smoke omitted under RULING-001; public service documentation and scripted VERA gateway tests establish the available proof.
- 2026-11-20 frame: User authorized one local ticket commit after validation. Coordinator owns that commit and issue closure; this session prepares and validates the unstaged candidate only.
- 2026-11-20 frame: completed; next specify
- 2026-11-20 specify: completed; next design
- 2026-11-20 design: completed; next build
- 2026-11-20 build: red: Windows wrapped Vitest direct-provider-presets.test.ts exited 1; seven cases reached provider settings and hit NOT_FOUND for the missing presets. Receipt windows-red.txt.
- 2026-11-20 build: green: Windows wrapped Vitest 8 focused files and 114 tests passed; browser providers-layout passed separately; release notes check exited 0 after merging related provider entries for the category limit.
- 2026-11-20 build: The broad regression exposed a first-pass catalog behavior change in legacy curated fixtures. Catalog selection now uses an explicit opt-in for the two new HTTP catalogs. Review of the shared adapter path also caught an ordering regression in QwenCloud manual max_tokens. Windows 5-file follow-up passed 83 tests with an explicit QwenCloud assertion.
- 2026-11-20 build: completed; next validate
- 2026-11-20 validate: Inspection: DeepSeek List Models gives exact 1048576 context and 393216 output in the example while pinned metadata rounds them. Kimi K3 official quickstart specifies reasoning_effort, max_completion_tokens, base64 vision and complete assistant replays. Kimi Code docs specify the overseas Messages route, Kimi Code Console key, model entitlements and real client identity. Pinned pi-ai 1.1.0 confirms adapter-specific compatibility and the beta streaming route.
- 2026-11-20 validate: Ubuntu WSL2 pinned wrapper and owned source overlay passed 8 Vitest files (114 tests) and 1 Chromium settings test. Affected follow-up after QwenCloud max_tokens assertion passed 5 files (83 tests) on both platforms. Windows direct fixture type-narrowing follow-up passed 7 tests. Receipts windows-vitest-final.txt, windows-browser.txt, ubuntu-wsl2-final.txt, windows-final-regression.txt, ubuntu-wsl2-final-regression.txt and windows-final-direct.txt.
- 2026-11-20 validate: Round 1: Kimi documents implicit fallback for mistyped IDs. A fallback probe must not persist verified capabilities for the entered ID. DeepSeek and Moonshot catalog responses document more than IDs and must retain verified per-model metadata. A successful scoped list controls which unsaved models can be selected.
- 2026-11-20 validate: returned to build - Do not verify Kimi fallback IDs, retain documented catalog metadata and respect scoped model availability
- 2026-11-20 build: Review regressions red: Windows direct preset suite exited 1. The three expected failures reproduced missing discovery metadata, unsaved DeepSeek models after an empty catalog, and persisted Kimi fallback tool support.
- 2026-11-20 build: Review fixes green: Windows 8 focused files and 116 tests, plus the Chromium providers-layout test, exited 0. Rich and sparse list entries, success/empty/unavailable eligibility, and Kimi fallback probe capabilities are covered. Receipts windows-review-vitest.txt and windows-review-browser.txt.
- 2026-11-20 build: completed; next validate
- 2026-11-20 validate: Round 2: Previous findings resolved. Both reviewers found the clean Moonshot editor still compared the published ceiling to its saved budget and disabled Test. Moonshot explicit supports_reasoning false must also project as known absence.
- 2026-11-20 validate: returned to build - Use the effective Moonshot budget for editor Test eligibility and project known absent reasoning
- 2026-11-20 build: Round 2 reds: targeted Windows Vitest failed because supports_reasoning false was undefined. The Chromium fixture first exposed that mockApi created legacy slugs for presets. After fixing the fixture to allocate the production-style slug, the new browser test reached the saved editor and failed exactly because Test was disabled.
- 2026-11-20 build: Round 2 corrected proof: Windows Vitest 9 files and 138 tests passed, and Chromium providers-layout passed both tests including saved Moonshot Test. Explicit false and sparse reasoning metadata are distinguished. Receipts windows-round3-vitest.txt and windows-round3-browser.txt.
- 2026-11-20 build: completed; next validate
- 2026-11-20 validate: Final focused test selection on both Windows and Ubuntu WSL2, with pinned npmw: npx vitest run direct-provider-presets.test.ts qwencloud-presets.test.ts opencode-presets.test.ts provider-presets.test.ts provider-settings.test.ts src/libraries/core/src/llm/gateway.test.ts src/libraries/shared/src/providers.test.ts src/apps/desktop/src/renderer/mocks/mockApi.test.ts tests/tooling/boundaries.test.ts (9 files, 138 passed per host); npm run test:e2e -- providers-layout.spec.ts --browser-only (2 passed per host). All exit 0. Receipts under 05_Software/evaluation-outputs/direct-providers-351: windows-round3-vitest.txt, windows-round3-browser.txt, ubuntu-wsl2-round3.txt.
- 2026-11-20 validate: Round 3 independent specification and implementation-quality reviewers both approved the complete unstaged candidate. Release notes checker exited 0; receipt release-notes-final.txt.
- 2026-11-20 validate: Post-review strict run exited 1. Lint, i18n and help passed; TS rejected the catalog parser return annotation because internal CuratedModel allows readonly arrays and the discovery result uses mutable arrays. No runtime finding. Receipt aegis-typecheck-initial.txt.
- 2026-11-20 validate: returned to build - Use the existing discovery result type for the catalog parser return annotation
- 2026-11-20 build: completed; next validate
- 2026-11-20 validate: Round 4 independent specification and implementation-quality reviewers approved the type-only correction. Focused Windows and WSL2 runtime proof still applies.
- 2026-11-20 validate: Final strict: python .agentic/aegis.py check --task TASK-db834e2a --strict --run exited 0. Lint, typecheck, i18n and help passed. 35 advisories cover historical records, documentation outside configured globs, and colocated tests also classified as source. No errors or promoted warnings. Receipt aegis-strict.txt.
- 2026-11-20 validate: Handover: base 55d762ddaa789e24dcedc13b76c81f34a0bb9cde on ddp/epic-338, empty index and git diff --check exit 0. Owned Ubuntu source overlays removed and Windows browser scratch and helper moved to the Recycle Bin. Receipts retained. The coordinator owns the authorized ticket commit and issue closure.
- 2026-11-20 validate: completed; next done

## Rulings

- RULING-001 | date=2026-11-20 | decision=Ship the three presets with scripted proof and documented configuration; omit authenticated live smoke | reason=No authorized service accounts or paid usage for epic #347 | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-db834e2a.md
changed: Three scoped API-key presets, catalog/profile handling, protocol coverage and localized help
evidence: Windows and Ubuntu WSL2 138 Vitest and 2 Chromium tests each; release notes and strict AEGIS exited 0
issues: Authenticated service smoke omitted under user ruling RULING-001
spec_compliance: approved
implementation_quality: approved
review_round: 4

## Delivery report (2026-11-20)

- stage: validate; type: feature; branch: ddp/epic-338
- requirements:
  - REQ-FUNC-1ce2090f - Route three provider presets to their registered API
  - REQ-FUNC-bcb2eae2 - Discover models for DeepSeek and Moonshot AI
  - REQ-FUNC-81351d20 - Publish verified model capabilities
  - REQ-FUNC-8e38f83e - Preserve reasoning in provider tool continuations
  - REQ-FUNC-19e50545 - Report provider key rejection
  - REQ-REL-67dd99f1 - Cancel provider inference
  - REQ-UX-734fc12d - Offer DeepSeek Moonshot AI and Kimi For Coding in Providers
- deviations: 1 recorded
  - validate: authenticated live smoke omitted under RULING-001; public service documentation and scripted VERA gateway tests establish the available proof.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=4
- diff vs task base 55d762d: 34 file(s) changed, 1279 line(s) added
- checks: errors=0 warnings=35 notes=42
- checklist: 8/9 done; open: `report` appended
