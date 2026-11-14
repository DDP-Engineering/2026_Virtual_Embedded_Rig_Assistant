# TASK-0bc542d8 - IOT-03 circuitpython plugin: CircuitPython code and compatible libraries on an identified board (#116)

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-DATA-8f309a53, REQ-SEC-a6773cd2, REQ-FUNC-1bb6b2bb, REQ-FUNC-3f98ad97, REQ-SEC-b561dad0, REQ-SEC-8ddddfbb, REQ-REL-e00b3fb2, REQ-FUNC-96d699ae, REQ-FUNC-33fb01a8, REQ-FUNC-e51d0294, REQ-FUNC-37730607, REQ-REL-33085a32, REQ-REL-ca9500d0, REQ-SEC-15d58156, REQ-SEC-1d4b7f0a, REQ-FUNC-5a6f4aec, REQ-SEC-a59697a3, REQ-REL-aa8de0c7, REQ-REL-3542e56c, REQ-REL-dff06f35, REQ-REL-b71b5cab, REQ-FUNC-9845bd14, REQ-FUNC-3371a413, REQ-FUNC-52e12d99, REQ-SEC-1102b4a6, REQ-FUNC-998ebdb7, REQ-FUNC-96c2f1de, REQ-TEST-5af7bf4a, REQ-SEC-f98d4fd3, REQ-SEC-370f2d9b, REQ-FUNC-b9a25608, REQ-DATA-f2cbfc23
parent:
branch: feature/113-arduino-iot
base: aca377d4ca9a76189fb2bc1b25b96d214b3928c7
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

Problem: VERA cannot work with CircuitPython boards. OBSERVED (`05_Software/plugins/`, catalog.yaml): no plugin
handles a CIRCUITPY volume or CircuitPython libraries; the micropython plugin refuses CircuitPython firmware
(REQ-REL-2eaebfec) and talks only the raw REPL, which is the wrong model for CircuitPython's USB-drive workflow.

Desired outcome:
- An official plugin `circuitpython` (STATED ticket IOT-03) with the deliverables identify, inspect-code,
  inspect-libraries, prepare-libraries, deploy and capture/report (STATED), on an identified volume/device, without
  assuming MicroPython compatibility (STATED).
- circup and the library bundles are pinned (STATED); the package selects libraries compatible with the firmware's
  major version and the .mpy ABI (STATED); no implicit update-all and no UF2 firmware replacement (STATED).
- Identification binds the CIRCUITPY volume to the actual board/port and the available firmware information, not only
  to the disk label (STATED); with two volumes or insufficient identity a write is blocked until a selection (STATED).
- Copying code may trigger autoreload: the request covers the resulting execution and the project's physical effects
  (STATED); concurrency with an editor and the board's supported autoreload policy are handled explicitly (STATED).
- Library dependencies are resolved before the transfer, space is checked and only approved files are transferred
  (STATED); no atomic transaction is promised for the whole USB volume; on unplug the list of confirmed and unconfirmed
  files is kept and the application is not declared fully updated (STATED).
- Results `format: 1` under `arduino-iot-results/<run-id>/`, states pass/fail/incomplete/blocked/skipped/error (STATED
  plan section 3); a CIRCUITPY volume, if reserved, is a new identity kind in LAB-01's one lease registry (STATED brief).

Actors: the user (approves device operations and network preparation), the agent (runs `circuitpython-tool`), VERA's
runner, approval gate and lease registry, circup's bundle conventions, GitHub releases of the Adafruit bundles, the
board's CircuitPython firmware (USB drive CIRCUITPY plus serial console) and the hardware wired to it.

Primary scenario: the agent lists devices (CIRCUITPY volumes with boot_out.txt firmware/board/UID, serial ports with
identity keys, and the volume-port binding), identifies the board on `E:` (CircuitPython 9.x, board id, UID, space,
read-only state), inspects its code and /lib, prepares `adafruit_bme280` for firmware major 9 from a pinned bundle tag
(network, no board: dependencies resolved, only `9.x-mpy` files with a compatible .mpy header, files hashed into a
library-set manifest), then deploys `app/code.py` and that library set offline (approval binds the code and the
manifest by hash; space checked; libraries first, code last; each file confirmed by read-back hash), captures the
serial console of the auto-reloaded run (output, traceback, autoreload on/off), and writes a report.

