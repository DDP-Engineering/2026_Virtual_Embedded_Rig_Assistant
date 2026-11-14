# LAB-01...LAB-08 Embedded development and lab automation plugins

PURPOSE: the order and state of the eight plugins that take VERA from electronics design to the bench -
instruments, measurement validation, hardware-in-the-loop tests, debugging, power profiling, virtual
boards and firmware builds.
SPEC: Gitea epic [#101](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/101) and its children #102...#109 hold the specification of each work
package (deliverables, operations, Done criteria L01...L08); the local copies are
`F:\ProjectsDDP\VERA_Embedded_Lab_Plugins_Plan.md` and `F:\ProjectsDDP\VERA_Embedded_Lab_Plugins_Tickets\`.
This page records only order, state and what was built, so the two never diverge. Where a ticket is
wrong about the code, the code decides.
PROCESS: at the user's request (2026-11-13) every child is implemented with AEGIS, in order, on one
branch `feature/101-embedded-lab` cut from `feature/93-electronics-calc` at bb79e4b, in the sibling
worktree `F:\2026_Virtual_Embedded_Rig_Assistant_lab`. The implementer hands the candidate back without a
commit; the coordinator checks the evidence and makes one local commit per ticket. Nothing is pushed.
STATE: LAB-01 implemented 2026-11-13 on branch `feature/101-embedded-lab` (AEGIS TASK-a5a839c7, offline and
real-process evidence; real instruments, real PyVISA and native Ubuntu open); LAB-02 implemented 2026-11-13 on the same
branch (AEGIS TASK-cf769025, offline evidence and real uv on Windows; a real capture of a real circuit and native Ubuntu
open); LAB-03 implemented 2026-11-14 on the same branch (AEGIS TASK-789dcc82, offline and real-process evidence on Windows;
a real board, real probe-rs/esptool and native Ubuntu open); LAB-04 implemented 2026-11-14 on the same branch (AEGIS
TASK-6b092dfc, offline evidence with real compiler-built ELFs and GDB/OpenOCD stand-ins on Windows; real GDB, OpenOCD,
a probe, a board and native Ubuntu open); LAB-05 implemented 2026-11-14 on the same branch (AEGIS TASK-39da0f51,
offline evidence with closed-form fixtures and a pyjoulescope_driver stand-in, the real driver 2.5.5 without a meter on
Windows; a JS220, a reference load, a sleep/wake board and native Ubuntu open); LAB-06 implemented 2026-11-14 on the
same branch (AEGIS TASK-f059e085, offline evidence against an engine stand-in and the real Renode 1.17.0 on Windows;
native Ubuntu open); LAB-07 and LAB-08 planned.

## Order

| Order | Package | Issue | Plugin | Result | State |
|---|---|---|---|---|---|
| 1 | LAB-01 | [#102](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/102) | `scpi-instruments` | identified instruments, finite operations, captures and approved control; resource leases and supervised cleanup | implemented |
| 2 | LAB-02 | [#103](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/103) | `lab-validation` | reproducible comparisons of captures, simulations and requirements | implemented |
| 3 | LAB-03 | [#104](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/104) | `hil-testing` | orchestrated tests on the real board with controlled resources and stop | implemented |
| 4 | LAB-04 | [#105](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/105) | `gdb-debug` | supervised debug sessions and symbol-aware fault diagnosis | implemented |
| 5 | LAB-05 | [#106](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/106) | `power-profiler` | measured current, power and energy tied to firmware | implemented |
| 6 | LAB-06 | [#107](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/107) | `renode` | firmware on explicitly supported virtual platforms | implemented |
| 7 | LAB-07 | [#108](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/108) | `zephyr` | Zephyr build, flash and tests through checked operations | planned |
| 8 | LAB-08 | [#109](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/109) | `platformio` | PlatformIO build, upload and tests, plus the integrated acceptance | planned |

The order is the execution order of the initiative, not a runtime dependency chain: HIL can use the
existing programmers before GDB exists, Renode accepts an ELF built elsewhere, PlatformIO works without
Zephyr. Technical reuse: LAB-02 consumes normalized captures (imported files included) and can compare a
SPICE export without the ngspice plugin installed; LAB-03 reuses the LAB-01 resources, the LAB-02 verdict
and the existing programmers and serial monitor; LAB-04/05 reuse the resources and lifecycle; LAB-06
reuses the test contracts without needing hardware; LAB-07/08 reuse the orchestration and artifacts when
they run tests on devices. Plugins are never enabled for every workbench automatically.

Later plans in `F:\ProjectsDDP` (networking, Arduino/IoT, engineering expansion) build on this
initiative: they extend the LAB-01 lease and lifecycle contracts with further identity kinds (NIC,
endpoint, lab host) and the LAB-02 numeric engine with further metrics, and they explicitly do not create
a second lease registry or verdict engine. LAB-01 and LAB-02 keep those seams open without implementing
them.

## LAB-01 as built

- Platform (VERA itself, reused by LAB-02...08 and later plans): the workbench registry `lab/resources.json` (format 1;
  alias, identity kind as data - only `visa` today - identity fields, plugin data) and VISA identity keys in shared
  `lab-resources.ts`; the manifest program field `resources {option, kinds, grace, cleanup, cleanupTimeout}`; core
  `ResourceLeases` (`leases.ts`), the one lease registry: a per-user folder shared by the desktop app and the CLI, one
  lease file per key, stale leases of lost processes removed and recorded `unknown` when they could actuate; the
  runner's in-process BUSY (aliases, sessions, serial ports including sigrok-cli `conn=`), stop request with a grace
  period before the tree kill, one authorized cleanup run after an interrupted actuation and the physical state
  `confirmed`/`unchanged`/`unknown`; the approval card and CLI prompt show the reserved resources and the registry
  hash. Spec `.agentic/specs/REQ-DATA-f2cbfc23.md`; architecture `00_Planning/plugins/architecture.md` §3.5.
- Package `05_Software/plugins/scpi-instruments/` (official, pack "Embedded lab", activity `measurement`): program `scpi`
  (`scripts/scpi_tool.py`, PEP 723 with PyVISA 1.16.2, pyvisa-py 0.8.1, pyserial 3.5, pyusb 1.3.1; support package
  `scpi_support/`), skills `bench-instruments` and `instrument-profiles`. Operations `capabilities`,
  `discover-configured [--list-local]`, `identify`, `read`, `capture`, `status`, `configure`, `close`,
  `output --hold` (1...3500 s, always switched off at the end) and `decode`; spec `.agentic/specs/REQ-DATA-b3e2930f.md`.
  Risk by the first argument only: safe (capabilities, discovery, decode), device-read (`--list-local`, identify,
  read, capture, status), device-write (configure, close), irreversible with the word `output`.
- Profiles `keysight-34461a` (DMM), `rigol-ds1000z` (scope), `rigol-dp800` (PSU) are data with fixed command slots whose
  effect is decided by the helper's code; all three are `unverified` (written from the vendors' programming guides).
- Decisions: VERA never leaves an output energized outside a supervised run (`output` always has a hold); a power
  supply's set-points change only while its output is off; `--list-local` lists serial ports (pyserial) and USBTMC
  devices (pyusb) and never uses VISA's resource search, because pyvisa-py's TCPIP listing broadcasts on the network
  (GPIB is not listed); results go to `embedded-lab-results/<run-id>/result.json` (kind `scpi-result`) with the raw
  block and preamble kept for `decode`.
- Inventory (2026-11-13, read-only): this development machine has no SCPI instrument, no USBTMC device and no vendor VISA;
  its COM ports are Bluetooth links. No command was sent to any instrument.
- Criteria: L01-C, L01-D (two runners, a second Node process holding a lease) and L01-F are covered on Windows by
  `src/libraries/shared/src/lab-resources.test.ts`, `core/src/plugins/{leases,runner-leases,program-resources}.test.ts`,
  the approval tests and `tests/integration/scpi-instruments.test.ts` (real runner and helper processes against a fake
  PyVISA in `tests/fixtures/scpi-instruments/`); L01-A, L01-B (own raw block re-decoded; importing an instrument's export
  file is not implemented) and L01-E are covered offline only; L01-H is covered for package, catalog, pack, approvals
  and artifacts, not for workbench activation, disabling or workbench change of this plugin (existing platform tests). The opt-in
  `VERA_SCPI_UV` run passed on 2026-11-13 (real PyVISA 1.16.2 and pyvisa-py 0.8.1 from PyPI through VERA's provisioner:
  identify, read, capture and output over TCPIP SOCKET against local simulated servers - the library path, not an
  instrument). Open: L01-A/B/E/G against real instruments (none available; models chosen from the user's inventory),
  native Ubuntu x64 (`REQ-PLAT-fae260c3`) and the vendor-VISA (`ivi`) backend.

## LAB-02 as built

- Package `05_Software/plugins/lab-validation/` (official, pack "Embedded lab" group "Measurement validation", activity
  `measurement`): program `lab-validate` (`scripts/lab_validate.py`, standard-library PEP 723, Python >= 3.11; support
  package `lab_validation/`), skills `validation-planning` and `difference-explanation`. Operations `inspect`,
  `normalize`, `measure`, `align`, `compare`, `report`, all `safe`; spec `.agentic/specs/REQ-DATA-53797d16.md`. No
  platform (core/shared/host) change.
- Engine seams kept open for LAB-03/05 and later plans: the importer registry (`scpi-capture`, `csv`, `sigrok-csv`,
  `spice`) and the metric registry (min, max, mean, rms, peak-to-peak, ripple, frequency, duty-cycle, rise-time,
  fall-time, overshoot, settling-time, delay); result kind `lab-validation-result` with a `verdict`, and
  `lab-validation-report` from `report`, which HIL reports link.
- Decisions: `decisionRule` and `missingData` are required (no silent default); `guarded` without an uncertainty is
  incomplete; only transient SPICE folders are imported (AC/DC/noise refused - complex AC and time series are not
  compared); a cross-correlation lag is a judged value (`<id>.lag`), an unjudged one is reported `lag-unjudged`; a
  delay needs one source (one clock), a marker must share the clock of the signal it aligns; LAB-01 captures are read
  through their files and hashes, never by importing `scpi_support`, and only capture folders (a decode folder keeps
  no raw block, so clipping could not be checked); a reference that ends before the window limits the difference
  statistics, not the lag.
- Criteria: L02-A (RMS, frequency, duty cycle, rise/fall, overshoot, settling, ripple against closed-form solutions in
  `tests/fixtures/lab-validation/README.md`), L02-B, L02-C, L02-D, L02-E and L02-H (pass/fail/incomplete aggregated by
  `report`; a sitecustomize guard proves no network or process access) are covered on Windows by
  `tests/integration/lab-validation.test.ts`, including a real scpi-instruments capture folder produced by the scpi
  helper on its fake PyVISA (offline evidence, not an instrument). L02-G: Windows offline with VERA's real runner, the
  toolchain CPython 3.12 and 3.11 and a real uv 0.11.25 provisioning run (`VERA_LABVAL_UV`, 2026-11-13); inputs are
  checked unchanged. Open: L02-F (a real capture of a real circuit compared with a real simulation - no instrument on
  this machine, and no ngspice here), native Ubuntu x64 (`REQ-PLAT-72a7e11a`), real sigrok-cli CSV bytes (no
  sigrok-cli here; the importer also takes a declared rate).

## LAB-03 as built

- Platform (VERA itself): the manifest program field `plan: hil`; `run_program` hands `hil check|run <plan>` to core
  `plugins/hil/` (compile, adapters, executor, run); `ProgramRunner.hold` (a run without a process that reserves
  resources and has a log and record) and `RunRequest.parent` (child runs that use the hold's reservations);
  `LeaseOwner.parent` (children borrow the hold's lease files, never take or drop them); `ProgramChangeRequest.plan`
  (hashed binding of every compiled operation); `prepareCall`/`startCall`/`timeoutCap` exported from program-tools.
  Spec `.agentic/specs/REQ-DATA-5f714098.md`; architecture `00_Planning/plugins/architecture.md` §3.7.
- Package `05_Software/plugins/hil-testing/` (official, pack "Embedded lab" group "Hardware-in-the-loop tests",
  activities measurement/debug/flash): program `hil` (`scripts/hil_tool.py`, standard-library PEP 723; support package
  `hil_report/` renders report.html, report.md and junit.xml), skill `hil-planning`. Risks: `hil check` and `hil report`
  safe; `hil run` device-read by its rule, raised to the plan's highest operation risk and the firmware effect.
- Adapters (registrations in `core/src/plugins/hil/adapters.ts`, extended by later plans, never a second executor):
  `probe-rs.list|flash|verify|reset`, `esptool.identify|flash|verify`, `serial.capture|send`,
  `scpi.identify|status|read|capture|configure|output|close`, `lab-validate.compare` (the plan embeds a LAB-02 request
  whose sources name an earlier capture step or a hashed workbench path; the executor writes the request) and `await`.
- Decisions: the firmware is flashed only from the plan's declared file and hash; `setup.firmwareEffect` is required
  and raises the risk when the plan starts the firmware; the typed confirmation of an irreversible plan is its id; flash,
  reset, output and configure never retry; setup-phase failures are `blocked`; status precedence blocked > error > fail >
  incomplete > pass; the approval shows the expansion as notes (no UI change).
- Criteria: L03-A, L03-B, L03-D, L03-E, L03-F (plan holds vs. another session, plan and VERA process; interleaving
  refused at compilation; port handoff logged) and L03-G (risk, read-only, trial, confirmation) are covered on Windows by
  `shared/src/hil-plan.test.ts`, `core/src/plugins/hil/hil.test.ts` and `runner-leases.test.ts` (offline);
  `tests/integration/hil-testing.test.ts` runs plans with VERA's real runner and the real serial-monitor, scpi,
  lab-validate and hil helpers on their fakes plus the probe-rs replay stand-in (stop with cleanup, no run left,
  report). Open: L03-C (no board or probe on this machine; real probe-rs/esptool not provisioned), the live part of
  L03-H on Windows and native Ubuntu x64 (`REQ-PLAT-759e6df8`).

## LAB-04 as built

- Platform (VERA itself): only the `lab/resources.json` identity kind `probe` (`{alias, kind: "probe", resource:
  "VID:PID:SERIAL", profile}`, serial `[A-Za-z0-9._-]`, keys `probe:<vid>:<pid>:<serial>` and `probe:<vid>:<pid>`) in
  shared `lab-resources.ts`; leases, BUSY, stop/grace and cleanup are the LAB-01 runner code, unchanged. The LAB-01 scpi
  helper skips `probe` entries. Spec `.agentic/specs/REQ-DATA-d7da2a71.md`; architecture
  `00_Planning/plugins/architecture.md` §3.8.
- Package `05_Software/plugins/gdb-debug/` (official, pack "Embedded lab" group "Debugging (GDB and OpenOCD)",
  activities debug/firmware-analysis): programs `gdb-elf` (`scripts/gdb_elf.py`, offline `inspect` and `diagnose`),
  `gdb-debug` (`scripts/gdb_debug.py`, `tools`, `snapshot`, `break`, `step`, cleanup `release`; `uses:
  [arm-none-eabi-gdb, openocd]`), the find-only programs `arm-none-eabi-gdb` (GDB >= 12; `gdb-multiarch` on Ubuntu) and
  `openocd` (>= 0.12.0), both blocked for direct calls; support package `gdb_support/` (standard library: ELF/DWARF
  reader, MI parser and session, OpenOCD supervision, fault decoder, profiles); skill `debug-sessions`; profiles
  `stm32f4-stlink` (Cortex-M4F) and `stm32g0-stlink` (Cortex-M0+), both `unverified`.
- Decisions: one finite session per call (no long-lived debug service, no console); `--firmware-effect none|actuates`
  and `--on-exit halted|resume` are required (device-write, irreversible with `actuates`); OpenOCD's gdb-detach event
  applies the exit policy and prints the state it left, which alone confirms the physical state; the cleanup `release`
  never reconnects (a reconnect halts the core) and reports `unknown`; the ELF is matched by reading its read-only
  sections back from flash (GDB `compare-sections` would make OpenOCD run code in the target's RAM); a mismatch, or an
  `unchecked` match with nothing compared, withholds every symbol, source line, variable and fault-site attribution
  (a partly compared, all-equal ELF keeps them with an `elf-unchecked` problem), live and in `diagnose`; GDB may read only the profile's flash, RAM
  and the SCB fault registers; no GDB/OpenOCD download is declared (no verified archive layout on this machine).
- Fixtures: `tests/fixtures/gdb-debug/firmware/` built with zig cc 0.13.0 (clang 18.1.6, pinned PyPI `ziglang`):
  Cortex-M4 with DWARF 4, a rebuilt variant, Cortex-M0+ without debug information, RISC-V; GDB/OpenOCD stand-ins
  (`fake_gdb.py`, `fake_openocd.py`) made into real executables by `make_tools.py` (pip's launcher on Windows).
- Criteria: L04-A covered on Windows by `tests/integration/gdb-debug.test.ts` on real compiler output and checked
  against pyelftools 0.32 (opt-in `VERA_GDB_ORACLE_PYTHON`, run 2026-11-14); L04-D, L04-E (an external reset only
  indirectly: as an unrequested stop and async events, no scenario of its own), L04-G partially (runner BUSY against
  probe-rs `--probe` selectors, a second session and a HIL hold; access that does not name the probe - probe-rs
  without `--probe`, stm32-cubeprog `sn=` - is not detected; probe-rs `gdb`/`debug`/`serve`/`dap-server` still blocked) and
  the protocol/lifecycle parts of L04-B, L04-C and L04-F (MI tokens, mismatch withholding, breakpoint/step/timeout,
  exit policy, no process left, loopback-only arguments, Stop through VERA's real runner) are covered offline against
  the stand-ins and `internals.py`. Inventory 2026-11-14 (read-only): no GDB, OpenOCD, probe-rs, pyOCD, J-Link or QEMU
  installed and no debug probe attached. Real tools, Windows, 2026-11-14 (approved downloads, verified SHA-256, kept in
  a scratch folder): xPack arm-none-eabi-gcc 15.2.1-1.1 (GDB 16.3.90) and xPack OpenOCD 0.12.0-7. The opt-in tests
  `VERA_GDB_REAL_GDB` run snapshot, break (function, `file:line`, address), a not-hit interrupt, instruction steps and a
  rebuilt-ELF mismatch with the real GDB against the OpenOCD stand-in's remote-protocol target (fixture flash, a
  HardFault state): real MI output, real unwinding through the exception frame, no write packet. `VERA_GDB_REAL_OPENOCD`
  starts the real OpenOCD with a serial no probe has: every configuration command is accepted, it stops at the missing
  adapter, result `error`/`openocd`, physical `unchanged`. These runs found that GDB 16 names its target only for
  `--configuration`, and that the stand-in's fault pc lay in padding; both fixed. Open: L04-B/C/E/F on a real board and
  probe, OpenOCD's detach events on a real core, each profile (both stay `unverified`), L04-H on native Ubuntu x64
  (`REQ-PLAT-8c2cdfb0`).

## LAB-05 as built

- Platform (VERA itself): the `lab/resources.json` identity kind `power-monitor` (`{alias, kind: "power-monitor",
  resource: "u/js220/<serial>", profile}`, pyjoulescope_driver's device path, key `power-monitor:js220:<serial>`) in
  shared `lab-resources.ts`; leases, BUSY, stop/grace and cleanup are the LAB-01 runner code, unchanged. HIL adapters
  `power.identify` and `power.capture` (background; the plan's firmware is passed as `--firmware`) and an adapter flag
  `captures` that replaces the hard-coded `scpi.capture` check, so a `lab-validate.compare` source may bind to either.
  The LAB-01 scpi helper skips `power-monitor` entries. Spec `.agentic/specs/REQ-DATA-dd3e4fe1.md`; architecture
  `00_Planning/plugins/architecture.md` §3.9.
- LAB-02 extended where it belongs (no second engine): units C and J, metric `integral` (C for a current, J for a power;
  `unknown` when the window holds a gap - a missing interval is never counted as zero) and importer `power-capture`
  (capture/import folders, hash-checked, missing cells as gaps, overflow flags as clipped, conditions and meter/firmware
  identity as recorded).
- Package `05_Software/plugins/power-profiler/` (official, pack "Embedded lab" group "Power profiling (Joulescope)",
  activity `measurement`): program `power-profile` (`scripts/power_profile.py`, PEP 723, Python >= 3.12,
  `pyjoulescope_driver==2.5.5` - 2.5.6 was five days old; `tools [--list]`, `identify`, `capture`, cleanup `release`)
  and `power-analyze` (`scripts/power_analyze.py`, standard library: `acquisition` = configure-acquisition offline,
  `import`, `inspect`, `measure-energy`, `segment`, `compare`, `battery`, `report`); support package `power_support/`
  with byte-identical copies of lab-validation's `series.py`, gdb-debug's `elf.py` and the shared `workspace.py`;
  profile `joulescope-js220` (`unverified`); skills `power-measurement` and `energy-analysis`.
- Decisions: the meter is opened with `restore` and its defaults are never applied; only the sample rate, the current
  range mode (auto/manual, never off) and selection, the voltage range and the signal controls are written; a meter
  whose current path is off, or reads a raw mode value its metadata does not name, is blocked (VERA never powers the DUT; no power-path operation exists); settings are
  restored and read back, `confirmed` only on a matching readback; the cleanup `release` cannot see the interrupted
  run, so it returns the meter to auto-ranging. Capture risk is device-write (range and rate change the burden), not a
  read. Row 0 of a capture is the first sample every enabled signal covers; sample-id skips and NaN samples stay empty
  cells and a gap list, samples beyond their range limit are flagged overflow; energy and charge over either are null
  with the covered values. Energy uses the meter's power channel, or v x i when a sign or offset correction is declared
  (named in `energySource`). Segmentation trusts only the meter's clock: GPI markers, timestamps on the capture's own
  clock with the capture's hash, or the current itself; a PC/UART arrival time is refused (`sync`). A/B: build identity
  by SHA-256 and ELF build id, the setup from the meter's readback; classification `unidentified` > `setup-difference` > `same-firmware` >
  `firmware-change`; the lab-validate request integrates whole start-to-start periods and carries each capture's setup
  as source conditions, so lab-validate makes criteria incomplete when setups differ. Battery: charge domain for
  direct/linear, energy domain for switching (efficiency required; mAh needs the battery voltage), every input a range,
  the life an interval rounded outwards to two significant figures (one beyond a factor 10), at least three events.
- Criteria: L05-B (uniform, non-uniform, gap and overflow fixtures with closed forms in
  `tests/fixtures/power-profiler/README.md`; gaps and overflow never zero, in power-analyze and in lab-validate), L05-D
  (firmware-change, setup-difference, same-firmware, unidentified; lab-validate verdicts on the written requests), L05-E
  (two hand-computed battery examples and six refusals), L05-F (stop request, removal, a stalled stream, a malformed
  driver message, current path off or unnamed, release; VERA's real runner with BUSY, Stop and a timeout leaving no run
  or lease) and L05-G (lab-validate integrates a capture
  to the same energy and charge as power-analyze; a HIL plan binds a power.capture folder into its request; the report
  hash-checks its runs) are covered on Windows by `tests/integration/power-profiler.test.ts`,
  `core/src/plugins/hil/hil.test.ts` and `shared/src/lab-resources.test.ts`, offline against the pyjoulescope_driver
  stand-in `tests/fixtures/power-profiler/fake-driver/`. L05-C is covered offline only (a sleep/wake fixture with a GPI
  marker, a threshold and meter-clock timestamps; sync method recorded). L05-H: the opt-in `VERA_POWER_REAL_PYTHON` run
  passed on 2026-11-14 with the real pyjoulescope_driver 2.5.5 from PyPI in a scratch uv venv (CPython 3.12, Windows):
  import, `tools --list` with no device, WinUSB present, `identify` and `capture` blocked `device-missing` with physical
  `unchanged`. Open: L05-A (a real reference load against an independent check), L05-C live (a sleep/wake firmware on a
  board), L05-H live on Windows and native Ubuntu x64 (`REQ-PLAT-cd7e4f2c`) - no JS220 is available; the profile stays
  `unverified`; provisioning through VERA's own uv was not run (the pin was resolved by uv directly).

## LAB-06 as built

- Platform (VERA itself): no change. A Renode run reserves no bench resource, so VERA's Stop and the runner timeout
  are tree kills. The helper keeps `result.json` current instead, and `report` turns a killed run into
  `stopped`/`interrupted`. Spec `.agentic/specs/REQ-DATA-8a943977.md`; section 9 holds the observed engine facts.
- Package `05_Software/plugins/renode/` (official, pack "Embedded lab" group "Virtual boards (Renode)", activities
  testing/firmware-analysis), skill `virtual-boards`. Two programs:
  - `renode`: the engine. It is found (`==1.17.0`) or installed from the SHA-256-pinned 1.17.0 portable archives
    (`renode_1.17.0-portable/renode[.exe]`; the Linux path is inferred from Renode's packaging script). Every direct
    call is blocked.
  - `renode-sim`: `scripts/renode_sim.py`, standard-library PEP 723, all rules safe. Operations `tools`, `profiles`,
    `validate`, `run`, `capture-uart`, `test` and `report`.
- Profile `stm32f4-discovery` (STM32F407, Cortex-M4F, `unverified`): Renode's board and CPU descriptions copied beside
  the profile, without the CPU file's `sysbus: init:` block. That block downloads an SVD from dl.antmicro.com
  (`ApplySVD @https`), which is a hidden download the ticket forbids; it was found on the real engine.
  - Declared stimuli: user button and UART input. Observable: the user LED. The profile also lists what the model does
    not support.
- Test set `board-basics`: boot banner and version, UART echo, 10 timer ticks per virtual second, button to LED.
  Parameters `banner`, `version`, `ticks`.
- Fixtures `tests/fixtures/renode/firmware/` were built with zig cc 0.13.0, as in LAB-04: `demo`, `wrong-version`,
  `silent`, DAC `unmodeled`, and the CCM-linked memory-map mismatch. The LAB-04 `riscv.elf` and `fault-m0.elf` serve as
  foreign-chip fixtures.
- Decisions:
  - No Robot Framework. Renode 1.17.0's keyword server listens on every interface on Linux, and `Execute Command`
    reaches the monitor's `python`. Test sets are data, using the step kinds uart, count, stimulus, observe and run,
    and the helper runs them over the console.
  - The engine starts as `--disable-gui --console --plain --hide-log --config <run>/renode.config`, with no telnet
    port, no .NET diagnostics IPC and only system environment variables.
  - Commands are composed from the approved profile and fixed templates. Every `@` path is absolute and lies in the
    run folder (8.3 short form for spaces, else `blocked`/`run-path`). Any answer to a setup or run command is an
    error.
  - The UART file backend is exclusive on Windows, so it is read in closed segments (`CloseFileBackend` while
    emulation is paused).
  - Workbench `.repl` files are validated quote-aware: a `using` allowlist, denied host-binding words, no `init` and
    no `@` file paths. `.resc` files are parsed into five allowed commands. An engine file a profile uses must be
    hashed and free of `init` and URLs, so the stock `stm32f4_discovery.resc` and Renode's own CPU file are refused.
  - Firmware is checked offline against the explicit `--arch`, the memory map, `--boot-address` and the vector table.
    The engine's logged initial PC/SP must match that vector table.
  - Time advances in fixed slices (10 ms), so line times, stimuli and observations repeat exactly. Virtual and real
    time are separate fields, and both budgets apply.
  - Statuses: `fail` is an assertion, `timeout` has the code `virtual-timeout` or `real-timeout`, and an unmodeled
    access makes the run `incomplete`. Reports carry `evidence: virtual` and a fixed list of what is not covered:
    electrical timing, power, EMI, SPICE.
  - `report --hil` lines up requirement ids with the HIL steps a case names, in separate virtual and hardware
    columns.
- Criteria (Windows):
  - Offline, by `tests/integration/renode.test.ts` against the stand-in and VERA's real runner: L06-A, B, C, D, E
    (including Stop with no process left and the partial report), F and G.
  - Opt-in `VERA_RENODE_REAL`, run 2026-11-14 with the approved, SHA-256-verified Windows portable archive in a scratch
    folder:
    - L06-A/B: board-basics passes twice with equal virtual results.
    - L06-C: the DAC write is reported unmodeled.
    - L06-E: the wrong version is an assertion and silence a virtual timeout.
    - L06-D: no TCP/UDP endpoint of the engine during a run; a tree kill leaves no engine.
    - L06-H, Windows half: the profile files are the engine's own minus the SVD block; no download in engine.log and
      no URL in any command (the network was not disabled).
  - Open: L06-H on native Ubuntu x64 (`REQ-PLAT-d03a51af`; the Linux archive was not downloaded) and a firmware other
    than the fixtures. The profile stays `unverified`.

## Rules shared by the packages

- Finite operations with validated JSON, real paths and the existing plugin model (`plugin.yaml`,
  skills, declared programs, helper scripts, provisioning, `run_program`, approvals). No MCP, generic
  shell, raw SCPI, raw GDB/monitor or arbitrary Python/Tcl evaluation in the first delivery.
- Instrument profiles are validated data (model, firmware, identity, transport, channels, units,
  finite operations, limits, cleanup steps), not generated code or a free console. A resource identity
  is normalized (USB serial, VISA resource, TCP address and port, probe identity) so known aliases of one
  device share one key; VERA reports BUSY before any I/O when another VERA session holds the lease. It
  does not claim to lock out external programs.
- Lifecycle: identify, reserve, configure, act or capture, clean up, release. Cleanup is part of the
  authorized request, finite, verified by readback where the device allows, and runs on Stop and timeout
  before a forced kill when still possible. When it cannot be confirmed the physical state is reported
  `unknown` and the resource is not reused as if it were safe. No software emergency stop is promised.
- Risk follows the existing policy at the highest effective risk: offline analysis can be `safe`,
  identification and capture `device-read`, configuration as the device requires, and enabling outputs,
  loads, relays or running firmware that actuates hardware `irreversible`. A `?` in a command does not
  prove it has no effect. Project code run by builds and tests (CMake, west, PlatformIO scripts, test
  scripts) is host execution, never classified `safe`; approval is not a sandbox.
- A result is a document of its own (`format: 1`): operation, tool and device identity and version,
  start and end, inputs with hash, conditions, series and metrics with units, criteria and artifacts.
  States are `pass`, `fail`, `incomplete`, `blocked`, `skipped` and `error`; a test that did not run or a
  missing device is never `pass`, and unknown values never become zero. The ELEC result conventions
  are reused where they fit.
- Results go to `embedded-lab-results/<run-id>/` in the workbench, created exclusively, never inside
  `.vera/`; the chat summary points at the full report. JSON for machines, Markdown/HTML for reports, CSV
  and PNG/SVG for series, JUnit XML for tests. Firmware is identified by hash, ELF/symbols and
  board/revision, not by file name.
- VERA formats stay at version 1; pinning an external tool version does not migrate user data.
- New resource and lifecycle controls do not raise the background-process limit and pass no VERA
  secrets to processes. Any helper IPC channel is local, session-owned and finite.
- Evidence comes in three classes - offline fixtures for algorithms and protocols, real tools without
  hardware, real instruments and boards with an identified setup. PyVISA-sim, a test server or a probe
  mock never proves access to a real device, and a compiled-only test is not an executed test. Targets
  are Windows x64 and native Ubuntu x64 (WSL is not native Ubuntu). No system drivers, udev rules or USB
  driver replacements are installed. A missing instrument, board or backend stays an open blocker of
  that proof, never a ticked criterion. Verification follows `02_Tools/verification-policy.md`.

## Out of scope

Modbus, manufacturing checks, component inventory, openEMS and OCR/vision were proposed as later
extensions and are not part of the eight packages.
