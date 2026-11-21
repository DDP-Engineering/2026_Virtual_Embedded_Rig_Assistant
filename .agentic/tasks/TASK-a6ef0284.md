# TASK-a6ef0284 - PROV-06 Integrate Alibaba Cloud Model Studio and Xiaomi MiMo connections (#353)

stage: done
type: feature
interaction: autopilot
requirements: REQ-FUNC-f53d27f7, REQ-SEC-7cc5c9f3, REQ-SEC-4f76c27c, REQ-SEC-1d09f194, REQ-REL-c9642139, REQ-FUNC-4700a0c1, REQ-REL-18b1b62a, REQ-FUNC-8399bb8a, REQ-REL-428b168f, REQ-UX-0b794502, REQ-REL-24a63047, REQ-FUNC-0c80c03f
parent:
branch: ddp/epic-338
base: 70fa703a8b417963d1c86a06e9f97d685a02dcd4
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

Problem: STATED #353 requests Alibaba Cloud and Xiaomi connections through the shared provider workflow. OBSERVED The base registry exposes neither service.
Desired outcome: STATED Select Model Studio, Coding Plan, MiMo API or MiMo Token Plan, with region/workspace-locked routes, credentials, selection and setup errors.
Actors: STATED VERA users with existing Alibaba Cloud or Xiaomi accounts.
Primary scenario: STATED Choose a plan and region, enter the matching workspace and key, select a chat model, save, test and stream a tool-enabled turn.
Examples: OBSERVED Singapore Model Studio uses a console workspace ID. MiMo Token Plan has documented China, Singapore and Europe clusters.
Counterexamples: STATED A changed workspace, invalid domain label, cross-plan URL or a redirect cannot reuse a key elsewhere. Alibaba aliases cannot select QwenCloud.
In scope: STATED Four curated presets, official routes, catalog/manual selection, secure storage, connection test, localized UI/help/release notes and scripted streaming/tool continuation.
Out of scope: STATED Earlier provider routes/IDs, schema migration, authenticated service requests, credentials access and paid usage.
Constraints: STATED Format 1. Use ddp/epic-338 at 70fa703a8b417963d1c86a06e9f97d685a02dcd4. Coordinator owns the authorized local commit and issue closure.
Success signals: STATED Exact routes and isolated slots including workspace, explicit invalid workspace/region/auth/model errors, full scripted streaming and tool round trip per binding, Windows and Ubuntu WSL2 focused proof and both reviews.
Evidence: OBSERVED Ticket and epic from tea, architecture/04-llm-providers.md, registry and pinned pi-ai 1.1.0, official Alibaba and Xiaomi documentation (see spec).
Assumptions: INFERRED Use documented current workspace Chat Completions addresses and a catalog only where the chosen plan/region documents it.
Unknowns: UNKNOWN Account-specific model entitlements, key validity and service behavior without an authorized account.
Decision-blocking questions: None.
Proposed behaviors: None.

## Requirement coverage

| Requirement | Behavior | Design | Verification |
|---|---|---|---|
| REQ-FUNC-f53d27f7 | Use the documented Alibaba and Xiaomi inference endpoints | provider-presets.ts, preset-connection.ts, providers.ts | Regional gateway fixture |
| REQ-SEC-7cc5c9f3 | Scope Alibaba and Xiaomi credentials to the saved binding | provider-presets.ts, preset-connection.ts, providers.ts, provider-settings.ts, provider-gateway.ts | Regional gateway fixture |
| REQ-SEC-4f76c27c | Reject invalid Model Studio workspace IDs | provider-presets.ts, preset-connection.ts, provider-gateway.ts | Regional gateway fixture |
| REQ-SEC-1d09f194 | Reject mismatched provider routes | provider-presets.ts, preset-connection.ts, provider-settings.ts, provider-gateway.ts | Regional gateway fixture |
| REQ-REL-c9642139 | Diagnose credentials rejected by the selected account scope | provider-presets.ts, preset-connection.ts, providers.ts, errors.ts, provider-settings.ts | Regional gateway fixture |
| REQ-FUNC-4700a0c1 | Offer scoped Alibaba and Xiaomi model selection | provider-presets.ts, preset-connection.ts, providers.ts, provider-gateway.ts | Regional gateway fixture |
| REQ-REL-18b1b62a | Report unavailable models on scoped routes | providers.ts, errors.ts | Regional gateway fixture |
| REQ-FUNC-8399bb8a | Continue Alibaba and Xiaomi streamed tool calls | provider-presets.ts, providers.ts | Regional gateway fixture |
| REQ-REL-428b168f | Cancel Alibaba and Xiaomi inference | providers.ts | Regional gateway fixture |
| REQ-UX-0b794502 | Show Alibaba and Xiaomi plan and region controls | provider-presets.ts, custom-provider-editor.tsx | Chromium provider layout |
| REQ-REL-24a63047 | Distinguish a well-formed unknown workspace from a model error | preset-connection.ts, providers.ts, errors.ts, error-message.tsx | Regional gateway fixture |
| REQ-FUNC-0c80c03f | Test Qwen3.7 Plus using the approved thinking mode and probe budget | provider-presets.ts, provider-gateway.ts, providers.ts, connection.ts | Regional gateway fixture |


