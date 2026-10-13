<!--
Copyright (c) 2026 DDP Engineering
This software is licensed under the PolyForm Noncommercial License 1.0.0.
Commercial use requires a separate commercial license.
See the LICENSE.txt in the .agentic folder for full license details.
SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
-->


# TASK-3ad9ff0d - WP-29 Skills

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-FUNC-e728c8bf, REQ-FUNC-f06e9051, REQ-UX-a285bfa2
parent:
branch: master
base: 3b07f1e9de5dd721bb476bcd3c58581eb80f799d
opened: 2026-10-13

## Done checklist (current stage)

- [x] assertion-only correction and affected native proof
- [x] affected lint and intact static/runtime proof reuse
- [x] both independent round3 current verdicts
- [x] final strict/catalog and delivery handback
- [x] coordinator amends the single local WP29 commit and closes out

## Frame

Problem: STATED skills must extend VERA from workbench and user folders.
Desired outcome: validated metadata in next-turn prompt, body/extra through tool, editable settings.
Actors: engineering user, agent, core skill catalog, host root owner, renderer.
Primary scenario: create skill -> save exclusively -> next turn discovers index -> load_skill reads body/extra.
Examples: workbench datasheet-reader shadows same user skill.
Counterexamples: disabled, invalid, redirected or escaping skill cannot reach agent.
In scope: discovery/validation, load_skill, fresh prompt metadata, shared IPC, settings and Context UI, targeted native evidence.
Out of scope: WP30+, dependencies, publishing, coordinator registry, full M3 gate and human data.
Constraints: STATED master/base/autopilot, pinned runtime, renderer no fs, exact authorized origin, current ownership, localized accessible rem UI.
Success signals: Done discovery/clash/validation/disabled units; replay body/extra; native UI next-turn prompt.
Evidence: OBSERVED architecture02/03/06 and M3 WP29; prompt.ts metadata seam; WorkbenchService lifecycle/write admission; SessionsHost composition.
Assumptions: INFERRED bounded text limits reuse existing 256KiB read policy; explicit catalog overflow error.
Unknowns: no decision-blocking product unknowns.
Decision-blocking questions: none.
Proposed behaviors: see requirement coverage and skill spec.
Path and reason: full; new observable behavior/interface/data handling=no quick eligibility; dependency unchanged=yes. Tightly coupled implementation stays one task.

## Requirement coverage

| Frame outcome | Atomic behavior | Requirement | Positive case | Boundary or failure | Verification | Design decision or no impact |
|---|---|---|---|---|---|---|
| Agent index | Fresh validated metadata | REQ-FUNC-e728c8bf | both roots/workbench wins | invalid/disabled omitted, bounds error | unit + next-turn native | catalog per turn |
| Content tool | Load confined body/extra | REQ-FUNC-f06e9051 | replay reads both | traversal/symlink/stale/abort rejected | unit + integration | typed loader in context |
| Settings | inspect/create/edit/toggle | REQ-UX-a285bfa2 | UI template saved | stale hash/read-only/current ID rejected | units/native/browser | lifecycle/write queue, scoped dialog |

## Design

Catalog uses explicit host userData plus workbench root, bounded stable file reads, rejects redirect/hardlink paths, parses YAML without aliases and returns only metadata at discovery. Skill loader is read-class ToolRegistry entry with existing output cap/budgets. SessionsHost refreshes catalog before sends; CLI uses same service. Current config disables skills at both discovery/load. WorkbenchService admits settings reads/writes on lifecycle/write queues with ID checks; user root comes from host only. Create uses exclusive SKILL.md and edit original SHA256; no renderer path authority. UI uses isolated modal drafts, native focus restoration, rem/theme styles and en/ro/de catalogs; mock models same routes. Meaningful alternative persistent watched catalog rejected for stale metadata risk and extra infrastructure. Test seams: catalog units, service/IPC units, replay/session and next-turn native/browser. Full M3 gate owner coordinator. No migration/dependency/runtime budget change.

## Log

