# TASK-06f52fc5 - IOT-04 bus-tools plugin: active I2C, SPI and UART transactions through an identified Bus Pirate (#117)

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-DATA-634d35da, REQ-SEC-9350b6ae, REQ-DATA-9fe47866, REQ-FUNC-4dadea40, REQ-FUNC-de5e43b9, REQ-FUNC-0163b91b, REQ-SEC-1c72e308, REQ-FUNC-971cb423, REQ-REL-793a44d8, REQ-REL-023c37ad, REQ-FUNC-ebf73436, REQ-SEC-2ec2103d, REQ-SEC-145e1953, REQ-FUNC-edb1741e, REQ-REL-28754edd, REQ-FUNC-e5a016ac, REQ-SEC-b30461f8, REQ-SEC-a8f13a1a, REQ-SEC-85225742, REQ-FUNC-1dcdbb05, REQ-REL-077448a5, REQ-REL-87418271, REQ-REL-f430ec06, REQ-REL-737b96ec, REQ-FUNC-3223c457, REQ-FUNC-d9a201a5, REQ-REL-c63f36b2, REQ-REL-10ae6ea5, REQ-FUNC-cd3227bc, REQ-SEC-e088558b, REQ-SEC-d8671786, REQ-FUNC-e62ad15a, REQ-SEC-f0aa9c76, REQ-FUNC-1f2ee7cc, REQ-TEST-e0a0dfe1, REQ-SEC-f98d4fd3, REQ-SEC-370f2d9b, REQ-FUNC-a5770245, REQ-FUNC-e4ca09ad, REQ-REL-52212fce, REQ-FUNC-3bf3d5bc, REQ-REL-3817f2fd, REQ-FUNC-d4b72e6b, REQ-UX-73dd7a9b, REQ-DATA-f2cbfc23
parent:
branch: feature/113-arduino-iot
base: 6524f46edef455ccbb17d8c2a9aadda3657d3291
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

Problem: VERA cannot run active I2C, SPI or UART transactions on a circuit. OBSERVED (`05_Software/plugins/`,
catalog.yaml): sigrok captures and decodes passively, serial-monitor talks to a UART only as a terminal, and no plugin
drives a bus adapter; a raw serial terminal to a Bus Pirate would be a free console, which the plan excludes (STATED
plan section 2: no generic shell, no free REPL console).

Desired outcome:
- An official plugin `bus-tools` (STATED ticket IOT-04) with identify, capabilities, configure-bus, transfer,
  read-register, capture and report, through finite requests and bounded transactions (STATED); no interactive
  terminal and no change of the adapter's firmware (STATED); sigrok stays the capture/decode source (STATED).
- Initial backend: Bus Pirate with an explicit model, firmware and binary protocol (STATED); other bridges are separate
  extensions (STATED); no universal support claimed for all Bus Pirate versions (STATED T04-F).
- A profile holds wiring, logic voltage, ground, pull-ups, frequency, SPI mode and chip select, I2C addresses and
  register semantics (STATED). Register reads may write the register address first and may clear flags (STATED);
  scanning all addresses and powering the DUT are never implicit (STATED); the risk is never derived from the word
  read (STATED).
- Transfers are bounded in bytes, duration and frequency (STATED); chip select, output lines and any supply have a
  declared final state, verified where possible (STATED); the adapter reservation covers every port or interface of
  the adapter that controls the same device (STATED).
- Errors (NACK, timeout, wrong byte count, wrong SPI mode) give a diagnosis without unlimited physical retries
  (STATED T04-D); Stop/unplug/timeout apply the declared cleanup or report the state unknown, and two sessions never
  interleave transactions (STATED T04-E).
- Results `format: 1` under `arduino-iot-results/<run-id>/` with the plan's states (STATED plan section 3); the
  reservation uses LAB-01's one lease registry (STATED brief).

