# TASK-35af2ea8 - PROV-07 Add Fireworks AI, Together AI, Groq and Cerebras hosted inference presets (#354)

stage: done
type: feature
interaction: autopilot
requirements: REQ-DATA-4b2972de, REQ-SEC-c8d0ae29, REQ-SEC-ba662d06, REQ-SEC-1f2e8558, REQ-REL-8acab0c0, REQ-FUNC-efa9e25e, REQ-FUNC-c0a762cd, REQ-FUNC-6df147f9, REQ-FUNC-e350ebc5, REQ-FUNC-5d93e37f, REQ-UX-2d03ef7f, REQ-FUNC-da954efa, REQ-REL-2ee08eaf, REQ-REL-85cb47d5, REQ-REL-1bfbce29
parent:
branch: ddp/epic-338
base: ff44a6213b930bfcb2f958a994cfd9b519c2c885
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

Problem: STATED Gitea #354 requests four hosted inference connections. OBSERVED The base registry has no presets for these services.
Desired outcome: STATED Fireworks AI, Together AI, Groq and Cerebras are selectable and usable through the curated provider workflow.
Actors: STATED VERA users with a service API key.
Primary scenario: STATED Add a preset, discover a model or enter its full ID, save, test, and stream a tool-enabled turn.
Examples: OBSERVED Fireworks uses account-qualified model IDs and a separate catalog route. Together and Groq use slash-qualified IDs.
Counterexamples: STATED Opening or editing another preset does not retarget a stored key. Sparse metadata does not authorize tool or image claims.
In scope: STATED Registry, fixed API-key routes, catalog normalization, explicit model IDs, documented capabilities, existing streaming/tool/cancellation/error handling, help and release notes.
Out of scope: STATED Other provider IDs/routes, schema migrations, service account access and paid calls.
Constraints: STATED Format 1. Work only on ddp/epic-338 at ff44a6213b930bfcb2f958a994cfd9b519c2c885. The coordinator owns the authorized local ticket commit and issue closure.
Success signals: STATED Four coexisting presets, exact endpoints and isolated keys, complete scripted tool round trip, cancellation and error coverage for each, focused Windows and Ubuntu WSL2 proof and two independent reviews.
Evidence: OBSERVED Gitea #354 and #347, provider architecture, official API references and installed pi-ai 1.1.0 provider definitions.
Assumptions: INFERRED Exact public model profiles supplement sparse catalog rows; model availability is determined by the service and selected account.
Unknowns: UNKNOWN Authenticated service behavior and account-specific entitlements.
Decision-blocking questions: None.
Proposed behaviors: None.

## Requirement coverage

| Requirement | Behavior | Design | Verification |
|---|---|---|---|
| REQ-FUNC-6df147f9 | Connect to the four hosted inference services | provider-presets.ts, providers.ts, curated-adapters.ts | Scripted desktop gateway |
| REQ-FUNC-e350ebc5 | Normalize hosted model discovery | provider-presets.ts, hosted-catalog.ts, preset-connection.ts | Scripted desktop gateway |
| REQ-FUNC-5d93e37f | Show supported hosted model capabilities | provider-presets.ts, hosted-catalog.ts, preset-catalog-cache.ts, providers.ts | Scripted desktop gateway |
| REQ-UX-2d03ef7f | Offer manual model IDs for hosted inference | provider-presets.ts, providers.ts, custom-provider-editor.tsx | Settings and scripted desktop gateway |
| REQ-FUNC-da954efa | Continue hosted model tool calls | providers.ts, curated-adapters.ts | Scripted desktop gateway |
| REQ-REL-2ee08eaf | Report hosted authentication failures | preset-connection.ts, providers.ts | Scripted desktop gateway |
| REQ-REL-85cb47d5 | Report hosted rate limits | preset-connection.ts, providers.ts | Scripted desktop gateway |
| REQ-REL-1bfbce29 | Reject invalid hosted catalogs | hosted-catalog.ts, preset-connection.ts | Scripted desktop gateway |
| REQ-DATA-4b2972de | Save four independent hosted connections | Existing shared curated workflow | Scripted desktop gateway |
| REQ-SEC-c8d0ae29 | Scope each key to its configured routes | Existing shared curated workflow | Scripted desktop gateway |
| REQ-SEC-ba662d06 | Refuse redirected hosted requests | Existing shared curated workflow | Scripted desktop gateway |
| REQ-SEC-1f2e8558 | Keep hosted credentials out of public outputs | Existing shared curated workflow | Scripted desktop gateway |
| REQ-REL-8acab0c0 | Abort hosted requests on cancellation | Existing shared curated workflow | Scripted desktop gateway |
| REQ-FUNC-efa9e25e | Use typed discovery results | Existing shared curated workflow | Scripted desktop gateway |
| REQ-FUNC-c0a762cd | Test the saved hosted model | Existing shared curated workflow | Scripted desktop gateway |


