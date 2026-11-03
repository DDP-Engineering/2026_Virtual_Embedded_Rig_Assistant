# TASK-bc643d04 - PLG-19 probe-rs plugin

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-FUNC-19b10001, REQ-SEC-19b10002, REQ-SEC-19b10003, REQ-SEC-19b10004, REQ-SEC-19b10005, REQ-SEC-19b10006, REQ-UX-19b10007, REQ-UX-19b10008, REQ-UX-19b10009, REQ-UX-19b1000a, REQ-PLAT-19b1000b
parent:
branch: master
base: 80133a0a1b0ec3a178b7933c856cf6abfef8ce4d
opened: 2026-11-03

Edit Frame, Requirement coverage and Design directly. Write State, Log and
Rulings with `python .agentic/aegis.py` (advance, pause, log, ruling, verdict);
end each session with `advance` or `pause`.

## Done checklist (current stage)

- [x] diff reviewed against scope, requirements, design, error paths,
      portability, security and unrequested work
- [x] knowledge pages of changed components current with the reviewed code
- [x] project and environment context reconciled with the candidate
- [x] requirements re-read: status, prose, verification, paths and links true
- [x] manual or inspection verification disposition recorded; real three-board and RTT acceptance explicitly deferred by user RULING-001 and remains outstanding
- [x] explicit review approved, when enabled
- [x] final `check --strict --run` result logged truthfully after the last edit
- [x] remaining warnings and pre-existing failures explained
- [x] `report` appended

## Frame

Problem: STATED PLG-19 needs an official vendor-neutral probe-rs package; OBSERVED no probe-rs package exists at the recorded clean base.
Desired outcome: STATED pinned 0.32.0 provisioning, highest-risk rules and four skills for connect/flash/RTT/inspection through existing program tools.
Actors: STATED embedded engineer and VERA agent; coordinator verifies and commits the uncommitted candidate.
Primary scenario: STATED identify an explicitly selected target, download the exact build ELF with hash-bound approval, verify/reset, read a register and stream/stop background RTT.
Examples: STATED STM32 Nucleo/ST-Link, RP2040/CMSIS-DAP, ESP32-C3/USB-JTAG on Windows and Linux.
Counterexamples: STATED arbitrary memory write is irreversible; any --host and interactive/server commands are blocked even when lower rules match.
In scope: STATED official manifest, catalog entry, four skills, focused provisioning/rule/replay regressions and factual 0.32.0 CLI/archive/source investigation.
Out of scope: STATED other tickets, system driver/udev installation, real irreversible writes, publication, staging/commits by this implementation chat; no PLG-10 hardware re-execution.
Constraints: STATED shared master checkout, exact base 80133a0a1b0ec3a178b7933c856cf6abfef8ce4d, format versions 1, no migrations, reuse provisioner/runner/approvals, focused verification-policy checks and two independent reviews. Human authorization permits the coordinator alone to make the local ticket commit after verification.
Success signals: STATED every matcher row tested including escalation; real downloaded executable/version/help/list checks where hosts permit; deterministic agent/runner RTT and hash approval tests; real three-board acceptance separately recorded without claiming replay as hardware proof.
Evidence: OBSERVED clean git status and exact HEAD; 00_Planning/plugins/{architecture,plan,probe-rs}.md; ADR-0016..0019; .agentic/context/{project,environment}.md; knowledge/{plugins,official-plugins}.md; existing binutils manifest/tests and shared program rules.
Assumptions: INFERRED existing find-first combined install is the supported contract (PLG-20); source precedence will be documented explicitly.
Unknowns: UNKNOWN physical board availability, Linux ARM64 execution host, archive members/hashes and exact CLI/closed-stdin RTT behavior until inspected. Hardware absence remains an acceptance limit for the coordinator.
Decision-blocking questions: None; the delegated instruction explicitly permits completing code and handing back exact outstanding hardware criteria.
Proposed behaviors: None beyond the stated scope.
Path and reason: Full; new observable plugin/program/skills and hardware risk classifications.

| Quick criterion | Holds? | Evidence |
|---|---|---|
| no new observable behavior | no | official probe-rs program |
| no new interface/format | no | new package and skill interface |
| no new dependency | no | portable probe-rs 0.32.0 |
| existing requirement fully covers behavior | no | plugin-specific rules/skills |
| no security/data change | no | hardware risk rules |

## Requirement coverage

| Behavior | Requirement | Design | Proof |
|---|---|---|---|
| Ship pinned probe-rs tools | REQ-FUNC-19b10001 | Package content on existing platform | 05_Software/tests/integration/probe-rs.test.ts |
| Classify offline probe-rs commands | REQ-SEC-19b10002 | Package content on existing platform | 05_Software/tests/integration/probe-rs.test.ts |
| Classify probe-rs target reads | REQ-SEC-19b10003 | Package content on existing platform | 05_Software/tests/integration/probe-rs.test.ts |
| Classify probe-rs flashing | REQ-SEC-19b10004 | Package content on existing platform | 05_Software/tests/integration/probe-rs.test.ts |
| Gate arbitrary probe-rs memory writes | REQ-SEC-19b10005 | Package content on existing platform | 05_Software/tests/integration/probe-rs.test.ts |
| Block interactive and remote probe-rs access | REQ-SEC-19b10006 | Package content on existing platform | 05_Software/tests/integration/probe-rs.test.ts |
| Guide probe and target selection | REQ-UX-19b10007 | Package content on existing platform | 05_Software/tests/integration/probe-rs.test.ts |
| Guide exact-build flashing | REQ-UX-19b10008 | Package content on existing platform | 05_Software/tests/integration/probe-rs.test.ts |
| Guide bounded background RTT | REQ-UX-19b10009 | Package content on existing platform | 05_Software/tests/integration/probe-rs.test.ts |
| Guide register and fault inspection | REQ-UX-19b1000a | Package content on existing platform | 05_Software/tests/integration/probe-rs.test.ts |
| Operate three real probe families | REQ-PLAT-19b1000b | Package content on existing platform | UNVERIFIED: no Windows probe, WSL USB absent; full three-board workflow on both systems and actual closed-stdin down-channel RTT still required |

## Design

### Approach
STATED architecture.md and probe-rs.md already specify the implementation shape: one declarative plugin package, no new runner/provisioner infrastructure. OBSERVED combined find+download is implemented by PLG-20; PATH then cargo discovery takes precedence over explicit pinned fallback (REQ-FUNC-19b10001).

### Interfaces and data
Manifest format 1, exact version range ==0.32.0, timeout 120 s. Existing download extraction, hash verification, closed stdin, tree kill, serial guard and output caps remain authoritative. Token patterns include leading wildcard before command and host so global options and --host=value cannot lower risk (REQ-SEC-19b10002..06). Skills use run_program/program_output/program_stop and existing hash-bound approvals (REQ-UX-19b10007..0a).