- 2026-10-13 frame: accepted full scope/autopilot on shared master base3b07f1e9de5dd721bb476bcd3c58581eb80f799d; setup --check exit0. Reference content.ts resolved to apps/server/src/content.ts (no skills/content.ts).
- 2026-10-13 specify: three atomic requirements and bounded discovery/content spec audited against02 §5; reference body-line restriction intentionally not adopted because absent from product spec.
- 2026-10-13 design: catalog, load tool and lifecycle settings integration above; advance build.

- 2026-10-13 build red: REQ-FUNC-e728c8bf/f06e9051 command=python ../02_Tools/npmw.py npx vitest run packages/core/src/skills/catalog.test.ts; exit1; two expected failures: empty discovery and unimplemented content loading.
- 2026-10-13 build red: REQ-UX-a285bfa2 command=python ../02_Tools/npmw.py npx vitest run apps/desktop/src/renderer/mocks/mockApi.test.ts -t mock-skills (quoted selector mock skills); exit1; expected missing skills.create route returns INTERNAL. Catalog2tests now pass; bounds coverage expanded before final proof.
- 2026-10-13 build: exact UX red selector was `python ../02_Tools/npmw.py npx vitest run apps/desktop/src/renderer/mocks/mockApi.test.ts -t "mock skills"`; exit1 missing route. Prior log label mock-skills was explanatory, not the literal selector.
- 2026-10-13 build completed: focused-final13files117pass/1platform-specificskip eachOS; CLI-only selected process1pass/30unselected eachOS. Discovery/clash/invalid/disabled, overflow, late disable/abort/stale lifetime, UTF8/binary/hardlink, Windows junction and Ubuntu symlink covered. Real replay/CLI load user body+extra. Original receipts under02_Tools/cache/wp29-TASK-3ad9ff0d/windows and linux; softwareSHA000addef46e8034b2a9809e74ee7d0bf4898816e583b4a029eca4cf7b627187f matches platforms. Native E2E captures four actual loopback system requests: before, UI-create/edit, disabled, reenabled/edit; read tool offered and body omitted. Browser30language/theme/scale combinations preserve keyboard focus/no horizontal overflow; selected native/RO-light/DE-dark screenshots inspected. Focus bug discovered by browser was corrected by closing native dialog before trigger focus. Ownership callback retains database/token lifetime, refreshes config around reads and performs final source/content/disabled checks; UI exclusive template and original-hash edit preserve user bytes/permissions. Scope excludes full milestone testing; coordinator remains sole M3 gate owner. Native Ubuntu install uses current lock/pinned runtime; no dependency changes. Advance validate after semantic/code/document reconciliation.

- 2026-10-13 validate round1: both independent reviewers (spec_review,quality_review) returned changes_required for candidate6080b9c2d07ffc459f56de0c3b0fb8d9e5e6150c57991be832612884721c03fa; same P2: load_skill bypassed permanent ignores and .veraignore. Each inspected all49paths and originals/parity/coverage; no other concrete findings. Verdicts inreview-round1-verdicts.json. Return build, fix only this established contract gap and regressions, clear both verdicts; round2.

- 2026-10-13 build review correction: agent paths now use common workbench PathGuard/.veraignore with negations and permanent ignores for separately authorized user skills. Ignored primaries have unavailable diagnostics/no prompt; explicit UI access keeps its ownership boundary. Source/version/disabled/ignore checks occur before final disclosure. Added regression covers all three permanent directories in both sources, excluded and negated extras and ignored primary. Windows ignore-fix36pass/1POSIXskip, CLI-fix1pass and native-fix next-turn pass; native Ubuntu ignore-fix2/CLI-fix/native-fix same bytes and outcomes. Ubuntu first corrected run used a generated symlink TMP alias and correctly refused that redirected root; fixed harness to physical owned shortTMP and repeated affected checks, no product relaxation. Unaffected original117proof/browser matrix retained under policy; aggregate unit coverage118pass/1opposite-platformskip each. Return validate round2.

