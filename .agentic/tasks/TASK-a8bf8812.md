# TASK-a8bf8812 - BYP-03 Application data exclusion and explicit Bypass confirmation (#308)

stage: done
type: change
path: full
interaction: autopilot
requirements: REQ-SEC-3856567c, REQ-FUNC-6d5e514a, REQ-UX-33b9d601, REQ-UX-bb147586, REQ-UX-12185f60
parent:
branch: master
base: bc684338e7f3444d446e56d5487717c1b5e59e49
opened: 2026-11-16

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

Problem: STATED #308: wider Bypass must refuse application data and clearly communicate authority.
Desired outcome: STATED application data is refused in every mode; explicit confirmation precedes each Bypass change.
Actors: STATED agent tools and users of the session/workbench mode picker.
Primary scenario: STATED choosing Bypass then attempting to read or write settings, credentials or installed plugins.
Examples: STATED Bypass read/write application data returns a clear refusal; cancel leaves Ask selected.
Counterexamples: STATED normal VERA settings/plugin loading and workbench-owned storage retain their locations and authority.
In scope: STATED #308 guard, host composition, prompt, picker, four-language Permissions help and supporting proof/records. Coordinator-owned uncommitted bypass plan and inventory are included in candidate review.
Out of scope: STATED #309/#310 widening of program cwd and remaining tools; commit/stage/push; full suites.
Constraints: STATED shared master, sequential implementation, autopilot; coordinator owns authorized local commit after handback. OBSERVED HEAD/base bc684338e7f3444d446e56d5487717c1b5e59e49 and origin/HEAD master. Preserve untracked src/bundled-plugins and PERF task. Formats stay 1; no compatibility.
Success signals: STATED Done A actual Bypass read/write refusal; Done B one confirmation each change and cancellation preserves mode; focused regressions and both independent reviews.
Evidence: OBSERVED tea issues 308/307, plan/bypass.md, verification-policy.md, PathGuard/tool context/picker source; desktop index.ts and CLI run.ts already pass userData as managedRoots.
Assumptions: INFERRED existing canonical guard is the appropriate shared boundary; internal service callers retain unrestricted host-owned storage authority.
Unknowns: Native Ubuntu availability is not established; Windows and relevant WSL evidence will be distinguished.
Decision-blocking questions: None; coordinator explicitly deferred app and official-plugin full suites and authorized focused plugin-system cases.
Proposed behaviors: None unaccepted.
Path and reason: Full; changes observable consent and data handling.

| Quick criterion | Holds | Evidence |
|---|---|---|
| No new observable behavior | no | STATED per-change consent |
| No new interface/data format | no | STATED confirmation actions |
| No new dependency | yes | INFERRED existing guard/dialog seams |
| Existing requirement fully covers | no | OBSERVED suppressible notice contract |
| No security/data handling change | no | STATED deny reads of app data |

## Requirement coverage

| Behavior | Requirement | Design | Proof |
|---|---|---|---|
| Agent app-data refusal in all modes | REQ-SEC-3856567c | Canonical exclusions on host tool guards | guard/session/native/CLI |
| Bypass tool scope text | REQ-FUNC-6d5e514a | Explicit tool list and boundaries | prompt tests |
| Confirm before each Bypass change | REQ-UX-33b9d601 | Shared picker pending dialog | component/browser/native |
| Cancel preserves prior mode | REQ-UX-bb147586 | Cancel/Escape without change | component/browser/native |
| Irreversible plugin rules remain visible | REQ-UX-12185f60 | Same confirmation lists fresh rules | component/plugin approval |

## Design

