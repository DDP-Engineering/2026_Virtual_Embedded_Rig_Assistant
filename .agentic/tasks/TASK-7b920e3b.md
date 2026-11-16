# TASK-7b920e3b - BYP-02 Remaining path tools follow Bypass (#310)

stage: done
type: change
path: full
interaction: autopilot
requirements: REQ-FUNC-97e4de53, REQ-SEC-88780a57, REQ-FUNC-d7d7a18a, REQ-SEC-57d4df1d, REQ-FUNC-6d5e514a, REQ-SEC-3856567c, REQ-SEC-c4553379, REQ-FUNC-bf693078, REQ-FUNC-ef7d2de3, REQ-DATA-f2cbfc23, REQ-SEC-d84c7986
parent:
branch: master
base: 62630967185b3dee309538b597ec5165fa3c3d68
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

Problem: STATED #310 and epic #307 require every agent input path to follow shared Bypass policy; OBSERVED parse-log, definitions, plugin drafts, HIL and electrical input helpers still construct confined guards.
Desired outcome: STATED outside absolute inputs work only in Bypass, preserving application-data refusal, original revocation epochs, program approval/export metadata and workbench-owned storage.
Actors: STATED session agent and user selecting the permission mode; host owns scope and exclusions.
Primary scenario: STATED parse a sibling log, decode sibling definitions/manuals, validate/install a sibling plugin and use outside HIL/resource/electrical inputs in Bypass.
Examples: STATED BYP-02-A sibling log/definition accepted in Bypass and refused in Ask; BYP-02-B outside plugin folder validates.
Counterexamples: STATED application data remains refused in every mode; document indexing and fixed model/result/index/log/artifact storage remain workbench-owned.
In scope: STATED #310 plus remaining epic input seams, truthful descriptions/system prompt/help in four languages, focused proof and records.
Out of scope: STATED no indexing widening, compatibility, migration, full suites, branches, commits, staging, pushes or remote issue edits.
Constraints: STATED shared master, base 62630967185b3dee309538b597ec5165fa3c3d68; coordinator owns authorized local commit. Preserve untracked bundled-plugins and unrelated PERF journal. Formats remain 1. Reuse unchanged #308/#309 proof.
Success signals: STATED focused acceptance of outside inputs/refusal in other modes, exclusions including aliases, retained epochs through async/background work, absolute records and unchanged fixed storage; both independent reviewers approve; statics reported honestly.
Evidence: OBSERVED tea issues 310/307 --comments --output json; root AGENTS, Code_Style, verification-policy and plan/bypass.md; clean tracked master at recorded base, pre-existing untracked bundled-plugins.
Assumptions: None changing product behavior.
Unknowns: UNKNOWN native Ubuntu unavailable; WSL2 Linux proof is distinct. Known baseline lint errors will be checked without unrelated repair.
Decision-blocking questions: None; user expressly authorized scope and autopilot.
Proposed behaviors: None unaccepted.
Path and reason: Full, because observable path authority changes.

| Criterion | Holds? | Evidence |
|---|---|---|
| no new externally observable behavior | no | STATED outside input acceptance |
| no new interface or data format | no | OBSERVED host-only HIL helper policy metadata; STATED stored formats remain 1 |
| no new dependency | yes | INFERRED shared existing guard |
| existing requirement covers behavior | no | OBSERVED confined analysis requirements need revision |
| no security or data-handling change | no | STATED Bypass authority widening |

## Requirement coverage

| Requirement | Behavior / proof | Design |
|---|---|---|
| REQ-FUNC-97e4de53 | Shared input scope, canonical records, fixed storage; focused input/HIL tests | Inject captured toolPathGuard into helpers |
| REQ-SEC-88780a57 | Original epoch through async/worker/HIL; revocation regressions | Capture before awaits, retain in closures |
| REQ-FUNC-d7d7a18a | Worker log scope / refusals | Host-only worker metadata |
| REQ-SEC-57d4df1d | Definition scope / refusals | Inject guard; outside refs null |
| REQ-FUNC-6d5e514a | Exact prompt/tool/help scope | Update shared-policy tool list |
| REQ-SEC-3856567c | Preserve application-data refusal | Reuse shared exclusions |
| REQ-SEC-c4553379 | Preserve background revocation | Retain original epoch in HIL |
| REQ-FUNC-bf693078 | Draft validation issues/warnings under shared source scope | Retained schema and lint validation |
| REQ-FUNC-ef7d2de3 | Explicit reviewed trial installation in every writable mode | Internal store authority retained |
| REQ-DATA-f2cbfc23 | Registry input-cwd lookup and canonical pre-spawn rechecks | Original lookup retained internally |
| REQ-SEC-d84c7986 | Safe offline helper risk notes include host-approved HIL sources | Host-only helper input metadata |


