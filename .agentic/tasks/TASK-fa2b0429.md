# TASK-fa2b0429 - IOT-02 micropython plugin: finite MicroPython file and run operations (#115)

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-DATA-cb0ccbea, REQ-SEC-bf7892ca, REQ-FUNC-884fed95, REQ-SEC-dee0e930, REQ-REL-2eaebfec, REQ-FUNC-b829232e, REQ-FUNC-d8afbfa0, REQ-FUNC-9d90c56e, REQ-SEC-d31255bc, REQ-SEC-b493a006, REQ-FUNC-9dc200c3, REQ-REL-af9aefa3, REQ-REL-1499a74b, REQ-REL-8d35cfbd, REQ-FUNC-ab3282a4, REQ-FUNC-eddae180, REQ-FUNC-2c9933c0, REQ-FUNC-44f315bd, REQ-SEC-d8ec50bc, REQ-FUNC-f030cffe, REQ-FUNC-b9a25608, REQ-TEST-6073fccf, REQ-SEC-f98d4fd3, REQ-SEC-370f2d9b, REQ-SEC-016c9aad
parent:
branch: feature/113-arduino-iot
base: a4c1383e6e5a57b9389e18aea0dc163daab717da
opened: 2026-11-14

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

Problem: VERA cannot work with MicroPython boards. OBSERVED (`05_Software/plugins/`, catalog.yaml): no plugin wraps
mpremote; serial-monitor can only capture a console or send one line. OBSERVED (`runner.ts` `start`, spec
REQ-DATA-f2cbfc23 §2): after the LAB-01 merge (a4c1383) the runner's serial-port guard holds "inside one VERA process
only, since serial-port runs take no lease file", so the desktop app and a CLI process can both open one board.

Desired outcome:
- An official plugin `micropython` (STATED ticket IOT-02) with finite operations identify, inspect-files, read-file,
  deploy-file, run-file, capture-output, reset and report on local scripts, with structured results (STATED), through
  a pinned mpremote (STATED "Motor: mpremote pin-uit"; OBSERVED PyPI: mpremote 1.29.0 of 2026-08-24 is the latest
  stable). Firmware is assumed already installed; nothing flashes firmware on connect (STATED).
- Board identity, firmware version, port and application state are checked and reported (STATED); an operation that
  interrupts the running program is not presented as passive (STATED); running from RAM and a persistent deploy are
  different operations, and the approval covers the code run and its hardware effects (STATED).
- Transfers validate the remote path, size/space and integrity; the current file is inspected before replacement and a
  concurrent change is reported; the replace mechanism actually supported is probed and an incomplete transfer is
  reported as such; no backup/restore of firmware is fabricated (STATED).
- Results `format: 1` under `arduino-iot-results/<run-id>/` (STATED plan section 3), states pass/fail/incomplete/
  blocked/skipped/error (STATED plan).
- Scope addition (STATED coordinator 2026-11-14, recorded on 00_Planning/plan/arduino-iot-plugins.md): add the serial
  identity kind to LAB-01's one lease registry so a board's serial port is reserved across desktop and CLI; move
  arduino-cli onto it where the change is small.

Actors: the user (approves device operations), the agent (runs `micropython-tool`), VERA's runner, approval gate and lease
registry, mpremote, the board's MicroPython firmware and the hardware wired to it.

Primary scenario: the agent lists ports (identity keys), identifies the board on COM5 (MicroPython version, machine,
unique id, free space), inspects its files, deploys `app/sensor.py` to `/lib/sensor.py` after the approval binds the
local file's hash (the current remote file's hash is recorded, the copy goes to a temporary file, is hashed on the board
and then replaces the target), runs a test script from RAM with a timeout and captures its output and verdict, then
writes a report.

Examples: STATED T02-A...T02-F (ticket). T02-C: editing the script after approval makes the run refuse with CONFLICT.
T02-D: a deploy to a board with too little free space is refused before any write as "no space"; a transfer cut by Stop
leaves the target unchanged and reports `incomplete`; a vanished port reports `disconnected`. T02-E: a CLI run on COM5
while the desktop app runs a capture on COM5 is BUSY. Example needing a value the user has not given: the minimum
firmware version `N` (proposed below).

Counterexamples: STATED - no interactive REPL, no automatic connect, no exec/eval of arbitrary code in argv, no mount of
a host folder, no implicit change of boot.py/main.py, no firmware install or backup/restore.