Actors: the user (writes the bench registry and the bus profile, approves runs), the agent (runs `bus-tool`), VERA's
runner, approval gate, lease registry and supervised cleanup, the Bus Pirate (firmware with BPIO2 on its second USB
CDC port), and the DUT wired to it (sensor, SPI fixture, UART peer).

Primary scenario: the user declares the Bus Pirate in `lab/resources.json` (binary port, terminal port, USB identity)
and writes a bus profile for a BME280 on I2C at 0x76 (3.3 V external supply, common ground, pull-ups on, 100 kHz,
register `chip_id` = 0xD0, one byte, expected 0x60). The agent lists devices, identifies the adapter (hardware,
firmware, BPIO version), reads `chip_id` with read-register (approval binds the profile by hash; the adapter is
leased across VERA processes), gets 0x60 and a result whose final state (HiZ, pull-ups off, supply off) was read back.

Examples: STATED T04-A...T04-F. T04-A: a port that answers no BPIO2 status, or reports an unsupported hardware or
protocol version, receives no transaction. T04-C: a register absent from the profile, an address outside the
profile, a supply not declared or not allowed by the bench registry are refused before the adapter is touched.
T04-D: an address NACK is reported once as `nack`, a missing answer as no-response, a short read as a count mismatch,
and an SPI chip id that differs from the profile's expected value (as a wrong SPI mode gives) as an unexpected value;
none is retried. T04-E: a second run on the same adapter (other session or other VERA process, or any run naming one
of its two ports) is BUSY; Stop between steps ends with the declared final state; a killed run gets VERA's cleanup run.
Example needing a value the user has not given: the bench's maximum supply voltage/current (`N mV`, `M mA`), which the
registry entry declares; absent, the adapter's supply is never switched on.

Counterexamples: STATED - no interactive terminal, no firmware change, no address scan, no implicit DUT power, no
"read" classified safe, no capture/decode duplicating sigrok, no universal Bus Pirate support claim.

In scope: the package (manifest, README, skills, PEP 723 helper with support package, pinned flatbuffers and pyserial),
catalog/pack entries, a new identity kind `bus-adapter` in LAB-01's registry (INFERRED: the registry's documented
extension point "later identity kinds add a schema branch and a key function", spec REQ-DATA-f2cbfc23 section 1, is
the only way the runner can lease the adapter's second port and run the supervised cleanup), the scpi helper's
registry reader accepting entries of other kinds (INFERRED: it refuses any kind but visa today, OBSERVED
`scpi_support/registry.py:70`), offline tests against a simulated BPIO2 Bus Pirate with simulated I2C/SPI/UART
targets, and a runner-level test of leases, Stop and cleanup.

Out of scope: STATED - interactive terminal, firmware change, other bridges (FT232H, CH341, Aardvark...), passive
capture/decode (sigrok). INFERRED (ticket deliverables list) - address scan, 1-Wire/2-wire/3-wire/JTAG/LED/IR modes,
the Bus Pirate's own scripting, bit-banged pin control (io masks), Bus Pirate v3/v4 BBIO1 (discontinued hardware;
memory "minimum version over legacy").

Constraints: STATED (brief) pinned PyPI packages are fine for tests; any other download, driver install or write to
real hardware needs the user's approval; no commit/push/branch switch; formats stay `format: 1`; UI texts en/ro/de;
focused tests only; work only in the `_iot` worktree. Branch `feature/113-arduino-iot` (not the default branch).

Success signals: T04-A/C/D/E and the offline parts of T04-F covered by tests against the simulated adapter, the real
runner, lease registry and cleanup run; T04-B, native Ubuntu and the real-hardware parts of T04-E/F reported as open
blockers while no Bus Pirate is connected.