## Design

**Approach.** Resolve a workspace template using a validated DNS label and fixed regional suffix on both sides of IPC. Main re-resolves against the shared registry before reading a key or reaching the network (REQ-FUNC-f53d27f7, REQ-SEC-4f76c27c, REQ-SEC-1d09f194).

**Interfaces and data.** Extend the strict format-1 preset selection with an optional workspace ID, required only for Model Studio. Saved scope is immutable. Reuse the existing slot hash, which includes the derived inference and catalog URLs (REQ-SEC-7cc5c9f3). Keys are opaque beyond the documented plan prefixes. Auth, workspace and model diagnostics stay on the selected binding (REQ-REL-c9642139, REQ-REL-18b1b62a, REQ-REL-24a63047).

**Files and test seams.** Registry, resolver and main settings/discovery implement scope. Existing catalog cache and gateway supply choices, connection testing, pinned fetch and adapter continuation (REQ-FUNC-4700a0c1, REQ-FUNC-8399bb8a, REQ-REL-428b168f). The Coding Plan probe uses thinking on and a bounded token budget (REQ-FUNC-0c80c03f). Editor renders localized workspace and region controls (REQ-UX-0b794502). Desktop injected transport and Chromium verify the workflow.

**Risks and open decisions.** Workspace data is interpolation input, so validate it before constructing any host. Existing registry bindings and digests retain the prior contract. Account-specific eligibility remains unknown and surfaces as a scoped service error. No authenticated calls under RULING-001.

**Requirement map.** Each decision and its affected files are listed above and in the coverage table.
Diagrams: [diagram_TASK-a6ef0284.md](diagram_TASK-a6ef0284.md)


## Log

- 2026-11-20 frame: journal opened
- 2026-11-20 frame: DEVIATION validate: authenticated live smoke waived under RULING-001; use official docs and scripted tests.
- 2026-11-20 frame: The user authorized one local ticket commit after validation; the coordinator owns that commit and Gitea closure. This implementation leaves the candidate unstaged.
- 2026-11-20 frame: completed; next specify
- 2026-11-20 specify: completed; next design
- 2026-11-20 design: completed; next build
- 2026-11-20 build: red: Windows npmw.py npx vitest run regional-provider-presets.test.ts exit 1, 25 expected failures: the registry and workspace schema do not support the four presets. Receipt windows-red.txt.
- 2026-11-20 build: green: Windows pinned Vitest focused gateway/configuration/boundaries command exited 0 (154 tests); affected schema follow-up exited 0 (39 tests). Receipts windows-vitest.txt and windows-schema-final.txt.
- 2026-11-20 build: Browser regression: initial Windows provider layout run passed the new editor but found a stale count of presets in the original layout test. Updated the count from 15 to 19. All four provider editor tests then passed, plus the affected editor test after explicit locale references. Receipts windows-browser.txt, windows-browser-final.txt and windows-browser-affected.txt.
- 2026-11-20 build: Release-notes checker passed after merging the related provider entries within the ten-new-entry limit; release-notes-final.txt.
- 2026-11-20 build: Reviewed evolution and git diff --check against the recorded base. Advisory warnings include prior records and help, release-notes and AEGIS proof files outside layout globs.
- 2026-11-20 build: completed; next validate
- 2026-11-20 validate: Focused Ubuntu WSL2 proof passed with pinned Node 24.21.0 and dependencies and an owned native source overlay. Vitest: 154 tests in 10 files including import boundaries. Chromium: four provider layout tests under xvfb-run. Receipts ubuntu-wsl2-vitest.txt and ubuntu-wsl2-browser.txt.
- 2026-11-20 validate: Inspection of primary provider references and installed pi-ai 1.1.0 confirms exact regional and plan hosts, bearer scopes, model IDs and Chat Completions. Registry metadata and the pinned adapter substantiate MiMo token limits and reasoning-content replay. Account-specific model entitlements remain unverified under RULING-001.
- 2026-11-20 validate: Review round 1 found that Coding Plan probes can request documented unsupported thinking-off for qwen3.7-plus, the plan output ceiling should use its integration guide, and a remote WorkSpaceNotFound must be distinguished from a catalog or model failure. Spec also requested localized Alibaba Coding Plan usage disclosure.
- 2026-11-20 validate: returned to build - Correct Coding Plan reasoning and budget, document eligibility, and surface workspace-not-found on both routes
- 2026-11-20 build: Round 1 review red: Windows npx vitest run regional-provider-presets.test.ts -t coding-plan|missing workspace exited 1 for the false thinking probe and misclassified workspace catalog 404. Receipt windows-review-red.txt.
- 2026-11-20 build: Round 1 fixes green on Windows and Ubuntu WSL2. Pinned npmw.py npx vitest run regional-provider-presets.test.ts international-plan-presets.test.ts direct-provider-presets.test.ts qwencloud-presets.test.ts opencode-presets.test.ts provider-presets.test.ts provider-settings.test.ts src/libraries/core/src/llm/gateway.test.ts exited 0 with 137 tests each. Coding Plan probes enforce thinking on/4096 with a conservative 65536 model output budget. Missing workspaces are diagnosed before generic catalog/model handling. Receipts windows-review.txt and ubuntu-wsl2-review.txt.
- 2026-11-20 build: completed; next validate
- 2026-11-20 validate: Exact baseline selectors on Windows and Ubuntu WSL2 from 05_Software: pinned npmw.py npx vitest run regional-provider-presets.test.ts international-plan-presets.test.ts direct-provider-presets.test.ts qwencloud-presets.test.ts opencode-presets.test.ts provider-presets.test.ts provider-settings.test.ts src/libraries/core/src/llm/gateway.test.ts src/libraries/shared/src/providers.test.ts tests/tooling/boundaries.test.ts. Browser on both: pinned npmw.py npm run test:e2e -- providers-layout.spec.ts --browser-only, under xvfb-run -a in WSL2. Original receipts windows-vitest.txt, ubuntu-wsl2-vitest.txt, windows-browser-final.txt and ubuntu-wsl2-browser.txt. Shared schema follow-up: npx vitest run regional-provider-presets.test.ts src/libraries/shared/src/providers.test.ts provider-settings.test.ts on Windows and inclusion in the complete focused WSL2 command.
- 2026-11-20 validate: Changelog and four-language notes/help reviewed. Model Studio in Virginia offers explicit entry because the provider lists its inference host without an explicit native catalog URL. Other Model Studio regions use a bounded first page, while any enabled exact model ID can be saved. Xiaomi Token Plan and Alibaba Coding Plan usage restrictions are documented in the localized help.
- 2026-11-20 validate: Review round 2 approved specification and found that testConnection options still typed only off and low, while Coding Plan passes on.
- 2026-11-20 validate: returned to build - Add the supported on mode to the connection probe options type
- 2026-11-20 build: Round 2 review red: pinned npm run typecheck exited 2 with TS2345 at ProviderGateway.test on the on reasoning option. Receipt windows-probe-type-red.txt.
- 2026-11-20 build: Round 2 fix green: pinned npm run typecheck exited 0; receipt windows-probe-type-green.txt. Connection.ts only extends the erased options type, so reuse the 137-test Windows and Ubuntu WSL2 runtime proof.
- 2026-11-20 build: completed; next validate
- 2026-11-20 validate: Independent round 3 specification and implementation quality reviews both approved the complete candidate. No remaining findings. Verified branch ddp/epic-338 at recorded base, empty index, and clean git diff --check. Returned owned Windows test scratch to the Recycle Bin and the native WSL2 source overlay to trash. Original receipts retained.
- 2026-11-20 validate: Final python .agentic/aegis.py check --task TASK-a6ef0284 --strict --run exited 0. Lint, TypeScript, i18n and help passed. The 34 unpromoted warnings concern historical requirement/journal records, docs outside layout globs and the colocated gateway test also classified as source. No errors. Receipt aegis-strict.txt.
- 2026-11-20 validate: completed; next done