In scope: the package (manifest, README, skills, PEP 723 helper with support package, pinned mpremote/pyserial/
platformdirs), catalog/pack entries, a fake mpremote for offline tests and an opt-in test with the real pinned mpremote,
the runner's cross-process serial-port leases (INFERRED from the scope addition: the port a run names is the identity
LAB-01's registry can key without a registry entry; arduino-cli, serial-monitor and esptool name their port in argv,
so they gain it with no package change).

Out of scope: STATED - firmware installation (delegated to esptool and other tools), REPL console, mount, mip package
installs (not in the deliverables list). INFERRED (plan: no invented profiles) - per-board hardware effect profiles
beyond the firmware identity; the approval note states that code may drive any connected hardware.

Constraints: STATED (brief) pinned PyPI packages approved for tests; any other download, drivers, firmware flashing and
any write/run on a real board need the user's approval; no commit/push/branch switch; formats stay `format: 1`; modern
minimum versions; UI texts en/ro/de; focused tests only; work only in the `_iot` worktree. Branch
`feature/113-arduino-iot` (not the default branch).

Success signals: T02-B/C/D/E/F software parts covered by offline tests (fake mpremote, real runner, two lease holders)
and by the opt-in run against the real pinned mpremote; T02-A and the hardware parts of T02-B...E reported as open
blockers while no board is connected.

Evidence: ticket IOT-02.md and plan sections 2-4 (STATED); coordinator message 2026-11-14 (STATED scope addition);
runner.ts, leases.ts, resource-registry.ts, lab-resources.ts, program-request.ts (argument files hashed at approval and
again before spawn), arduino-cli and scpi-instruments packages (OBSERVED); mpremote 1.29.0 wheel (SHA-256 dedac688...,
OBSERVED `transport.py`, `transport_serial.py`: `enter_raw_repl` sends Ctrl-C and, by default, a soft reset;
`fs_writefile` writes in place; `fs_hashfile` hashes on the device or reads back when hashlib is missing). Read-only
inventory 2026-11-14 (`Win32_PnPEntity`): no USB serial board, COM3/4/7/8 are Bluetooth links.

