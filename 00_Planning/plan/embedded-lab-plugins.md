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
real-process evidence; real instruments, real PyVISA and native Ubuntu open); LAB-02...LAB-08 planned.

## Order

| Order | Package | Issue | Plugin | Result | State |
|---|---|---|---|---|---|
| 1 | LAB-01 | [#102](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/102) | `scpi-instruments` | identified instruments, finite operations, captures and approved control; resource leases and supervised cleanup | implemented |
| 2 | LAB-02 | [#103](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/103) | `lab-validation` | reproducible comparisons of captures, simulations and requirements | planned |
| 3 | LAB-03 | [#104](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/104) | `hil-testing` | orchestrated tests on the real board with controlled resources and stop | planned |
| 4 | LAB-04 | [#105](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/105) | `gdb-debug` | supervised debug sessions and symbol-aware fault diagnosis | planned |
| 5 | LAB-05 | [#106](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/106) | `power-profiler` | measured current, power and energy tied to firmware | planned |
| 6 | LAB-06 | [#107](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/107) | `renode` | firmware on explicitly supported virtual platforms | planned |
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