Evidence: ticket IOT-04.md and plan sections 2-4 (STATED); coordinator brief (STATED); BPIO2 docs page
https://docs.buspirate.com/docs/binmode-reference/protocol-bpio2/ and `bpio.fbs` in DangerousPrototypes/
BusPirate5-firmware main (OBSERVED through a web read, 2026-11-14: COBS framing with a trailing 0x00; tables
RequestPacket{version_major, minimum_version_minor, contents} with union StatusRequest|ConfigurationRequest|
DataRequest, ResponsePacket{error, contents}; StatusResponse version_flatbuffers_major/minor, version_hardware_major/
minor, version_firmware_major/minor/git_hash/date, modes_available, mode_current, mode_max_write/read, psu_*,
pullup_enabled, io_direction/value; ModeConfiguration speed, data_bits, parity, stop_bits, clock_stretch,
clock_polarity, clock_phase, chip_select_idle; ConfigurationRequest mode string, psu_enable/disable/set_mv/set_ma,
pullup_enable/disable; DataRequest start_main, data_write, bytes_read, stop_main; DataResponse error, data_read,
is_async; I2C: the first written byte is the 8-bit address, a restart separates write and read; BPIO2 is selected on
the device with the `binmode` terminal command and served on the second serial port); flatbuffers 25.12.19 installed
in the toolchain Python (OBSERVED `python -c "import flatbuffers"`); runner.ts serial/volume claims, leases.ts,
resource-registry.ts, lab-resources.ts, scpi-instruments lifecycle/registry (OBSERVED). No Bus Pirate is connected
(OBSERVED IOT-03 inventory of this host; the brief says none is known).

Assumptions: both CDC ports of one Bus Pirate show the same USB serial number through pyserial (INFERRED: one
composite USB device; reported, never used to guess which port is binary - the user names it).

Unknowns: the exact BPIO2 error strings for an I2C NACK and the UART read semantics on real firmware; the firmware
version that first shipped BPIO2; the USB VID:PID of Bus Pirate 5/6 (not in the sources read); real behaviour on
native Ubuntu.

Decision-blocking questions: none. Missing hardware is settled by the brief (open blocker); backend choice is settled by
the ticket ("Bus Pirate with explicit model/firmware/binary protocol").

Proposed behaviors (not accepted until specify): backend `bus-pirate-bpio2` for hardware majors 5 and 6 with
FlatBuffers protocol major 2; registry kind `bus-adapter` keyed by both ports and the USB identity; every bus operation
re-identifies first; risk device-write for every operation that configures the bus (read-register included),
irreversible with `--power`; one transaction per run, no retry; final state `release` (HiZ, pull-ups and supply off,
read back) unless the profile declares `keep`; `release` as VERA's cleanup.

Path and reason: full.

| Criterion | Holds? | Evidence |
|---|---|---|
| no new externally observable behavior | no | new plugin, new registry kind |
| no new interface or data format | no | bus-tool CLI, bus profile, result format 1, registry branch |
| no new dependency | no | flatbuffers 25.12.19, pyserial 3.5 |
| an existing requirement already covers the behavior | no | none for bus adapters |
| no security or data-handling change | no | drives physical bus lines and optionally a DUT supply |

## Requirement coverage