Examples: STATED T03-A...T03-F (ticket). T03-B: a library whose bundle .mpy is not CircuitPython 9+ ABI is not
offered as compatible. T03-D: a read-only volume (boot.py remounted it for the board) refuses before any write; too
little space refuses before any write; an unplug in the middle reports confirmed/unconfirmed files, status incomplete;
a code.py changed by an editor since inspection or during the deploy gives a conflict, not a pass. T03-E: preparing
libraries contacts the network, deploy never does; nothing updates all libraries or touches another board.
Example needing a value the user has not given: the bundle tag `YYYYMMDD` to pin (the caller names it; no "latest").

Counterexamples: STATED - no UF2/firmware replacement, no implicit update-all, no write to a volume chosen by label
alone, no MicroPython raw-REPL assumptions, no atomicity claim for the whole volume, no "fully updated" after a lost
transfer.

In scope: the package (manifest, README, skills, PEP 723 helper with support package, pinned circup 3.1.0 and
pyserial 3.5), catalog/pack entries, offline tests against a simulated CircuitPython board (a folder standing for the
CIRCUITPY volume plus a fake serial console that reruns code.py on writes), a local fixture bundle, an opt-in test with
the real pinned circup from PyPI, and the volume identity kind in the runner's lease set (INFERRED: a deploy and another
VERA run must not write one volume concurrently; the serial-port lease does not cover a volume named without its port).

Out of scope: STATED - UF2/firmware installation, update-all. INFERRED (ticket deliverables list) - web workflow
(network CircuitPython boards), library uninstall, examples download, community bundle choice beyond the pinned
Adafruit bundle. Settings files that hold secrets (`settings.toml`) are listed by name but never copied or read
(INFERRED from plan section 2: secrets never in artifacts).

Constraints: STATED (brief) pinned PyPI packages approved for tests; any other download (notably the Adafruit bundle
zips), drivers, UF2 flashing and any write to a real board or CIRCUITPY volume need the user's approval; read-only
enumeration is fine; no commit/push/branch switch; formats `format: 1`; modern minimum versions (CircuitPython 9+);
UI texts en/ro/de; focused tests only; work only in the `_iot` worktree. Branch `feature/113-arduino-iot` (not the
default branch).

Success signals: T03-B/C/D/E/F software parts covered by offline tests (simulated volume and console, fixture bundle,
real runner and lease registry); T03-A and the hardware parts of T03-C/D/F reported as open blockers while no board
is connected; the real bundle download reported open unless the user approves it.

Evidence: ticket IOT-03.md and plan sections 2-4 (STATED); brief of the coordinator session (STATED); micropython and
arduino-cli packages, runner.ts serialPorts/port claims, leases.ts (kind is data), lab-resources.ts (OBSERVED);
circup 3.1.0 wheel from PyPI, SHA-256 f3fabbfd..., MIT (OBSERVED `shared.py`: PLATFORMS 9mpy/10mpy/11mpy,
SUPPORTED_PLATFORMS 9-11, .mpy header `C\x06` = CircuitPython 9+, `C\x05` = 7-8; `bundle.py`: release asset
`adafruit-circuitpython-bundle-<platform>-<tag>.zip`; `command_utils.py`: `find_device` returns the first CIRCUITPY
volume only, `get_dependencies` reads `requirements/<lib>/requirements.txt` and pyproject `circup_dependencies` from
the py bundle, prints with click; `backends.py` DiskBackend copies in place, parses boot_out.txt version and Board ID).
Read-only inventory 2026-11-14 (`Win32_LogicalDisk`, `Win32_PnPEntity`): no CIRCUITPY volume and no CircuitPython USB
device; E: is an empty removable card reader (USB 14cd:1212), COM3/4/7/8 are Bluetooth links.