## Design

**Approach.** Register four fixed bindings using the shared OpenAI Completions adapter and curated settings workflow (REQ-FUNC-6df147f9, REQ-UX-2d03ef7f). The editor's current searchable registry, model field and discovery actions handle the new services.

**Interfaces and data.** Select a hosted parser by registry metadata (REQ-FUNC-e350ebc5). Fireworks follows at most 20 pages with a single discovery timeout and a fixed origin and path. Its cursor is opaque query data. Catalog identity errors fail discovery (REQ-REL-1bfbce29). Project only documented fields and merge exact-ID profiles for missing data (REQ-FUNC-5d93e37f). Existing fixtures, credential scopes and format-1 records need no change.

**Files and test seams.** Register bindings in shared, add hosted-catalog.ts, and route the existing preset discovery and cached model projection through it. Adapt documented token fields and streaming options in curated-adapters.ts. Script main's real settings and gateway (REQ-FUNC-da954efa, REQ-REL-2ee08eaf, REQ-REL-85cb47d5), plus a Chromium Settings regression (REQ-UX-2d03ef7f).

**Risks and open decisions.** A catalog can be available to a key without listing its dedicated deployment. The saved model remains selectable. Sparse listing data does not establish capabilities. Account-dependent behavior remains unknown under RULING-001.

**Requirement map.** See Requirement coverage for the route, model, trust-boundary and test seams.
Diagrams: [diagram_TASK-35af2ea8.md](diagram_TASK-35af2ea8.md)


## Log