| Behavior | Requirement | New/revised | Frame source |
|---|---|---|---|
| bus-tool contract: operations, bus profile, registry fields, results and exit codes | REQ-DATA-634d35da | new | ticket deliverables, plan results |
| Speak to the adapter only through the pinned bus-tool helper | REQ-SEC-9350b6ae | new | ticket: no terminal, no firmware change |
| Declare a bus adapter in the bench registry | REQ-DATA-9fe47866 | new | brief: LAB-01 registry; ticket: reservation |
| Key a bus adapter by both of its serial ports and its USB identity | REQ-FUNC-4dadea40 | new | ticket: reservation covers all ports; T04-E |
| Ignore other identity kinds in the scpi helper's registry reader | REQ-FUNC-de5e43b9 | new | registry shared with scpi |
| List serial ports by identity without opening them | REQ-FUNC-0163b91b | new | T04-A identification |
| Refuse an adapter whose ports are missing or show another identity | REQ-SEC-1c72e308 | new | T04-A |
| Identify the adapter through one BPIO2 status request | REQ-FUNC-971cb423 | new | T04-A, deliverable identify |
| Refuse a port that does not answer as BPIO2 | REQ-REL-793a44d8 | new | T04-A no guessed transfers |
| Refuse an unsupported adapter model or protocol version | REQ-REL-023c37ad | new | T04-A, T04-F no universal claim |
| Report the backend's capabilities without opening a port | REQ-FUNC-ebf73436 | new | deliverable capabilities |
| Validate the bus profile before touching the adapter | REQ-SEC-2ec2103d | new | T04-C profile validated |
| Switch the adapter's supply on only when declared, named and within the bench limits | REQ-SEC-145e1953 | new | ticket: DUT power not implicit |
| Configure the bus and read the configuration back | REQ-FUNC-edb1741e | new | deliverable configure-bus |
| Fail a configuration the adapter refuses or does not apply | REQ-REL-28754edd | new | T04-D diagnostics |
| Read a declared register in one transaction | REQ-FUNC-e5a016ac | new | deliverable read-register |
| Read only registers the profile declares | REQ-SEC-b30461f8 | new | T04-C allowed registers |
| Read a register that clears flags only on purpose | REQ-SEC-a8f13a1a | new | ticket: reads may clear flags |
| Transfer only to devices that allow raw transfers, within limits | REQ-SEC-85225742 | new | ticket: transfer limits; T04-C |
| Run one bounded transfer | REQ-FUNC-1dcdbb05 | new | deliverable transfer |
| Report an address NACK after a single attempt | REQ-REL-077448a5 | new | T04-D NACK |
| Report a missing answer as incomplete | REQ-REL-87418271 | new | T04-D timeout |
| Report a byte count mismatch | REQ-REL-f430ec06 | new | T04-D wrong byte count |
| Report an unexpected register value with the causes to check | REQ-REL-737b96ec | new | T04-D wrong SPI mode |
| Capture a UART for a bounded time | REQ-FUNC-3223c457 | new | deliverable capture; sigrok stays capture source |
| Leave the declared final state and read it back | REQ-FUNC-d9a201a5 | new | ticket: declared, verified final state |
| Stop at the next safe point with the final state | REQ-REL-c63f36b2 | new | T04-E Stop |
| Report a lost adapter | REQ-REL-10ae6ea5 | new | T04-E unplug |
| Release the adapter as VERA's cleanup | REQ-FUNC-cd3227bc | new | T04-E cleanup |
| Refuse bus operations while the adapter's state is unknown | REQ-SEC-e088558b | new | T04-E unknown state |
| Act only on the approved bench registry in bus-tool | REQ-SEC-d8671786 | new | plan: approval binds configuration |
| Summarize bus-tool run folders | REQ-FUNC-e62ad15a | new | deliverable report |
| Classify bus-tool calls at their highest risk | REQ-SEC-f0aa9c76 | new | ticket: safe never from the name read |
| Publish the official bus-tools plugin | REQ-FUNC-1f2ee7cc | new | ticket deliverables |
| Gate the real Bus Pirate tests behind variables | REQ-TEST-e0a0dfe1 | new | plan evidence separation |
| Bus profile and argument files bound by hash; re-checked before start | REQ-SEC-f98d4fd3, REQ-SEC-370f2d9b | reused | plan: approval binds configuration |
| One holder per resource in a process and across processes; stale leases | REQ-FUNC-a5770245, REQ-FUNC-e4ca09ad, REQ-REL-52212fce | reused | T04-E no interleaving |
| Stop request, grace, cleanup run, physical state of the run | REQ-FUNC-3bf3d5bc, REQ-REL-3817f2fd, REQ-FUNC-d4b72e6b | reused | T04-E |
| Approval shows the reserved resources | REQ-UX-73dd7a9b | reused | ticket: reservation |
| Registry spec sections 1-2 gain kind bus-adapter | REQ-DATA-f2cbfc23 (spec) | revised | brief: one registry |