### Approach
REQ-SEC-3856567c: add host-configured excluded roots to PathGuard; check lexical and canonical identities, including nonexistent descendants, using the existing ordinary-path/case policy. ToolContext passes managedRoots and pluginBuilder.root to tool guards and worker tasks. Confined analysis/draft/candidate/electrical/program/HIL inputs retain confinement and also receive exclusions. ProgramRunner carries host-only exclusions for cwd checks before spawning; bound-file rechecks retain exclusions. Candidate apply checks rebuild the confined guard against current host roots. Agent search_docs/read_doc pass host exclusions to DocumentKnowledge guarded reads/result validation; the persisted index and internal reader stay unchanged. PathGuard.assertNotExcluded supplies exclusion-only preflight for program arguments before existing outside/unbound fallback. Internal generated storage remains unchanged. Internal settings, credential and PluginStore loaders do not use the agent guard.
REQ-UX-33b9d601 / REQ-UX-bb147586: selection opens one pending confirmation before change; confirm awaits change, cancel/Escape leave the prior value. Keep errors visible, prevent duplicate submissions, and restore selector focus. Remove warning suppression UI/preference, without migration (root pre-release policy).
REQ-UX-12185f60: fetch eligible irreversible rules before showing the same confirmation; list failure still shows the confirmation. Keep plugin loading separate from agent raw file access.
REQ-FUNC-6d5e514a: explicitly enumerate current shared-policy tools and describe application-data exclusion; retain honest current confinement of remaining tools until #309/#310.

### Interfaces and data
PathGuard.create receives optional excludedRoots after the existing authorization callback; existing host-internal callers stay unchanged. WorkerTask receives host-only excludedRoots. No model-controlled override. Stored schema versions stay1; removed suppression setting is not migrated.
Picker owns pending/rules/dialog state, parent owns committed mode. Cancel never calls change; change errors retain the dialog with an error and permit retry/cancel. During async rule loading and confirmation the selector is disabled.

### Files and test seams
Core workbench/path-guard, tools/context and grep worker/task plus confined analysis adapters; core session bypass and focused file-tool/worker tests. Desktop/CLI existing managedRoots composition is inspected and exercised through native/CLI replay.
Shared settings, picker and locale dictionaries; four help/permissions pages; focused component/browser/native tests and plugin approval consumer.
Records/context/inventory, CHANGELOG/release notes and plan state follow successful proof.

### Risks and open decisions
Canonical alias checks must cover Windows junction/case and missing descendants without broadening other tools. No sandbox claim for arbitrary plugin processes; run_program cwd widening belongs to#309. Native Ubuntu unavailable unless discovered; WSL Linux is identified separately. User defers full app/plugin suites.

### Requirement map
All five coverage rows above map to the approach and proof seams. No unresolved product decisions.
Diagrams: [diagram_TASK-a8bf8812.md](diagram_TASK-a8bf8812.md).

## Log

- 2026-11-16 frame: journal opened
- 2026-11-16 frame: DEVIATION validate: complete app and official-plugin suites deferred by explicit user instruction; use focused guard/plugin-system proof and statics, no full acceptance claim.
- 2026-11-16 frame: completed; next specify (7 Done checklist item(s) left unticked)
- 2026-11-16 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-16 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-16 build: red: pinned npx vitest run path-guard.test.ts prompt.test.ts exit 1; four expected failures: exclusions ignored and explicit tool scope absent (REQ-SEC-3856567c, REQ-FUNC-6d5e514a).
- 2026-11-16 build: green: pinned focused path-guard and prompt tests exit 0, 52 passed/1 platform skip. red: permission-picker.test.ts exit 1, five expected failures because selection currently changes mode before confirmation (REQ-UX-33b9d601, REQ-UX-bb147586).
- 2026-11-16 build: red: focused app-data file/worker tests exit 1; four read/list/glob/write cases pass, parse_log worker fails expected exclusion because confined worker did not receive host roots.
- 2026-11-16 build: green: Windows focused Vitest 13 files (guard/prompt/file tools/analysis/draft/session/settings/picker/workspace) exit0, 195 passed/2 platform skips; CLI Bypass configured --data replay exit0 (1 passed/43 deselected); VERA_TEST=1 pinned npm run test:e2e -- bypass.spec.ts program-approvals.spec.ts exit0, 4 passed (Chromium four languages plus native Electron Done A/B, restart, plugin approvals). No full suites.
- 2026-11-16 build: green: pinned focused plugin-system consumers and import boundaries (program-tools, program-request, store, tests/tooling/boundaries) exit0, 99 passed/1 platform skip. Actual bundled current guard/context/read/prepareChange passed four-mode alias/read/write assertions on Ubuntu WSL2 using /home/dpasare/vera-cap-01/node-v24.21.0-linux-x64/bin/node; Linux v24.21.0, no install or native Ubuntu claim. No official-plugin suite.
- 2026-11-16 build: Inspection: desktop index.ts:346 passes selected dataLocations.paths.userData; SessionsHost forwards managedRoots to SessionService and service.ts tool contexts. CLI run.ts:234 passes location.paths.userData; configured --data replay and native profile proof both refuse access. Internal Credential/Settings/PluginStore loading bypasses agent guard, with store and authoring review regression proof. New PathGuard exclusions are opt-in for host internal callers. Reviewed evolution against full recorded base, including owned plan and preserved bundled-plugins files.
- 2026-11-16 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-16 validate: Review round1: both changes_required for omitted exclusions in still-confined program cwd and candidate/electrical/HIL input guards when app-data is nested in the workbench. Fix exclusions only, without widening scope; add targeted nested-root refusals and apply/spawn rechecks.
- 2026-11-16 validate: returned to build - Round1 requires complete host-exclusion propagation to confined input/program guards
- 2026-11-16 build: red round1 fixes: program-tools/apply-candidate nested app-data tests exit1 (5 expected failures: accepted cwd/input); app-data-inputs helper/entrypoint tests expose omitted confined exclusions. Extend guard policy without granting filesystem scope.
- 2026-11-16 build: Round1 fixes: optional host exclusions now pass through confined program request/runner cwd and bound-file rechecks, resource registry, HIL plan/firmware checks, candidate input/apply checks and electrical input helpers. ApplicationDataAccessError prevents program binding from treating excluded files as plain unbound arguments. Workbench scope and internal generated storage stay unchanged.
- 2026-11-16 build: green round1 fixes: pinned npx vitest run app-data-inputs, apply-candidate, path-guard, program-tools/program-request/runner/program-resources/hil, electrical tools/catalog/cable/lighting/measurements plus five electrical tool adapters and import boundaries exit0, 19 files270passed3skips. Pinned Ubuntu WSL2 Node24.21.0 refreshed bundled-current-source assertions pass four-mode alias/read/write refusal plus confined model and program cwd/file exclusions. No native Ubuntu claim.
- 2026-11-16 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-16 validate: Refreshed targeted Windows Chromium/Electron: VERA_TEST=1 python ../02_Tools/environment/npmw.py npm run test:e2e -- bypass.spec.ts program-approvals.spec.ts exit0, four passed. Done A actual read/write refusal and ordinary outside edits; Done B four languages, per-change confirm/cancel, both selectors and restart. Owned WSL bundling scratch and Linux mkdtemp removed after processes closed.
- 2026-11-16 validate: Exact focused round1-fix command from 05_Software: python ../02_Tools/environment/npmw.py npx vitest run src/libraries/core/src/tools/app-data-inputs.test.ts src/libraries/core/src/tools/apply-candidate.test.ts src/libraries/core/src/workbench/path-guard.test.ts src/libraries/core/src/plugins/program-tools.test.ts src/libraries/core/src/plugins/program-request.test.ts src/libraries/core/src/plugins/runner.test.ts src/libraries/core/src/plugins/program-resources.test.ts src/libraries/core/src/plugins/hil/hil.test.ts src/libraries/core/src/electrical/tools.test.ts src/libraries/core/src/electrical/catalog-tool.test.ts src/libraries/core/src/electrical/cable-table.test.ts src/libraries/core/src/electrical/lighting-files.test.ts src/libraries/core/src/electrical/measurements.test.ts src/libraries/core/src/electrical/network-tool.test.ts src/libraries/core/src/electrical/protection-tool.test.ts src/libraries/core/src/electrical/motor-drives-tool.test.ts src/libraries/core/src/electrical/power-quality-tool.test.ts src/libraries/core/src/electrical/lighting-tool.test.ts tests/tooling/boundaries.test.ts; exit0, 19 files270passed3skips.
- 2026-11-16 validate: Round2: prior findings fixed; remaining changes_required for agent indexed-document read/search policy and existing absolute external program arguments bypassing exclusions before unbound fallback. Fix exclusion-only checks, preserving index storage and outside binding/cwd behavior.
- 2026-11-16 validate: returned to build - Round2 requires document-agent boundary and exclusion-only preflight for outside program arguments
- 2026-11-16 build: red round2 fixes: focused existing external app-data absolute program argument regression exit1 (accepted unbound); indexed document agent regression after valid index setup exit1 (read_doc returns private extraction).
- 2026-11-16 build: Additional red/green boundary: exclusion-only argument preflight must resolve relative arguments from the chosen cwd, not workbench root; regression failed accepted ../../external-data/settings.json from build and was corrected before round3.
- 2026-11-16 build: green round2 fixes: from05_Software python ../02_Tools/environment/npmw.py npx vitest run src/libraries/core/src/knowledge/search.test.ts src/libraries/core/src/plugins/program-tools.test.ts src/libraries/core/src/plugins/program-request.test.ts src/libraries/core/src/workbench/path-guard.test.ts src/libraries/core/src/sessions/bypass.test.ts src/libraries/core/src/tools/registry.test.ts tests/tooling/boundaries.test.ts exit0, 7files141passed2skips. After cwd-relative correction, program-tools.test.ts/program-request.test.ts exit0,68passed1skip. Other unchanged proof reused; no routine full retesting.
- 2026-11-16 build: Pinned Ubuntu WSL2 Linux Node24.21.0 bundled current program-request assertions exit0: external absolute, canonical alias, cwd-relative and missing-descendant app-data arguments refused; ordinary outside argument stays unbound. Owned scratch removed. Documents index storage stays unchanged; tools pass host-only exclusions on each knowledge read/search, keeping confined scope and cached protected snippets out of output.
- 2026-11-16 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-16 validate: returned to build - Round3 spec flags Windows stream fallback before exclusion preflight; establish exact failing spelling and apply same exclusion to its base
- 2026-11-16 build: Round3 regression established that ::$DATA was already normalized and refused; the actual remaining failure was external settings.json:payload (accepted unbound). Applied exclusion-only preflight to the Windows stream base; named streams and default-stream spellings are now covered.
- 2026-11-16 build: green round3 fix: python ../02_Tools/environment/npmw.py npx vitest run src/libraries/core/src/plugins/program-tools.test.ts src/libraries/core/src/plugins/program-request.test.ts from05_Software exit0,68passed1platformskip; Windows ::$DATA, :payload and :payload:$DATA application-data argument refusal verified. Earlier unchanged proof reused.
- 2026-11-16 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-16 validate: Round4 independent reviews: specification compliance approved (byp03_spec_review); implementation quality approved (byp03_quality_review), complete tracked/untracked candidate against base bc684338e7f3444d446e56d5487717c1b5e59e49. No remaining actionable findings. Coordinator retains local commit ownership.
- 2026-11-16 validate: DEVIATION validate: final check --task TASK-a8bf8812 --strict --run exits1 solely because repository lint reports two known baseline formatter errors: preserved untracked src/bundled-plugins/index.json and unchanged shared/workbench-create-ipc.test.ts (current blob953b4ea3eb9f249b88acc4202f42a2930273f04b matches supplied baseline). No unrelated files fixed. Full candidate lint57files exit0; typecheck/i18n/help exit0 in strict run; check:release-notes exit0. Full app/official-plugin suites remain user-deferred.
- 2026-11-16 validate: final: python .agentic/aegis.py check --task TASK-a8bf8812 --strict --run exit1 (lint baseline only; typecheck0/i18n0/help0). After unchanged candidate: narrow pinned Biome --vcs-enabled=false --diagnostic-level=error over57changed TS/TSX/JSON/CSS files exit0; pinned npm run check:release-notes exit0 (3files0errors); python .agentic/aegis.py check --task TASK-a8bf8812 --strict exit0 (47 warnings/38 notes, no errors). Remaining warnings are unrelated historical metadata/ticket refs, outside-layout help/release/changelog mappings and preserved preexisting bundled-plugin binaries; no owned source coverage gap. No source edits after independent round4 approvals/final proof.
- 2026-11-16 validate: Closure: Done A/B proved, all validate checklist items satisfied under recorded user-authorized verification deviations. Complete owned candidate remains unstaged/uncommitted on original master/base; preexisting bundled-plugins and PERF journal preserved. No push, remote issue edits or full suites. Coordinator verifies current candidate/proof and makes authorized local ticket commit; do not start next ticket from this chat.
- 2026-11-16 validate: completed; next done

## Rulings

- RULING-001 | date=2026-11-16 | decision=User authorizes AEGIS autopilot on shared master and one local commit per ticket; coordinator verifies and commits, implementer hands back without staging or commit. | reason=Explicit delegation and root AGENTS automated cycle; only this implementation chat active. | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-a8bf8812.md
changed: BYP-03 application-data guard, prompt, per-change consent and four-language help
evidence: Focused Windows/native/CLI/WSL proof and narrow lint/statics/strict metadata pass; strict --run exit1 from baseline lint only
issues: Two preserved baseline lint errors; full app/plugins suites deferred; native Ubuntu unavailable
spec_compliance: approved
implementation_quality: approved
review_round: 4

## Delivery report (2026-11-16)

- stage: validate; type: change; path: full; branch: master
- requirements:
  - REQ-SEC-3856567c - Refuse agent filesystem access to application data in every mode
  - REQ-FUNC-6d5e514a - Describe shared Bypass tool scope in the system prompt
  - REQ-UX-33b9d601 - Confirm every change to Bypass
  - REQ-UX-bb147586 - Cancel a Bypass mode change
  - REQ-UX-12185f60 - List irreversible plugin rules in the Bypass confirmation
- deviations: 2 recorded
  - validate: complete app and official-plugin suites deferred by explicit user instruction; use focused guard/plugin-system proof and statics, no full acceptance claim.
  - validate: final check --task TASK-a8bf8812 --strict --run exits1 solely because repository lint reports two known baseline formatter errors: preserved untracked src/bundled-plugins/index.json and unchanged shared/workbench-create-ipc.test.ts (current blob953b4ea3eb9f249b88acc4202f42a2930273f04b matches supplied baseline). No unrelated files fixed. Full candidate lint57files exit0; typecheck/i18n/help exit0 in strict run; check:release-notes exit0. Full app/official-plugin suites remain user-deferred.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=4
- diff vs task base bc68433: 95 file(s) changed, 1644 line(s) added; 9 file(s) not content-scanned
- checks: errors=0 warnings=47 notes=38
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended

## Delivery report (2026-11-16)

- stage: validate; type: change; path: full; branch: master
- requirements:
  - REQ-SEC-3856567c - Refuse agent filesystem access to application data in every mode
  - REQ-FUNC-6d5e514a - Describe shared Bypass tool scope in the system prompt
  - REQ-UX-33b9d601 - Confirm every change to Bypass
  - REQ-UX-bb147586 - Cancel a Bypass mode change
  - REQ-UX-12185f60 - List irreversible plugin rules in the Bypass confirmation
- deviations: 2 recorded
  - validate: complete app and official-plugin suites deferred by explicit user instruction; use focused guard/plugin-system proof and statics, no full acceptance claim.
  - validate: final check --task TASK-a8bf8812 --strict --run exits1 solely because repository lint reports two known baseline formatter errors: preserved untracked src/bundled-plugins/index.json and unchanged shared/workbench-create-ipc.test.ts (current blob953b4ea3eb9f249b88acc4202f42a2930273f04b matches supplied baseline). No unrelated files fixed. Full candidate lint57files exit0; typecheck/i18n/help exit0 in strict run; check:release-notes exit0. Full app/official-plugin suites remain user-deferred.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=4
- diff vs task base bc68433: 95 file(s) changed, 1662 line(s) added; 9 file(s) not content-scanned
- checks: errors=0 warnings=47 notes=38
- checklist: 9/9 done