- 2026-10-13 validate round2: spec_compliance=approved (/root/spec_review) and implementation_quality=approved (/root/quality_review), candidate2066959c46945bcb029bc122cd0951021fc514aca88d5276c155a140b56a2c03, no remaining findings. Both independently verified49paths, current native originals/parity and ignore regression coverage, no retesting. Verdicts inreview-round2-verdicts.json. final-proof-reuse.json supersedes first-round ledger and reconstructs118focused cases eachOS+CLI1/native4prompts/browser30matrix from minimal reruns and unchanged bytes. Current386software hashes7dcad853ef2db6fb4078c4a1f9e5cfa25c12262f97bdd3fcebd4d39b33b5070e; main/preload originals retained with actual-execution hash matches. Final strict/statics next; no full M3 gate duplicated.

- 2026-10-13 validate final: Windows `python .agentic/aegis.py check --task TASK-3ad9ff0d --strict --run` and native Ubuntu python3 equivalent exit0; actual lint/typecheck/i18n all pass, full tests intentionally omitted by configured verification-policy. Original receipts windows/strict-final.json and linux/strict-final2.json match current386software SHA7dcad853ef2db6fb4078c4a1f9e5cfa25c12262f97bdd3fcebd4d39b33b5070e and log hashes. Strict errors0/warnings11 both:10historical journal warnings plus1pre-existing DEMO-01 pattern; Ubuntu no mirror anchor note uses original Windows anchor/evolution. Initial Ubuntu strict runner lacked `python` command alias; owned shim to python3 corrected environment then same configured commands all executed successfully, no weakened check. Original targeted118unit-equivalent+CLI1/currentnative/browser proofs reused per final-proof-reuse.json; no routine handover tests/fullM3 gate duplication. Both round2 approvals unchanged.
- 2026-10-13 validation housekeeping: native Ubuntu all386software and48non-journal candidate bytes equal Windows; owned mirror/temp removed after processes closed and originals copied, linux-cleanup.json. Windows process snapshot shows no task model/test processes. Automatic approval review rejected complete owned-temp/source-archive cleanup action, reason blocked by policy; nothing executed, ignored Windows scratch and single overwritten source archive retained, windows-cleanup.json; no bypass. Human optional-companions SHA2a69f5b335a53e498b1f8e30fa5adb8096e870e7a12bbc05b0727a03cee72c6b intact/excluded; manual-user-data and other task runtime/caches untouched. Advance deliver for coordinator acceptance; implementer no staging/commit/push/PR/issue mutation.

- 2026-10-13 deliver handback prepared: unchanged49candidate files (35modified14untracked, index empty), master/HEAD remain recorded base3b07f1e9de5dd721bb476bcd3c58581eb80f799d. Current non-journal candidate2066959c46945bcb029bc122cd0951021fc514aca88d5276c155a140b56a2c03 still binds both independent round2 approvals. Exact paths/status/raw hashes in candidate-manifest.json; original source/parity/runtime/statics and minimal-rerun reconstruction in final-proof-reuse.json, reviews in review-round2-verdicts.json. FullM3 gate deferred exclusively to coordinator after his authorized local WP29 commit. No implementation children, both review-only agents finished. Generated report50paths includes the protected unchanged untracked human file; intended commit49manifest paths excludes it, and advisory12thwarning is pending coordinator deliver/close-out. No remaining implementation blocker, no accepted candidate/verification deviation. Original proof retained; own Linux mirror/temp cleaned, Windows cleanup auto-review rejection retained per instruction. Implementer performed no staging/commit/push/PR/issue or implementation-cycle.json change. Coordinator verifies original evidence/current diff without handover retesting, then performs the one local commit and M3 integrated gate.

- 2026-10-13 deliver coordinator acceptance: complete49file diff/new files/journal/Done reviewed. Current48non-journal digest2066959c46945bcb029bc122cd0951021fc514aca88d5276c155a140b56a2c03 and386software bytes match bound reviews/proof. Actual independent R2 messages and original receipt/log source deltas checked; affected ignore36+CLI1/native reruns supersede earlier proof, unchanged browser retained. Native four provider system requests/payload hashes and Windows executable verified; native/editor screenshots inspected.118focused+CLI1 eachOS, strict0 bothOS reused,11inherited warnings retained. Protected human draft unchanged; no source edits/retesting/remote. Acceptance:02_Tools/cache/wp29-TASK-3ad9ff0d/coordinator-acceptance.json; user local commit authorization applies. M3ownercoordinator remains gate beforeWP30.