## Design

Diagrams: [diagram_TASK-06f52fc5.md](diagram_TASK-06f52fc5.md)

**Approach.** A new official package `05_Software/plugins/bus-tools/` with one program `bus-tool`, a PEP 723 script
pinned to flatbuffers 25.12.19 and pyserial 3.5 (REQ-SEC-9350b6ae), installed by VERA's uv like scpi-instruments. The
adapter is declared once in LAB-01's registry as the new identity kind `bus-adapter` (REQ-DATA-9fe47866), keyed by both
of its serial ports and its USB identity (REQ-FUNC-4dadea40); the manifest's `resources` declaration (`--adapter`,
cleanup `release`) makes the host reserve it, pass the registry hash, supervise Stop and run the cleanup (reused
LAB-01 requirements). So no runner change and no second registry. Rejected: naming both ports in argv to reuse the
serial-port lease alone (no supervised cleanup, no bench power limits, two strings to keep consistent per call).
Bus Pirate v3/v4 BBIO1 was rejected for discontinued hardware (memory minimum-version-over-legacy); BPIO2 on Bus
Pirate 5/6 is the documented current binary interface (frame evidence). Every adapter operation re-checks registry,
profile and options before touching a port, then both ports' identities, then a BPIO2 status (REQ-FUNC-971cb423,
REQ-REL-793a44d8, REQ-REL-023c37ad), then acts with one configuration, one read-back and at most one data request
(capture: one optional write, then async reads), then applies the declared final state and reads it back
(REQ-FUNC-d9a201a5). FlatBuffers tables are built and read with the official runtime by slot number (no flatc-
generated code is vendored); COBS is a few lines in the helper.

**Interfaces and data.** CLI, profile, registry fields, wire mapping, results and problem codes exactly as spec
REQ-DATA-634d35da. Program env `BUS_REGISTRY: "${workbench}/lab/resources.json"`. Test seam: the fake pyserial reads
`FAKE_BUS_BENCH` (ports, adapter versions, targets, faults) and keeps adapter state in `FAKE_BUS_STATE` and every
decoded request in `FAKE_BUS_LOG`; the runner's environment allowlist never passes these to a program. Host:
`lab-resources.ts` gains the schema branch (discriminated on `kind`), `labResourceKindSchema` `bus-adapter`,
`labResourceKeys` per kind; `resource-registry.ts` is unchanged (it already uses `entry.resource` and the key
function). The scpi registry reader skips non-visa entries and refuses their aliases (REQ-FUNC-de5e43b9).

**Files and test seams.** Package: plugin.yaml, README.md, skills bus-transactions and bus-profiles,
profiles/examples (bme280-i2c, w25q-spi, uart-echo bus profiles), scripts/bus_tool.py,
scripts/bus_support/{__init__, cli, report, workspace (byte-identical copy), ports, registry, profile, cobs, bpio,
adapter, operations, lifecycle}.py; catalog.yaml, packs.yaml. Host: shared lab-resources.ts (+ test), scpi
registry.py (+ scpi integration case). Tests: tests/integration/bus-tools.test.ts (package, rules, every operation and
error against the simulated adapter, the real runner with leases, Stop and cleanup, hardware block gated by
REQ-TEST-e0a0dfe1); fixtures tests/fixtures/bus-tools/fake-serial (pyserial stand-in with a BPIO2 Bus Pirate, a BME280,
an I2C EEPROM, a W25Q-style SPI flash answering only in mode 0 and a UART peer); bus profiles written by the test;
tests/packaging/prepare-plugins.test.ts list; the workspace-copies test list.

**Risks and open decisions.** Unverified on hardware: NACK error text (rule: the word NACK in the error), UART async
capture, mode_max limits, whether both CDC ports report the same USB serial number. All are open blockers of T04-B/E/F
and are written in the README as unverified, never as support. The fake's FlatBuffers code is written separately from
the helper's, but both follow one reading of bpio.fbs: a slot mistake shared by both would only show on hardware.
Registry keys of `/dev/serial/by-id` links are not resolved (the spec keeps them as written).