Assumptions: boot_out.txt line 3 `UID:<hex>` (CircuitPython 8+) equals the board's USB serial number, so a volume binds
to its serial port by UID (INFERRED from CircuitPython's USB descriptor convention; reported as `bound` only when the
two values match, never guessed).

Unknowns: real firmware behaviour (autoreload timing, read-only remount, Windows write caching on unplug) on the user's
boards and native Ubuntu (no board, no Ubuntu host); whether the user approves a real bundle download for the opt-in
test.

Decision-blocking questions: none. The board-free proof is settled by the brief (missing board = open blocker); the
bundle download is optional proof, asked separately (non-blocking).

Proposed behaviors (not accepted until specify): supported firmware = the majors circup 3.1.0 supports (9, 10, 11);
.mpy files must start with `C\x06`; library sets are prepared into the run folder with a manifest that deploy verifies
file by file; bundle zips cached in VERA's own folder with recorded SHA-256; writes need `--volume` and `--identity`;
code.py/boot.py writes are separate risk levels; a run naming `--volume` leases `volume:<path>`.

Path and reason: full.

| Criterion | Holds? | Evidence |
|---|---|---|
| no new externally observable behavior | no | new plugin; volume leases |
| no new interface or data format | no | circuitpython-tool CLI, result and library-set format 1 |
| no new dependency | no | circup 3.1.0, pyserial 3.5 |
| an existing requirement already covers the behavior | no | none for CircuitPython |
| no security or data-handling change | no | network downloads, writes to a board's drive, code that autoreloads |

## Requirement coverage

| Behavior | Requirement | New/revised | Frame source |
|---|---|---|---|
| circuitpython-tool contract, run folders, library set, result documents, exit codes (spec) | REQ-DATA-8f309a53 | new | ticket deliverables, plan results |
| Pinned circup/pyserial helper is the only program; no REPL, exec, UF2, update-all | REQ-SEC-a6773cd2 | new | ticket: pinned circup, no update-all, no UF2 |
| devices: CIRCUITPY volumes with firmware, read-only, identity, port; serial ports | REQ-FUNC-1bb6b2bb | new | T03-A identification |
| Volume bound to its serial port only by matching UID | REQ-FUNC-3f98ad97 | new | ticket: volume bound to board/port, not only label |
| Missing volume / other identity refused before read or write | REQ-SEC-b561dad0 | new | T03-D no selection of another volume |
| Shared or insufficient identity blocks writes | REQ-SEC-8ddddfbb | new | ticket: two volumes or insufficient identity block writes |
| Unsupported firmware (not 9-11) refused | REQ-REL-e00b3fb2 | new | T03-B firmware version |
| identify: firmware, board, UID, platform, space, read-only, port | REQ-FUNC-96d699ae | new | deliverable identify |
| inspect-code: listing, startup file, copies; secrets never read | REQ-FUNC-33fb01a8 | new | deliverable inspect-code |
| inspect-libraries: versions and .mpy ABI verdicts | REQ-FUNC-e51d0294 | new | deliverable inspect-libraries, T03-B |
| prepare-libraries: pinned tag, dependencies, library set with hashes, no volume access | REQ-FUNC-37730607 | new | deliverable prepare-libraries, T03-B, T03-E |
| Incompatible .mpy in a selection blocks the set | REQ-REL-33085a32 | new | T03-B |
| Unknown library / download failure distinct | REQ-REL-ca9500d0 | new | T03-E network distinct |
| Only pinned release assets; cache hashes verified | REQ-SEC-15d58156 | new | ticket: bundles pinned |
| Deploy checks library set against manifest and firmware major | REQ-SEC-1d4b7f0a | new | ticket: only approved files transferred |
| Deploy one verified file at a time, startup code last, confirmed list | REQ-FUNC-5a6f4aec | new | T03-C deploy, ticket transfer |
| boot.py only with --boot; boot_out.txt and part names refused | REQ-SEC-a59697a3 | new | ticket: startup protection (IOT-02 convention) |
| Read-only volume before / during | REQ-REL-aa8de0c7 | new | T03-D |
| No space before / during | REQ-REL-3542e56c | new | T03-D, ticket space check |
| Unplug or stop: incomplete with confirmed/unconfirmed files | REQ-REL-dff06f35 | new | T03-D, T03-F, ticket unplug |
| External change (editor) since inspection or during deploy -> conflict | REQ-REL-b71b5cab | new | T03-D, ticket editor concurrency |
| capture-output: console run, verdict, autoreload state, --reload | REQ-FUNC-9845bd14 | new | deliverable capture, T03-C |
| deploy --capture: the autoreload run after writes | REQ-FUNC-3371a413 | new | T03-C autoreload declared |
| report of run folders | REQ-FUNC-52e12d99 | new | deliverable report |
| Risk classification incl. autoreload and Stop notes | REQ-SEC-1102b4a6 | new | ticket approvals, T03-F |
| Official plugin, skills, catalog and pack | REQ-FUNC-998ebdb7 | new | ticket deliverables |
| Volume identity kind in the lease registry (BUSY across processes) | REQ-FUNC-96c2f1de | new | brief: volume identity kind, T03-F |
| Real circup, real bundle and board tests gated by variables | REQ-TEST-5af7bf4a | new | T03-A, plan evidence |
| Files named by an approved request bound by hash; re-checked before start | REQ-SEC-f98d4fd3, REQ-SEC-370f2d9b | reused | ticket approvals |
| Serial port named by a run leased across processes (capture-output, deploy --port) | REQ-FUNC-b9a25608 | reused | T03-F |
| Host lease spec section 2 gains identity kind volume | REQ-DATA-f2cbfc23 (spec §2) | revised | brief |

