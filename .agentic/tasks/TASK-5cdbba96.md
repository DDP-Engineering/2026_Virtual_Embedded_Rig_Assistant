# TASK-5cdbba96 - PLG-08 serial-monitor plugin

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-FUNC-b7ceddbc, REQ-FUNC-3e33dbe8, REQ-SEC-79b6adad, REQ-SEC-22dd5e18, REQ-SEC-5fd0ed52, REQ-FUNC-e80e3dd7, REQ-FUNC-742426ac, REQ-PLAT-19d5189a, REQ-FUNC-42818bb7, REQ-FUNC-3ee59f30, REQ-REL-46027e04, REQ-FUNC-6f7569e2, REQ-PLAT-4013192c, REQ-REL-3c25e5c0, REQ-FUNC-0a001d5d, REQ-UX-7dc52524, REQ-TEST-4041b893, REQ-PLAT-f215472a, REQ-SEC-016c9aad
parent:
branch: master
base: 0554c48471702de36ac2e1f21b32a62367efd8ee
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
- [x] manual or inspection verification recorded where applicable
- [x] explicit review approved, when enabled
- [x] final `check --strict --run` result logged truthfully after the last edit
- [x] remaining warnings and pre-existing failures explained
- [x] `report` appended

## Frame

Problem: the plugin platform (PLG-01..05) can install, classify, approve and run declared programs, but no real plugin exists: the only plugin is the test fixture `tests/fixtures/plugins/echo-tools` (OBSERVED: `git ls-files | grep plugin.yaml`), so the agent cannot list serial ports or capture a board's console, and PLG-09 has nothing to depend on (STATED: ticket #64 goal "list ports and capture consoles on Windows and Linux"; epic #55 order PLG-08 -> PLG-09).
Desired outcome: a `serial-monitor` plugin folder (plugin.yaml, Agent Skills, one PEP 723 helper script on pyserial installed with `install: script`) that the user installs from a folder; its `list` reports each port with VID:PID, serial number and board family, `capture` reads a console for a duration, until a regex or up to a byte limit with an optional DTR/RTS reset, `send` writes one line; each command runs at the risk the packs spec names (list `safe`, capture and reset `device-read`, send `device-write`), a Linux EACCES prints the dialout/uucp instruction, and skills teach the agent to list first, prefer `/dev/serial/by-id/*` and map families (STATED: ticket #64 scope; packs §1.1, §1.4; architecture §9).
Actors: the engineer who installs and enables the plugin and approves device commands; the agent, which runs `serial` through run_program after loading the skill (STATED: architecture §3.4 rule); PLG-09, which declares `requires: [serial-monitor]` (STATED: architecture §2.1 example).
Primary scenario: with an ESP32-S3 (USB-Serial-JTAG) and an ESP32 behind a CP210x connected, the agent loads `esp32-identify`, runs `serial list` (safe, no approval), reads `303A:1001 Espressif native USB` and `10C4:EA60 CP210x`, then runs `serial capture --port COM7 --reset --until "main_task" --duration 10`, which waits for the user's approval in `ask` and returns the boot log (STATED: ticket done-when 1 and 2).
Examples: a port with VID 0x10C4 PID 0xEA60 lists family CP210x; 0x303A with any PID lists Espressif native USB; 0x0403:0x6010 lists FTDI (ESP-Prog) (STATED: ticket ID table); on Linux, opening `/dev/ttyUSB0` with EACCES prints `sudo usermod -aG dialout $USER` (Debian, Ubuntu, Fedora) and `uucp` (Arch) and a re-login step (STATED: ticket; architecture §9); a background capture on COM7 makes a `send --port COM7` BUSY through the runner's serial-port guard (OBSERVED: runner.ts `serialPorts`; knowledge plugins.md invariant).
Counterexamples: `list` never opens a port; capture without `--reset` does not toggle the reset lines on purpose (INFERRED: device-read semantics "may reset" only when asked; ESP32 auto-reset circuits reset on RTS); the script never flashes or erases (STATED: ticket scope has only list/capture/send); no agent-visible way to reach network serial URLs (`socket://`, `rfc2217://`) (INFERRED: pyserial's `serial_for_url` would turn a device-read into network access; the ticket names ports only).
In scope: the plugin folder; the script with list/capture/send and the family map; rules with notes; skills `esp32-identify` (ticket) and `serial-console` (how to use the program, since architecture §3.4 requires a skill per plugin's programs); tests without hardware (fake pyserial, recorded output, real runner, replay session); manual board steps in this journal; planning/knowledge updates; `.agentic/aegis.toml` layout entry for the new folder.
Out of scope: bundling official plugins in the package and the catalog (PLG-07, STATED: plan §PLG-07 "official plugins bundled in the package"); esptool chip-id (PLG-09, STATED: ticket "once PLG-09 exists"); any change to the platform's matcher, runner or provisioner unless a test proves a defect (INFERRED from the ticket's scope listing only plugin content); a live interactive terminal (STATED: architecture §3.2 stdin closed).
Constraints: master, one commit, no push, no AI attribution, close #64 with tea (STATED: brief); LF; format 1, no compat code; code wins and 00_Planning is updated when diverging (STATED); no network in tests: pyserial and CPython cannot be fetched, so tests use a fake `serial` package and the system Python of the toolchain (STATED: brief §5; OBSERVED: `02_Tools/README.md` "Python 3.11+" is a machine requirement); never touch a device (STATED); Windows x64 machine, Linux branches unit-tested (STATED). On the default branch master per the user's instruction (STATED).
Success signals: the three done-when boxes of #64 hold on real boards (manual, user); automated: the plugin installs into a PluginStore without issues, the provisioner resolves its program to `uv run --quiet --offline --script <installed>/scripts/serial_monitor.py`, classifyCommand gives list/capture/send their risks, the script's list/capture/send/EACCES behaviours pass against the fake pyserial, a replay session lists ports and captures after approval through the real runner; typecheck, lint, i18n and full vitest green.
Evidence: run_program, runner, guard, rules and provisioner exist (OBSERVED: commits ad9c1ba..0554c48 and `.agentic/knowledge/plugins.md`); script programs run as `uv run --quiet --offline --script <file>` and are probed with `version.args` (OBSERVED: `provisioning.ts` `scriptProgram`, `install`); `version` is required per program (OBSERVED: `plugins.ts` programSchema); a script named `serial.py` imports itself instead of pyserial when run (OBSERVED: scratchpad `shadow/scripts/serial.py` printed its own path and `Serial` None); the runner environment drops variables except the minimal set, program env and resolution env (OBSERVED: knowledge invariant); PLG-05 verified a pyserial PEP 723 script through `vera run` on Windows (OBSERVED: PLG-05 hand-over note); the packs spec puts `esp32-identify` in serial-monitor (OBSERVED: packs §1.4) while plan §PLG-09 lists it under PLG-09 (OBSERVED: plan.md line 206).
Assumptions: one reset sequence (DTR released, RTS asserted for 200 ms, then released, re-sending DTR after each RTS change for Windows usbser.sys) restarts both an ESP32-S3 over USB-Serial-JTAG and an ESP32 behind a CP210x into run mode (INFERRED from esptool's HardReset strategy; verified only by the manual board steps).
Unknowns: whether the S3's USB-Serial-JTAG port stays enumerated across an RTS reset on both systems (manual step); Ubuntu behaviour of pyserial `exclusive` locking (no Linux machine).
Decision-blocking questions: none; autopilot (OBSERVED: journal header). Location and script name are recorded as rulings.
Proposed behaviors (accepted for this task in autopilot):
- The plugin lives in `05_Software/plugins/serial-monitor/` and installs with `vera plugin install --path` or `plugins.install`; PLG-07 bundles official plugins later.
- Program `serial`, `install: { script: scripts/serial_monitor.py }`, `version: { args: [--version], match: 'serial-monitor (\d+\.\d+\.\d+)' }`; the script reports the plugin version.
- Rules: `serial {--version,--help,-h}` and `serial list *` safe; `serial capture *` device-read with a note naming the reset; `serial send *` device-write with a note; everything else falls to the platform default device-write.
- `list` prints a JSON array of `{port, vid_pid, serial_number, family, description, by_id}`; family from the ID table, else null; `by_id` is the `/dev/serial/by-id/*` link of the port on Linux, else null.
- `capture --port P [--baud 115200] [--duration 10] [--until REGEX] [--max-bytes 1048576] [--reset]`: opens with DTR/RTS released, optional reset, streams raw bytes to stdout (flushed), stops on duration, a match of `until` against each line (and the current partial line), or the byte limit; prints a one-line summary to stderr.
- `send --port P --text LINE [--eol crlf|lf|cr|none] [--baud] [--duration 1] [--until] [--max-bytes]`: writes the line, then reads the reply like capture.
- Exit codes: 0 stopped normally, 2 usage, 3 port could not be opened or failed while reading, 4 `--until` given and never matched.
- A port opened with errno EACCES prints the dialout (Debian, Ubuntu, Fedora) / uucp (Arch) instruction; other open failures print pyserial's message and a hint to list ports again and free a port another program or background capture holds.
- Skills `serial-console` and `esp32-identify` (list, map family, prefer by-id, capture after reset; confirm the chip with esptool chip-id when esp32-esptool is enabled).
Path and reason: full - a new plugin with new externally observable behaviour, a new data format (list JSON) and a new Python dependency (pyserial inside the script).

   | Criterion | Holds? | Evidence |
   |---|---|---|
   | no new externally observable behavior | no | list/capture/send |
   | no new interface or data format | no | list JSON, exit codes |
   | no new dependency | no | pyserial 3.5 in the PEP 723 header |
   | an existing requirement already covers the behavior | no | none covers serial ports |
   | no security or data-handling change | no | device-read/device-write commands on hardware |

## Requirement coverage

| Behavior | Requirement |
|---|---|
| plugin folder installs without issues; serial resolves to uv run --script serial_monitor.py | REQ-FUNC-b7ceddbc |
| --version prints serial-monitor <plugin version> for the probe | REQ-FUNC-3e33dbe8 |
| rules: list, --version, --help, -h are safe | REQ-SEC-79b6adad |
| rules: capture (reset included) is device-read with a note | REQ-SEC-22dd5e18 |
| rules: send is device-write with a note; other commands fall to device-write | REQ-SEC-5fd0ed52 |
| list prints JSON ports without opening any | REQ-FUNC-e80e3dd7 |
| family from the VID:PID table, else null | REQ-FUNC-742426ac |
| Linux by_id from /dev/serial/by-id | REQ-PLAT-19d5189a |
| capture streams bytes and stops by duration, until or max-bytes, with a summary (spec) | REQ-FUNC-42818bb7 |
| capture --reset pulses RTS with DTR released | REQ-FUNC-3ee59f30 |
| error: --until never matched -> exit 4 (0 otherwise) | REQ-REL-46027e04 |
| send writes one line with the line ending, then reads the reply | REQ-FUNC-6f7569e2 |
| error: EACCES -> exit 3 with dialout/uucp instruction | REQ-PLAT-4013192c |
| error: other open or read failure -> exit 3 with hint, output kept | REQ-REL-3c25e5c0 |
| error: invalid arguments -> exit 2, no port opened | REQ-FUNC-0a001d5d |
| skills serial-console and esp32-identify offered and say list first, by-id, family, chip-id | REQ-UX-7dc52524 |
| agent session: list without approval, capture after approval | REQ-TEST-4041b893 |
| real boards on Windows and Ubuntu (manual) | REQ-PLAT-f215472a |
| background capture makes a run naming the same port BUSY (reused; the plugin's --port form is covered by a new linked test) | REQ-SEC-016c9aad |

## Design

**Approach.** The plugin is content only: `05_Software/plugins/serial-monitor/` with `plugin.yaml`, `README.md`,
`scripts/serial_monitor.py` and skills `serial-console` and `esp32-identify` (RULING-001, RULING-002). No platform
code changes: the existing script install kind, resolver, rules, gate, runner and serial-port guard carry it
(Frame evidence). The agent runs program `serial`; VERA runs `uv run --quiet --offline --script <installed>/scripts/
serial_monitor.py <args>` (REQ-FUNC-b7ceddbc). Rejected: one program per subcommand (three scripts, three
`<programs>` lines, no shared code) and pyserial URLs such as `loop://` as a test seam (would expose `socket://` to
the agent, Frame counterexample).

**Interfaces and data.** CLI contract, JSON fields, family table, reset sequence, exit codes and messages: spec
`.agentic/specs/REQ-FUNC-42818bb7.md`. Script shape (one file, standard library + pyserial 3.5): `FAMILIES` table and
`family(vid, pid)` (REQ-FUNC-742426ac); `BY_ID = "/dev/serial/by-id"` and `by_id_links()` (REQ-PLAT-19d5189a);
`list_command()` (REQ-FUNC-e80e3dd7); `open_port(port, baud)` builds an unopened `serial.Serial` with DTR asserted
and RTS released, sets `exclusive` on POSIX, opens, then releases DTR, so the lines never pass through the reset
state (review round 1) (REQ-FUNC-42818bb7); `reset(port)` (REQ-FUNC-3ee59f30); `read(...)`
returns the stop reason and the until flag (REQ-FUNC-42818bb7, REQ-REL-46027e04); `send` writes then reuses
`read` (REQ-FUNC-6f7569e2); `fail(error)` prints the message and either the EACCES group instruction
(REQ-PLAT-4013192c) or the list/free hint (REQ-REL-3c25e5c0); argparse with `allow_abbrev=False` and typed
validators exits 2 before any open (REQ-FUNC-0a001d5d); `VERSION = "1.0.0"` equals plugin.yaml (REQ-FUNC-3e33dbe8).
Output bytes go to `sys.stdout.buffer` and are flushed per read so background runs stream. State: none kept.
Rules (REQ-SEC-79b6adad, REQ-SEC-22dd5e18, REQ-SEC-5fd0ed52): `serial {--version,--help,-h}` and `serial list *`
safe; `serial capture *` device-read; `serial send *` device-write; unmatched lines keep the platform default.

**Files and test seams.** New `05_Software/tests/integration/serial-monitor.test.ts` (integration project, compiled
`@vera/core`): installs the plugin into a temp PluginStore (REQ-FUNC-b7ceddbc, scripted host for the provisioner),
classifies rules (REQ-SEC-*), runs the installed script under the toolchain Python (`VERA_TEST_PYTHON`, else
`python`/`python3`) with `PYTHONPATH` = new fake pyserial `05_Software/tests/fixtures/serial-monitor/fake-pyserial/`
driven by a JSON scenario (`FAKE_SERIAL_SCENARIO`) that records port operations as JSON lines (`FAKE_SERIAL_RECORD`)
(script requirements); `tests/fixtures/serial-monitor/by_id.py` imports the script, points `BY_ID` at a temp folder
and patches `os.path.realpath` (REQ-PLAT-19d5189a); a recorded ESP32-S3 boot log fixture; a ProgramRunner with the
real NodeProcessHost proves the guard with `--port COM7` (REQ-SEC-016c9aad); a replay SessionService with the
real runner runs list and an approved capture (REQ-TEST-4041b893) and a SkillCatalog/programPromptEntries check
(REQ-UX-7dc52524). `.agentic/aegis.toml` layout gains `05_Software/plugins/` as source. REQ-PLAT-f215472a: manual.

**Risks and open decisions.** No hardware or network in tests: pyserial and the reset timing on real boards are
proven only by the manual steps (REQ-PLAT-f215472a). Linux branches (by-id, EACCES, exclusive) run on Windows
through the fakes only. A capture holds the port; Windows refuses a second opener and the runner's guard refuses a
second run naming the same spelling, but a by-id path and its /dev/tty name are different spellings (the script's
POSIX `exclusive` lock then refuses). Tests must not write `__pycache__` into the repo (installed copies,
`PYTHONDONTWRITEBYTECODE=1`).

**Requirement map.** REQ-FUNC-b7ceddbc manifest + install test; REQ-FUNC-3e33dbe8 VERSION + version.match;
REQ-SEC-79b6adad/22dd5e18/5fd0ed52 rules; REQ-FUNC-e80e3dd7 list; REQ-FUNC-742426ac FAMILIES; REQ-PLAT-19d5189a
by_id_links; REQ-FUNC-42818bb7 open_port + read; REQ-FUNC-3ee59f30 reset; REQ-REL-46027e04 exit 4;
REQ-FUNC-6f7569e2 send; REQ-PLAT-4013192c and REQ-REL-3c25e5c0 fail(); REQ-FUNC-0a001d5d argparse; REQ-UX-7dc52524
skills; REQ-TEST-4041b893 replay session; REQ-PLAT-f215472a manual; REQ-SEC-016c9aad guard test, no design impact.

Diagrams: [diagram_TASK-5cdbba96.md](diagram_TASK-5cdbba96.md)

**Manual board check (REQ-PLAT-f215472a), for the user.** On Windows 11, then on Ubuntu LTS, with an ESP32-S3
DevKit on its USB (USB-Serial-JTAG) socket and an ESP32 DevKitC (CP210x) connected:
1. `npm run prepare:uv` once in `05_Software`, then
   `npm run vera -- plugin install --path <absolute path of 05_Software/plugins/serial-monitor> --data <dir>`; the status line shows `serial` ready
   with version 1.0.0 (first install needs network for CPython 3.13 and pyserial).
2. Enable `serial-monitor` in a workbench (`plugins: { enabled: [serial-monitor] }`), start a session in `ask` and
   ask: "Which boards are connected? Capture the boot log of each after a reset."
3. Expect `serial list` to run without a card and show `303A:1001` Espressif native USB and `10C4:EA60` Silicon
   Labs CP210x (on Ubuntu with `by_id` paths); each `serial capture ... --reset` shows a device-read card; after
   approval the result holds the ROM banner and `main_task: Calling app_main()` (or the app's first lines).
4. Check that the S3 port is still listed after its reset (USB-Serial-JTAG must not re-enumerate under another name).
   Then run a capture WITHOUT `--reset` on the S3 while its app prints: the output must not start with the ROM
   banner (opening the port must not restart the board; matters most on Ubuntu, where open raises DTR and RTS).
5. Ubuntu only: remove the user from `dialout` (or test with a fresh user), run a capture: exit 3 with the
   `sudo usermod -aG dialout $USER` / `uucp` instruction. Restore the group.
6. Optional: a background capture (`background: true`) and then `serial send` on the same port: BUSY naming the handle.

## Log

- 2026-11-03 frame: journal opened
- 2026-11-03 frame: DEVIATION frame: script named serial_monitor.py instead of the ticket's serial.py - serial.py would shadow pyserial; the program is still called serial
- 2026-11-03 frame: completed; next specify (7 Done checklist item(s) left unticked)
- 2026-11-03 specify: completed; next design
- 2026-11-03 design: completed; next build
- 2026-11-03 build: red: npmw npx vitest run tests/integration/serial-monitor.test.ts exit 1 - store.install NOT_FOUND, plugins/serial-monitor (manifest, script, skills) missing; all 22 tests blocked (REQ-FUNC-b7ceddbc, REQ-FUNC-3e33dbe8, REQ-SEC-79b6adad, REQ-SEC-22dd5e18, REQ-SEC-5fd0ed52, REQ-FUNC-e80e3dd7, REQ-FUNC-742426ac, REQ-PLAT-19d5189a, REQ-FUNC-42818bb7, REQ-FUNC-3ee59f30, REQ-REL-46027e04, REQ-FUNC-6f7569e2, REQ-PLAT-4013192c, REQ-REL-3c25e5c0, REQ-FUNC-0a001d5d, REQ-UX-7dc52524, REQ-TEST-4041b893, REQ-SEC-016c9aad)
- 2026-11-03 build: green: npmw npx vitest run tests/integration/serial-monitor.test.ts exit 0, 22 passed (all 18 automated requirements and REQ-SEC-016c9aad); npm run typecheck exit 0; npm run lint exit 0 (0 errors, pre-existing warnings); check:i18n exit 0
- 2026-11-03 build: DEVIATION build: REQ-PLAT-f215472a (real ESP32-S3 USB-Serial-JTAG and ESP32+CP210x on Windows 11 and Ubuntu) is a manual step for the user, not run here - no board may be touched by the agent; tests use a fake pyserial
- 2026-11-03 build: DEVIATION build: Linux-only branches (by-id links, EACCES group instruction, POSIX exclusive lock) are covered on Windows only through the fake pyserial and the by_id.py harness; a native Ubuntu run is owed
- 2026-11-03 build: check --task: errors=0; this task's findings cleared (fixtures and README traced to REQ-FUNC-42818bb7, REQ-PLAT-19d5189a, REQ-FUNC-b7ceddbc); the 46 remaining warnings are on older requirements and journals
- 2026-11-03 build: completed; next validate
- 2026-11-03 validate: review round 1: spec approved (optional wording notes on spec example, --help in spec, by-id wording, REQ-FUNC-3ee59f30 'before the first read', REQ-TEST-4041b893 'without a spawn'); quality changes_required: (1) blocking - only SerialException caught, POSIX in_waiting/flush/baud raise OSError, termios.error, ValueError -> traceback exit 1; (2) blocking - open with DTR=0,RTS=0 set before open passes DTR=0/RTS=1 on Linux (kernel raises both, pyserial clears DTR first) and resets USB-Serial-JTAG boards; (3) $-anchored --until flaky because complete lines keep \r; (4) reset leaves pre-reset bytes in the input buffer; (5) fake splits chunks via utf-8 decode; (6) no test of the 4096-char partial-line bound
- 2026-11-03 validate: returned to build - review round 1 quality findings 1-6 and spec wording notes
- 2026-11-03 build: red: npmw npx vitest run tests/integration/serial-monitor.test.ts exit 1, 6 failed / 18 passed - open still DTR=0 before open (no post-open DTR release), no reset_input_buffer after reset, $ anchor fails on CR, in_waiting OSError escapes as a traceback (REQ-FUNC-42818bb7, REQ-FUNC-3ee59f30, REQ-FUNC-6f7569e2, REQ-REL-3c25e5c0, REQ-TEST-4041b893)
- 2026-11-03 build: green: npmw npx vitest run tests/integration/serial-monitor.test.ts exit 0, 24 passed (review fixes: DTR asserted before open then released, reset_input_buffer after reset, CR stripped before --until, any port exception exit 3; fake keeps bytes and raises OSError from in_waiting; new tests for $ anchor, 4096 bound, split multibyte, in_waiting OSError); biome check exit 0; typecheck exit 0
- 2026-11-03 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-03 validate: review round 2: spec approved, quality approved; optional notes accepted for a last fix: clear the input buffer while RTS holds the chip in reset (not after release, which could drop the new ROM banner); Design text still says open with DTR/RTS released and read_loop; ValueError is not Linux-only
- 2026-11-03 validate: returned to build - round 2 optional notes: reset_input_buffer inside the reset pulse, design and spec wording
- 2026-11-03 build: red: npmw npx vitest run tests/integration/serial-monitor.test.ts exit 1, 2 failed - reset_input_buffer still after RTS release (REQ-FUNC-3ee59f30, REQ-TEST-4041b893)
- 2026-11-03 build: green: npmw npx vitest run tests/integration/serial-monitor.test.ts exit 0, 24 passed (reset_input_buffer inside the reset pulse); biome exit 0; spec, REQ-FUNC-3ee59f30, knowledge and Design wording updated
- 2026-11-03 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-03 validate: review round 3: spec approved, quality approved, no findings (Frame proposal line keeps its original wording; Design is authoritative)
- 2026-11-03 validate: manual: REQ-PLAT-f215472a not run - the agent may not touch boards; steps for the user are in Design (Manual board check)
- 2026-11-03 validate: final: python .agentic/aegis.py check --task TASK-5cdbba96 --strict --run exit 0 (errors=0; lint, typecheck, i18n ok); npmw npx vitest run exit 0 (206 files, 1634 passed, 12 skipped); 46 remaining warnings are on older requirements/journals, none on this task; e2e not run (no renderer or e2e change)
- 2026-11-03 validate: completed; next done

## Rulings

- RULING-001 | date=2026-11-03 | decision=serial-monitor ships as the source folder 05_Software/plugins/serial-monitor/, installed from a folder (vera plugin install --path, plugins.install); bundling official plugins into the package stays with PLG-07 | reason=plan step 1 says 'with a plugin installed from a folder'; plan PLG-07 owns 'official plugins bundled in the package'; the user's brief asked for the smallest option PLG-09 can depend on | source=repository | supersedes=none
- RULING-002 | date=2026-11-03 | decision=the helper script is scripts/serial_monitor.py, not scripts/serial.py | reason=a script named serial.py is first on sys.path and imports itself instead of pyserial's serial package (reproduced in the scratchpad) | source=technical | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-5cdbba96.md
changed: serial-monitor plugin, tests and fixtures, knowledge official-plugins.md, context, planning
evidence: aegis check --task TASK-5cdbba96 --strict --run exit 0; npx vitest run exit 0 (1634 passed, 12 skipped)
issues: REQ-PLAT-f215472a manual board check owed by the user (Windows 11 and Ubuntu); Linux branches verified through fakes only; native Ubuntu run owed
spec_compliance: approved
implementation_quality: approved
review_round: 3

## Delivery report (2026-11-03)

- stage: validate; type: feature; path: full; branch: master
- requirements:
  - REQ-FUNC-b7ceddbc - Install the serial-monitor plugin and resolve its script program
  - REQ-FUNC-3e33dbe8 - Report the script version for the probe
  - REQ-SEC-79b6adad - Classify listing and help as safe
  - REQ-SEC-22dd5e18 - Classify console capture as device-read
  - REQ-SEC-5fd0ed52 - Classify sending a line as device-write
  - REQ-FUNC-e80e3dd7 - List serial ports as JSON without opening them
  - REQ-FUNC-742426ac - Name the board family from the USB IDs
  - REQ-PLAT-19d5189a - Report the stable by-id name of a Linux port
  - REQ-FUNC-42818bb7 - Capture a serial console until a stop condition
  - REQ-FUNC-3ee59f30 - Restart the board through DTR/RTS before a capture
  - REQ-REL-46027e04 - Exit 4 when the until expression never matched
  - REQ-FUNC-6f7569e2 - Send one line and read the reply
  - REQ-PLAT-4013192c - Explain the serial group on a Linux permission error
  - REQ-REL-3c25e5c0 - Report other port failures with a hint
  - REQ-FUNC-0a001d5d - Refuse invalid arguments before opening a port
  - REQ-UX-7dc52524 - Teach the agent the serial-monitor workflow
  - REQ-TEST-4041b893 - Run the plugin through an agent session
  - REQ-PLAT-f215472a - List and capture real ESP32 boards on both systems
  - REQ-SEC-016c9aad - Refuse a run that names a serial port held by a background run
- deviations: 3 recorded
  - frame: script named serial_monitor.py instead of the ticket's serial.py - serial.py would shadow pyserial; the program is still called serial
  - build: REQ-PLAT-f215472a (real ESP32-S3 USB-Serial-JTAG and ESP32+CP210x on Windows 11 and Ubuntu) is a manual step for the user, not run here - no board may be touched by the agent; tests use a fake pyserial
  - build: Linux-only branches (by-id links, EACCES group instruction, POSIX exclusive lock) are covered on Windows only through the fake pyserial and the by_id.py harness; a native Ubuntu run is owed
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=3
- diff vs task base 0554c48: 40 file(s) changed, 1957 line(s) added
- checks: errors=0 warnings=46 notes=5
- checklist: 9/9 done