**Requirement map.** REQ-DATA-634d35da cli/report/profile; REQ-SEC-9350b6ae manifest + bpio (no forbidden fields);
REQ-DATA-9fe47866, REQ-FUNC-4dadea40 lab-resources.ts; REQ-FUNC-de5e43b9 scpi registry.py; REQ-FUNC-0163b91b,
REQ-SEC-1c72e308 ports.py; REQ-FUNC-971cb423, REQ-REL-793a44d8, REQ-REL-023c37ad, REQ-REL-87418271, REQ-REL-10ae6ea5
adapter.py; REQ-FUNC-ebf73436, REQ-SEC-2ec2103d, REQ-SEC-b30461f8, REQ-SEC-a8f13a1a profile.py + cli; REQ-SEC-145e1953,
REQ-FUNC-edb1741e, REQ-REL-28754edd, REQ-FUNC-e5a016ac, REQ-SEC-85225742, REQ-FUNC-1dcdbb05, REQ-REL-077448a5,
REQ-REL-f430ec06, REQ-REL-737b96ec, REQ-FUNC-3223c457, REQ-FUNC-d9a201a5, REQ-FUNC-cd3227bc operations.py;
REQ-REL-c63f36b2, REQ-SEC-e088558b lifecycle.py; REQ-SEC-d8671786 registry.py; REQ-FUNC-e62ad15a report.py;
REQ-SEC-f0aa9c76, REQ-FUNC-1f2ee7cc plugin.yaml/catalog/packs; REQ-TEST-e0a0dfe1 test file; reused LAB-01 and
approval requirements: no design impact (declaration only).


## Log

