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
STATE: IOT-01 built (hardware acceptance pending); IOT-02...IOT-08 planned.

## Order

| Order | Package | Issue | Plugin | Result | State |
|---|---|---|---|---|---|
| 1 | IOT-01 | [#114](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/114) | `arduino-cli` | pinned arduino-cli 1.6.0 (direct use blocked) behind `arduino-tool`: VERA's own environment `~/.vera-arduino`, offline outside `install`; exact-version installs; serial ports by identity key, no board inferred from a USB bridge; compile of a sketch copy into `arduino-iot-results/<run-id>/` (core, libraries, sizes, hashes); upload of exactly that verified binary to a matching identity; runner BUSY for foreground port holders. Real compiles verified on Windows (arduino:avr 1.8.8, arduino:samd 1.8.14); real upload, serial readback, two boards and native Ubuntu pending hardware (AEGIS TASK-239a7379) | built |
| 2 | IOT-02 | [#115](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/115) | `micropython` | finite file and run operations on MicroPython devices | planned |
| 3 | IOT-03 | [#116](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/116) | `circuitpython` | code and compatible libraries on an identified CircuitPython board | planned |
| 4 | IOT-04 | [#117](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/117) | `bus-tools` | I2C/SPI/UART transactions through an identified adapter | planned |
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
