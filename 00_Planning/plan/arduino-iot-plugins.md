# IOT-01...IOT-08 Arduino and IoT plugins

PURPOSE: the order and state of the eight plugins that take VERA to native Arduino projects, Python
boards, active buses, MQTT, BLE, cloud simulation and Linux projects on a Raspberry Pi.
SPEC: Gitea epic [#113](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/113) and its children #114...#121 hold the specification of each work
package (deliverables, operations, Done criteria T01...T08); the local copies are
`F:\ProjectsDDP\VERA_Arduino_IoT_Plugins_Plan.md` and `F:\ProjectsDDP\VERA_Arduino_IoT_Plugins_Tickets\`.
This page records only order, state and what was built, so the two never diverge. Where a ticket is
wrong about the code, the code decides.
PROCESS: at the user's request (2026-11-13) every child is implemented with AEGIS, in order, on one
branch `feature/113-arduino-iot` cut from `feature/93-electronics-calc` at bb79e4b, in the sibling
worktree `F:\2026_Virtual_Embedded_Rig_Assistant_iot`. The implementer hands the candidate back without a
commit; the coordinator checks the evidence and makes one local commit per ticket. Nothing is pushed.
STATE: IOT-01...IOT-04 built (hardware acceptance pending); IOT-05...IOT-08 planned.

## Order

| Order | Package | Issue | Plugin | Result | State |
|---|---|---|---|---|---|
| 1 | IOT-01 | [#114](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/114) | `arduino-cli` | pinned arduino-cli 1.6.0 (direct use blocked) behind `arduino-tool`: VERA's own environment `~/.vera-arduino`, offline outside `install`; exact-version installs; serial ports by identity key, no board inferred from a USB bridge; compile of a sketch copy into `arduino-iot-results/<run-id>/` (core, libraries, sizes, hashes); upload of exactly that verified binary to a matching identity; runner BUSY for foreground port holders. Real compiles verified on Windows (arduino:avr 1.8.8, arduino:samd 1.8.14); real upload, serial readback, two boards and native Ubuntu pending hardware (AEGIS TASK-239a7379) | built |
| 2 | IOT-02 | [#115](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/115) | `micropython` | `micropython-tool` (PEP 723, pinned mpremote 1.29.0 / pyserial 3.5 / platformdirs 4.14.0) using mpremote's serial transport with fixed snippets only (no REPL, exec, eval, mount): ports by identity key, identify, files, read-file, deploy-file through a hashed `<target>.vera-part` copy with probed rename or remove-then-rename (boot.py/main.py only with `--startup`, irreversible), run-file from RAM with deadline and verdict, capture-output, reset with re-bind by identity, report; MicroPython >= 1.22 only; every board operation except a plain capture-output interrupts the running program and says so; loss reported as disconnected / device-reset / no-response. Serial identity kind added to LAB-01's lease registry: every run naming a serial port leases `serial:<port>` across VERA processes (arduino-cli, serial-monitor, esptool covered with no package change). Verified offline on a simulated board and with the real mpremote 1.29.0 (opt-in); real board and native Ubuntu pending (AEGIS TASK-fa2b0429) | built |
| 3 | IOT-03 | [#116](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/116) | `circuitpython` | `circuitpython-tool` (PEP 723, pinned circup 3.1.0 for the bundle conventions only, never its CLI; pyserial 3.5) working through the board's CIRCUITPY drive and serial console, no REPL, UF2 or update-all: `devices` lists CIRCUITPY drives with firmware/board id/UID from boot_out.txt and binds a drive to its serial port only when the UID equals exactly one port's USB serial number (identity `usb:<vid>:<pid>:<serial>`, else `circuitpy-uid:` or unstable `volume-serial:`); writes refused for a missing drive, another identity, two drives with one identity or none; CircuitPython 9-11 only; identify, inspect-code (startup file, settings.toml never read), inspect-libraries (.mpy ABI `C\x06`); `prepare-libraries` is the only network step: exact bundle tag, zips cached in `~/.vera-circuitpython` with recorded SHA-256, dependencies resolved, incompatible .mpy refused, per-file hashed library set in the run folder; offline `deploy` checks set/firmware/space/read-only/`--expect-from` before writing, then libraries first and code.py last, each file via `.vera-part`, read-back and replace, confirmed/unconfirmed list (unplug or Stop -> incomplete, never "updated"), boot.py only with `--boot`, and `--capture` reads the autoreloaded run (output, traceback, autoreload on/off); `capture-output [--reload]`. Volume identity kind added to LAB-01's lease registry: a run naming `--volume` leases `volume:<drive>` across VERA processes. Verified offline on simulated drives and console and with the real circup 3.1.0 (opt-in); real board, real bundle download and native Ubuntu pending (AEGIS TASK-0bc542d8) | built |
| 4 | IOT-04 | [#117](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/117) | `bus-tools` | `bus-tool` (PEP 723, pinned flatbuffers 25.12.19 / pyserial 3.5), one backend `bus-pirate-bpio2`: a Bus Pirate 5 or 6 whose BPIO2 status reports hardware major 5/6 and FlatBuffers major 2, reached on its binary serial port with COBS-framed FlatBuffers (no terminal, scan, firmware, bootloader, reset or pin-mask request; other Bus Pirate generations and bridges not claimed). The adapter is a new identity kind `bus-adapter` in LAB-01's registry (`lab/resources.json`: binary port, terminal port, USB identity, optional bench power limits), keyed by both ports and the identity, so any run naming either port is BUSY across VERA processes and VERA's supervised cleanup runs `bus-tool release` after Stop, timeout or a crash; the scpi helper now skips such entries. A workbench bus profile (hash-bound) declares common ground, logic voltage, supply, I2C/SPI/UART settings, pull-ups, byte/time limits, final state (release = HiZ, pull-ups and supply off, or keep), devices with I2C addresses, raw-transfer permission and named registers (`read`/`read-clears`, expected value). Operations devices, capabilities, identify, configure-bus, read-register (`--clears` for clearing registers), transfer, capture (UART only; I2C/SPI capture refused in favour of sigrok), release, report; supply only with `--power` (irreversible) within the registry's limits. Each request is sent once: NACK, no-response, count-mismatch, unexpected-value (names SPI mode/wiring/voltage) and disconnected are distinct, with the final state read back as physical confirmed/unknown; Stop is honoured before every request and during capture. Verified offline against a simulated BPIO2 Bus Pirate and with the real runner, lease folder and cleanup; T04-B (real I2C sensor and SPI fixture), the real-hardware parts of T04-E/F (unplug, Stop on a live bus, firmware NACK text and UART receive) and native Ubuntu pending a Bus Pirate (AEGIS TASK-06f52fc5) | built |
| 5 | IOT-05 | [#118](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/118) | `mqtt-tools` | bounded telemetry and commands on a configured broker | planned |
| 6 | IOT-06 | [#119](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/119) | `ble-tools` | BLE discovery and GATT operations on known profiles | planned |
| 7 | IOT-07 | [#120](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/120) | `wokwi` | explicit cloud simulation and firmware scenarios | planned |
| 8 | IOT-08 | [#121](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/121) | `raspberry-pi-linux` | projects, services and logs on an identified Linux board, plus the integrated acceptance | planned |

The order is the execution order of the initiative, not a runtime dependency chain: MicroPython does not
need the Arduino cores, BLE needs no MQTT broker, the Raspberry Pi needs no Wokwi account. Package
dependencies are declared only for functions actually reused. Existing plugins are reused where they fit
(serial-monitor, esptool, probe-rs, Git). PlatformIO (LAB-08 #109) stays separate: IOT-01 keeps native
Arduino projects and never converts them.

## Shared infrastructure

IOT-01 adds only the shared identity, resource and result infrastructure these plugins need, and reuses
the LAB-01 implementation (epic #101) when it exists. LAB-01 is developed in parallel on branch
`feature/101-embedded-lab`, which is not part of this branch's base. Before building its own, IOT-01
checks that branch: a committed LAB-01 registry is taken over as is, so only one registry exists when the
branches meet; otherwise IOT-01 builds the minimal registry along the seams of the LAB plan and the
reconciliation is recorded as an open item for the merge.

Outcome (IOT-01, 2026-11-13): LAB-01 was not committed (still at specify), so IOT-01 built no registry. It extended
the existing in-process serial-port guard of the program runner (a foreground run now holds the ports it names;
Linux `/dev/serial/by-id` links resolve to their device) and keeps serial board identity keys
(`usb:<vid>:<pid>:<serial>`, `usb:<vid>:<pid>`, `serial:<address>`) inside the arduino-cli helper. Open item for the
merge with `feature/101-embedded-lab`: LAB-01's cross-process lease registry replaces this guard extension and adopts
the serial identity kind; desktop app and CLI do not yet see each other's ports.

Merge (2026-11-14, at the user's request): `feature/101-embedded-lab` up to LAB-01 (41313ca) was merged into this branch
before IOT-02, so the IoT plugins build on LAB-01's one lease registry (`leases.ts`, `resource-registry.ts`,
`lab-resources.ts`). The runner keeps both guards: a serial port named by any unfinished run, or claimed by a run's
lease, is BUSY; Linux by-id links resolve. IOT-02 (2026-11-14) added the serial identity kind: the runner leases every serial port a run names in argv
(`serial:<port>`, non-actuating) in the same lease folder, so arduino-cli, serial-monitor, esptool and micropython
runs exclude each other across desktop and CLI; no registry entry or manifest change is needed. IOT-03 (2026-11-14) added the volume identity kind the same way: a run naming a
mass-storage volume with `--volume` (the CIRCUITPY drive) leases `volume:<drive>` (Windows drive letter upper-cased, absolute paths
resolved, relative ones as written) in the same lease folder; one board named by drive in one run and by serial port in another is two keys. IOT-04 (2026-11-14) added the registry identity kind `bus-adapter` (a schema branch and key function in
`lab-resources.ts`, as the registry spec foresees): a Bus Pirate declared in `lab/resources.json` is keyed `serial:<binary port>`,
`serial:<terminal port>` and its `usb:<vid>:<pid>:<serial>` identity, so both of its ports are reserved together and the
LAB-01 supervision (stop request, grace, cleanup run, unknown markers) applies; no runner change was needed.

## Rules shared by the packages

- Finite operations with validated JSON and the existing plugin model (`plugin.yaml`, skills, declared
  programs, helper scripts, provisioning, approvals). No Arduino Runtime, Firmata, VERA Bridge firmware,
  generic shell, universal GPIO access or free REPL console.
- Serial, USB and BLE resources are reserved by normalized identity and known aliases; a handoff to
  upload or bootloader releases the monitor and re-binds the port by identity, never by the first new
  COM port. A common USB bridge VID/PID never identifies a board model. Ambiguity asks for a choice.
- Private settings for MQTT, Wokwi and SSH go through explicit host integration; secrets stay in the
  CredentialStore or the system SSH agent, never in prompt, argv, manifest, `workbench.yaml`, log or
  artifact. The general environment inheritance of plugins is not changed to pass credentials.
- Risk follows the existing policy at the highest effective risk. Builds may run host recipes and hooks,
  so a name like compile or build never makes an operation `safe`; code run on an MCU or Linux board may
  actuate hardware. Approval binds firmware, scripts, effective configuration and destination by hash.
- Stop ends processes and streams and releases resources; it does not promise to stop code left on the
  board, a remote service or an actuator. Unconfirmed physical or remote state is reported `unknown`.
- Results (`format: 1`) go to `arduino-iot-results/<run-id>/` in the workbench, created exclusively,
  never inside `.vera/`: JSON plus Markdown/HTML, CSV/charts/JUnit where they apply. States are `pass`,
  `fail`, `incomplete`, `blocked`, `skipped` and `error`; unknown never becomes zero.
- Evidence separates offline tests, real tools, test services and real hardware. A mock of USB, BLE or a
  broker never proves a board or adapter works; Wokwi is a cloud job, not an offline test. Targets are
  Windows x64 and native Ubuntu x64. A missing board, adapter or account stays an open blocker of that
  proof. Verification follows `02_Tools/verification-policy.md`; IOT-08 owns the focused integrated
  acceptance and reuses the valid evidence of IOT-01...07.