Assumptions: rename over an existing file works on littlefs and fails on FAT (INFERRED from MicroPython's VFS docs) -
the helper probes it per transfer instead of relying on it.

Unknowns: real firmware behaviour on the user's boards and native Ubuntu (no board, no Ubuntu host); whether a board
re-enumerates on another port after a hard reset (re-bound by identity, reported).

Decision-blocking questions: none. The board-free proof was settled by the brief (missing board = open blocker); the
lease scope by the coordinator.

Proposed behaviors (not accepted until specify): minimum firmware MicroPython 1.22; listing and reads interrupt the
running program with Ctrl-C (device-read with a note), run-file soft-resets first; deploys to /boot.py or /main.py need
an explicit flag and are irreversible-risk; a serial port named by a run takes a non-actuating lease file `serial:<port>`.

Path and reason: full.

| Criterion | Holds? | Evidence |
|---|---|---|
| no new externally observable behavior | no | new plugin; cross-process BUSY for serial ports |
| no new interface or data format | no | micropython-tool CLI, result format 1 |
| no new dependency | no | mpremote 1.29.0, pyserial 3.5, platformdirs |
| an existing requirement already covers the behavior | no | none for MicroPython |
| no security or data-handling change | no | code run on a board, writes to its filesystem |

## Requirement coverage

| Behavior | Requirement | New/revised | Frame source |
|---|---|---|---|
| micropython-tool contract, run folders, result documents, exit codes (spec) | REQ-DATA-cb0ccbea | new | ticket deliverables, plan results |
| Pinned mpremote helper is the only program; no REPL, connect, exec/eval argv, mount | REQ-SEC-bf7892ca | new | ticket counterexamples, T02-F |
| ports: identity keys, bridges never name a board | REQ-FUNC-884fed95 | new | ticket identity, plan rules |
| Missing port / other identity refused before open | REQ-SEC-dee0e930 | new | T02-E selected port |
| Incompatible firmware refused before any action | REQ-REL-2eaebfec | new | T02-F |
| identify: firmware, machine, unique id, memory, fs; program interrupted | REQ-FUNC-b829232e | new | T02-A, ticket "not passive" |
| files: bounded listing with space | REQ-FUNC-d8afbfa0 | new | T02-A inspect-files |
| read-file into the run folder with hashes | REQ-FUNC-9d90c56e | new | T02-A read-file |
| Remote path validation | REQ-SEC-d31255bc | new | ticket remote paths |
| boot.py/main.py only with --startup, irreversible | REQ-SEC-b493a006 | new | T02-D no implicit boot/main |
| Deploy via verified temporary copy, probed replace mechanism | REQ-FUNC-9dc200c3 | new | T02-C integrity, ticket atomicity |
| Expected/concurrent target change -> conflict | REQ-REL-af9aefa3 | new | ticket concurrent changes |
| No space before / during transfer | REQ-REL-1499a74b | new | T02-D |
| Interrupted / unplugged / reset transfer reported distinctly | REQ-REL-8d35cfbd | new | T02-D |
| run-file from RAM: timeout, output, verdict, application state | REQ-FUNC-ab3282a4 | new | T02-B |
| capture-output bounded | REQ-FUNC-eddae180 | new | ticket deliverables |
| reset soft/hard, re-bound by identity | REQ-FUNC-2c9933c0 | new | ticket deliverables, plan re-bind |
| report of run folders | REQ-FUNC-44f315bd | new | ticket deliverables |
| Risk classification incl. interrupting reads and Stop note | REQ-SEC-d8ec50bc | new | T02-E, T02-F |
| Official plugin, skills, catalog and pack | REQ-FUNC-f030cffe | new | ticket deliverables |
| Serial port leases across VERA processes (serial identity kind) | REQ-FUNC-b9a25608 | new | scope addition, T02-E |
| Real-mpremote and board tests gated by variables | REQ-TEST-6073fccf | new | T02-A, plan evidence |
| Script/source changed after approval refused | REQ-SEC-f98d4fd3, REQ-SEC-370f2d9b | reused | T02-C |
| In-process BUSY for ports of unfinished runs | REQ-SEC-016c9aad | reused | T02-E |

## Design

Diagrams: [diagram_TASK-fa2b0429.md](diagram_TASK-fa2b0429.md)

**Approach.** A new official package `05_Software/plugins/micropython/` with one program `micropython-tool`, a PEP 723
script pinned to mpremote 1.29.0 / pyserial 3.5 / platformdirs 4.14.0 (REQ-SEC-bf7892ca), installed by VERA's uv like
scpi-instruments. It imports mpremote's `SerialTransport` as the engine and sends only fixed snippets (REQ-DATA-cb0ccbea):
mpremote's CLI was rejected because it soft-resets on its first command, writes files in place and hashes on the host
without hashlib (spec Rationale). A support package mirrors arduino-cli's layout: `cli` (argparse, dispatch, one JSON
document), `report` (header, run folders, emit, Markdown, summary - adapted from arduino_support/report.py), `workspace`
(byte-identical copy of the shared path rules), `ports` (pyserial enumeration, identity keys and bridge table as in
arduino_support/boards.py), `remote` (remote path rules), `device` (open/raw REPL/firmware check/snippets/restart/close and
the loss classification disconnected/device-reset/no-response), `deploy` (the 8-step deploy) and `operations`
(identify, files, read-file, run-file, capture-output, reset). Host side: the runner takes a non-actuating lease
`serial:<port>` for each port its guard finds in argv (REQ-FUNC-b9a25608), in the same `acquire` call as the run's
registry claims, and releases it when the run settles; no manifest change, so arduino-cli, serial-monitor, esptool and
micropython are all covered (arduino-cli moved onto the registry with zero package change).

**Interfaces and data.** CLI and documents exactly as spec REQ-DATA-cb0ccbea. Exit 0/1/2/3. Run folders
`arduino-iot-results/<run-id>/` with result.json, report.md, files/, output.txt. deploy-file writes an `incomplete`
result.json before the transfer and before the replace (REQ-REL-8d35cfbd). Leases: `LeaseClaim {kind: "serial",
alias: <port>, resource: <port>, keys: ["serial:<port>"], actuates: false}`; BUSY from another process carries
`{resource: <port>, holder}` (LAB-01's lease error); without a lease registry the in-process guard alone applies.

**Files and test seams.** Package: plugin.yaml, README.md, skills micropython-deploy and micropython-test-script,
scripts/micropython_tool.py, scripts/micropython_support/{__init__,cli,report,workspace,ports,remote,device,deploy,
operations}.py; catalog.yaml, packs.yaml (arduino pack, group MicroPython). Core: runner.ts (+ runner-leases.test.ts).
Tests: tests/integration/micropython.test.ts; fixtures tests/fixtures/micropython/ with `fake-serial/serial` (a byte-level
MicroPython board: raw REPL, raw-paste refusal, soft reboot, snippet execution in a CPython sandbox over a host folder,
faults) and `fake-mpremote/mpremote` (a minimal raw-REPL client with mpremote's SerialTransport interface for the
offline default suite); the opt-in block (VERA_MICROPYTHON_UV) installs the real pinned mpremote through VERA's
Provisioner and drives the same fake-serial board (REQ-TEST-6073fccf); a board block needs VERA_TEST_MICROPYTHON_PORT
and _IDENTITY. The workspace copy is added to the existing byte-identity check.

**Risks and open decisions.** The fake board runs the helper's snippets in CPython, so MicroPython-only behaviour
(FAT rename, ENOSPC text, raw-paste windows) is modelled, not proved; real boards stay open. Serial-port leases change
behaviour for every serial plugin: a CLI run and the desktop app on one port are now BUSY across processes, which is
the plan's intent; on Linux an unusable lease folder makes such runs DENIED `{reason: leases}` as for registry claims.
Stop kills the helper; code already running on the board continues (stated in rule notes and skills).

**Requirement map.** REQ-DATA-cb0ccbea cli/report/workspace; REQ-SEC-bf7892ca plugin.yaml + parser; REQ-FUNC-884fed95
ports; REQ-SEC-dee0e930 ports+device open order; REQ-REL-2eaebfec device firmware gate; REQ-FUNC-b829232e,
REQ-FUNC-d8afbfa0, REQ-FUNC-9d90c56e, REQ-FUNC-ab3282a4, REQ-FUNC-eddae180, REQ-FUNC-2c9933c0 operations;
REQ-SEC-d31255bc, REQ-SEC-b493a006 remote; REQ-FUNC-9dc200c3, REQ-REL-af9aefa3, REQ-REL-1499a74b, REQ-REL-8d35cfbd
deploy (+ device loss classification); REQ-FUNC-44f315bd report; REQ-SEC-d8ec50bc, REQ-FUNC-f030cffe plugin.yaml,
skills, catalog, packs; REQ-FUNC-b9a25608 runner.ts; REQ-TEST-6073fccf micropython.test.ts gating; REQ-SEC-f98d4fd3,
REQ-SEC-370f2d9b, REQ-SEC-016c9aad no design impact (reused host behaviour).

## Log

- 2026-11-14 frame: journal opened
- 2026-11-14 frame: Hardware inventory 2026-11-14 (Win32_PnPEntity, read-only): no MicroPython or USB serial board; COM3/4/7/8 are Bluetooth links. T02-A and hardware parts stay open.
- 2026-11-14 frame: completed; next specify - scope recorded (autopilot) (7 Done checklist item(s) left unticked)
- 2026-11-14 specify: DEVIATION specify: REQ-SEC-dee0e930 (port-missing / identity-mismatch) and REQ-REL-8d35cfbd (disconnected / device-reset) each keep two error codes of one refusal or loss path in one requirement - the codes share trigger point and oracle; each code still has its own test.
- 2026-11-14 specify: completed; next design
- 2026-11-14 design: completed; next build
- 2026-11-14 build: red: npx vitest run src/libraries/core/src/plugins/runner-leases.test.ts exit 1 - 3 serial-port lease tests fail: no lease file is taken for a port named in argv (REQ-FUNC-b9a25608)
- 2026-11-14 build: green: npx vitest run runner-leases.test.ts runner.test.ts leases.test.ts program-resources.test.ts exit 0, 72 passed (REQ-FUNC-b9a25608)
- 2026-11-14 build: red: npx vitest run tests/integration/micropython.test.ts exit 1 - 24 failed, 1 passed, 2 skipped: plugin micropython and micropython-tool do not exist yet (all IOT-02 requirements except REQ-FUNC-b9a25608)
- 2026-11-14 build: green: npm run typecheck (rebuilt dist); npx vitest run tests/integration/micropython.test.ts exit 0, 25 passed, 2 skipped (opt-in, hardware) - all IOT-02 requirements
- 2026-11-14 build: green (opt-in): VERA_MICROPYTHON_UV=<uv 0.11.25> VERA_MICROPYTHON_PYTHON_SEED=<local uv cpython 3.13.14> npx vitest run micropython.test.ts -t 'real mpremote' exit 0, 1 passed - VERA's Provisioner installed mpremote 1.29.0/pyserial 3.5/platformdirs 4.14.0 from PyPI; identify, deploy-file and run-file passed against the simulated board through the real mpremote raw-REPL client (REQ-TEST-6073fccf, REQ-SEC-bf7892ca)
- 2026-11-14 build: Consumers: prepare-plugins.test.ts expected list lacked arduino-cli (missed by IOT-01) and now micropython - both added; arduino-cli, serial-monitor, esp32-esptool, catalog-source, runner tests pass with serial-port leases (132 passed)
- 2026-11-14 build: completed; next validate
- 2026-11-14 validate: Inspection REQ-TEST-6073fccf: default run of micropython.test.ts shows 25 passed, 2 skipped (the opt-in and hardware blocks); with VERA_MICROPYTHON_UV set the opt-in block installed the pinned packages and passed identify, deploy-file and run-file; the hardware block stays skipped - no board connected
- 2026-11-14 validate: Review round 1: spec changes_required - (1 blocking) startup-file check case-sensitive (/MAIN.PY on FAT); capture-output/read-file rule timeouts vs limits; restart after incompatible-firmware; capture/soft reset skip the firmware check; --mkdir/stale-part writes before blocked refusals; wording drift (omitted, port.after, deviceHash, project.md); docs link to pinned mpremote; missing assertions (raw REPL left, soft reset recorded, deploy-file paths). Quality approved with non-blocking: remove-then-rename on any rename error; reset during a running snippet classified no-response; unbounded serial reads; unexpected exception leaves the run folder stale + last-line parsing; no-response leaves raw REPL; fake never exercises raw-paste.
- 2026-11-14 validate: returned to build - review round 1 findings (spec blocking: case-insensitive startup names; plus non-blocking spec and quality findings)
- 2026-11-14 build: Round 1 fixes: startup names case-insensitive (+ /MAIN.PY, /Boot.py tests); read-file limit 1 MiB with rule timeout 900, capture-output rule timeout 660; no restart after incompatible-firmware; reset soft and capture --restart check firmware through the raw REPL, plain capture reports firmware null; deploy refusals before any write (--mkdir/stale part after checks); remove-then-rename only on EEXIST, else fail write-failed; SerialTransport timeout=10; Recorder keeps last 4 KiB read for device-reset classification; fake reboot now after OK; lost link sends Ctrl-C/Ctrl-B once; unexpected exception -> Ended internal with run folder; value() takes the last literal line; fake raw-paste mode (R\x01, 128-byte window) used by one default test and the opt-in test; spec/req/knowledge wording aligned; docs link to mpremote 1.29.0.
- 2026-11-14 build: green: npx vitest run micropython.test.ts runner-leases.test.ts exit 0 (43 passed, 2 skipped); opt-in real mpremote (raw-paste) exit 0; lint 0 errors
- 2026-11-14 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-14 validate: Review round 2: spec approved, quality approved; both note (non-blocking) that Recorder.recent spans the whole session, so an earlier 'soft reboot'/'MicroPython v' read (run-file soft reset, capture --restart, file contents) turns a later loss into device-reset instead of no-response. Fixing it (clear per exchange) - a candidate edit, so round 3 follows.
- 2026-11-14 validate: returned to build - round 2 shared non-blocking finding: Recorder buffer must cover only the failing exchange
- 2026-11-14 build: red: npx vitest run micropython.test.ts -t no-response exit 1 - a silent board after a banner read earlier is classified device-reset (REQ-REL-8d35cfbd)
- 2026-11-14 build: green: npx vitest run micropython.test.ts exit 0 (28 passed, 2 skipped) - Recorder cleared at each exchange (run, send, capture loop); lint 0 errors (REQ-REL-8d35cfbd)
- 2026-11-14 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-14 validate: final: python .agentic/aegis.py check --task TASK-fa2b0429 --strict --run exit 0 (strict ok, errors=0); ran lint ok, typecheck ok, i18n ok (tests not in [check] run - focused proof: micropython.test.ts 28 passed/2 skipped, runner-leases 16 passed, opt-in real mpremote passed, consumers passed). Warnings: 59 - journal-header/ticket-ref of other tasks' journals (pre-existing); uncovered-source for README, __init__.py, fixtures and runner-leases.test.ts (test/support files outside affected_paths, as in IOT-01); secret-in-diff on the empty fake serial/tools/__init__.py is 'added lines not scanned' (0-byte untracked file), no secret.
- 2026-11-14 validate: Review: round 1 spec changes_required / quality approved; round 2 approved/approved with one shared non-blocking finding, fixed; round 3 approved/approved.
- 2026-11-14 validate: completed; next done

## Rulings

- RULING-001 | date=2026-11-14 | decision=LAB-01 (41313ca) is merged into feature/113-arduino-iot (merge a4c1383) before IOT-02; IOT-02 builds on LAB-01's lease registry and adds the serial identity kind to it, moving arduino-cli onto it where small | reason=User chose 'Merge LAB-01 first'; coordinator relayed the user's 'Yes, merge LAB-01' and the scope addition 2026-11-14 | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-fa2b0429.md
changed: micropython plugin + catalog/packs; runner.ts serial-port leases; fixtures and tests; spec REQ-DATA-cb0ccbea, REQ-DATA-f2cbfc23 §2; 22 requirements; knowledge official-plugins/plugins, context project.md
evidence: check --task TASK-fa2b0429 --strict --run exit 0 (lint, typecheck, i18n ok); micropython.test.ts 28 passed 2 skipped; runner-leases 16 passed; opt-in real mpremote 1.29.0 passed
issues: No MicroPython board: T02-A and hardware parts of T02-B..E open; native Ubuntu open
spec_compliance: approved
implementation_quality: approved
review_round: 3

## Delivery report (2026-11-14)

- stage: validate; type: feature; path: full; branch: feature/113-arduino-iot
- requirements:
  - REQ-DATA-cb0ccbea - Define the micropython-tool operations, run folders and result documents
  - REQ-SEC-bf7892ca - Reach MicroPython boards only through finite micropython-tool operations
  - REQ-FUNC-884fed95 - List serial ports with their identity keys
  - REQ-SEC-dee0e930 - Refuse a device operation whose port is missing or shows another identity
  - REQ-REL-2eaebfec - Refuse firmware other than MicroPython 1.22 or newer
  - REQ-FUNC-b829232e - Identify a MicroPython board
  - REQ-FUNC-d8afbfa0 - List the files of a MicroPython board
  - REQ-FUNC-9d90c56e - Copy a board file into the run folder
  - REQ-SEC-d31255bc - Refuse remote paths outside the allowed form
  - REQ-SEC-b493a006 - Write boot.py or main.py only when the call names --startup
  - REQ-FUNC-9dc200c3 - Deploy a file through a verified temporary copy
  - REQ-REL-af9aefa3 - Refuse a deploy when the target changed
  - REQ-REL-1499a74b - Report missing space distinctly
  - REQ-REL-8d35cfbd - Report an interrupted, unplugged or reset transfer as such
  - REQ-FUNC-ab3282a4 - Run a script from RAM with a deadline and a verdict
  - REQ-FUNC-eddae180 - Capture the board's console for a bounded time
  - REQ-FUNC-2c9933c0 - Reset a board and find it again by identity
  - REQ-FUNC-44f315bd - Summarize micropython-tool run folders
  - REQ-SEC-d8ec50bc - Classify micropython-tool operations by their effect on the board
  - REQ-FUNC-f030cffe - Ship micropython as an official plugin with skills, catalog and pack entries
  - REQ-FUNC-b9a25608 - Reserve a serial port a run names across VERA processes
  - REQ-TEST-6073fccf - Gate real-mpremote and board tests behind environment variables
  - REQ-SEC-f98d4fd3 - Void a program approval when a named file changes
  - REQ-SEC-370f2d9b - Re-check approved file hashes right before the program starts
  - REQ-SEC-016c9aad - Refuse a run that names a serial port held by another unfinished run
- deviations: 1 recorded
  - specify: REQ-SEC-dee0e930 (port-missing / identity-mismatch) and REQ-REL-8d35cfbd (disconnected / device-reset) each keep two error codes of one refusal or loss path in one requirement - the codes share trigger point and oracle; each code still has its own test.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=3
- diff vs task base a4c1383: 57 file(s) changed, 4115 line(s) added; 1 file(s) not content-scanned
- checks: errors=0 warnings=59 notes=27
- checklist: 9/9 done