- 2026-11-14 frame: journal opened
- 2026-11-14 frame: completed; next specify - scope recorded (autopilot) (7 Done checklist item(s) left unticked)
- 2026-11-14 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-14 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-14 build: red: npx vitest run src/libraries/shared/src/lab-resources.test.ts exit 1 - bus-adapter entries refused by the visa-only schema and keyed as VISA (REQ-DATA-9fe47866 REQ-FUNC-4dadea40)
- 2026-11-14 build: green: npx vitest run src/libraries/shared/src/lab-resources.test.ts src/libraries/core/src/plugins/program-resources.test.ts exit 0; npm run typecheck exit 0 (REQ-DATA-9fe47866 REQ-FUNC-4dadea40)
- 2026-11-14 build: red: npx vitest run tests/integration/scpi-instruments.test.ts -t 'bus adapter' exit 1 - scpi refuses a registry holding a bus-adapter entry (REQ-FUNC-de5e43b9)
- 2026-11-14 build: green: npx vitest run tests/integration/scpi-instruments.test.ts exit 0 (REQ-FUNC-de5e43b9)
- 2026-11-14 build: DEVIATION build: the bus-tool helper was drafted before tests/integration/bus-tools.test.ts ran, so the plugin requirements have no red line before implementation; the host registry kind and the scpi reader were built test-first - the integration test still checks every requirement's verification against the simulated adapter
- 2026-11-14 build: green: npx vitest run tests/integration/bus-tools.test.ts tests/integration/scpi-instruments.test.ts src/libraries/shared/src/lab-resources.test.ts src/libraries/core/src/plugins/program-resources.test.ts tests/packaging/prepare-plugins.test.ts exit 0 (all 35 IOT-04 requirements); npm run typecheck exit 0, npm run lint 0 errors, npm run check:i18n exit 0
- 2026-11-14 build: runner-leases.test.ts 'treats a timeout like Stop' failed once when run in parallel with five other files (158 ms timing case) and passed 3 of 3 alone; runner.ts is unchanged by this task
- 2026-11-14 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-14 validate: inspection (REQ-TEST-e0a0dfe1): read the 'a real Bus Pirate' block of tests/integration/bus-tools.test.ts - describe.skipIf without VERA_TEST_BUS_PIRATE_PORT/_TERMINAL/_IDENTITY (vitest reported it skipped, 30 passed 1 skipped) and it runs only identify, which sends one status request
- 2026-11-14 validate: review round 1: spec changes_required - BLOCKING REQ-FUNC-1dcdbb05 verification claims an SPI transfer no test runs; non-blocking: verification texts of REQ-FUNC-4dadea40/cd3227bc differ from the tests, a few verification details unasserted, REQ-DATA-634d35da omits the late limit and the folderless refusals, spec omits devices[].note/requests/manufacturer and the 2 s release wait and empty query vector, Interrupted docstring wrong. quality approved, non-blocking: SIGTERM skips the helper's own final state (runner cleanup covers it), a late data reply may be taken for the release reply (physical unknown, pessimistic), capture --write has no rawTransfer gate, stale-bytes not-bpio2 hint
- 2026-11-14 validate: returned to build - review round 1: SPI transfer untested (REQ-FUNC-1dcdbb05) plus non-blocking wording, asserts and spec details
- 2026-11-14 build: green (round 1 fixes): npx vitest run tests/integration/bus-tools.test.ts exit 0, 30 passed 1 skipped - SPI transfer case added (REQ-FUNC-1dcdbb05), COM35 holder (REQ-FUNC-4dadea40), version, exit-code, no-open, duration and HiZ asserts; REQ-DATA-634d35da and REQ-FUNC-cd3227bc wording and spec details aligned with the code
- 2026-11-14 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-14 validate: final: python .agentic/aegis.py check --task TASK-06f52fc5 --strict --run exit 0; lint, typecheck, i18n ok; errors=0, 58 warnings: stale-paths/no-linked-tests/journal-header/ticket-ref of other tasks' records, uncovered-source for fixtures, example profiles, the empty __init__.py files and the copied workspace.py, secret-in-diff 'added lines not scanned' for the empty fake serial/tools/__init__.py - none limits this candidate. Focused tests after the last edit: bus-tools.test.ts 30 passed 1 skipped (rerun by the spec reviewer too); scpi-instruments, lab-resources, program-resources, prepare-plugins passed before the review fixes, which touched only bus-tools files
- 2026-11-14 validate: completed; next done

## Rulings

- RULING-001 | date=2026-11-14 | decision=Accept as known limits: on a Linux SIGTERM the helper skips its own final state and run folder (VERA's cleanup run releases the adapter); a late data reply can be taken for the release reply, which makes the result physical unknown (pessimistic, never a false confirmed); the host schema is a plain z.union | reason=Golden path unaffected and the outcome is safe; per the user's standing guidance 'No implementation is perfect - as long as it doesn't block the golden path, it's acceptable' (2026-11-13), 1-2 review rounds | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-06f52fc5.md
changed: new plugin bus-tools (helper, manifest, skills, profiles, README), registry kind bus-adapter in lab-resources.ts, scpi registry reader skips other kinds, catalog/packs, tests and fixture, 35 requirements, spec, knowledge and context
evidence: aegis check --task TASK-06f52fc5 --strict --run exit 0 (lint, typecheck, i18n ok); bus-tools.test.ts 30 passed 1 skipped; reviews round 2 approved/approved
issues: No Bus Pirate connected: T04-B, real-hardware parts of T04-E/F and native Ubuntu open; NACK text, UART async receive and per-mode limits unconfirmed on firmware
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-14)