### Files and test seams
05_Software/plugins/probe-rs/{plugin.yaml,README.md,skills/*/SKILL.md}; catalog.yaml/packs.yaml. One focused integration file exercises manifest, every risk row, installed skill catalog, isolated discovery and version rejection, local official archives on x64, replay approvals and background RTT. Fixtures clearly simulate hardware. Knowledge/context and planning status are reconciled during validate.

### Risks and open decisions
OBSERVED all three archives fetched and hash-checked against published .sha256. Windows binary reports 0.32.0. Read width is b8/b16/b32/b64; default hex-table despite stale prose in --help. Source write directly dispatches core memory writes despite the help's RAM-only note. Closed-stdin real RTT with down channels and three-board acceptance remain UNKNOWN until available hardware is inventoried; REQ-PLAT-19b1000b stays outstanding if absent. No source workaround or new hardware transport is inferred. Existing format remains 1.

### Requirement map
REQ-FUNC-19b10001: manifest and existing combined provisioner; REQ-SEC-19b10002..06: declarative highest-risk rules plus exhaustive token matrix; REQ-UX-19b10007..0a: installed skill discovery plus replay; REQ-PLAT-19b1000b: physical acceptance inventory/proof only. No substantive structural change: existing architecture.md already provides the structure/sequence/state; no new diagram is needed for content-only integration.


## Log

- 2026-11-03 frame: journal opened
- 2026-11-03 frame: Human authorization: coordinator alone may commit PLG-19 locally after validated handover. Implementer must not stage/commit/push. Clean base verified 80133a0a1b0ec3a178b7933c856cf6abfef8ce4d on master.
- 2026-11-03 frame: completed; next specify (7 Done checklist item(s) left unticked)
- 2026-11-03 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-03 design: skipped; next build - Existing architecture and probe-rs spec define the content-only package design; design decisions recorded without new infrastructure
- 2026-11-03 build: red: focused probe-rs.test.ts exit 1, 7 failures because plugin is absent (ENOENT/NOT_FOUND); 1 optional real-archive test skipped. Original windows-red.log in 02_Tools/cache/plg19/proof. REQ-FUNC/SEC/UX-19b1 coverage.
- 2026-11-03 build: Observed all three 0.32.0 archive hashes match published .sha256; member paths/ELF64 x86-64 and AArch64 headers verified (proof/archives.json, linux-headers.json). Windows real CLI version/help/list executed; list reports no probes. Upstream source confirms read formats, unrestricted memory dispatch, Xtensa sequences and conditional RTT readline paths. decode_register is absent from current source; skill must not invent it.
- 2026-11-03 build: green: Windows 8 new cases proven across windows-focused3.log (unchanged passing cases), windows-affected.log (skills/find passing), windows-replay-native.log (2/2 attach+run), windows-real-env-fixed.log (affected real archive case 1/1). Windows consumers: 144 passed, 2 platform skips in windows-consumers.log. Ubuntu focused+consumers: 142 passed, 12 platform skips, all 8 new cases passed including genuine downloaded/found CLI and both real-process replay RTT cases; ubuntu-focused-consumers.log. Pinned Node 24.21.0 readiness passed on both hosts; ubuntu-typecheck-fixed.log exit 0.
- 2026-11-03 build: DEVIATION validate: real three-board Windows/Linux acceptance and closed-stdin RTT with down channels unavailable - no Windows debug probe enumerated, WSL has no USB bus. REQ-PLAT-19b1000b remains unverified; coordinator must decide acceptance/defer or provide bench. No PLG-10 ruling reused. ARM64 inspected only, not executed. Windows sandbox taskkill refusal required native escalated fixture replay; native rerun passed.
- 2026-11-03 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-03 validate: Round1 both independent reviews changes_required: P1 itm lacks explicit risk floor; valid --log-file list/chip/help option values match safe rows and downgrade real trace configuration. Fix is explicit device-write itm preserving unmatched floor, command-completeness/collision regression and current docs. No other findings; neither review waives hardware.
- 2026-11-03 validate: returned to build - Both reviews P1 itm option-value safe downgrade
- 2026-11-03 build: red round2: windows-round2-red.log exit 1; matcher regression requires explicit itm hardware risk/note and option-value collision protection. Existing captured 0.32.0 --help now a fixture requiring explicit rule coverage for every shipped command.
- 2026-11-03 build: green round2: explicit itm device-write note now prevents safe option-value downgrade. windows-round2-rules.log exit0 2 affected cases; windows-round2-catalog.log exit0 7 cases; original CLI help fixture asserts every shipped command has an explicit rule and collisions preserve its risk. Documentation/REQ-SEC-19b10004 now include trace configuration. No production infrastructure changed.
- 2026-11-03 build: Ubuntu round2 affected proof exit0: ubuntu-round2-affected.log, 4 selected assertions/cases passed (11 intentionally filtered). Existing RTT/provisioning and unaffected consumer proof reused per verification-policy. Both reviewers will re-review complete candidate at round2.
- 2026-11-03 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-03 validate: Round2 independent spec_review and quality_review both approved complete tracked/untracked candidate; itm P1 resolved, no further actionable findings. Both explicitly limit approval to implementation candidate and do not waive REQ-PLAT-19b1000b, real closed-stdin down-channel RTT or ARM64 execution. Final strict proof follows.
- 2026-11-03 validate: final: python .agentic/aegis.py check --task TASK-bc643d04 --strict --run exit0; lint/typecheck/i18n all passed after round2 approvals and final candidate edit. Original proof/windows-strict.log. Full suite intentionally not run per verification-policy. 46 warnings are existing unrelated stale paths/test metadata/ticket refs/other task journal headers; no task errors. Manual-verification note is not a hardware pass: REQ-PLAT-19b1000b remains pending. Candidate unchanged after final proof except this task journal.
- 2026-11-03 validate: Handover: code candidate complete on unchanged master/base, index empty, no staging/commit/push/Gitea mutation. Package/rules/four skills, official catalog group, regression fixtures and scoped knowledge/context/planning evidence updated. Done matcher row passed; real x64 install/find/CLI and replay register/RTT passed; Done physical workflow is UNVERIFIED on both systems for Nucleo/ST-Link, RP2040/CMSIS-DAP and ESP32-C3/USB-JTAG (identify, flash correct ELF with approval hashes, verify, reset, documented peripheral read, RTT start/read/stop including down channels). Coordinator decision/bench required before claiming task complete; no existing PLG-10 ruling applies. Owned Windows/Linux scratch removed after processes closed; proof logs, raw CLI/events/runs, official .sha256, source excerpts and review transcripts retained in 02_Tools/cache/plg19/proof. Shared caches/runtimes/tracker untouched.
- 2026-11-03 validate: Coordinator inspected complete 29-file candidate, all requirements and task journal, original independent round2 spec/quality approvals, original Windows/native Ubuntu focused+affected proof and final lint/typecheck/i18n strict success, official archive digests and actual CLI/replay output. No implementation findings; no handover retests. Base unchanged and index empty. Real three-board hardware workflow and closed-stdin down-channel RTT remain outstanding under verification-policy; awaiting explicit human deferral decision before local commit. Existing local-commit authorization retained.
- 2026-11-03 validate: Coordinator acceptance and local-commit authorization: user explicitly approved deferral and one local PLG-19 commit under RULING-001. Previously reviewed product, tests and config are unchanged. Reuse original Windows and Ubuntu focused, affected and static proof, both independent round 2 approvals and final strict AEGIS exit 0. Real three-board acceptance and real RTT remain unverified.
- 2026-11-03 validate: completed; next done
- 2026-11-03 done: Coordinator staged diff hygiene: retained original CLI help fixture spacing, including the empty mi description consumed by the matcher test. Verified fixture against windows-cli-01.txt. All other candidate paths pass git diff --cached --check.

## Rulings

- RULING-001 | date=2026-11-03 | decision=Defer REQ-PLAT-19b1000b physical acceptance, including real RTT with closed stdin and down channels, and retain it as outstanding. Commit the reviewed PLG-19 implementation locally, then continue with sigrok #83 and the rest of epic #80. | reason=Explicit user decision in the coordinator chat on 2026-11-03. The Windows and Linux three-board workflow and real RTT have no bench evidence. This decision changes the local integration gate only. | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-bc643d04.md
changed: Reviewed PLG-19 probe-rs plugin accepted for local integration under RULING-001.
evidence: Original Windows and Ubuntu focused and affected tests, final AEGIS check --strict --run exit 0, and both independent round 2 approvals.
issues: Outstanding by RULING-001: Windows and Linux Nucleo/ST-Link, RP2040/CMSIS-DAP and ESP32-C3/USB-JTAG workflow including real RTT with stdin closed and down channels. ARM64 archive inspected only.
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-03)

- stage: validate; type: feature; path: full; branch: master
- requirements:
  - REQ-FUNC-19b10001 - Ship pinned probe-rs tools
  - REQ-SEC-19b10002 - Classify offline probe-rs commands
  - REQ-SEC-19b10003 - Classify probe-rs target reads
  - REQ-SEC-19b10004 - Classify probe-rs flashing
  - REQ-SEC-19b10005 - Gate arbitrary probe-rs memory writes
  - REQ-SEC-19b10006 - Block interactive and remote probe-rs access
  - REQ-UX-19b10007 - Guide probe and target selection
  - REQ-UX-19b10008 - Guide exact-build flashing
  - REQ-UX-19b10009 - Guide bounded background RTT
  - REQ-UX-19b1000a - Guide register and fault inspection
  - REQ-PLAT-19b1000b - Operate three real probe families
- deviations: 1 recorded
  - validate: real three-board Windows/Linux acceptance and closed-stdin RTT with down channels unavailable - no Windows debug probe enumerated, WSL has no USB bus. REQ-PLAT-19b1000b remains unverified; coordinator must decide acceptance/defer or provide bench. No PLG-10 ruling reused. ARM64 inspected only, not executed. Windows sandbox taskkill refusal required native escalated fixture replay; native rerun passed.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base 80133a0: 29 file(s) changed, 1248 line(s) added
- checks: errors=0 warnings=46 notes=9
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended

## Delivery report (2026-11-03)

- stage: validate; type: feature; path: full; branch: master
- requirements:
  - REQ-FUNC-19b10001 - Ship pinned probe-rs tools
  - REQ-SEC-19b10002 - Classify offline probe-rs commands
  - REQ-SEC-19b10003 - Classify probe-rs target reads
  - REQ-SEC-19b10004 - Classify probe-rs flashing
  - REQ-SEC-19b10005 - Gate arbitrary probe-rs memory writes
  - REQ-SEC-19b10006 - Block interactive and remote probe-rs access
  - REQ-UX-19b10007 - Guide probe and target selection
  - REQ-UX-19b10008 - Guide exact-build flashing
  - REQ-UX-19b10009 - Guide bounded background RTT
  - REQ-UX-19b1000a - Guide register and fault inspection
  - REQ-PLAT-19b1000b - Operate three real probe families
- deviations: 1 recorded
  - validate: real three-board Windows/Linux acceptance and closed-stdin RTT with down channels unavailable - no Windows debug probe enumerated, WSL has no USB bus. REQ-PLAT-19b1000b remains unverified; coordinator must decide acceptance/defer or provide bench. No PLG-10 ruling reused. ARM64 inspected only, not executed. Windows sandbox taskkill refusal required native escalated fixture replay; native rerun passed.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base 80133a0: 29 file(s) changed, 1271 line(s) added
- checks: errors=0 warnings=46 notes=9
- checklist: 8/9 done; open: manual or inspection verification recorded where applicable