## Design

Approach: REQ-FUNC-97e4de53 uses the existing toolPathGuard as host-owned authority at every agent input seam; helper APIs accept an optional guard and retain confined defaults for internal callers. Fixed storage retains separate confined guards. No new dependency or model scope field.
Interfaces and data: capture Bypass epoch before awaits (REQ-SEC-88780a57); retain guards/signals through prepared apply and HIL background execution. Worker scope/exclusions are host-only metadata; termination cancels access. Canonical outside source paths carry null local line refs rather than widening indexed-document identity. Stored formats remain 1.
Files and test seams: context/registry, parse-log worker, definition loader, authoring, program-tools/request, resource-registry, HIL compile/run/executor and electrical input helpers. Focused sibling fixtures and existing immediate consumers cover scope/refusal, aliases, hashes, cancellation and fixed storage.
Review correction: HIL cwd is an input base; child storage remains workbench-owned. Canonical compiled source paths replace raw aliases in generated requests. The real lab-validation helper receives host-only scope/exclusions from the captured guard, never a model option; standalone calls stay confined. Plugin version rises to 0.3.0; focused real-process integration covers this boundary.
Risks and open decisions: guards must retain the original epoch; rechecks must use the same authority; generated HIL requests must not acquire new approval bindings. Catalog/table/measurement/project identifiers remain identifiers, with their referenced input paths and canonical aliases following shared scope. Internal plugin and credential loaders retain authority.
Requirement map: REQ-FUNC-97e4de53 shared guard injection; REQ-SEC-88780a57 captured lifetime; REQ-FUNC-d7d7a18a host worker metadata; REQ-SEC-57d4df1d shared definition guard; REQ-FUNC-6d5e514a truthful prompt/help; REQ-SEC-3856567c exclusions preserved; REQ-SEC-c4553379 retained HIL epoch.
Diagrams: [diagram_TASK-7b920e3b.md](diagram_TASK-7b920e3b.md)


## Log

- 2026-11-16 frame: journal opened
- 2026-11-16 frame: completed; next specify (7 Done checklist item(s) left unticked)
- 2026-11-16 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-16 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-16 build: red: focused input-bypass vitest exit 1 (red.log): outside analysis denied and retained guard reacquires authority after leave/re-enter; REQ-FUNC-97e4de53, REQ-SEC-88780a57.
- 2026-11-16 build: Scope audit: apply_candidate run is an agent-supplied input, so its source/candidate rechecks also reuse captured toolPathGuard; fixed model/result storage remains confined.
- 2026-11-16 build: green: focused-1 unchanged passing7files and focused-2 authoring/candidate corrections pass; focused-3 exit0 10files95passed1platformskip covers all touched electrical consumers plus HIL/input/prompt. Targeted built Windows CLI sibling analysis exit0 1passed44unselected (cli.log), actual isolated worker results canonical and no outside storage.
- 2026-11-16 build: DEVIATION validate: complete app and official-plugin suites deferred by explicit user instruction; focused affected plugin-system/CLI checks used without full acceptance claim. Native Ubuntu unavailable; WSL2 evidence is distinct.
- 2026-11-16 build: green: focused-final exit0 8files182passed, including worker cancellation/re-entry, outside candidate/import, HIL retained lifetime and program immediate consumers. Pinned WSL2 Linux24.21.0 current-source bundled assertions exit0 (wsl/result.log): sibling analysis, canonical null refs, plugin validation, registry scope, exclusions and epoch retention; no native Ubuntu claim.
- 2026-11-16 build: Review preparation caught a registry identity risk: final spawn check must resolve the original lab/resources lookup, not just rehash its formerly canonical target. Added matching-byte alias replacement regression; canonical records also normalize candidate run/import source paths.
- 2026-11-16 build: DEVIATION build: initial red shared-policy and epoch tests preceded anchor and implementation; additional plugin/HIL/electrical integration acceptance was added after implementation. All assertions are now green; sequencing deviation only, with no weakened proof.
- 2026-11-16 build: green: latest pre-review.log exit0 12files140passed2platformskips covers final registry original-lookup identity recheck, canonical input records, retained HIL source checks and all affected electrical readers/engines. Unchanged passing focused-1/2/final consumers and CLI proof reused. Candidate formatting exit0 (infos only). Advisory errors0; historical metadata and out-of-layout help/release notes warnings retained.
- 2026-11-16 build: completed; next validate
- 2026-11-16 validate: Round1 changes_required: HIL cwd remains root-only; HIL/resource specs stale; real lab-validation helper still confines approved external nested sources; generated request retains a raw source alias instead of canonical binding; strengthened registry test accidentally added an undefined marker to an earlier test. Fix these seams and rerun focused proof before both reviews.
- 2026-11-16 validate: returned to build - Independent round1 findings: HIL cwd/source consumption and helper integration, stale specs, test marker scope
- 2026-11-16 build: Round1 corrections: HIL approved cwd now bases plan/firmware/source/registry inputs; children and generated storage remain in workbench. Generated source paths are canonical, preventing raw-alias consumption. Real lab-validation0.3.0 receives host-only guard scope/exclusions for source/member reads, with default standalone confinement and fixed output unchanged. Updated governing HIL/resource/helper specs and requirements; fixed accidentally scoped test marker.
- 2026-11-16 build: green: round2-green.log exit0 3files60passed includes real Python orchestration and canonical raw-alias replacement at actual spawn, standalone/host exclusions, HIL cwd/resource env and revocation plus all program-bypass tests; targeted hil-cwd.log1passed verifies final forwarding fix. WSL2 current-source bundle plus actual Python helper exit0 (wsl/round2.log). Original real-helper result/log evidence retained windows/hil-real.
- 2026-11-16 build: green: round2-consumers.log exit0 5files76passed covers actual program-resources, program-tools, authoring/candidate and electrical import immediate consumers after corrections. Candidate Biome exit0, infos only. Earlier unchanged analysis/electrical/CLI proof reused.
- 2026-11-16 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-16 validate: Round2 spec approved; quality requests helper exclusion parity: retain configured lexical application-data roots as well as canonical roots, including a managed junction with an outward child junction. Other round1 corrections approved.
- 2026-11-16 validate: returned to build - Round2 helper lexical-plus-canonical exclusion parity
- 2026-11-16 build: red: targeted actual-helper double-junction regression exit1 (round3-red-filesystem.log): filesystem scope returned0 instead of refused2 for lexical configured-managed/outward/capture.csv.
- 2026-11-16 build: green: from05_Software, python ../02_Tools/environment/npmw.py npx vitest run tests/integration/hil-bypass.test.ts exit0,5passed (windows/round3-green.log); includes filesystem/workbench lexical double-junction refusal plus real orchestration/canonical-consumption/default-confinement cases. Narrow helper fix preserves lexical absolute and canonical excluded roots.
- 2026-11-16 build: green: python ../02_Tools/environment/npmw.py node evaluation-outputs/byp02/wsl/build.mjs exit0; wsl -d Ubuntu -- /home/dpasare/vera-cap-01/node-v24.21.0-linux-x64/bin/node /mnt/d/ProjectsDDP/2026_Virtual_Embedded_Rig_Assistant/05_Software/evaluation-outputs/byp02/wsl/check.mjs exit0 (wsl/round3.log), now including actual-helper outward-alias refusal. WSL2 is distinct from native Ubuntu.
- 2026-11-16 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-16 validate: Round3 both independent reviewers approved complete owned tracked/untracked candidate against recorded base62630967185b3dee309538b597ec5165fa3c3d68; no remaining actionable findings. Final static proof follows after candidate freeze.
- 2026-11-16 validate: final attempt: check --task TASK-7b920e3b --strict --run exit1 (windows/strict-final.log): lint has known2baseline formatter errors; typecheck found candidate test TS6307 from direct CLI-source import; i18n/help exit0; test command explicitly skipped. Correct the fixture import, rerun only affected checks, refresh both reviews and retain passing unchanged i18n/help proof.
- 2026-11-16 validate: returned to build - Final typecheck found integration fixture CLI import outside tools TypeScript project
- 2026-11-16 build: green: pinned vitest run tests/integration/hil-bypass.test.ts exit0,5passed (windows/round4-green.log) after replacing direct CLI-source import with equivalent NodeProcessHost(spawn) from the referenced core project. Production code and assertions unchanged.
- 2026-11-16 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-16 validate: Round4 both independent reviewers approve latest complete owned candidate after equivalent process-host fixture correction. Production/assertions unchanged; final proof reruns only affected/failed checks and retains unchanged i18n/help passes.
- 2026-11-16 validate: final: initial check --task TASK-7b920e3b --strict --run exit1 truthfully retained (strict-final.log); its candidate TS6307 test-fixture import is corrected. After round4 approvals, pinned npm run typecheck exit0 (typecheck-final.log); candidate-only npx biome check44files exit0,5infos (candidate-lint-final.log); npm run check:release-notes exit0,3files0errors (release-notes-final.log); strict metadata exit0,errors0 (strict-metadata-final.log). Unchanged strict-run i18n/help passes reused. Read-only baseline check2files exit1 confirms exactly2formatter errors in pre-existing untracked bundled-plugins/index.json and unchanged shared/workbench-create-ipc.test.ts.
- 2026-11-16 validate: DEVIATION validate: complete global lint remains blocked solely by two preserved baseline formatter errors; candidate-only lint, typecheck, i18n/help, release notes and strict metadata provide final narrow proof under explicit user policy. Complete app and official-plugin suites remain user-deferred; native Ubuntu unavailable and WSL2 separately labelled.
- 2026-11-16 validate: Exact retained focused commands (from05_Software through python ../02_Tools/environment/npmw.py): npx vitest run tests/integration/hil-bypass.test.ts =>5passed (round4-green.log); npx vitest run tests/integration/hil-bypass.test.ts src/libraries/core/src/plugins/hil/hil.test.ts src/libraries/core/src/plugins/program-bypass.test.ts =>60passed before newest double-alias test, with unchanged core results retained (round2-green.log); npx vitest run src/libraries/core/src/plugins/program-resources.test.ts src/libraries/core/src/plugins/program-tools.test.ts src/libraries/core/src/plugins/authoring.test.ts src/libraries/core/src/tools/apply-candidate.test.ts src/libraries/core/src/electrical/tools.test.ts =>76passed (round2-consumers.log); npx vitest run tests/integration/cli.test.ts -t 'CLI Bypass analyzes sibling inputs' =>1passed44unselected (cli.log). Additional unchanged analysis/electrical tests in pre-review.log140passed2platformskips and focused-final.log182passed. All original evidence rooted05_Software/evaluation-outputs/byp02/{windows,wsl}; actual helper originals windows/hil-real; CLI originals windows/suite-*; WSL original source/build scripts and round3.log retained.
- 2026-11-16 validate: Handover inspection: HEAD remains62630967185b3dee309538b597ec5165fa3c3d68 on master; index empty; no stage/commit/push/remote edits. Preserved unrelated PERF journal and pre-existing bundled-plugins. Owned temporary fixtures/processes closed and cleaned; removed only accidentally created empty owned scratch directories. All three bypass work packages marked implemented with TASK IDs; #308/#309 commits recorded, no permanent commit-pending plan text. Coordinator retains authorized ticket commit ownership.
- 2026-11-16 validate: completed; next done

## Rulings

- RULING-001 | date=2026-11-16 | decision=User authorizes local ticket commit by coordinator only; implementer hands back without staging or committing on shared master in autopilot. | reason=Explicit delegated sequential-cycle instruction and root AGENTS | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-7b920e3b.md
changed: BYP-02 shared input scope, retained revocation, real HIL/helper policy and current four-language guidance
evidence: Focused Windows/CLI/real-helper and WSL2 pass; both reviews approved r4; candidate lint/typecheck/i18n/help/release notes/strict metadata pass
issues: Global lint: 2 preserved baseline formatter errors; full app/plugin suites user-deferred; native Ubuntu unverified
spec_compliance: approved
implementation_quality: approved
review_round: 4

## Delivery report (2026-11-16)

- stage: validate; type: change; path: full; branch: master
- requirements:
  - REQ-FUNC-97e4de53 - Apply shared policy to agent input paths
  - REQ-SEC-88780a57 - Retain original Bypass epoch
  - REQ-FUNC-d7d7a18a - Apply shared scope to log reads
  - REQ-SEC-57d4df1d - Apply shared scope to register definition reads
  - REQ-FUNC-6d5e514a - Describe shared Bypass tool scope in the system prompt
  - REQ-SEC-3856567c - Refuse agent filesystem access to application data in every mode
  - REQ-SEC-c4553379 - Revoke outside background program access when leaving Bypass
  - REQ-FUNC-bf693078 - Validate plugin drafts
  - REQ-FUNC-ef7d2de3 - Review and install plugin drafts as trial
  - REQ-DATA-f2cbfc23 - Declare bench resources in one host-guarded registry lookup
  - REQ-SEC-d84c7986 - Classify every lab-validate operation as a safe offline analysis
- deviations: 3 recorded
  - validate: complete app and official-plugin suites deferred by explicit user instruction; focused affected plugin-system/CLI checks used without full acceptance claim. Native Ubuntu unavailable; WSL2 evidence is distinct.
  - build: initial red shared-policy and epoch tests preceded anchor and implementation; additional plugin/HIL/electrical integration acceptance was added after implementation. All assertions are now green; sequencing deviation only, with no weakened proof.
  - validate: complete global lint remains blocked solely by two preserved baseline formatter errors; candidate-only lint, typecheck, i18n/help, release notes and strict metadata provide final narrow proof under explicit user policy. Complete app and official-plugin suites remain user-deferred; native Ubuntu unavailable and WSL2 separately labelled.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=4
- diff vs task base 6263096: 90 file(s) changed, 1934 line(s) added; 9 file(s) not content-scanned
- checks: errors=0 warnings=47 notes=38
- checklist: 9/9 done