- stage: validate; type: feature; path: full; branch: feature/113-arduino-iot
- requirements:
  - REQ-DATA-634d35da - bus-tool contract: operations, bus profile, registry fields, results and exit codes
  - REQ-SEC-9350b6ae - Speak to the adapter only through the pinned bus-tool helper
  - REQ-DATA-9fe47866 - Declare a bus adapter in the bench registry
  - REQ-FUNC-4dadea40 - Key a bus adapter by both of its serial ports and its USB identity
  - REQ-FUNC-de5e43b9 - Ignore other identity kinds in the scpi helper's registry reader
  - REQ-FUNC-0163b91b - List serial ports by identity without opening them
  - REQ-SEC-1c72e308 - Refuse an adapter whose ports are missing or show another identity
  - REQ-FUNC-971cb423 - Identify the adapter through one BPIO2 status request
  - REQ-REL-793a44d8 - Refuse a port that does not answer as BPIO2
  - REQ-REL-023c37ad - Refuse an unsupported adapter model or protocol version
  - REQ-FUNC-ebf73436 - Report the backend's capabilities without opening a port
  - REQ-SEC-2ec2103d - Validate the bus profile before touching the adapter
  - REQ-SEC-145e1953 - Switch the adapter's supply on only when declared, named and within the bench limits
  - REQ-FUNC-edb1741e - Configure the bus and read the configuration back
  - REQ-REL-28754edd - Fail a configuration the adapter refuses or does not apply
  - REQ-FUNC-e5a016ac - Read a declared register in one transaction
  - REQ-SEC-b30461f8 - Read only registers the profile declares
  - REQ-SEC-a8f13a1a - Read a register that clears flags only on purpose
  - REQ-SEC-85225742 - Transfer only to devices that allow raw transfers, within limits
  - REQ-FUNC-1dcdbb05 - Run one bounded transfer
  - REQ-REL-077448a5 - Report an address NACK after a single attempt
  - REQ-REL-87418271 - Report a missing answer as incomplete
  - REQ-REL-f430ec06 - Report a byte count mismatch
  - REQ-REL-737b96ec - Report an unexpected register value with the causes to check
  - REQ-FUNC-3223c457 - Capture a UART for a bounded time
  - REQ-FUNC-d9a201a5 - Leave the declared final state and read it back
  - REQ-REL-c63f36b2 - Stop at the next safe point with the final state
  - REQ-REL-10ae6ea5 - Report a lost adapter
  - REQ-FUNC-cd3227bc - Release the adapter as VERA's cleanup
  - REQ-SEC-e088558b - Refuse bus operations while the adapter's state is unknown
  - REQ-SEC-d8671786 - Act only on the approved bench registry in bus-tool
  - REQ-FUNC-e62ad15a - Summarize bus-tool run folders
  - REQ-SEC-f0aa9c76 - Classify bus-tool calls at their highest risk
  - REQ-FUNC-1f2ee7cc - Publish the official bus-tools plugin
  - REQ-TEST-e0a0dfe1 - Gate the real Bus Pirate tests behind variables
  - REQ-SEC-f98d4fd3 - Void a program approval when a named file changes
  - REQ-SEC-370f2d9b - Re-check approved file hashes right before the program starts
  - REQ-FUNC-a5770245 - Refuse a second holder of a resource in one process
  - REQ-FUNC-e4ca09ad - Share resource leases between VERA processes
  - REQ-REL-52212fce - Recover leases left by a lost process
  - REQ-FUNC-3bf3d5bc - Ask a supervised program to stop before killing it
  - REQ-REL-3817f2fd - Run the authorized cleanup after an interrupted actuation
  - REQ-FUNC-d4b72e6b - Report the physical state of a supervised run
  - REQ-UX-73dd7a9b - Show the reserved resources in the program approval
  - REQ-DATA-f2cbfc23 - Declare bench resources in one workbench registry file
- deviations: 1 recorded
  - build: the bus-tool helper was drafted before tests/integration/bus-tools.test.ts ran, so the plugin requirements have no red line before implementation; the host registry kind and the scpi reader were built test-first - the integration test still checks every requirement's verification against the simulated adapter
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base 6524f46: 76 file(s) changed, 4886 line(s) added; 1 file(s) not content-scanned
- checks: errors=0 warnings=58 notes=27
- checklist: 9/9 done