## Design

Diagrams: [diagram_TASK-0bc542d8.md](diagram_TASK-0bc542d8.md)

**Approach.** A new official package `05_Software/plugins/circuitpython/` with one program `circuitpython-tool`, a PEP
723 script pinned to circup 3.1.0 and pyserial 3.5 (REQ-SEC-a6773cd2), installed by VERA's uv like micropython. The
board is reached through its CIRCUITPY drive with ordinary file I/O and, for capture, its serial port (pyserial); the
REPL is never used to write files (spec Rationale). circup is imported as a library for the bundle conventions only
(platform names, supported majors, asset names, name cleaning, requirement parsing, NOT_MCU_LIBRARIES, version
extraction); its CLI was rejected because it picks the first CIRCUITPY volume, downloads the latest bundle, offers
update-all and copies in place (frame evidence). The network step (prepare-libraries) writes a library set with a
hash manifest into the workbench; deploy is offline and verifies every file against that manifest, whose own hash
VERA's approval binds (REQ-FUNC-37730607, REQ-SEC-1d4b7f0a, reused REQ-SEC-f98d4fd3). Deploy writes one file at a time
via `<target>.vera-part` + read-back + `os.replace`, libraries first and startup code last, rewriting an incomplete
result after each file (REQ-FUNC-5a6f4aec, REQ-REL-dff06f35). Host side: the runner adds identity kind `volume`
alongside the serial-port claims (REQ-FUNC-96c2f1de), so no manifest field or registry entry is needed.

**Interfaces and data.** CLI, documents, library set and exit codes exactly as spec REQ-DATA-8f309a53. Volume identity
`usb:<vid>:<pid>:<serial>` when bound by UID, else `circuitpy-uid:<uid>`, else `volume-serial:<serial>`
(REQ-FUNC-3f98ad97). Bundle cache `~/.vera-circuitpython/bundles/<tag>/` (or `$VERA_CIRCUITPYTHON_HOME`) with
`hashes.json`, written aside and renamed (REQ-SEC-15d58156). Test seams `VERA_CIRCUITPYTHON_FAKE_BENCH` (volume list
and deploy faults) and `VERA_CIRCUITPYTHON_DOWNLOAD_BASE` (127.0.0.1 only); the runner's environment allowlist never
passes either to a program. Lease: `LeaseClaim {kind: "volume", alias, resource, keys: ["volume:<value>"], actuates:
false}`; in-process BUSY `{handle, resource}`.