- 2026-11-20 frame: journal opened
- 2026-11-20 frame: DEVIATION validate: authenticated live smoke waived under RULING-001; use official docs and scripted tests.
- 2026-11-20 frame: The user authorized one local ticket commit after validation. The coordinator owns the local commit and issue closure; this candidate is handed back unstaged.
- 2026-11-20 frame: completed; next specify
- 2026-11-20 specify: completed; next design
- 2026-11-20 design: completed; next build
- 2026-11-20 build: red: Windows pinned npmw.py npx vitest run hosted-provider-presets.test.ts exit 1; all 18 cases fail for missing registry IDs (windows-red.txt).
- 2026-11-20 build: Initial gateway suite passed 17 of 18; corrected the Groq live-limit oracle to distinguish the configured reservation from the provider maximum. See windows-vitest-build.txt.
- 2026-11-20 build: Green: pinned npx vitest run hosted-provider-presets.test.ts provider-presets.test.ts provider-settings.test.ts direct-provider-presets.test.ts regional-provider-presets.test.ts qwencloud-presets.test.ts opencode-presets.test.ts international-plan-presets.test.ts src/libraries/core/src/llm/gateway.test.ts src/libraries/shared/src/providers.test.ts tests/tooling/boundaries.test.ts exited 0 on Windows and Ubuntu WSL2: 173 tests in 11 files per platform. Receipts windows-vitest.txt and ubuntu-wsl2-vitest.txt.
- 2026-11-20 build: Pinned npm run test:e2e -- providers-layout.spec.ts --browser-only exited 0 on Windows and Ubuntu WSL2: four Chromium tests per platform. Receipts windows-browser.txt and ubuntu-wsl2-browser.txt.
- 2026-11-20 build: Cerebras publishes account-tier-dependent token limits. Use configured budgets. Hosted profiles with documented reasoning get a bounded 4096-token connection test; runtime leaves provider reasoning defaults in place. Added empty-catalog coverage. The affected hosted-provider-presets.test.ts run exited 0 on each platform (18 tests); windows-hosted.txt and ubuntu-wsl2-hosted.txt. Reused the unchanged surrounding regression proof. The overlay dependency lock matches the Windows checkout and the pinned Ubuntu seed byte for byte.
- 2026-11-20 build: completed; next validate
- 2026-11-20 validate: Round 1 spec findings: preserve broad rollout wording in capped release notes and add exact documented Together Qwen3.5 and Groq GPT-OSS 20B model capabilities. Quality findings: use native reasoning fixture fields and keep hosted tool capability unknown without catalog or exact-model evidence.
- 2026-11-20 validate: returned to build - Resolve both independent review findings
- 2026-11-20 build: Review fix red: Windows pinned npx vitest run hosted-provider-presets.test.ts exited 1 for the two missing capability profiles and unsupported stored tool flag. Native continuation field assertions passed on the pinned adapter. Receipt windows-review1-red.txt.
- 2026-11-20 build: Review fixes: preserve the broader rollout in the localized release note, add exact documented Groq and Together profiles, replay native reasoning fields and disregard unsupported settings flags for hosted models. Pinned npx vitest run hosted-provider-presets.test.ts direct-provider-presets.test.ts regional-provider-presets.test.ts international-plan-presets.test.ts src/libraries/core/src/llm/gateway.test.ts exited 0 (114 tests per platform); windows-review1-vitest.txt and ubuntu-wsl2-review1-vitest.txt. Pinned npm run check:release-notes exited 0 (windows-release-notes.txt).
- 2026-11-20 build: completed; next validate
- 2026-11-20 validate: Round 2 independent specification and implementation quality reviews both approved the candidate. The reviewers inspected the native continuation assertions, stored-flag protection, documented model profiles and original platform receipts. No remaining findings.
- 2026-11-20 validate: Final python .agentic/aegis.py check --task TASK-35af2ea8 --strict --run --full exited 0. Lint, TypeScript, i18n and help passed. The 35 advisory warnings concern existing requirement/journal records, docs outside configured globs and two colocated test artifacts classified as source. Receipt aegis-strict.txt.
- 2026-11-20 validate: Verified the complete candidate remains on ddp/epic-338 at ff44a6213b930bfcb2f958a994cfd9b519c2c885 with an empty index and clean git diff --check. Trashed the owned WSL2 source/dependency-link overlay and removed Windows overlay manifests and launchers. Original receipts retained.
- 2026-11-20 validate: completed; next done

## Rulings

- RULING-001 | date=2026-11-20 | decision=Ship with documented configuration and scripted VERA proof; omit authenticated live smoke | reason=No authorized service accounts or paid usage for epic #347 | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-35af2ea8.md
changed: Four hosted inference presets with discovery, manual model IDs and scoped credentials
evidence: 114 affected Vitest tests and four Chromium tests per platform. Strict AEGIS and release notes passed.
issues: Authenticated live smoke and account eligibility remain unverified under RULING-001.
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-20)

- stage: validate; type: feature; branch: ddp/epic-338
- requirements:
  - REQ-DATA-4b2972de - Store independent curated provider connections
  - REQ-SEC-c8d0ae29 - Bind curated keys to the connection and service routes
  - REQ-SEC-ba662d06 - Refuse redirected curated provider requests
  - REQ-SEC-1f2e8558 - Keep curated credentials out of public provider output
  - REQ-REL-8acab0c0 - Cancel curated provider requests
  - REQ-FUNC-efa9e25e - Return a typed curated model discovery outcome
  - REQ-FUNC-c0a762cd - Test curated connections on their saved model
  - REQ-FUNC-6df147f9 - Connect to the four hosted inference services
  - REQ-FUNC-e350ebc5 - Normalize hosted model discovery
  - REQ-FUNC-5d93e37f - Show supported hosted model capabilities
  - REQ-UX-2d03ef7f - Offer manual model IDs for hosted inference
  - REQ-FUNC-da954efa - Continue hosted model tool calls
  - REQ-REL-2ee08eaf - Report hosted authentication failures
  - REQ-REL-85cb47d5 - Report hosted rate limits
  - REQ-REL-1bfbce29 - Reject invalid hosted catalogs
- deviations: 1 recorded
  - validate: authenticated live smoke waived under RULING-001; use official docs and scripted tests.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base ff44a62: 31 file(s) changed, 1264 line(s) added
- checks: errors=0 warnings=35 notes=42
- checklist: 8/9 done; open: `report` appended