## Rulings

- RULING-001 | date=2026-11-20 | decision=Ship with documented configuration and scripted VERA proof; omit authenticated live smoke | reason=No authorized service accounts or paid usage for epic #347 | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-a6ef0284.md
changed: Four Alibaba Cloud and Xiaomi MiMo presets with 11 scoped bindings, localized setup and diagnostics
evidence: 137 post-fix focused Vitest tests and four Chromium provider tests passed per platform. Strict AEGIS and release notes passed.
issues: Authenticated live smoke and account eligibility remain unverified under user ruling RULING-001.
spec_compliance: approved
implementation_quality: approved
review_round: 3

## Delivery report (2026-11-20)

- stage: validate; type: feature; branch: ddp/epic-338
- requirements:
  - REQ-FUNC-f53d27f7 - Use the documented Alibaba and Xiaomi inference endpoints
  - REQ-SEC-7cc5c9f3 - Scope Alibaba and Xiaomi credentials to the saved binding
  - REQ-SEC-4f76c27c - Reject invalid Model Studio workspace IDs
  - REQ-SEC-1d09f194 - Reject mismatched provider routes
  - REQ-REL-c9642139 - Diagnose credentials rejected by the selected account scope
  - REQ-FUNC-4700a0c1 - Offer scoped Alibaba and Xiaomi model selection
  - REQ-REL-18b1b62a - Report unavailable models on scoped routes
  - REQ-FUNC-8399bb8a - Continue Alibaba and Xiaomi streamed tool calls
  - REQ-REL-428b168f - Cancel Alibaba and Xiaomi inference
  - REQ-UX-0b794502 - Show Alibaba and Xiaomi plan and region controls
  - REQ-REL-24a63047 - Report an unavailable Model Studio workspace
  - REQ-FUNC-0c80c03f - Probe Qwen3.7 Plus in Coding Plan thinking mode
- deviations: 1 recorded
  - validate: authenticated live smoke waived under RULING-001; use official docs and scripted tests.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=3
- diff vs task base 70fa703: 43 file(s) changed, 1458 line(s) added
- checks: errors=0 warnings=34 notes=42
- checklist: 8/9 done; open: `report` appended