**Files and test seams.** Package: plugin.yaml, README.md, skills circuitpython-deploy and circuitpython-libraries,
scripts/circuitpython_tool.py, scripts/circuitpython_support/{__init__, cli, report, workspace (byte-identical copy),
ports (micropython's listing and port check), volumes (enumeration, boot_out.txt, identity, binding, selection),
inspection (identify, inspect-code, inspect-libraries, .mpy header), bundle (cache, download, resolution, library
set), deploy, console (serial capture and transcript parsing)}.py; catalog.yaml, packs.yaml (arduino pack). Core:
runner.ts `volumeKeys(args)` + claims (runner-leases.test.ts). Tests: tests/integration/circuitpython.test.ts;
fixtures tests/fixtures/circuitpython/: `fake-serial/serial` (a CircuitPython console that reruns code.py from the
bench volume folder in CPython on writes when autoreload is on, or on Ctrl-D), `fake-circup/circup` (the six circup
names conventions.py imports, so the default offline suite needs no PyPI package; the opt-in block runs the real one), a bundle builder in tests/support that
writes small py and 9.x-mpy zips (C\x06, C\x05 and M\x06 headers, requirements, pyproject) served by a local HTTP
server in the test; opt-in blocks for real circup (VERA_CIRCUITPYTHON_UV), a real bundle tag
(VERA_CIRCUITPYTHON_BUNDLE_TAG) and a real board (VERA_TEST_CIRCUITPY_VOLUME/_IDENTITY) (REQ-TEST-5af7bf4a). The
workspace copy joins the existing byte-identity check.

**Risks and open decisions.** The simulated console models CircuitPython's banner lines and autoreload; real timing,
Windows write caching and read-only remounts stay open until a board is connected. A FAT volume has no atomic replace
across files: the result lists confirmed and unconfirmed files instead (ticket). The bundle has no published hash: the
first download is trusted and recorded, later uses verified (trust on first use, recorded in the library set).
Autoreload starts new code while later files are still being written only if writes pause longer than the firmware's
debounce; startup code last limits the window. Stop kills the helper; code already running on the board continues.

**Requirement map.** REQ-DATA-8f309a53 cli/report/workspace; REQ-SEC-a6773cd2 plugin.yaml + parser; REQ-FUNC-1bb6b2bb,
REQ-FUNC-3f98ad97, REQ-SEC-b561dad0, REQ-SEC-8ddddfbb volumes + ports; REQ-REL-e00b3fb2 volumes firmware gate;
REQ-FUNC-96d699ae, REQ-FUNC-33fb01a8, REQ-FUNC-e51d0294 inspection; REQ-FUNC-37730607, REQ-REL-33085a32,
REQ-REL-ca9500d0, REQ-SEC-15d58156 bundle; REQ-SEC-1d4b7f0a, REQ-FUNC-5a6f4aec, REQ-SEC-a59697a3, REQ-REL-aa8de0c7,
REQ-REL-3542e56c, REQ-REL-dff06f35, REQ-REL-b71b5cab deploy; REQ-FUNC-9845bd14 console; REQ-FUNC-3371a413 deploy +
console; REQ-FUNC-52e12d99 report; REQ-SEC-1102b4a6, REQ-FUNC-998ebdb7 plugin.yaml, skills, catalog, packs;
REQ-FUNC-96c2f1de runner.ts; REQ-TEST-5af7bf4a circuitpython.test.ts gating; REQ-SEC-f98d4fd3, REQ-SEC-370f2d9b,
REQ-FUNC-b9a25608 no design impact (reused host behaviour); REQ-DATA-f2cbfc23 §2 documents the volume kind.


## Log

- 2026-11-14 frame: journal opened
- 2026-11-14 frame: Hardware inventory 2026-11-14 (Win32_LogicalDisk, Win32_PnPEntity, read-only): no CIRCUITPY volume, no CircuitPython USB device; E: is an empty card reader (USB 14cd:1212); COM3/4/7/8 are Bluetooth. T03-A and hardware parts stay open.
- 2026-11-14 frame: completed; next specify - scope recorded (autopilot) (7 Done checklist item(s) left unticked)
- 2026-11-14 specify: DEVIATION specify: REQ-SEC-b561dad0, REQ-SEC-8ddddfbb, REQ-REL-ca9500d0, REQ-SEC-1d4b7f0a, REQ-SEC-a59697a3 each keep two error codes of one refusal point, and REQ-REL-aa8de0c7, REQ-REL-3542e56c, REQ-REL-b71b5cab each keep the before-write refusal and the during-transfer failure of one condition in one requirement - shared trigger and oracle (nothing written / confirmed list); each code still gets its own test.
- 2026-11-14 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-14 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-14 build: red: npx vitest run src/libraries/core/src/plugins/runner-leases.test.ts exit 1 - 3 volume-lease tests fail: volumeKeys does not exist and no lease is taken for --volume (REQ-FUNC-96c2f1de)
- 2026-11-14 build: green: npx vitest run runner-leases.test.ts runner.test.ts exit 0, 63 passed (REQ-FUNC-96c2f1de)
- 2026-11-14 build: DEVIATION build: the circuitpython helper, fixtures and package were written before circuitpython.test.ts ran, so the plugin requirements have no red line before implementation; the tests were written from the requirements' verification text and their first run is recorded as is (the runner volume lease kept test-first: red then green).
- 2026-11-14 build: red (first run, after implementation): npx vitest run tests/integration/circuitpython.test.ts exit 1 - 8 failed: in-process bundle server blocked by spawnSync (6), editor fault wrote CRLF, fake console output block-buffered; then 3 failed (request log CRLF, download-base check after cache lookup, wrong test expectation)
- 2026-11-14 build: green: npx vitest run tests/integration/circuitpython.test.ts runner-leases.test.ts exit 0, 46 passed, 2 skipped (opt-in real circup, hardware) - all IOT-03 requirements
- 2026-11-14 build: green (opt-in): VERA_CIRCUITPYTHON_UV=<uv 0.11.25> VERA_CIRCUITPYTHON_PYTHON_SEED=<local uv cpython 3.13.14> npx vitest run circuitpython.test.ts -t 'real circup' exit 0, 1 passed - VERA's Provisioner installed circup 3.1.0 and pyserial 3.5 from PyPI; prepare-libraries (fixture bundle), deploy and inspect-libraries passed with the real circup conventions (REQ-TEST-5af7bf4a, REQ-SEC-a6773cd2)
- 2026-11-14 build: evolution reviewed: 30 paths (25 added, 5 modified) all within the design's file list; check --task: errors=0, remaining warnings belong to other tasks' requirements and journals
- 2026-11-14 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-14 validate: Inspection REQ-TEST-5af7bf4a: default run of circuitpython.test.ts shows 27 passed, 2 skipped (real circup, hardware); with VERA_CIRCUITPYTHON_UV set the real-circup block installed circup 3.1.0/pyserial 3.5 from PyPI and passed; the real-bundle download (VERA_CIRCUITPYTHON_BUNDLE_TAG) was not run - it needs the user's approval for a GitHub download; the hardware block stays skipped - no board connected
- 2026-11-14 validate: Review round 1: spec changes_required - (blocking) REQ-REL-dff06f35 verification says partially-updated where unplug reports unknown; REQ-DATA-8f309a53 run-exists and .vera results-dir untested; (non-blocking) failing-file wording in REQ-REL-aa8de0c7/-3542e56c, report.md lacks library set and capture identity, REQ-SEC-b561dad0 wording (boot_out.txt is read), spec omits codes/limits (verify-failed, too-large, bundle-invalid, port-open-failed, port-lost, no-lib, internal, EPERM, 8 segments, application restarted/unchanged), missing assertions, fake-circup absent from Design, runner relative/case volume keys vs spec, skill line on host-only packages. Quality changes_required - (blocking) no os.sync after replace on Linux: confirmed/capture before the board sees the file; (non-blocking) shadowed startup file, Linux unplug classified write-failed, autoreload off unobservable, concurrent bundle download .part clash, deploy hashes settings.toml into the result.
- 2026-11-14 validate: returned to build - review round 1 findings (spec: verification text, untested run-exists/.vera checks; quality: no sync after replace on Linux; plus non-blocking items)
- 2026-11-14 build: Round 1 fixes: os.sync after each replace (Linux vfat page cache; Windows has no os.sync and removable drives write through - not testable offline); EIO/ENODEV/ENXIO and Windows 21/55/433/1167 classified disconnected (fault ioErrorAtFile); startup-shadowed warning and startup field; secret targets keep only {exists,size,secret} in the result, --expect-from compares their size; per-process bundle .part name with the replace inside try; report.md library-set column and capture-output identity; tests for run-exists, .vera results-dir, timestamps, settings.toml size and report.md, unknown-library writes no set, deploy makes no request, autoreload unknown when off; requirement texts REQ-REL-dff06f35/-aa8de0c7/-3542e56c, REQ-SEC-b561dad0, REQ-FUNC-3371a413/-5a6f4aec, REQ-DATA-8f309a53 aligned; spec lists the extra codes/limits; spec §2 volume keys as built (absolute resolved, relative as written); Design names fake-circup; skill line corrected.
- 2026-11-14 build: green: npx vitest run tests/integration/circuitpython.test.ts exit 0 (28 passed, 2 skipped); opt-in real circup exit 0; npm run lint exit 0
- 2026-11-14 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-14 validate: Review round 2: spec approved, quality approved. Non-blocking notes: deploy may target settings.toml/secrets.py and reads their bytes in memory to compare (no hash or content in results; --expect-from compares size only); a real flash EIO is reported disconnected; a shadowed deploy passes with a warning.
- 2026-11-14 validate: DEVIATION validate: the Frame's 'settings.toml never copied or read' holds for inspect-code and all artifacts, but deploy reads an existing secret target in memory to detect concurrent changes and --expect-from compares only its size - accepted: nothing secret reaches a result, and a same-size editor change to a secret file is not detected.
- 2026-11-14 validate: final: python .agentic/aegis.py check --task TASK-0bc542d8 --strict --run exit 0 (strict ok, errors=0); ran lint ok, typecheck ok, i18n ok (tests are not in [check] run - focused proof: circuitpython.test.ts 28 passed/2 skipped, runner-leases 19 passed, opt-in real circup passed, consumers prepare-plugins/micropython/runner passed). Warnings 57: journal-header, ticket-ref, stale-paths and no-linked-tests belong to other tasks' records (pre-existing); 9 uncovered-source are the empty __init__.py, fixtures and runner-leases.test.ts (test/support files outside affected_paths, as in IOT-01/02).
- 2026-11-14 validate: completed; next done

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-0bc542d8.md
changed: circuitpython plugin + catalog/packs; runner.ts volume leases; fixtures and tests; spec REQ-DATA-8f309a53, REQ-DATA-f2cbfc23 §2; 28 requirements; knowledge official-plugins/plugins, context project.md
evidence: check --task TASK-0bc542d8 --strict --run exit 0
issues: No CircuitPython board: T03-A and hardware parts of T03-C/D/F open; real Adafruit bundle download not run (needs approval); native Ubuntu open
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-14)

