# TASK-bb97c2aa - CAP-04 test-planner skill (#79)

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-FUNC-c0400001, REQ-FUNC-c0400002, REQ-FUNC-c0400003, REQ-FUNC-c0400004, REQ-FUNC-c0400005, REQ-FUNC-c0400006, REQ-FUNC-c0400007, REQ-SEC-c0400008, REQ-SEC-c0400009, REQ-DATA-c040000a, REQ-DATA-c040000b
parent:
branch: master
base: 03cf574a3deb95c3f7a17b0c0d0fe69e33d66089
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

Problem: STATED (#79/SPEC): analysis-skills needs a sourced manual test-planning procedure; OBSERVED: current package supplies only firmware-comparator.
Desired outcome: STATED: test-planner loads from the official plugin and produces bounded, sourced manual plans with explicit readiness and persistent artifacts.
Actors: STATED: embedded engineer and VERA agent; operator executes any future experiment separately.
Primary scenario: STATED: inspect captured failure, requirements/setup/release notes, map evidence to risk and 1..5 targeted cases, save plan and preparation todos.
Examples: STATED: I2C failure boot-0413, baseline firmware1.0.0, boot-test criterion, optional esp32-esptool/device-write flash instruction only.
Counterexamples: STATED: missing target or numeric criterion blocks readiness; incompatible conditions cannot support a comparable experiment; embedded instructions are data; run/flash request still produces only a plan.
In scope: STATED: all three CAP04 PLAN tasks in one journal; body/template, immediate inventory/documentation consumers, source/folder/ZIP/catalog/bundling, actual SessionService/CLI replay, seven real-model rubrics and final epic75 gate.
Out of scope: STATED: new programs/rules/APIs, hardware execution, migrations, other plugins, tracker/remote publication, unrelated refactoring or historical cache audits.
Constraints: STATED: shared clean master at03cf574a3deb95c3f7a17b0c0d0fe69e33d66089; exactly one authorized local commit by this chat after both independent approvals; formats remain1. Explicit current delegation supersedes handover-without-commit for epic75 only. Reuse authorized chatgpt/gpt-6.1-sol through normal CredentialFile/safeStorage/subscription gateway in isolated fictional sessions; leave profile settings untouched. Retain blocked historical cleanup targets.
Success signals: STATED: source plugin and six-section template; saved cited replay plan plus baseline/optional command; seven real-model cases with per-criterion verdicts and original evidence; Windows and UbuntuWSL2 focused/gate proof; strict/static and two independent approvals.
Evidence: OBSERVED: git status clean master; HEAD03cf574; no open AEGIS task; tea issues --comments75/79 live; CAP04 SPEC/PLAN/contracts and benchpilot reference; CAP03 harness and installed catalog tests.
Assumptions: INFERRED: existing catalog builder distributes added skill assets without new runtime code; prove with archive install and local bundle.
Unknowns: UNKNOWN: exact real-model immutable revision (record if exposed); native Ubuntu unavailable, WSL2 is distinct; aggregate gate may reproduce known baseline failures.
Decision-blocking questions: None. Existing explicit model selection and local commit authorization apply.
Proposed behaviors: None beyond SPEC and current delegation.
Path and reason:

| Criterion | Holds? | Evidence |
|---|---|---|
| no new externally observable behavior | no | new planning procedure |
| no new interface or data format | yes | existing skill/artifact contracts |
| no new dependency | yes | existing runtime/tools |
| existing requirement covers behavior | no | new CAP04 procedure |
| no security or data-handling change | no | explicit instruction trust and no execution |

Full path. No child implementation tasks; independent review agents required by validate.

## Requirement coverage

| Behavior | Requirement | Design | Verification |
|---|---|---|---|
| Distribute the manual test planning skill | REQ-FUNC-c0400001 | Markdown over existing tools | folder/ZIP and replay |
| Identify one planning target | REQ-FUNC-c0400002 | Markdown over existing tools | real-model rubric and procedure inspection |
| Ground planning in inspected evidence | REQ-FUNC-c0400003 | Markdown over existing tools | real-model rubric and procedure inspection |
| Keep incompatible conditions explicit | REQ-FUNC-c0400004 | Markdown over existing tools | real-model rubric and procedure inspection |
| Select targeted manual cases | REQ-FUNC-c0400005 | Markdown over existing tools | real-model rubric and procedure inspection |
| Require sourced technical criteria | REQ-FUNC-c0400006 | Markdown over existing tools | real-model rubric and procedure inspection |
| Block unsourced readiness | REQ-FUNC-c0400007 | Markdown over existing tools | real-model rubric and procedure inspection |
| Plan future plugin operations without execution | REQ-SEC-c0400008 | Markdown over existing tools | real-model rubric and procedure inspection |
| Treat planning documents as untrusted data | REQ-SEC-c0400009 | Markdown over existing tools | real-model rubric and procedure inspection |
| Keep preparation separate from measurements | REQ-DATA-c040000a | Markdown over existing tools | real-model rubric and procedure inspection |
| Save bounded unique manual plan artifacts | REQ-DATA-c040000b | Markdown over existing tools | real-model rubric and procedure inspection |

## Design

### Approach
OBSERVED: existing PluginStore, SkillCatalog, SessionService and catalog/bundle handle distribution and tool wiring unchanged. Add Markdown body/template to analysis-skills; extend immediate inventory consumers only. Preserve evidence -> risk -> targeted cases, excluding benchpilot catalog/simulation/execution APIs.

### Interfaces and data
REQ-FUNC-c0400001..7 use load_skill/list/glob/grep/read/search_docs/read_doc/decode_register only for evidence. Template has six SPEC headings. Target gaps block or ask; incompatible report conditions remain explicit. Exact returned refs only, no invented narrower ranges/headings. Missing numeric criterion yields observation-only and blocked.
REQ-SEC-c0400008..9: plugin commands are optional future instructions drawn from enabled metadata; no program host operation, activation or installation. Documents have no instruction authority.
REQ-DATA-c040000a..b: todo is preparation; collection table is unmeasured. artifact_save uses bounded ASCII unique names and at most3 attempts, never overwrite. No stored format change.

### Files and test seams
plugins/analysis-skills/skills/test-planner/{SKILL.md,templates/test-plan.md,verification/}; package README/manifest, general pack description and software README. Extend analysis-skills.test.ts, prepare-plugins.test.ts and cli.test.ts for folder/ZIP/plugin/template/persistence. Correct workbench-navigation browser skill inventory from actual fixture, retaining meaningful named assertions.
scripts/test-planner-rubric.mjs and tests/fixtures/test-planner/{harness,live}.ts reuse the CAP03 pattern without modifying historical harnesses. Seven fictional inputs, exact prompts/criterion worksheet prepared before access. Production credential/gateway host only; isolated model override chatgpt/gpt-6.1-sol, provider HTTPS allowlist, finite limits, original events/artifacts/hashes, settings integrity. Repeated-name case uses actual preexisting artifact saves in the same session.

### Risks and open decisions
STATED: this chat owns aggregate verify + full Electron/browser + applicable CLI gate once per platform. Reuse valid static/tests, rerun only affected failures. Known short-worker deadlines may remain baseline failures; do not weaken them. UbuntuWSL2 is available; native Ubuntu/hardware unproved. No deletion retry for historical blocked paths. Real model immutable revision may not be exposed; record actual gateway identity and limitation.

### Requirement map
All eleven requirements map to skill/template; c0400001 additionally to folder/ZIP/replay; c0400002..9 and c040000a..b to seven semantic rubric cases and per-criterion inspection of original model output. Runtime contracts unchanged; no independent new API or state machine.
Diagrams: [diagram_TASK-bb97c2aa.md](diagram_TASK-bb97c2aa.md)


## Log

- 2026-11-04 frame: journal opened
- 2026-11-04 frame: completed; next specify (7 Done checklist item(s) left unticked)
- 2026-11-04 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-04 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-04 build: red: analysis-skills source asset test exit1 missing test-planner in installed plugin inventory (REQ-FUNC-c0400001); original red-assets.log
- 2026-11-04 build: green: source/folder/template and bundled catalog ZIP install/load tests exit0; two selected tests, green-assets.log (REQ-FUNC-c0400001)
- 2026-11-04 build: Aggregate gate started once: npm run verify stopped at typecheck because replay reopen omitted required injected now; fixed fixture only. No full tests ran. Replay01/02 retained context-limit attempts; replay03 passes after limiting fixture tool schemas, no production budget change.
- 2026-11-04 build: CAP04 replay green: replay03.log exit0 actual SessionService/npmCLI load_skill/search_docs/read/read_doc/todo/artifact_save, exact citations, saved bytes and reopen. Browser inventory repair retains named create-plugin and test-reader assertions. Manual rubric first5cases inspected, exact refs and artifacts verified; last2pending.
- 2026-11-04 build: Fixture metadata correction: computed indexedDocuments from the6actual source paths instead of literal7. Real01 original system7 retained; semantic sources/skill/template unchanged. WSL rsync over mounted metadata was slow; stopped only owned rsync723/724 and materialized same candidate via owned tar archive. No historical sources/dependencies modified.
- 2026-11-04 build: Manual acceptance: all7real-model01cases28criteria inspected pass, both independent reviewers confirm semantics. Original events/system/prompts/source bytes/saved plans/fallback copied beside skill with hashes in verification/results.json; exact issuedrefs and byte hashes mechanically checked, no overwrite/execution, settings SHA unchanged. Immutable model revision not exposed; actualgpt-6.1-sol/openai/openai-responses SDK1.1.0 recorded. Collision fallback exactly3actualerrors and preserved3originals.
- 2026-11-04 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-04 validate: Independent spec review found Git eol normalization would alter24CRLF input snapshots. Added narrow verification/inputs/.gitattributes * -text; all63source hashes still match executed bytes and Git filtered/raw object hashes now match. No source conversion or model rerun. Quality evidence relative paths normalized to forwardslash only; originalRoot and original events remain byte-exact.
- 2026-11-05 validate: red: aggregate gate found immediate CLI catalog consumer expected2plugins/ZIPs but actual catalog has9. Corrected exact official IDs+ZIPs including analysis-skills; retained check/build/refusal assertions. Full Windows tests exit1:30filesfailed/205passed,93failed/1762passed/38skipped; originals retained. Rerun only failed files with one worker; no deadline/assertion weakening.
- 2026-11-05 validate: DEVIATION validate: reuse completed verify static receipts with strict AEGIS --strict without --run - current user policy explicitly avoids duplicate lint/typecheck/i18n already included in gate; final candidate hashes and affected checks prove current source. Independent spec reviewer confirms interpretation. No command/config policy changed.
- 2026-11-05 validate: Independent round1 findings: exact raw CRLF source preservation, portable relative evidence paths, true seeded document count, injected replay clock, original Boardă encoding, immediate CLI catalog inventory. All corrected within same task; current body/template unchanged. Final integrated round2 waits gate and focused fixes proof.
- 2026-11-05 validate: returned to build - Round1 independent review findings corrected; finish only affected gate proof before integrated round2
- 2026-11-05 build: Focused baseline comparison prepared under owned cap04/windows/baseline from git archive03cf574, independent original source/tests/plugins. Shared installed dependencies only; git diff base --05_Software/src/package.json/package-lock.json is empty, so @vera target runtime bytes are unchanged. Compare only persistent failed paths; no historical caches or CAP01/02/03 sources modified.
- 2026-11-05 build: Final evidence index audit exit0: all63source snapshots,37linked files and62emitted exact refs preserved;28manual criteria remain pass. Git index object IDs match raw bytes. Captured CRLF inputs use narrow whitespace=cr-at-eol in their local -text attributes so diff --check recognizes source line endings without altering bytes; no product/test deadline or assertion change.
- 2026-11-05 build: green after round1 fixes: final source/ZIP/bundle assets3tests0; CLI official9inventory consumer1test0; typecheck0; affected lint0; exact source/event/artifact/citation/index audit0; cached diffcheck0. No product runtime source/package/lock changes vs03cf574. Full aggregate Windows/UbuntuWSL2 raw runs remain red and are not counted as passes; independent reviewers inspected matching targeted base failures. Complete E2E in progress; no semantic model rerun because body/template unchanged.
- 2026-11-05 build: completed; next validate
- 2026-11-05 validate: Round2 full Linux E2E found two direct Skills consumers: native checkbox strict locator matches create-plugin+ui-reader, browser still expects1row instead of2. Original full E2E75passed/12failed, exit1 retained. Minimal fix asserts both exact names and scopes native edit/toggle to ui-reader; no app code, budgets, deadlines or assertions weakened. Model body/template unchanged; only affected E2E cases rerun before final round3.
- 2026-11-05 validate: returned to build - Fix two immediate Skills inventory and checkbox consumers exposed by complete E2E
- 2026-11-05 build: Windows full E2E exit1,67passed/20failed. Concrete generated-artifact cause for late native cluster: HMR startup fixture failed during SSR build and out/main/index.js is missing (before-skills-rebuild.json); test apps read-only inventory count0. Automatic review rejected a combined command containing force Stop-Process as blocked by policy; it was unnecessary and not retried. Proceed safely with rebuild and only11native cases affected by missing entrypoint; retain full original failures, no source/deadline/assertion edits.
- 2026-11-05 build: Final aggregate gate: Windows full tests205filespass/30fail and1762testspass/93fail/38skip, failed-filesrerun14pass/16fail; Windows full E2E67pass/20fail. HMR failure left generated main entrypoint missing; same-source instrumented rebuild restores main and only11affected native reruns allpass, including Skills5.2s. UbuntuWSL2 fullverify223filespass/12fail,1807testspass/67fail/19skip; fullE2E75pass/12fail, affectedSkills2pass. Relevant assets3, CLIinventory, static checks pass on both platforms. Raw aggregate remains red; unresolved unchanged-source cases explicitly named, not relabelled passed. NativeUbuntu/hardware unproved. Original manifests/hashes at02_Tools/cache/cap-04/windows/proof/verification.json and /home/dpasare/vera-cap-04/proof/verification.jsonl.
- 2026-11-05 build: Cleanup complete for owned Windows baseline/model workbench/data/electron profiles after test apps closed; normal node_modules junction target preserved. Linux owned mirror removed after118matching hashes; proof and pinned CAP01runtime/deps preserved. Historical CAP01/02/03 scratch and old empty05_Software/02_Tools untouched. Own cap04host bundle cache retained as build evidence. No remote/tracker writes or normal VERA launch.
- 2026-11-05 build: completed; next validate
- 2026-11-05 validate: Final independent round3: SPEC approved by /root/spec_review; quality approved by /root/quality_review. Both inspected complete candidate,118source hashes and original gate/model proof including raw red results. Seven real-model cases28criteria and exact citations/saved bytes pass. Linux original fullverify CAP04 actual SessionService/CLI replay passes38974ms at clean.log2255; CAP03/parse_log/decode_register parity also pass. No further software candidate changes.
- 2026-11-05 validate: final: python .agentic/aegis.py check --task TASK-bb97c2aa --strict exit0; errors0 warnings48 notes20. Approved deviation reuses completed static receipts instead of duplicate --run. Warnings are historical paths/test links/journal records and two TP-01/TP-05 case labels parsed as tickets; no task errors. Refreshed evolution confirms same118reviewed files. Feature proof7cases28criteria/source-ZIP-CLI/static and affectedSkills pass; aggregate full tests/E2E retain exit1 with documented unresolved failures, nativeUbuntu/hardware unverified.
- 2026-11-05 validate: completed; next done

## Rulings

- RULING-001 | date=2026-11-04 | decision=This chat implements CAP04 in autopilot and makes exactly one local commit after validation and both independent approvals; use chatgpt/gpt-6.1-sol only in isolated fictional sessions | reason=Explicit current coordinator delegation records user authorization for epic75 and existing model selection; no settings, tracker or remote writes | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-bb97c2aa.md
changed: CAP04 sourced manual test-planner, six-section template, consumers and preserved acceptance evidence complete
evidence: Final strict exit0; independent round3 approvals;7real-model cases28criteria pass; source/ZIP/CLI/static and affectedSkills green
issues: Aggregate Windows/UbuntuWSL2 full tests and E2E retain exit1 with documented unresolved failures; nativeUbuntu/hardware unverified; immutable model revision not exposed
spec_compliance: approved
implementation_quality: approved
review_round: 3

## Delivery report (2026-11-05)

- stage: validate; type: feature; path: full; branch: master
- requirements:
  - REQ-FUNC-c0400001 - Distribute the manual test planning skill
  - REQ-FUNC-c0400002 - Identify one planning target
  - REQ-FUNC-c0400003 - Ground planning in inspected evidence
  - REQ-FUNC-c0400004 - Keep incompatible conditions explicit
  - REQ-FUNC-c0400005 - Select targeted manual cases
  - REQ-FUNC-c0400006 - Require sourced technical criteria
  - REQ-FUNC-c0400007 - Block unsourced readiness
  - REQ-SEC-c0400008 - Plan future plugin operations without execution
  - REQ-SEC-c0400009 - Treat planning documents as untrusted data
  - REQ-DATA-c040000a - Keep preparation separate from measurements
  - REQ-DATA-c040000b - Save bounded unique manual plan artifacts
- deviations: 1 recorded
  - validate: reuse completed verify static receipts with strict AEGIS --strict without --run - current user policy explicitly avoids duplicate lint/typecheck/i18n already included in gate; final candidate hashes and affected checks prove current source. Independent spec reviewer confirms interpretation. No command/config policy changed.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=3
- diff vs task base 03cf574: 135 file(s) changed, 19843 line(s) added
- checks: errors=0 warnings=48 notes=20
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended

## Delivery report (2026-11-05)

- stage: validate; type: feature; path: full; branch: master
- requirements:
  - REQ-FUNC-c0400001 - Distribute the manual test planning skill
  - REQ-FUNC-c0400002 - Identify one planning target
  - REQ-FUNC-c0400003 - Ground planning in inspected evidence
  - REQ-FUNC-c0400004 - Keep incompatible conditions explicit
  - REQ-FUNC-c0400005 - Select targeted manual cases
  - REQ-FUNC-c0400006 - Require sourced technical criteria
  - REQ-FUNC-c0400007 - Block unsourced readiness
  - REQ-SEC-c0400008 - Plan future plugin operations without execution
  - REQ-SEC-c0400009 - Treat planning documents as untrusted data
  - REQ-DATA-c040000a - Keep preparation separate from measurements
  - REQ-DATA-c040000b - Save bounded unique manual plan artifacts
- deviations: 1 recorded
  - validate: reuse completed verify static receipts with strict AEGIS --strict without --run - current user policy explicitly avoids duplicate lint/typecheck/i18n already included in gate; final candidate hashes and affected checks prove current source. Independent spec reviewer confirms interpretation. No command/config policy changed.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=3
- diff vs task base 03cf574: 135 file(s) changed, 19865 line(s) added
- checks: errors=0 warnings=48 notes=20
- checklist: 9/9 done