- 2026-10-13 deliver local-only close-out: agreed outcome is the single local delivery commit itself; deliver step7 permits close-out in that commit before creation. Completed journal/report are included with exact49approved paths. Actual Git SHA/parent/membership are recorded atomically in coordinator-commit.json and implementation-cycle.json after success; no push/PR/release. M3gate is a subsequent coordinator operation beforeWP30.

- 2026-10-13 M3 correction reopen: coordinator committed single local WP29 7e14160f497b171f5d9553b53f8a9fb2266c65f3; recorded task base3b07f1e remains unchanged. Original coordinator Windows full verify passed, E2E42cases41pass/1deterministic failure in artifacts.spec.ts:175/176 expecting full visible artifact refs despite existing WP27 compact referenceLabel contract. Read complete artifact test/refs/Markdown and failure original02_Tools/cache/m3-coordinator-gate/windows-e2e.stdout.log. Scope authorized: assertion-only consumer correction for compact labels, full tooltip/accessibility and invalid warning/inert; preserve validity/export/restart/delete. Reuse all original WP29 and intact full verify/41E2E; only affected native case eachOS/lint and strict/catalog. Runtime/config/policy/registry/gate helper unchanged; no new requirement/administrative task. Clear current verdicts/reopen build; round3 for delta+complete candidate. Coordinator will amend last local commit to preserve one ticket commit; implementer no staging/commit/amend/remote.

- 2026-10-13 M3 correction build: original red command from coordinator `python ../02_Tools/npmw.py npm run test:e2e -- --output=02_Tools/cache/m3-coordinator-gate/windows-e2e-results` (absolute argv/cwd/UTC in windows-e2e.execution.json), exit1,41pass/1fail at obsolete full visible artifact label. Corrected only artifacts.spec.ts assertions: compact summary.md/missing.md, full title/aria-label, invalid aria-disabled/warning class and Enter produces no document dialog while artifact viewer remains. Existing37B/valid chip/no-approval/export exact bytes/reveal/restart/list/delete/file+folder removal/non-loopback guard checks unchanged. Windows m3-artifact-native1pass and Linux m3-artifact-native2 same bytes1pass; exact captures/main/preload/original child outputs retained. First Linux setup borrowed Electron via symlink and helper correctly caught execPath mismatch; created one owned same-version Electron package in reused task mirror and repeated only failing case, no test/runtime relaxation. Other dependencies reused read-only from identical-lock native installation. Affected biome e2e/artifacts.spec.ts exit0. Runtime/source/config except test unchanged, WP29 original units/CLI/Done and coordinator full verify/41E2E reused as instructed. Original task base unchanged; correction scope references existing REQ-UX-34535128 compact/accessibility/inert contract, no new requirement. Advance validate round3.

- 2026-10-13 M3 correction review round3: both independent spec/quality approved candidate d5edcf021b4221b09c52ec89625c6b71dc6020cc1a418b62db97d32a42663118; all50full candidate hashes,2path delta vs7e and48previous approved non-journal paths checked. No findings; existing analysis reused on identical bytes. Original Windows/Ubuntu affected case initial+restart captures and source parity/lint verified; no reviewer edits/tests. Verdicts review-round3-verdicts.json. Final strict/catalog with explicit intact static proof reuse per delegated instruction, no full run.