- stage: validate; type: feature; path: full; branch: feature/113-arduino-iot
- requirements:
  - REQ-DATA-8f309a53 - Define the circuitpython-tool operations, run folders, library sets and result documents
  - REQ-SEC-a6773cd2 - Reach CircuitPython boards only through finite circuitpython-tool operations
  - REQ-FUNC-1bb6b2bb - List CircuitPython volumes and serial ports with their identity keys
  - REQ-FUNC-3f98ad97 - Bind a CIRCUITPY volume to a serial port only by matching UID
  - REQ-SEC-b561dad0 - Refuse a volume operation whose volume is missing or shows another identity
  - REQ-SEC-8ddddfbb - Refuse a volume write when the identity does not single out one volume
  - REQ-REL-e00b3fb2 - Refuse firmware other than CircuitPython 9 to 11
  - REQ-FUNC-96d699ae - Identify a CircuitPython board from its volume
  - REQ-FUNC-33fb01a8 - Inspect the code files of a CircuitPython volume
  - REQ-FUNC-e51d0294 - Inspect the libraries of a CircuitPython volume against the firmware ABI
  - REQ-FUNC-37730607 - Prepare a library set from a pinned bundle for one firmware major version
  - REQ-REL-33085a32 - Refuse a library set holding an incompatible .mpy file
  - REQ-REL-ca9500d0 - Report an unknown library or an unavailable bundle distinctly
  - REQ-SEC-15d58156 - Download only pinned bundle zips and verify cached copies
  - REQ-SEC-1d4b7f0a - Deploy a library set only when it matches its manifest and the board's firmware
  - REQ-FUNC-5a6f4aec - Deploy files to a CircuitPython volume one verified file at a time
  - REQ-SEC-a59697a3 - Write boot.py only when the call names --boot
  - REQ-REL-aa8de0c7 - Refuse or stop a deploy on a read-only volume
  - REQ-REL-3542e56c - Report missing space before or during a deploy
  - REQ-REL-dff06f35 - Report a deploy cut by an unplug or a stop as incomplete with confirmed files
  - REQ-REL-b71b5cab - Refuse a deploy over files changed outside it
  - REQ-FUNC-9845bd14 - Capture a CircuitPython console run with its verdict and autoreload state
  - REQ-FUNC-3371a413 - Capture the run an autoreload starts after a deploy
  - REQ-FUNC-52e12d99 - Summarize circuitpython-tool run folders
  - REQ-SEC-1102b4a6 - Classify circuitpython-tool operations by their effect on the board
  - REQ-FUNC-998ebdb7 - Ship circuitpython as an official plugin with skills, catalog and pack entries
  - REQ-FUNC-96c2f1de - Reserve a volume a run names across VERA processes
  - REQ-TEST-5af7bf4a - Gate real-circup, real-bundle and board tests behind environment variables
  - REQ-SEC-f98d4fd3 - Void a program approval when a named file changes
  - REQ-SEC-370f2d9b - Re-check approved file hashes right before the program starts
  - REQ-FUNC-b9a25608 - Reserve a serial port a run names across VERA processes
  - REQ-DATA-f2cbfc23 - Declare bench resources in one workbench registry file
- deviations: 3 recorded
  - specify: REQ-SEC-b561dad0, REQ-SEC-8ddddfbb, REQ-REL-ca9500d0, REQ-SEC-1d4b7f0a, REQ-SEC-a59697a3 each keep two error codes of one refusal point, and REQ-REL-aa8de0c7, REQ-REL-3542e56c, REQ-REL-b71b5cab each keep the before-write refusal and the during-transfer failure of one condition in one requirement - shared trigger and oracle (nothing written / confirmed list); each code still gets its own test.
  - build: the circuitpython helper, fixtures and package were written before circuitpython.test.ts ran, so the plugin requirements have no red line before implementation; the tests were written from the requirements' verification text and their first run is recorded as is (the runner volume lease kept test-first: red then green).
  - validate: the Frame's 'settings.toml never copied or read' holds for inspect-code and all artifacts, but deploy reads an existing secret target in memory to detect concurrent changes and --expect-from compares only its size - accepted: nothing secret reaches a result, and a same-size editor change to a secret file is not detected.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base aca377d: 66 file(s) changed, 4837 line(s) added
- checks: errors=0 warnings=57 notes=27
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended
