# TASK-f00f64cb - PLG-10 esp32-idf plugin

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-FUNC-06eaa9a5, REQ-FUNC-efbc6124, REQ-DATA-10e10001, REQ-FUNC-10e10002, REQ-SEC-10e10003, REQ-FUNC-10e10004, REQ-SEC-10e10005, REQ-SEC-10e10006, REQ-FUNC-10e10007, REQ-SEC-10e10008, REQ-FUNC-10e10009, REQ-UX-10e1000a, REQ-UX-10e1000b, REQ-PLAT-10e1000c, REQ-PLAT-10e1000d
parent:
branch: master
base: 021dd9812c3e4c9941022142df3d75b31b67b111
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
- [x] manual or inspection verification recorded where applicable; real hardware acceptance explicitly deferred by user RULING-002 and remains outstanding
- [x] explicit review approved, when enabled
- [x] final `check --strict --run` result logged truthfully after the last edit
- [x] remaining warnings and pre-existing failures explained
- [x] `report` appended

## Frame

Problem: STATED PLG-10 (#66) needs ESP-IDF build/flash/crash support; OBSERVED provisioner and program tools explicitly refuse launcher programs.
Desired outcome: STATED official esp32-idf package, verified EIM command transport, launcher infrastructure preserving existing approvals and port locks, two skills.
Actors: STATED user installing EIM/ESP-IDF and enabling plugins; agent using declared programs; coordinator reviewing and committing.
Primary scenario: STATED agent builds, reads diagnostics, edits source, rebuilds, flashes, captures panic with serial-monitor and decodes with matching ELF.
Examples: STATED idf.py build; idf.py -p COM3 flash; xtensa/riscv addr2line; idf.py monitor refused with its explanatory note.
Counterexamples: STATED VERA never installs vendor suites/drivers, interactive commands never execute, simulations do not establish hardware acceptance.
In scope: STATED launcher mode schema, resolver/probes, runner and immediate consumers; manifest, rules, catalog registration, skills; focused deterministic regression and available live platform evidence.
Out of scope: STATED other tickets, migrations, payload changes, staging/commits/publication/Gitea writes, coordinator tracker.
Constraints: STATED shared master checkout; exact base 021dd9812c3e4c9941022142df3d75b31b67b111; coordinator alone makes authorized local commit after handover. Format remains 1. Verification policy governs focused checks and both independent reviews.
Success signals: STATED both platform transport proofs; launcher preserves arguments, files hashes and serial locks; rules/skills pass replay; live build/hardware evidence reported accurately.
Evidence: OBSERVED clean git status and exact HEAD; architecture §3.3/§5, packs §1.3/§1.4, ADR0016-0019; official EIM CLI reference uses one COMMAND string; current source 043ca81de5b723c4e1b95635929da912811e9586 declares command:String and delegates to platform script executor.
Assumptions: INFERRED existing plugin seams can extend launcher support without a new dependency, based on launcher.ts and Provisioner.
Unknowns: UNKNOWN real toolchain/board availability and executable string quoting until platform probe completes; no hardware criterion claimed without actual board.
Decision-blocking questions: None; delegation explicitly permits finishing independent implementation and documenting unavailable resources.
Proposed behaviors: None beyond the stated architecture and package scope.
Path and reason: full; new observable programs and launcher schema.

| Quick criterion | Holds | Evidence |
|---|---|---|
| no new externally observable behavior | no | new ESP-IDF programs |
| no new interface or data format | no | launcher mode |
| no new dependency | yes | existing process/provisioning ports |
| existing requirement covers behavior | no | new package |
| no security or data handling change | no | launcher transport/port guard |

## Requirement coverage

| Behavior | Requirement | Design | Verification |
|---|---|---|---|
| Explicit launcher transport | REQ-DATA-10e10001 | Launcher/package flow below | shared plugins.test.ts |
| Resolve vendor launcher | REQ-FUNC-10e10002 | Launcher/package flow below | provisioning.test.ts |
| Refuse launcher metacharacters | REQ-SEC-10e10003 | Launcher/package flow below | launcher.test.ts and program-tools.test.ts |
| Run launcher commands | REQ-FUNC-10e10004 | Launcher/package flow below | program-tools.test.ts |
| Bind launcher approval | REQ-SEC-10e10005 | Launcher/package flow below | program-tools.test.ts |
| Guard launcher serial ports | REQ-SEC-10e10006 | Launcher/package flow below | runner.test.ts and program-tools.test.ts |
| Ship ESP-IDF plugin | REQ-FUNC-10e10007 | Launcher/package flow below | esp32-idf.test.ts |
| Classify IDF commands | REQ-SEC-10e10008 | Launcher/package flow below | esp32-idf.test.ts |
| Explain blocked refusal | REQ-FUNC-10e10009 | Launcher/package flow below | esp32-idf.test.ts |
| Build repair guidance | REQ-UX-10e1000a | Launcher/package flow below | esp32-idf.test.ts replay |
| Panic guidance | REQ-UX-10e1000b | Launcher/package flow below | esp32-idf.test.ts replay |
| EIM transport | REQ-PLAT-10e1000c | Launcher/package flow below | eim-windows-results.json and eim-linux-results.json |
| Real hardware acceptance | REQ-PLAT-10e1000d | Launcher/package flow below | OPEN: toolchain and board unavailable |
| Temporary launcher refusal retired | REQ-FUNC-06eaa9a5 | Launcher/package flow below | launcher support replaces it |
| Platform invocation refinement | REQ-FUNC-efbc6124 | Launcher/package flow below | launcher.test.ts plus official EIM probes |

## Design

### Approach
Extend the existing launcher helper and resolver seam; no shell in ProcessHost. EIM itself uses Bash/PowerShell internally, observed in official source and Windows executable. Find resolves launcher[0], version probes invoke the declared program, and resolver carries immutable launcher transport metadata (REQ-FUNC-10e10002/04).

### Interfaces and data
Format 1 gains launcherMode argv|string, required iff launcher and only with find (REQ-DATA-10e10001). ResolvedProgram gains launcher command/mode/platform. A single invocation helper serves version probes and tools. String mode quotes tokens after rejecting metacharacters; Bash escapes backslashes, PowerShell uses a generated call operator with literal backslashes (REQ-SEC-10e10003). No agent-provided operators enter the string.
prepare binds the complete generated launcher argv in executableArgs, while args remain the agent's own for classification and file binding; apply reconstructs and consumes the exact request, then beforeSpawn rehashes files (REQ-SEC-10e10005). RunRequest gains programArgs for the serial guard (REQ-SEC-10e10006); logs keep the original agent arguments. Refusal text includes matched notes (REQ-FUNC-10e10009).

### Files and test seams
Shared plugins.ts/schema tests; core launcher.ts, provisioning.ts, program-tools.ts, runner.ts and adjacent tests. Official esp32-idf manifest, README, skills and catalog files; deterministic Python vendor fixture and replay integration tests (REQ-FUNC-10e10007, REQ-SEC-10e10008, REQ-UX-10e1000a/b). Immediate catalog and plugin-builder guidance consumers updated to teach explicit mode.

### Risks and open decisions
Existing architecture and REQ-FUNC-efbc6124 quote every executable without a PowerShell call operator and double trailing backslashes universally. Actual Windows EIM 0.20.1 rejects that syntax. Correct platform quoting is necessary and will be documented as an evidence-backed refinement. Linux live probe confirmed the Bash transport. Toolchain and board availability are independent acceptance limits (REQ-PLAT-10e1000c/d); no install of vendor suite authorized/needed for deterministic implementation. Existing unmatched device-write and mode matrix remain authoritative.

### Requirement map
REQ-DATA-10e10001 schema; REQ-FUNC-10e10002 resolver/probe; REQ-SEC-10e10003 quoting; REQ-FUNC-10e10004 tools/prompt; REQ-SEC-10e10005 exact invocation plus file guard; REQ-SEC-10e10006 runner programArgs; REQ-FUNC-10e10007 package/catalog; REQ-SEC-10e10008 manifest rules; REQ-FUNC-10e10009 refusal notes; REQ-UX-10e1000a/b skills/replay; REQ-PLAT-10e1000c README measured contract; REQ-PLAT-10e1000d explicitly manual hardware acceptance.
Diagrams: [diagram_TASK-f00f64cb.md](diagram_TASK-f00f64cb.md).

## Log

- 2026-11-03 frame: journal opened
- 2026-11-03 frame: completed; next specify (7 Done checklist item(s) left unticked)
- 2026-11-03 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-03 design: OBSERVED EIM 0.20.1 Windows: run accepts one command string, extra argv rejected exit 2; quoted executable alone fails PowerShell parse exit 1; generated call operator executes exact spaced/empty/backslash fixture arguments exit 0. Original eim-windows-results.json in 02_Tools/cache/plg-10.
- 2026-11-03 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-03 build: red: pinned vitest schema/launcher/tools assertions failed for missing launcherMode, platform quoting and prompt support; logs red-infrastructure.log and red-tools.log. Runner/provisioning multi-worker ENOENT is an environment failure, not behavioral proof.
- 2026-11-03 build: DEVIATION design: platform-aware string quoting refines universal trailing-backslash rule in architecture 3.3/REQ-FUNC-efbc6124 - actual EIM 0.20.1 on Windows rejects quoted executable without generated PowerShell call operator; Bash needs literal backslashes escaped throughout. Agent metacharacter refusals remain unchanged.
- 2026-11-03 build: red: esp32-idf package integration exit 1, missing shipped plugin.yaml (red-package.log). REQ-FUNC-10e10007, REQ-SEC-10e10008, REQ-FUNC-10e10009, REQ-UX-10e1000a/b. No real toolchain/board acceptance claimed.
- 2026-11-03 build: DEVIATION specify: retired temporary launcher-unavailable REQ-FUNC-06eaa9a5 and refined REQ-FUNC-efbc6124/platform quoting spec - explicit PLG-10 launcher implementation replaces the temporary refusal; observed EIM transport requires Bash/PowerShell-specific quoting.
- 2026-11-03 build: green: Windows focused infrastructure 119 tests passed, one existing platform skip (focused-1.log); package tests initially consumed stale emitted shared package and required normal TypeScript build. Pinned typecheck completed exit 0.
- 2026-11-03 build: OBSERVED EIM 0.20.1 native Ubuntu: single string idf.py build exit 0; extra argv exit 2; Bash quoted spaced/empty/trailing-backslash tokens exact exit 0; PowerShell call operator rejected exit 1. Original eim-linux-results.json and eim-windows-results.json in 02_Tools/cache/plg-10. No live vendor build or hardware evidence.
- 2026-11-03 build: Native Ubuntu first focused pass: package replay 7/7 and runner/tool/launcher/schema passed; provisioning had 5 failures because its existing executable() fixture wrote mode 0644. Corrected fixture creation to 0755, preserving separate non-executable refusal case. Test output retained in ubuntu-focused.log before affected rerun.
- 2026-11-03 build: green: native Ubuntu affected set 65/65 passed (ubuntu-affected-pass.log), plus unchanged schema/runner/launcher initial proof. Original deterministic session run logs and tool results retained in 02_Tools/cache/plg-10/linux-idf-replay. Ubuntu setup/typecheck exit 0; exact current pinned dependencies installed in owned scratch before tests.
- 2026-11-03 build: Windows consumer set: 13 files passed including 7/7 esp32-idf replay (windows-consumers.log), 3 existing platform skips; matcher performance assertion and 2 session setup timeouts failed under concurrent host load, renderer worker failed to start. Rerun only those 3 files serially after Ubuntu finishes; session harness timeout 20s, matcher assertion unchanged. Native Ubuntu immediate consumers: 13 files, 237 passed/12 existing skips (ubuntu-focused.log).
- 2026-11-03 build: green: Windows affected serial rerun 3 files/117 tests exit 0 (windows-affected-rerun.log); matcher 300ms assertion retained. Together with windows-consumers.log's 13 passed files, all selected Windows checks pass; original run's timing/worker failures remain recorded. Both platform replay logs retained at {win32,linux}-idf-replay.
- 2026-11-03 build: Manual availability: Windows Get-CimInstance Win32_SerialPort returned no ports, Get-Command eim/idf.py none, C:/Espressif and USERPROFILE/.espressif/tools absent. Ubuntu shutil.which eim/idf.py None, /dev/ttyUSB*, ttyACM*, serial/by-id/* empty and ~/.espressif/tools absent. REQ-PLAT-10e1000d remains OPEN; no real compile/build/flash/panic claimed.
- 2026-11-03 build: DEVIATION validate: real ESP-IDF build/flash/panic/source-line acceptance on both systems cannot run - required vendor toolchain and board unavailable; explicit delegation permits completing independent implementation and handing back this exact resource limit, not claiming fixtures meet hardware Done.
- 2026-11-03 build: completed; next validate
- 2026-11-03 validate: returned to build - Round 1 P2 fixes: preserve direct-program resolved-prefix serial locking; verify effective sdkconfig values and project-supported regeneration after defaults changes
- 2026-11-03 build: Round 1 independent reviews: spec approved, quality changes_required. Original verdicts in 02_Tools/cache/plg-10/review-{spec,quality}-round1.md. Fix only direct-prefix port guard and accurate sdkconfig.defaults guidance, then rerun affected checks and both reviews.
- 2026-11-03 build: red: direct-prefix regression exit 1, second COM3 run incorrectly resolved with a handle instead of BUSY (review1-red-port-explicit.log). Fixed by supplying programArgs only for launcher runs; ordinary runs again lock actual invocation including resolver prefix. Corrected both skills and README from official ESP-IDF 5.4.3 defaults documentation: verify effective values, project-agreed regeneration for existing values, no direct sdkconfig edit or silent reset.
- 2026-11-03 build: green after round-1 fixes: Windows core compile exit 0; vitest program-tools.test.ts + esp32-idf.test.ts --maxWorkers 1 exit 0, 41/41 (review1-windows-affected.log). Native Ubuntu setup/typecheck exit 0 and same affected 41/41 exit 0 (review1-ubuntu-affected.log). All unchanged earlier proof reused; final replay run logs retained.
- 2026-11-03 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-03 validate: Final Windows strict AEGIS --strict --run exit 0: lint/typecheck/i18n pass, no full tests selected per verification policy; strict ok with 46 unrelated historical warnings and 8 manual-verification notes (final-strict.log). Native lint first attempt failed solely because isolated source mirror lacked root .gitignore; copied that unchanged repository file and rerun only failed/native pending statics.
- 2026-11-03 validate: final: python .agentic/aegis.py check --task TASK-f00f64cb --strict --run exit 0 after both round-2 approvals; lint/typecheck/i18n pass, 46 unrelated historical warnings and 8 manual notes retained (final-strict.log). Native Ubuntu current typecheck, final lint and i18n exit 0; lint retains repository warnings (ubuntu-final-lint.log, ubuntu-final-i18n.log). No product edits after proof. Remaining limit is REQ-PLAT-10e1000d real vendor/hardware acceptance.
- 2026-11-03 validate: Review round 2: independent spec and quality both approved; original verdicts review-spec-round2.md and review-quality-round2.md. Handover command/results and evidence map: 02_Tools/cache/plg-10/verification.md. Windows verified owned TEMP/vendor scratch and downloaded binaries cleaned, original EIM and replay logs retained. No staging/commit/push/Gitea/tracker writes.
- 2026-11-03 validate: Owned native scratch cleanup completed after process inventory: removed only /home/dpasare/.cache/vera-plg10-TASK-f00f64cb, retaining pinned shared runtime/cache and workspace evidence. HEAD remains exact base, index empty. Candidate handover is uncommitted.
- 2026-11-03 validate: Coordinator review complete: inspected the complete 50-file candidate, journal and 15 requirement records, EIM native result receipts, focused Windows/Ubuntu logs and strict proof; confirmed original round2 specification and quality approvals in chats 01a1a24c-911d-70d1-a034-307aedc5dcfb and 01a1a24c-bf82-74e2-9ff9-42e748dfb628. No actionable code finding and no handover retesting. REQ-PLAT-10e1000d remains unverified: no vendor toolchain or board on either host. Under verification-policy ticket criteria, request human disposition before the coordinator commit: explicitly defer hardware acceptance while keeping it open, or wait for resources. No commit, staging, remote publication or Gitea change.
- 2026-11-03 validate: Coordinator acceptance under new user ruling: complete candidate and original passing Windows/Ubuntu proof already inspected, both independent round2 approvals confirmed. User explicitly accepts deferring real vendor build/board flash/panic/source-line acceptance while it remains outstanding. No product/source/test/configuration changes or retesting after proof; close implementation validation and make one local PLG-10 commit, no push or Gitea mutation.
- 2026-11-03 validate: completed; next done

## Rulings

- RULING-001 | date=2026-11-03 | decision=Implement PLG-10 directly on shared master; coordinator alone performs the human-authorized local commit after validation; implementer does not stage, commit or publish. | reason=Explicit delegated user instruction and root AGENTS.md implementation cycle; base 021dd9812c3e4c9941022142df3d75b31b67b111 verified clean. | source=user | supersedes=none
- RULING-002 | date=2026-11-03 | decision=Defer REQ-PLAT-10e1000d real ESP-IDF/hardware acceptance and retain it as outstanding; commit the reviewed PLG-10 implementation locally and continue with binutils #82, then the rest of epic #80. | reason=Explicit human instruction in coordinating chat on 2026-11-03: Da, amana acceptanta hardware si pastreaz-o ca restanta. Fa commitul pentru PLG-10 si continua cu binutils (#82), apoi cu restul epic-ului #80. This changes the local integration gate only; no real hardware proof is claimed or publication authorized. | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-f00f64cb.md
changed: PLG-10 reviewed implementation accepted for local integration under explicit user hardware deferral RULING-002.
evidence: Original Windows/Ubuntu focused proof and final strict --run exit 0 reused unchanged; both independent round2 approvals confirmed by coordinator.
issues: Outstanding by user decision: REQ-PLAT-10e1000d actual ESP-IDF compile/build/flash/panic/source-line acceptance on Windows and Linux; no hardware verification claimed.
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-03)

- stage: validate; type: feature; path: full; branch: master
- requirements:
  - REQ-FUNC-06eaa9a5 - Report launcher programs as unavailable
  - REQ-FUNC-efbc6124 - Compose launcher arguments before the command
  - REQ-DATA-10e10001 - Explicit launcher transport
  - REQ-FUNC-10e10002 - Resolve vendor launcher
  - REQ-SEC-10e10003 - Refuse launcher metacharacters
  - REQ-FUNC-10e10004 - Run launcher commands
  - REQ-SEC-10e10005 - Bind launcher approval
  - REQ-SEC-10e10006 - Guard launcher serial ports
  - REQ-FUNC-10e10007 - Ship ESP-IDF plugin
  - REQ-SEC-10e10008 - Classify IDF commands
  - REQ-FUNC-10e10009 - Explain blocked program refusal
  - REQ-UX-10e1000a - Guide ESP32 build repair
  - REQ-UX-10e1000b - Guide ESP32 panic analysis
  - REQ-PLAT-10e1000c - Verify EIM command transport
  - REQ-PLAT-10e1000d - Accept real ESP-IDF hardware workflow
- deviations: 3 recorded
  - design: platform-aware string quoting refines universal trailing-backslash rule in architecture 3.3/REQ-FUNC-efbc6124 - actual EIM 0.20.1 on Windows rejects quoted executable without generated PowerShell call operator; Bash needs literal backslashes escaped throughout. Agent metacharacter refusals remain unchanged.
  - specify: retired temporary launcher-unavailable REQ-FUNC-06eaa9a5 and refined REQ-FUNC-efbc6124/platform quoting spec - explicit PLG-10 launcher implementation replaces the temporary refusal; observed EIM transport requires Bash/PowerShell-specific quoting.
  - validate: real ESP-IDF build/flash/panic/source-line acceptance on both systems cannot run - required vendor toolchain and board unavailable; explicit delegation permits completing independent implementation and handing back this exact resource limit, not claiming fixtures meet hardware Done.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base 021dd98: 50 file(s) changed, 1333 line(s) added
- checks: errors=0 warnings=46 notes=8
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended

## Delivery report (2026-11-03)

- stage: validate; type: feature; path: full; branch: master
- requirements:
  - REQ-FUNC-06eaa9a5 - Report launcher programs as unavailable
  - REQ-FUNC-efbc6124 - Compose launcher arguments before the command
  - REQ-DATA-10e10001 - Explicit launcher transport
  - REQ-FUNC-10e10002 - Resolve vendor launcher
  - REQ-SEC-10e10003 - Refuse launcher metacharacters
  - REQ-FUNC-10e10004 - Run launcher commands
  - REQ-SEC-10e10005 - Bind launcher approval
  - REQ-SEC-10e10006 - Guard launcher serial ports
  - REQ-FUNC-10e10007 - Ship ESP-IDF plugin
  - REQ-SEC-10e10008 - Classify IDF commands
  - REQ-FUNC-10e10009 - Explain blocked program refusal
  - REQ-UX-10e1000a - Guide ESP32 build repair
  - REQ-UX-10e1000b - Guide ESP32 panic analysis
  - REQ-PLAT-10e1000c - Verify EIM command transport
  - REQ-PLAT-10e1000d - Accept real ESP-IDF hardware workflow
- deviations: 3 recorded
  - design: platform-aware string quoting refines universal trailing-backslash rule in architecture 3.3/REQ-FUNC-efbc6124 - actual EIM 0.20.1 on Windows rejects quoted executable without generated PowerShell call operator; Bash needs literal backslashes escaped throughout. Agent metacharacter refusals remain unchanged.
  - specify: retired temporary launcher-unavailable REQ-FUNC-06eaa9a5 and refined REQ-FUNC-efbc6124/platform quoting spec - explicit PLG-10 launcher implementation replaces the temporary refusal; observed EIM transport requires Bash/PowerShell-specific quoting.
  - validate: real ESP-IDF build/flash/panic/source-line acceptance on both systems cannot run - required vendor toolchain and board unavailable; explicit delegation permits completing independent implementation and handing back this exact resource limit, not claiming fixtures meet hardware Done.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base 021dd98: 50 file(s) changed, 1365 line(s) added
- checks: errors=0 warnings=46 notes=8
- checklist: 9/9 done
