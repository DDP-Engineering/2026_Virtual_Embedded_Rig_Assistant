# TASK-46fcedc2 - PLG-16 microchip-pymcuprog plugin

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-FUNC-dd9f71eb, REQ-SEC-9dbe7de8, REQ-SEC-f626bf83, REQ-SEC-c2108ca1, REQ-UX-d3193aa3, REQ-TEST-9b1ed1aa, REQ-PLAT-35de3f5d
parent:
branch: master
base: a5951111e8c6a642440cd8cfb2452e058e6458aa
opened: 2026-11-11

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

Problem: STATED (#72 PLG-16, packs §4): VERA cannot program AVR and PIC parts; the agent has no Microchip programming tool.
Desired outcome: STATED: `microchip-pymcuprog` with pip pymcuprog (UPDI, PICkit 4/5, nEDBG); ping and read device-read; write and erase device-write; fuse, config-word and lock writes that enable protection irreversible.
Actors: STATED: embedded engineer and the agent in a workbench with the plugin enabled.
Primary scenario: STATED: on one UPDI board the agent pings, flashes and verifies an image.
Examples: OBSERVED (`pymcuprog --help`, 3.19.4.61): `ping -t uart -u COM42 -d atmega4809`, `write -f app.hex`, `write -m fuses -o 1 -l 0xE0`, `erase --chip-erase-locked-device`.
Counterexamples: OBSERVED (pymcuprog 3.19.4.61 source): argparse with abbreviations, attached and grouped short options and an action positional anywhere; `-m` defaults to `all`; a hex write ignores `-m` and writes every segment of the file, including fuses, config words and user row; `-V`/`-R` print and return before any action; `-l` takes one or more values; `setsupplyvoltage` drives the kit supply; `-H` applies a UPDI high-voltage pulse.
In scope: STATED: package, pip install, rules, skills, catalog/pack, matcher tests. INFERRED: an `optionSyntax: pymcuprog` role projection (precedent tshark/git/sigrok) because raw-argv rules cannot see attached `-mfuses` or the default memory.
Out of scope: STATED: later candidates microchip-avrdude and microchip-mplab; writing real lock bits in any test; driver installation. Remote publication.
Constraints: STATED: shared master, base a5951111e8c6a642440cd8cfb2452e058e6458aa, autopilot; one local commit per ticket and the Gitea issue closed after implementation (user, 2026-11-11); the user has no hardware. OBSERVED: pymcuprog 3.19.4.61 is current on PyPI; makeuf2 converts a hex file offline; a missing SerialUPDI port fails with exit 1.
Success signals: STATED: matcher tests prove that protection writes are irreversible; no test writes real lock bits; UPDI board ping/flash/verify pending hardware.
Evidence: OBSERVED: pymcuprog.py argument definitions and pymcuprog_main.py write/erase/version paths; scratch runs of --help, --version, makeuf2, ping on a missing port.
Assumptions: INFERRED: any hex write is irreversible (it can carry fuse/lock/config segments); setsupplyvoltage and -H are irreversible physical outputs (like sigrok supply settings); `reset` is device-read like other resets.
Unknowns: UNKNOWN: real tool/board behaviour on Windows and Linux.
Decision-blocking questions: None.
Proposed behaviors: INFERRED (not user-accepted): hex writes, supply and high-voltage irreversible; unknown or malformed arguments device-write; erase of protection memories irreversible.
Path and reason:

| Criterion | Holds? | Evidence |
|---|---|---|
| no new externally observable behavior | no | STATED: new plugin |
| no new interface or data format | no | INFERRED: new optionSyntax value |
| no new dependency | no | STATED: pymcuprog from PyPI |
| an existing requirement already covers the behavior | no | OBSERVED: none for Microchip |
| no security or data-handling change | no | STATED: irreversible protection writes |

## Requirement coverage

| Requirement | Accepted behavior | Design | Proof |
| --- | --- | --- | --- |
| REQ-FUNC-dd9f71eb | STATED: pip pymcuprog | manifest pip + range | opt-in VERA_MCU_UV |
| REQ-SEC-9dbe7de8 | STATED: ping/read device-read, write/erase device-write; INFERRED: help/version/makeuf2 safe, verify/reset/voltage reads device-read, reboot-debugger and -U/-C device-write | projection + rules | matrix |
| REQ-SEC-f626bf83 | STATED: protection writes irreversible; INFERRED: hex writes, default memory | `<protect>` role | matrix |
| REQ-SEC-c2108ca1 | INFERRED: supply and HV are physical outputs | `<high-voltage>`, setsupplyvoltage rules | matrix |
| REQ-UX-d3193aa3 | STATED: agent workflows | two skills | installed skill listing |
| REQ-TEST-9b1ed1aa | STATED: matcher proof, no real lock bits | stub resolver gate; opt-in real makeuf2/ping | microchip-pymcuprog.test.ts |
| REQ-PLAT-35de3f5d | STATED: UPDI board ping/flash/verify | manual | pending hardware |

## Design

Diagrams: [TASK-46fcedc2 diagrams](diagram_TASK-46fcedc2.md)

### Approach

Declarative package `microchip-pymcuprog` (pip `pymcuprog>=3.19,<4`, version probe `--version`) plus a shared projection `pymcuprogRuleArguments` selected by `optionSyntax: pymcuprog`, like tshark (named constraint: existing optionSyntax seam; raw rules cannot see `-xmfuses` or the default memory `all`). Raw argv is executed and shown unchanged. Rejected: raw-argv prefix rules (miss grouped short options and absent -m).

### Interfaces and data

`pymcuprogRuleArguments(args)` mimics argparse 3.12: value letters d p t s m o b f c u i v H, flag letters h V R x U C, `-l` takes values until the next option-looking word (negative numbers are values), long options by exact name or unique prefix with `--name=value`, attached short values with one leading `=` dropped (argparse 3.12+), `--` ends options, the first positional is the action (unknown word → `<unknown>`). It returns `[action|<none>, ...roles]` with roles `<info>` (-h/-V/-R), `<protect>` (write with a .hex file, or write whose memory, default `all`, is fuses/lockbits/config_words/all; erase whose explicit memory is fuses/lockbits/config_words), `<high-voltage>` (-H), `<locked>` (-U/-C), `<unknown>` (unknown, ambiguous, missing value or flag with a value). Memory names compare case-insensitively.
Rules (REQ-SEC-9dbe7de8, REQ-SEC-f626bf83, REQ-SEC-c2108ca1): `* <info> *` and `makeuf2 *` safe; `{ping,read,verify,getvoltage,getsupplyvoltage,getusbvoltage,reset} *` device-read; `{write,erase,reboot-debugger} *`, `* <locked> *`, `* <unknown> *` device-write; `{write,erase} * <protect> *`, `setsupplyvoltage *` and `<every action> * <high-voltage> *` irreversible (confirm word = the action). Timeout 300 s. Pack `microchip` (Programming, default on). Skills microchip-flash and microchip-fuses (REQ-UX-d3193aa3).

### Files and test seams

New: `plugins/microchip-pymcuprog/{plugin.yaml,README.md,skills/*}`, `shared/src/pymcuprog-options.ts`, `tests/fixtures/microchip/app.hex`, `tests/integration/microchip-pymcuprog.test.ts`. Changed: `shared/src/plugins.ts` (enum), `shared/src/program-rules.ts` (dispatch), `plugins/catalog.yaml`, `plugins/packs.yaml`, `tests/packaging/prepare-plugins.test.ts`, planning/spec optionSyntax lists. Tests: matrix; installed skills; auto-edit replay session with a stub resolver and a fake pymcuprog script (device-read ping by mode, typed word for the fuse write); opt-in VERA_MCU_UV real provisioning, makeuf2 and a failing ping after approval (REQ-TEST-9b1ed1aa).

### Risks and open decisions

Hex writes always need the typed word, even for flash-only files (safety over convenience; the skill explains it). No test touches hardware or writes lock bits. Board acceptance is manual (REQ-PLAT-35de3f5d).

### Requirement map

Each requirement ID is cited above; REQ-FUNC-dd9f71eb: manifest pip/range; REQ-PLAT-35de3f5d: manual.

## Log

- 2026-11-11 frame: journal opened
- 2026-11-11 frame: completed; next specify - scope recorded (autopilot)
- 2026-11-11 specify: completed; next design
- 2026-11-11 design: completed; next build
- 2026-11-11 build: red: npx vitest run tests/integration/microchip-pymcuprog.test.ts exit 1 - package, pymcuprog optionSyntax, rules, skills and the fuse-write gate missing (REQ-SEC-9dbe7de8, REQ-SEC-f626bf83, REQ-SEC-c2108ca1, REQ-UX-d3193aa3, REQ-TEST-9b1ed1aa)
- 2026-11-11 build: measured: pymcuprog 3.19.4.61 argparse: '-l 0x01 write' swallows the action (error), '-l0x01 write' and '--literal=0x01 write' write with the default memory all; makeuf2 converts offline; ping on a missing SerialUPDI port exits 1
- 2026-11-11 build: green: npx vitest run tests/integration/microchip-pymcuprog.test.ts tests/packaging/prepare-plugins.test.ts exit 0 (matrix incl. attached/grouped/abbreviated/equals spellings and the attached-literal case, installed skills, auto-edit gate: device-read ping runs by mode, fuse write waits for 'write', missing and wrong word start nothing) (REQ-SEC-9dbe7de8, REQ-SEC-f626bf83, REQ-SEC-c2108ca1, REQ-UX-d3193aa3, REQ-TEST-9b1ed1aa)
- 2026-11-11 build: green: VERA_MCU_UV npx vitest run tests/integration/microchip-pymcuprog.test.ts exit 0 (10.5 s, Windows 11): pip pymcuprog 3.19 ready, --version and makeuf2 ran without approval, ping on a missing port after approval exited non-zero; regression shared program-rules/plugins, core program-tools, wireshark-tshark, sigrok, git exit 0 (137 passed, 2 opt-in skips); lint and typecheck exit 0 (REQ-FUNC-dd9f71eb, REQ-TEST-9b1ed1aa)
- 2026-11-11 build: manual (REQ-PLAT-35de3f5d): not performed - no UPDI board or tool; pending in README, knowledge, plan and State issues
- 2026-11-11 build: completed; next validate
- 2026-11-11 validate: review round 1 findings: (both, critical) '-m=fuses' / '-xm=fuses' / 'erase -m=config_words' project memory '=fuses' while argparse 3.12+ reads 'fuses' - protection writes classified device-write; matrix lacked the '=' short spelling, negative numbers and last-wins repeats. (spec) gate test runs in auto-edit while REQ-TEST and Design say ask; REQ-SEC-9dbe7de8 verification overstated (options before every action); PICkit 5 claimed but pymcuprog 3.19/pyedbglib has no pickit5. (quality, minor) --help/-h device-write; output files of makeuf2/read written without approval not disclosed. Non-blocking: coverage labels, AVR mode for PICkit 4/Snap.
- 2026-11-11 validate: returned to build - review round 1: short-option '=' values, help as info, PICkit 5 claim, verification texts, matrix coverage
- 2026-11-11 build: green (round-1 fixes): attached short values drop one leading '=' (argparse 3.12+), -h/--help are <info>, PICkit 5 claim removed (pymcuprog 3.19/pyedbglib has no pickit5), makeuf2/read -f output files disclosed; matrix adds -m=/-xm=/-l=/-f=/-H= forms, last-wins repeats, negative values, help and options before every action. npx vitest run microchip-pymcuprog + prepare-plugins + program-rules + wireshark-tshark exit 0; VERA_MCU_UV real run exit 0; lint exit 0 (REQ-SEC-9dbe7de8, REQ-SEC-f626bf83, REQ-SEC-c2108ca1, REQ-TEST-9b1ed1aa)
- 2026-11-11 build: differential (scratch, not committed): 4081 generated argv lists through pymcuprog 3.19.4.61's real argparse on CPython 3.12.13 (3239 accepted) compared with the compiled projection: under-classified 0, over-classified 220 (e.g. upper-case memory names pymcuprog rejects).
- 2026-11-11 build: completed; next validate
- 2026-11-11 validate: review round 2: spec approved, quality approved. Accepted non-blocking remainder: the projection comment overstates the argparse-version difference for '-m=' (only grouped '-xm=' differs on older releases; stripping stays conservative); README Limits 'without approval' for read -f means the output file is not gated separately; irreversible cards also show the device-write note; the argparse differential lives only in scratch.
- 2026-11-11 validate: DEVIATION validate: after both approvals, documentation-only edits without a new review round - packs.md row, plan.md candidate note and the REQ-PLAT-35de3f5d manual verification now say PICkit 4/Snap in AVR mode and that pymcuprog 3.19 has no PICkit 5. No code, test, rule or skill changed; cost: these three wording edits were not re-reviewed.
- 2026-11-11 validate: final: python .agentic/aegis.py check --task TASK-46fcedc2 --strict --run exit 0; strict ok; lint, typecheck, i18n ok (tests run separately: microchip-pymcuprog incl. VERA_MCU_UV, prepare-plugins, program-rules, wireshark-tshark exit 0); remaining warnings pre-existing except uncovered-source on the fixture tests/fixtures/microchip/app.hex (test data used by REQ-TEST-9b1ed1aa's opt-in run, not named in affected_paths)
- 2026-11-11 validate: completed; next done

## Rulings

- RULING-001 | date=2026-11-11 | decision=Local commit per ticket on master, then close the Gitea issue; UPDI board acceptance not available | reason=User 2026-11-11: no hardware; close each ticket after implementation; AGENTS.md authorizes local commits | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-46fcedc2.md
changed: 7 created, 0 revised
evidence: python .agentic/aegis.py check --task TASK-46fcedc2 --strict --run exit 0
issues: REQ-PLAT-35de3f5d UPDI board acceptance pending hardware; PICkit 5 not supported by pymcuprog 3.19; inferred classifications (hex writes, supply, -H) await user acceptance
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-11)

- stage: validate; type: feature; path: full; branch: master
- requirements:
  - REQ-FUNC-dd9f71eb - Install pymcuprog from PyPI for the microchip-pymcuprog plugin
  - REQ-SEC-9dbe7de8 - Classify pymcuprog actions from parsed option roles
  - REQ-SEC-f626bf83 - Treat pymcuprog protection writes as irreversible
  - REQ-SEC-c2108ca1 - Treat pymcuprog supply and high-voltage actions as irreversible
  - REQ-UX-d3193aa3 - Expose Microchip flashing and fuse skills
  - REQ-TEST-9b1ed1aa - Prove pymcuprog classification, typed confirmation and a real offline run
  - REQ-PLAT-35de3f5d - Microchip UPDI board acceptance
- deviations: 1 recorded
  - validate: after both approvals, documentation-only edits without a new review round - packs.md row, plan.md candidate note and the REQ-PLAT-35de3f5d manual verification now say PICkit 4/Snap in AVR mode and that pymcuprog 3.19 has no PICkit 5. No code, test, rule or skill changed; cost: these three wording edits were not re-reviewed.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base a595111: 29 file(s) changed, 1141 line(s) added
- checks: errors=0 warnings=53 notes=23
- checklist: 9/9 done