- 2026-10-13 M3 correction final validation: Windows and native Ubuntu `python[3] .agentic/aegis.py check --task TASK-3ad9ff0d --strict` exit0, errors0/warnings11; originals windows/m3-strict-catalog.json and linux/m3-strict-catalog.json bind current386software SHA34cf90198789eab46308a1ee3a38d8d0bbc188b8a9aed0a9dd12e8a5c38a7670. Affected biome test lint0 and native artifact case1pass eachOS (initial+restart captures) are current; unchanged production/other-test static, unit/CLI/UI and coordinator full verify/41unaffected E2E evidence explicitly reused via m3-correction-proof.json, no full run or other test run. Both round3 approvals remain bound to d5edcf021b4221b09c52ec89625c6b71dc6020cc1a418b62db97d32a42663118. Native Ubuntu386software/49non-journal candidate byte parity checked before removal of same owned mirror/temp; linux-m3-cleanup.json records success, external linked dependencies/runtime untouched. Earlier Windows cleanup rejection remains respected: ignored owned scratch/archive retained, no bypass/retry. Advance deliver; coordinator owns amendment/M3 continuation, implementer no staging/commit/amend/remote. Original task base remains3b07f1e, correction base7e14160.

- 2026-10-13 M3 correction handback: report-time advisory51paths includes unchanged protected human draft; actual amended candidate50paths vs original base and exact2path correction delta vs7e exclude it. Report warnings12 adds pending coordinator deliver/close-out to11inherited validation warnings, errors0. m3-correction-manifest.json binds final journal hash, unchanged reviewed non-journal digest and exact2path amend scope; m3-correction-proof.json retains original/current proof reuse without full gate duplication. Index remains empty, master HEAD7e14160 unchanged; no staging/commit/amend/push/PR/issue/registry action. Both review-only agents finished approved; no implementation children. Ready for coordinator amendment and sole-owned M3 continuation; no new user approval needed within existing local-commit authorization.

- 2026-10-13 M3 correction coordinator acceptance/close-out: reviewed exact2path delta and full50path candidate, all49non-journal hashes match R3; both actual reviewer final messages/original affected native/lint/strict receipts verified. Four native initial/restart main/preload/process/log hashes checked; only artifacts.spec.ts software bytes changed. Windows integrated verify622pass9skip/41unaffected E2E preserved plus correctedArtifact1pass perOS; no coordinator retest. Protected human draft unchanged. Acceptance:02_Tools/cache/wp29-TASK-3ad9ff0d/coordinator-m3-correction-acceptance.json. Standing local authority permits amendment; local-only outcome closes before amend per deliver step7, keeping one WP29 commit and original base. Actual new SHA/parent/full50membership recorded atomically after Git succeeds; no remote. Coordinator then runs remaining nativeUbuntu M3 gate using valid artifact proof and same-source Windows coverage.

## Rulings

- RULING-001 | date=2026-10-13 | decision=Autopilot/master/recorded base; implementer hands back without staging/commit/push/PR; user authorizes coordinator local commit | reason=user delegation | source=user | supersedes=none
- RULING-002 | date=2026-10-13 | decision=Coordinator owns M3 full gate after WP29 commit; implementer owns focused native/static/strict and two independent reviews only | reason=verification policy v3 and explicit delegation | source=user | supersedes=none

- RULING-003 | date=2026-10-13 | decision=Reopen same WP29 for assertion-only M3 consumer correction; coordinator owns amendment and integrated gate; implementer runs only affected native case/statics reuse/reviews | reason=explicit coordinator delegation following original deterministic artifact label failure | source=user | supersedes=none

## Handoff

current: done
status: ready
next: coordinator amends WP29 and continues M3gate beforeWP30
must_read: .agentic/tasks/TASK-3ad9ff0d.md,02_Tools/cache/wp29-TASK-3ad9ff0d/coordinator-m3-correction-acceptance.json
blockers: none for candidate; integrated nativeUbuntu gate pending

## Stage report

stage: deliver
result: completed
current: done
changed: assertion-only Artifacts correction plus journal; full50path WP29candidate
evidence: nativeArtifact1pass eachOS; affectedlint0/strict0; R3spec/quality approved; Windowsfull622pass9skip/41otherE2E preserved
issues:11inherited advisories; prior Windows scratch rejection retained; remaining M3Ubuntu pending
next: authorized amendment preserving one WP29commit, then M3gate beforeWP30
needs_user: no
spec_compliance: approved
implementation_quality: approved
review_round: 3

