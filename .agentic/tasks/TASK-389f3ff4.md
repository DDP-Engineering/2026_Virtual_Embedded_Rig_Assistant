# TASK-389f3ff4 - PLG-11 esp32-efuse (#67)

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-DATA-0ab3122a, REQ-FUNC-2bd7e52f, REQ-SEC-d18364d7, REQ-SEC-1bf3873b, REQ-UX-9ccdb641, REQ-FUNC-20e1f26f
parent:
branch: master
base: a3eab69e8230234a60cfe678c250e847190ffe8e
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

Problem: STATED (#67): the ESP32 pack needs eFuse reads and gated irreversible burns; OBSERVED: no esp32-efuse package exists at the recorded clean base.
Desired outcome: STATED (#67, packs section 1): official esp32-efuse with espefuse/espsecure, disabled by default in Security (irreversible), and esp32-efuse-review.
Actors: STATED: engineer enables the plugin and approves; agent reviews summary and a written session artifact plan before any requested irreversible operation.
Primary scenario: STATED: virtual summary is device-read, virtual burn-efuse waits for typed burn-efuse in ask/auto-edit; bypass runs with durable decided_by=mode.
Examples: STATED: espefuse --chip esp32 --virt summary; a virtual burn of a single field after an explicit request and plan.
Counterexamples: STATED: wrong confirmation cannot launch; no physical burn, no batch burns, no implicit burns.
In scope: STATED: manifest, catalog/pack, review skill, focused integration tests through installed package/provisioner/runner and SessionService/ApprovalGate, actual virtual esptool v5 on Windows and available Linux.
Out of scope: STATED: physical eFuse writes, driver installs, privilege changes, unrelated suites/refactoring, coordinator tracker, other tickets' hardware debts, remote writes and all Git staging/commits by this chat.
Constraints: STATED: shared master, no worktree/branch; exact base a3eab69e8230234a60cfe678c250e847190ffe8e plus complete uncommitted candidate; all formats remain 1. Local ticket commit is user-authorized but reserved for coordinator after acceptance. Both independent read-only reviews required. Focused verification policy overrides generic full suite.
Success signals: STATED: all three #67 Done criteria, complete risk rows/spellings/boundaries/collisions, actual process exitCode and virtual state effects, static/strict checks and both review approvals.
Evidence: OBSERVED: live tea issues 67 and 55 on 2026-11-04; packs sections 1.1-1.4, plan PLG-11, architecture sections 2-5, ADR-0018; existing esptool package and integration; NodeProcessHost closes stdin. Espressif primary documentation confirms virtual persistence and --do-not-confirm and documents espsecure HSM beyond the local-file scope.
Assumptions: INFERRED: the existing matcher, approval gate and provisioner suffice; validate against actual v5 entry points before choosing probes.
Unknowns: UNKNOWN: physical hardware and ARM64 acceptance, neither required for #67 virtual Done. Available Ubuntu distribution is WSL2 (OBSERVED wsl --list --verbose), not bare-metal Ubuntu.
Decision-blocking questions: none; user authorized autopilot and virtual tests.
Proposed behaviors: none beyond the stated contract; HSM options are outside local-files scope and require blocked rules.
Path and reason: full, new package/interface and dependency.

| Criterion | Holds? | Evidence |
|---|---|---|
| no new externally observable behavior | no | new plugin and risks |
| no new interface or data format | no | package/programs/skill |
| no new dependency | no | esptool v5 pip entry points |
| existing requirement covers behavior | no | new package |
| no security/data handling change | no | irreversible eFuses |

## Requirement coverage

| Behavior | Requirement | Design/test seam |
|---|---|---|
| Disabled Security group | REQ-DATA-0ab3122a | Pack/catalog and focused package test |
| Provision official eFuse programs from esptool v5 | REQ-FUNC-2bd7e52f | Content package; focused esp32-efuse integration |
| Classify eFuse reads and permanent writes | REQ-SEC-d18364d7 | Content package; focused esp32-efuse integration |
| Restrict espsecure workflows to local files | REQ-SEC-1bf3873b | Content package; focused esp32-efuse integration |
| Review each requested burn with a written session plan | REQ-UX-9ccdb641 | Content package; focused esp32-efuse integration |
| Gate virtual eFuse burns with durable approvals | REQ-FUNC-20e1f26f | Content package; focused esp32-efuse integration |

## Design

**Approach.** Content-only official package, two pip entry points, existing highest-risk matcher,
provisioner, runner and approval gate unchanged (all six requirements). Help is the actual v5
version probe; neither CLI has a reliable standalone --version contract. No burn flag is added
as a hidden fixed prefix: raw approved argv explicitly includes --do-not-confirm for closed stdin.

**Interfaces and data.** Format 1, package 1.0.0, Windows x64/Linux x64. Catalog Security group defaults
false (REQ-DATA-0ab3122a). Read commands are device-read; burn/protect/voltage irreversible with OTP
warning (REQ-SEC-d18364d7). espsecure wildcard safe is overridden by blocked HSM flags, including
equals/underscore forms (REQ-SEC-1bf3873b); safe means hardware-risk, not a file sandbox. Existing
mode matrix, exact request hashes, normalized confirmation and single-use decisions are reused
(REQ-FUNC-20e1f26f); wrong text leaves approval pending. No format changes or migrations.

**Files and test seams.** plugins/esp32-efuse/{plugin.yaml,README.md,skills/esp32-efuse-review/SKILL.md},
plugins/{packs,catalog}.yaml, tests/integration/esp32-efuse.test.ts and captured help fixtures.
Real executable acceptance is opt-in with VERA_EFUSE_UV and an owned scratch/evidence root; default
tests stay offline. Actual uv provisions esptool 5, NodeProcessHost runs virtual commands with
explicit --chip esp32 --virt --path-efuse-file; receipt assertions parse tool results, require
exitCode 0, compare virtual memory bytes and read back JTAG_DISABLE. Replay modes ask/auto-edit,
bypass and read-only reuse the platform gate (REQ-FUNC-20e1f26f). Skill instructions/discovery and
prompt metadata cover REQ-UX-9ccdb641. Focused immediate catalog/matcher/gate/runner tests and static
checks follow repository policy. Both reviewers inspect the entire base/candidate read-only.

**Risks and open decisions.** No hardware command in acceptance; every executable burn carries --virt.
Virtual state is mutable local scratch. Linux available is Ubuntu WSL2 x64, not bare-metal or ARM64.
Physical reset/serial behavior is documented from the vendor, not claimed tested. HSM is explicitly
outside local-file scope. No new state machine; approvals and process lifecycle are reused unchanged.

**Requirement map.** REQ-DATA-0ab3122a default-off group; REQ-FUNC-2bd7e52f package/catalog/probes; REQ-SEC-d18364d7 risk table;
REQ-SEC-1bf3873b local-file/HSM rules; REQ-UX-9ccdb641 review skill;
REQ-FUNC-20e1f26f real virtual replay receipts and durable SQL approval rows.
Diagrams: [diagram_TASK-389f3ff4.md](diagram_TASK-389f3ff4.md).


## Log

- 2026-11-04 frame: journal opened
- 2026-11-04 frame: Authorization: user directs full/autopilot implementation on master at exact base a3eab69e8230234a60cfe678c250e847190ffe8e; coordinator alone makes the authorized local ticket commit after acceptance; this chat never stages, commits or publishes. Both independent read-only reviewers authorized.
- 2026-11-04 frame: completed; next specify (7 Done checklist item(s) left unticked)
- 2026-11-04 specify: completed; next design
- 2026-11-04 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-04 build: red: pinned vitest run tests/integration/esp32-efuse.test.ts exit 1, 4 failed/1 opt-in skip: official package missing, risk/skill package ENOENT; original D:/vera-task-389f3ff4/evidence/red.txt (all five task requirements).
- 2026-11-04 build: Real CLI observation: esptool5.6.0 espefuse/espsecure --help are valid version probes; espsecure --version exits2. Virtual --chip esp32 --virt --path-efuse-file FILE --do-not-confirm burn-efuse JTAG_DISABLE 1 exits0, persisted summary True/0b1; vendor prompt BURN is distinct from VERA burn-efuse. Pinned uv0.13.1 downloaded and hash-verified. Catalog low-risk name tokens require three exact reviewed entries; actual whole-candidate independent reviews will approve these.
- 2026-11-04 build: green: Windows pinned Node24.21.0/uv0.13.1/esptool5.6.0: opt-in vitest esp32-efuse exit0 5/5 (windows-fourth.txt + windows-fourth/efuse-receipts.json), 10 accepted process exits0 with actual summary False/0b0 -> True/0b1 and virtual bytes changed. Ask/Auto-edit wrong BURN refused with INVALID confirmMismatch and no burn spawn; exact burn-efuse succeeds. Bypass SQL decided_by=mode, read-only no spawn. All six task requirements covered (REQ-DATA-0ab3122a shares original package-missing red).
- 2026-11-04 build: Focused consumers: initial parallel Windows exit1, 207passed/7failed/2skip caused timing/I/O contention; original windows-consumers.txt retained. Failed/affected files rerun serial maxWorkers1 exit0 187passed/2platform skips incl packaging and17 import boundaries, windows-consumers-affected.txt; passing initial schema/catalog/gate tests reused. No Git/full suites. Windows typecheck-first exit0. Linux actual Ubuntu24.04.4 WSL2 kernel6.6.87.2, pinned Node24.21.0, own npm ci/typecheck exit0; actual virtual acceptance running. Shell final-line CRLF failure retained and fixed, not a product defect.
- 2026-11-04 build: green: Ubuntu24.04.4 WSL2 x64 pinned Node24.21.0/uv0.13.1 real esptool5.6.0 focused-final exit0:238passed/1skip in11 files, including actual virtual replay5, packaging and17 boundaries. Native receipts passed=true,10 accepted process exitCodes0 and persistent state/readback, exact pending/wrong-word/mode SQL. Original logs copied unchanged from /home/dpasare/.cache/vera-PLG-11-389f3ff4/evidence to D:/vera-task-389f3ff4/evidence/linux; raw per-mode run logs/virtual files preserved. No hardware/ARM64/bare-metal Ubuntu claim.
- 2026-11-04 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-04 validate: Specification compliance original round1 APPROVED by /root/efuse_spec_review: all21 paths relative exact base, six requirements/design and original Windows/Ubuntu WSL2 receipts reviewed; all Done met, three exact low-risk catalog exceptions appropriate, no findings, no reviewer writes/test reruns. Non-journal candidate hashes match candidate-round1.json. Quality review pending; final strict/static after both approvals.
- 2026-11-04 validate: Implementation quality original round1 APPROVED by /root/efuse_quality_review: complete21 paths/base/candidate and actual receipts inspected,20 nonjournal hashes match; no actionable findings or mutations. Both original final verdict texts retained in evidence/spec-review-round1.txt and quality-review-round1.txt. Final static/strict now runs after both approvals; no candidate edits planned.
- 2026-11-04 validate: final: python .agentic/aegis.py check --task TASK-389f3ff4 --strict --run exit0 AFTER both round1 approvals and last candidate edit. strict-final.txt: lint9.7s/typecheck8.4s/i18n1.3s all ok; no tests run by strict per policy; errors0,46 pre-existing advisory warnings/9notes, none introduced by candidate. Linux npm lint/check:i18n exit0; typecheck exit0 and focused boundaries valid. Linux mirror missing root ignore lint configuration failure retained in lint-missing-ignore-diagnostic.txt, fixed by copying unchanged root .gitignore; no product edits/retests needed.
- 2026-11-04 validate: Cleanup limitation: automatic approval review rejected grouped Windows owned-scratch cleanup and then exact separately resolved Remove-Item D:/vera-task-389f3ff4/efuse-4vf6RZ -Recurse -Force, both with reason blocked by policy. No alternative deletion attempted. Windows task scratch retained; original per-platform process receipts/run logs, virtual files and complete test-mode failure diagnostics copied to evidence. Existing PLG22 policy-blocked fixture untouched.
- 2026-11-04 validate: DEVIATION validate: owned Windows scratch retained - automatic approval review rejected recursive cleanup (grouped and exact verified directory) as blocked by policy; original logs/diagnostics preserved, no policy bypass. Linux owned repo mirror and closed fixture deleted after exact resolved path checks; evidence and pinned external Node runtime preserved.
- 2026-11-04 validate: Done1: actual virtual summary device-read; Done2: Ask/Auto-edit burn absent before exact normalized burn-efuse confirmation, BURN fails INVALID/pending, then exit0 and virtual state0->1; Done3: Bypass no user prompt and durable SQL mode approvals. Ten actual accepted process exits0/platform including local espsecure key32bytes. Windows/Ubuntu24.04WSL2 only, no real burns/hardware/ARM64/native baremetal claims. Both independent round1 APPROVED; final strict/static/focused valid. Whole21path candidate remains unstaged/uncommitted on exact base, unchanged20 nonjournal hashes. Final complete paths/SHA256 and concise handover saved to D:/vera-task-389f3ff4/evidence/candidate-final.json and handover.md after closure; coordinator next inspects originals and commits locally under existing authorization.
- 2026-11-04 validate: completed; next done
- 2026-11-04 done: Coordinator reviewed complete21-file candidate, journal, requirements, original independent round1 approvals and original Windows/Ubuntu WSL2 proof. Exact21 candidate hashes, master base a3eab69e8230234a60cfe678c250e847190ffe8e and empty index confirmed. Actual receipts each prove10 accepted exits0, persistent JTAG_DISABLE False0b0 to True0b1, no burn spawn before exact confirmation, wrong BURN refused and Bypass SQL decided_by mode; all burns virtual. Original focused/static/strict proof reused without routine handover retest. User authorization covers one local commit of this ticket; no remote/Gitea publication. WSL-only/ARM64/hardware limits and Windows cleanup policy rejection stay explicit; prior deferred obligations untouched.
- 2026-11-04 done: DEVIATION validate: preserve original CLI help trailing spacing in exactly tests/fixtures/esp32-efuse/espefuse-5.6.0-help.txt and espsecure-5.6.0-help.txt - raw vendor help fixtures retain captured layout; coordinator reviewed these fixtures and all risk-command extraction assertions. git diff --cached --check reports only these fixture lines; exact exclusions preserve original evidence and all remaining candidate whitespace checks must pass.

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-389f3ff4.md
changed: Official esp32-efuse, default-off Security group, risk rules/local HSM block, review skill, fixtures/test/packaging, six requirements/context (21 paths)
evidence: strict --run exit0 after both round1 approvals; Windows real5/5 plus final affected187/2skip/reused consumers; Ubuntu WSL2 focused238/1skip, static checks exit0
issues: No implementation blockers. Windows scratch cleanup rejected by automatic approval review (blocked by policy), retained with original diagnostics. Linux is WSL2; hardware/ARM64/bare-metal Ubuntu untested. Existing unrelated hardware debts unchanged.
spec_compliance: approved
implementation_quality: approved
review_round: 1

## Delivery report (2026-11-04)

- stage: validate; type: feature; path: full; branch: master
- requirements:
  - REQ-DATA-0ab3122a - Keep eFuse security disabled in the official pack
  - REQ-FUNC-2bd7e52f - Provision official eFuse programs from esptool v5
  - REQ-SEC-d18364d7 - Classify eFuse reads and permanent writes
  - REQ-SEC-1bf3873b - Restrict espsecure workflows to local files
  - REQ-UX-9ccdb641 - Review each requested burn with a written session plan
  - REQ-FUNC-20e1f26f - Gate virtual eFuse burns with durable approvals
- deviations: 1 recorded
  - validate: owned Windows scratch retained - automatic approval review rejected recursive cleanup (grouped and exact verified directory) as blocked by policy; original logs/diagnostics preserved, no policy bypass. Linux owned repo mirror and closed fixture deleted after exact resolved path checks; evidence and pinned external Node runtime preserved.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=1
- diff vs task base a3eab69: 21 file(s) changed, 961 line(s) added
- checks: errors=0 warnings=46 notes=9
- checklist: 9/9 done
