# TASK-86a7c2d9 - CAP-03 firmware-comparator skill (#78)

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-FUNC-c0300001, REQ-FUNC-c0300002, REQ-FUNC-c0300003, REQ-FUNC-c0300004, REQ-REL-c0300005, REQ-REL-c0300006, REQ-FUNC-c0300007, REQ-FUNC-c0300008, REQ-SEC-c0300009, REQ-SEC-c030000a, REQ-DATA-c030000b, REQ-REL-c030000c, REQ-REL-b434edc8, REQ-REL-3d156d23
parent:
branch: master
base: 325311b39279cf49f310c5ebdc2b4952cebed1ec
opened: 2026-11-04

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

Problem: STATED (#78): captured firmware runs need a sourced comparison procedure in VERA.
Desired outcome: STATED: official analysis-skills package loads firmware-comparator and its seven-section template; comparisons identify conditions, cite captured evidence, preserve limitations and save an artifact.
Actors: STATED: embedded engineer and VERA agent.
Primary scenario: STATED: boot-0412 baseline versus boot-0413 candidate on the fictional demo-board, firmware1.0.0 versus1.1.0.
Examples: STATED: comparable notes, error0->1 citing candidate L4, criterion met->not met; documented I2C timing change without invented cause.
Counterexamples: STATED: different revision blocks comparability; ambiguous runs require a question; incomplete/changed sources cannot support complete claims.
In scope: STATED: all three CAP03 PLAN steps in this one task; official package/catalog/bundling, schema/load/template integration, real SessionService and CLI replay, seven real-model rubric cases and evidence.
Out of scope: STATED (delegation): CAP04 implementation, hardware execution, remote publication, tracker changes, migrations, unrelated repairs and cycle JSON edits.
Constraints: STATED: shared master, recorded base325311b39279cf49f310c5ebdc2b4952cebed1ec; one local commit only after all acceptance and both independent approvals. Current delegation explicitly authorizes this implementer to commit, superseding coordinator-only handover for this cycle. All stored formats stay1. Existing user profile is read through normal credential host only; isolated fictional workbenches/output, no secret disclosure or account/key setup.
Success signals: STATED: schema accepts skills-only manifest; source plugin load and seven template sections; actual saved replay artifact; seven separately recorded real-model cases; focused Windows/UbuntuWSL2 proof, static/strict and independent spec/quality approvals.
Evidence: OBSERVED: clean master at325311b; no open tasks; live tea issues75/78 including comments; SPEC/PLAN/contracts; existing PluginStore/SkillCatalog/catalog preparation and cli.test.ts parity patterns.
Assumptions: INFERRED: current catalog source packaging automatically includes a listed official package; prove through release build and zip install.
Unknowns: UNKNOWN: configured chatgpt/gpt-4 availability and model revision; native Ubuntu host unavailable (WSL2 is distinct).
Decision-blocking questions: None before preparing fixtures/harness/rubric and checking configured model through existing host. If inaccessible, record concrete blocker; no false completion or commit.
Proposed behaviors: None beyond cited SPEC and delegation.
Path and reason:

| Criterion | Holds? | Evidence |
|---|---|---|
| no new externally observable behavior | no | new comparison skill |
| no new interface or data format | yes | existing plugin/skill/artifact contracts |
| no new dependency | yes | existing tools and runtime |
| existing requirement covers all behavior | no | CAP03 procedure new |
| no security or data-handling change | no | explicit untrusted-data procedure |

Full path; no child implementation tasks. Independent reviews use separate reviewers as required by validate.

## Requirement coverage

| Behavior | Requirement | Design | Verification |
|---|---|---|---|
| Distribute the captured comparison skill | REQ-FUNC-c0300001 | Markdown procedure over unchanged platform | schema/catalog/load replay |
| Resolve the comparison runs explicitly | REQ-FUNC-c0300002 | Markdown procedure over unchanged platform | real-model rubric plus procedure inspection |
| Qualify run comparability | REQ-FUNC-c0300003 | Markdown procedure over unchanged platform | real-model rubric plus procedure inspection |
| Compare cited captured evidence | REQ-FUNC-c0300004 | Markdown procedure over unchanged platform | real-model rubric plus procedure inspection |
| Preserve partial scan limits | REQ-REL-c0300005 | Markdown procedure over unchanged platform | real-model rubric plus procedure inspection |
| Pin additional event reads | REQ-REL-c0300006 | Markdown procedure over unchanged platform | real-model rubric plus procedure inspection |
| Constrain register interpretation | REQ-FUNC-c0300007 | Markdown procedure over unchanged platform | real-model rubric plus procedure inspection |
| Evaluate sourced criteria | REQ-FUNC-c0300008 | Markdown procedure over unchanged platform | real-model rubric plus procedure inspection |
| Limit binary inspection | REQ-SEC-c0300009 | Markdown procedure over unchanged platform | real-model rubric plus procedure inspection |
| Treat captured instructions as data | REQ-SEC-c030000a | Markdown procedure over unchanged platform | real-model rubric plus procedure inspection |
| Save the sourced comparison report | REQ-DATA-c030000b | Markdown procedure over unchanged platform | real-model rubric plus procedure inspection |
| Report unavailable tools | REQ-REL-c030000c | Markdown procedure over unchanged platform | real-model rubric plus procedure inspection |
| Preserve public OAuth scope words | REQ-REL-b434edc8 | Exempt six documented public permission names only; retain other secrets | credential load/reload regression |
| Preserve optional live tool arguments | REQ-REL-3d156d23 | Live ChatGPT model advertises strict-flag support so SDK emits strict:false | actual SDK payload regression plus real model |


## Design

### Approach
OBSERVED: PluginStore, SkillCatalog, SessionService, catalog builder and bundled staging already provide all runtime seams.
REQ-FUNC-c0300001: add one skills-only package and official/general pack entries; reuse those seams unchanged.
REQ-FUNC-c0300002,c0300003,c0300004,c0300007,c0300008: express the sourced procedure and seven sections as Markdown, not another evaluator/API.
REQ-REL-c0300005,c0300006,c030000c and REQ-SEC-c0300009,c030000a: explicit partial/conflict/untrusted-data/safe-only branches in the procedure.
REQ-DATA-c030000b: template plus bounded collision handling through existing artifact_save.

### Interfaces and data
Existing load_skill{name,file}, parse_log{path,profile,expectedSha256}, read/search_docs/read_doc, decode_register and artifact_save contracts stay unchanged.
Firmware identity is the intentional A/B variable; missing required identity or mismatched board/revision/unit/procedure/setup blocks comparability. Image hash is recorded when known, not invented.
The real-model harness copies only fictional demo inputs, isolates DB/settings/artifacts and uses the production createPiAiGateway with normal CredentialFile/safeStorage/subscriptionStore. Electron initializes the existing profile's encryption context for credentials only, then switches to an isolated profile; only a normal OAuth refresh can persist credentials. Settings are never written, and their SHA is checked. Safe model metadata and source/script/skill hashes enter evidence; secrets do not.
Fault cases wrap actual registry tools only at the fixture seam: bounded incomplete result and deterministic post-parse mutation, both explicitly labelled in proof.

### Files and test seams
plugins/analysis-skills/{plugin.yaml,README.md,skills/firmware-comparator/{SKILL.md,templates/comparison.md,verification/}}.
tests/integration/analysis-skills.test.ts validates installation/load/catalog/bundle; cli.test.ts provides actual SessionService/CLI replay and saved artifact.
scripts/firmware-comparator-rubric.mjs plus fixture harness implement opt-in real-model runs, exact prompts, allowlisted provider egress, original events/report and human verdict recording.
Immediate catalog/packaging consumers are adjusted only where they assert official inventory.

### Risks and open decisions
OBSERVED: configured chatgpt/gpt-4 is absent from the usable live catalog. RULING-002 selects chatgpt/gpt-6.1-sol only for isolated sessions; no substitute replay semantic claim. Real06 plus the affected ambiguity07 rerun supply seven passing cases and34 explicit criterion verdicts, with prior failures and original hashes retained beside the skill.
STATED: no profile provider/model edits; no new key/account/login bypass. Full npm run verify gate remains#79/coordinator. Native Ubuntu unverified; Linux proof labelled Ubuntu WSL2.

### Requirement map
All twelve requirements map to the procedure/template and seven semantic rubrics; REQ-FUNC-c0300001 additionally maps to schema/load/catalog/bundle tests and REQ-DATA-c030000b to saved replay bytes.
REQ-REL-b434edc8 and REQ-REL-3d156d23 are narrow immediate-consumer repairs discovered by actual model04/05: OAuth public scope words must not redact tool keys; Responses must explicitly preserve optional arguments. They change no stored schema or user provider/model settings. Original failed attempts are retained, not passed over.
Diagrams: [diagram_TASK-86a7c2d9.md](diagram_TASK-86a7c2d9.md)


## Log

- 2026-11-04 frame: journal opened
- 2026-11-04 frame: completed; next specify (7 Done checklist item(s) left unticked)
- 2026-11-04 specify: completed; next design
- 2026-11-04 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-04 build: red: focused analysis-skills.test.ts exit1 ENOENT missing plugin.yaml (REQ-FUNC-c0300001); original red-assets.log
- 2026-11-04 build: green: schema/source-plugin/template and local bundled catalog tests exit0,2files2tests; assets-packaging.log. Replay correction in progress: npm CLI reopens and reindexes documents, so seed-only chunks cannot serve read_doc; use actual CLI index before parity replay.
- 2026-11-04 build: Real-model preflight: normal CredentialFile+safeStorage profile context and existing OAuth refresh succeed HTTP200; live models HTTP200. Configured chatgpt/gpt-4 absent. Available refs gpt-6.1-sol,gpt-6-astra,gpt-6.1-terra,gpt-6-sol,gpt-6-luna,gpt-5.6-sol,gpt-5.6-terra,gpt-5.6-luna. Seven prepared cases remain pending, no model inference fabricated. Evidence real-model-03/{configured-model,model-metadata,blocker,egress,profile-integrity}.json. SettingsSHA unchanged; no key copied. Choice required before semantic runs; independent local validation continues.
- 2026-11-04 build: Model-choice blocker resolved by explicit user selection; continue build/real-model acceptance. Normal CredentialFile token refresh succeeded using original safeStorage context, then Electron userData switches to isolated output before tests. No settings changes or secret copies.
- 2026-11-04 build: Real-model04 comparable attempt exposed immediate consumer defect: public OAuth scopes include profile; CredentialFile.register retained it as a secret, gateway replaced the parse_log profile argument key with REDACTED. Original failed transcript retained, no semantic pass claimed. Stopped owned model04 host to prevent repeated invalid calls. Minimal public-scope redaction fix required for CAP03 actual use; access/refresh/unknown extension secret retention preserved. Review1 quality also requests >200-event conflict fixture and catalog-zip install coverage; fixing before next semantic run.
- 2026-11-04 build: Stopped model05 after confirming optional arguments forced by missing Responses strict:false: bundled pi-ai getCompat defaults supportsStrictMode=false so it omits strict; live ChatGPT models are reconstructed without compat. OpenAI official function-calling docs confirm Responses normalizes omitted strict into strict mode. Minimal live-catalog metadata compat.supportsStrictMode=true makes SDK explicitly send strict:false and keeps VERA optional params optional. Existing user auth reuse/no-new-key instruction already authorizes access, no credential setup needed.
- 2026-11-04 build: red/green immediate consumers: red-scope.log exit1 masks profile/email; scope-consumers.log exit0 24tests. red-optional.log exit1 missing strict:false; provider-packaging.log exit0 5files53tests including actual SDK payload and catalog-zip install/load. Source faults2tests exit0; Windows typecheck-6 exit0. Original failed real04/05 attempts retained. Model06 now executes minimal parse/read_doc successfully; comparable artifact saved. Full gate remains CAP04/coordinator, no full suite run.
- 2026-11-04 build: DEVIATION build: added two narrow immediate-consumer repairs (public OAuth scope-word registration and live Responses optional-parameter projection) - actual mandated model runs demonstrated both block CAP03; no provider/profile setting change, migration or unrelated refactoring. Synthetic red/green regressions and retained failed attempts support the fixes.
- 2026-11-04 build: DEVIATION build: automatic approval review rejected removal of this task accidentally created empty05_Software/02_Tools subtree with blocked by policy - retained, no alternative deletion attempted. No CAP01/CAP02 scratch touched. Windows relevant immediate consumers exit0 5files50passed1skipped; Linux focused-final55tests exit0, replay-2 exit0. Real-model06 first four cases pass inspected rubric behavior, originals retained.
- 2026-11-04 build: Independent round2 exact-provenance review found ambiguous06 invented narrower refs #L5-L12/#L3-L14 (Vera invalid), though valid full ref supports facts. That attempt is failed, not graded pass. Both reviewers independently accept an ambiguity-branch-only guard and identical-prompt rerun, retaining six unaffected explicitly-selected-case proofs with old hashes per focused policy. All six artifact/final ref sets were independently checked exactly against successful tool provenance. Raw failed06 retained.
- 2026-11-04 build: Manual acceptance complete: seven cases34criteria pass in verification/results.json, six original saved report bytes plus exact prompts and successful ambiguity07 question; failed ambiguous06 and failed/stopped04/05 retained. Exact artifact-body/final refs mechanically checked against successful structured tool provenance, final citation flags true, artifact hashes/sections/no-overwrite/no-execution verified. Six unchanged explicit-pair branches reuse06 with original bodySHA; reviewers confirmed only3 ambiguity-question guard lines differ. Current-model immutable snapshot not separately exposed; actual gateway gpt-6.1-sol/openai/openai-responses and SDK1.1.0 recorded, not invented. Settings SHA unchanged in06/07. Default local bundle now9officialplugins exit0; final Windows affected assets3tests exit0. Baseline worker1s/skills browser limitations untouched; nativeUbuntu unproved; fullgate79/coordinator.
- 2026-11-04 build: completed; next validate
- 2026-11-04 validate: Final Windows check --task TASK-86a7c2d9 --strict --run exit0: lint0,typecheck0,i18n0; test skipped by explicit project policy. errors0,warnings52,notes20.46 warnings belong to unchanged old requirements/journals; six uncovered-source advisories are supporting harness/scripts/tests/tsconfig whose manual/linked proof is explicitly recorded under CAP03 requirements and test seams, not unverified product behavior. No unrelated historical-record repair. UbuntuWSL2 lint environment first lacked root gitignore, then external manifest symlink caused Biome internal diagnostics despite exit0; typecheck initially resolved old CAP01 workspace aliases through borrowed whole node_modules. Fixed owned mirror layout/workspace links/cache/manifest without changing candidate or vendor dependencies; rerun only affected lint/typecheck; original failures retained.
- 2026-11-04 validate: final: check --task TASK-86a7c2d9 --strict --run exit0 after both independent round3 approvals; Windows lint/typecheck/i18n0; UbuntuWSL2 final owned-view lint/typecheck/i18n0, no internal Biome errors. Original setup-failure diagnostics retained as superseded environment proof, not product green. Final Windows/Linux affected assets3tests0; original focused/provider/immediate/CLI proof reused.34 software candidate byte hashes match between reviewed Windows source and Linux mirror; original command/exits manifests at02_Tools/cache/cap-03/windows/proof/verification.json and/home/dpasare/vera-cap-03/proof/verification.json. No test model Electron app running; original user settings SHA unchanged; no remote writes. Full aggregate verify remains79/coordinator, nativeUbuntu unproved, legacy worker/browser limitations untouched.
- 2026-11-04 validate: Final independent review evidence: /root/spec_review round3 approved, /root/quality_review final round3 integrated candidate approved. All7 cases34criteria and exact body/final refs reviewed, artifact/prompts/hashes recorded beside skill; no remaining actionable findings. Windows source/master/base frozen and Git diff --check exit0. Final Linux manifest confirms34 source hashes match candidate; superseded setup-only failures remain named. No code/config/test changes after final strict proof; closing records only.
- 2026-11-04 validate: Cleanup observed: Linux owned05_Software mirror and scratch removed after verifying no owned process and34 matching hashes; originals and cleanup.json retained in/home/dpasare/vera-cap-03/proof. CAP01 runtime/deps and CAP01/02 Windows scratch untouched. Windows empty accidental05_Software/02_Tools and owned ignored proof/bundle data retained after approval-policy cleanup rejection; no alternative Windows deletion. No test Electron process remains. Local #78 commit remains authorized, exact parent325311b/master; no further implementation or commit planned after handover.
- 2026-11-04 validate: completed; next done

## Rulings

- RULING-001 | date=2026-11-04 | decision=Implement in autopilot on shared master; this implementation chat makes exactly one local #78 commit after complete acceptance and independent reviews | reason=Current coordinator delegation records explicit user authorization and supersedes handover without commit only for this cycle; no remote writes | source=user | supersedes=none
- RULING-002 | date=2026-11-04 | decision=Use chatgpt/gpt-6.1-sol for all seven isolated real-model cases; retain user defaultModel unchanged | reason=User selected the recommended available model in response to live catalog evidence that chatgpt/gpt-4 is absent | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-86a7c2d9.md
changed: CAP03 complete; seven real-model cases34criteria; independent reviews approved round3
evidence: strict/static exit0; focused/CLI exit0 on Windows and UbuntuWSL2; original proof manifests retained
issues: NativeUbuntu unverified; epic aggregate gate79/coordinator; Windows owned cleanup rejected, data retained
spec_compliance: approved
implementation_quality: approved
review_round: 3

## Delivery report (2026-11-04)

- stage: validate; type: feature; path: full; branch: master
- requirements:
  - REQ-FUNC-c0300001 - Distribute the captured comparison skill
  - REQ-FUNC-c0300002 - Resolve the comparison runs explicitly
  - REQ-FUNC-c0300003 - Qualify run comparability
  - REQ-FUNC-c0300004 - Compare cited captured evidence
  - REQ-REL-c0300005 - Preserve partial scan limits
  - REQ-REL-c0300006 - Pin additional event reads
  - REQ-FUNC-c0300007 - Constrain register interpretation
  - REQ-FUNC-c0300008 - Evaluate sourced criteria
  - REQ-SEC-c0300009 - Limit binary inspection
  - REQ-SEC-c030000a - Treat captured instructions as data
  - REQ-DATA-c030000b - Save the sourced comparison report
  - REQ-REL-c030000c - Report unavailable tools
  - REQ-REL-b434edc8 - Preserve public OAuth scope words in analysis tool arguments
  - REQ-REL-3d156d23 - Preserve optional arguments for live ChatGPT tools
- deviations: 2 recorded
  - build: added two narrow immediate-consumer repairs (public OAuth scope-word registration and live Responses optional-parameter projection) - actual mandated model runs demonstrated both block CAP03; no provider/profile setting change, migration or unrelated refactoring. Synthetic red/green regressions and retained failed attempts support the fixes.
  - build: automatic approval review rejected removal of this task accidentally created empty05_Software/02_Tools subtree with blocked by policy - retained, no alternative deletion attempted. No CAP01/CAP02 scratch touched. Windows relevant immediate consumers exit0 5files50passed1skipped; Linux focused-final55tests exit0, replay-2 exit0. Real-model06 first four cases pass inspected rubric behavior, originals retained.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=3
- diff vs task base 325311b: 55 file(s) changed, 2686 line(s) added
- checks: errors=0 warnings=52 notes=20
- checklist: 8/9 done; open: `report` appended