## Delivery report (2026-10-13)

- stage: deliver; type: feature; path: full; branch: master
- requirements:
  - REQ-FUNC-e728c8bf - Discover validated skill metadata
  - REQ-FUNC-f06e9051 - Load skill content on demand
  - REQ-UX-a285bfa2 - Manage workbench and user skills
- deviations: none recorded
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base 3b07f1e: 50 file(s) changed, 2159 line(s) added
- checks: errors=0 warnings=12 notes=3
- checklist: 3/6 done; open: coordinator includes journal/report in delivery commit; coordinator makes one local WP29 commit; coordinator closes out after successful commit

## Delivery evidence

- Exact49-file candidate/status/hash/exclusion:02_Tools/cache/wp29-TASK-3ad9ff0d/candidate-manifest.json.
- Current independent approvals:review-round2-verdicts.json; immutable review-round2-manifest.json.
- Original commands/cwd/UTC/exit/source/log hashes:windows/{focused-final,mock-readonly,ignore-fix,cli-fix,native-fix,strict-final}.json; linux/{focused-final,mock-readonly,ignore-fix2,cli-fix,native-fix,strict-final2}.json and corresponding stdout/stderr.
- Reuse/current386-byte parity and reconstructed118unit cases eachOS+CLI/native/browser:final-proof-reuse.json.
- Executed native main/preload originals and four provider requests:windows/native-fix-native and linux/native-fix-native; compiled CLI payload/argv/output originals in cli-fix-native.
- UI screenshots and30-case browser original:windows/e2e4-results and linux/e2e-final-results.
- Own cleanup outcomes:linux-cleanup.json; windows-cleanup.json (automatic review blocked; ignored scratch retained).
- M3 full gate owner:coordinator, after local WP29 commit and before WP30; no full-suite run by implementer.

## Delivery report (2026-10-13)

- stage: deliver; type: feature; path: full; branch: master
- requirements:
  - REQ-FUNC-e728c8bf - Discover validated skill metadata
  - REQ-FUNC-f06e9051 - Load skill content on demand
  - REQ-UX-a285bfa2 - Manage workbench and user skills
- deviations: none recorded
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base 3b07f1e: 50 file(s) changed, 2187 line(s) added
- checks: errors=0 warnings=12 notes=3
- checklist: 5/6 done; open: coordinator closes out after successful commit

## Delivery report (2026-10-13)

- stage: done; type: feature; path: full; branch: master
- requirements:
  - REQ-FUNC-e728c8bf - Discover validated skill metadata
  - REQ-FUNC-f06e9051 - Load skill content on demand
  - REQ-UX-a285bfa2 - Manage workbench and user skills
- deviations: none recorded
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base 3b07f1e: 50 file(s) changed, 2201 line(s) added
- checks: errors=0 warnings=11 notes=3
- checklist: 6/6 done

## Delivery report (2026-10-13)

- stage: deliver; type: feature; path: full; branch: master
- requirements:
  - REQ-FUNC-e728c8bf - Discover validated skill metadata
  - REQ-FUNC-f06e9051 - Load skill content on demand
  - REQ-UX-a285bfa2 - Manage workbench and user skills
- deviations: none recorded
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=3
- diff vs task base 3b07f1e: 51 file(s) changed, 2237 line(s) added
- checks: errors=0 warnings=12 notes=3
- checklist: 4/5 done; open: coordinator amends the single local WP29 commit and closes out

## Delivery report (2026-10-13)

- stage: done; type: feature; path: full; branch: master
- requirements:
  - REQ-FUNC-e728c8bf - Discover validated skill metadata
  - REQ-FUNC-f06e9051 - Load skill content on demand
  - REQ-UX-a285bfa2 - Manage workbench and user skills
- deviations: none recorded
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=3
- diff vs task base 3b07f1e: 51 file(s) changed, 2254 line(s) added
- checks: errors=0 warnings=11 notes=3
- checklist: 5/5 done
