# IOT-01...IOT-08 integrated acceptance

PURPOSE: the focused integrated acceptance of epic #113 (ticket IOT-08, section "Acceptanță integrată deținută de
IOT-08", criterion T08-F). It reuses the valid evidence of each child's AEGIS task and plan row and reruns no complete
suite. It separates four kinds of evidence and names every proof that is still open.
STATE (2026-11-14): software acceptance complete for all eight plugins; hardware, cloud and native-Ubuntu acceptance
open. Not a release statement.

Evidence kinds used below:

- **Offline**: tests with simulated devices or tools (fake pyserial, simulated BPIO2, fake Bleak, scripted wokwi-cli,
  simulated boards and drives), VERA's real ProgramRunner, lease folder and cleanup. They prove VERA's own logic.
- **Real tool**: the pinned third-party program run for real on this host (arduino-cli 1.6.0, mpremote 1.29.0, circup
  3.1.0, wokwi-cli 0.29.1, asyncssh 2.24.1), without a device.
- **Test service**: a real protocol service started inside the tests on 127.0.0.1 (the TLS MQTT test broker; the
  asyncssh SSH server whose commands run in WSL Ubuntu 24.04 with its systemd user manager).
- **Real hardware or cloud**: a physical board, adapter or radio, or Wokwi's cloud. Only the passive BLE scan on this
  computer's adapter exists so far.

Host: Windows 11 x64 with the repository's toolchain Python 3.12 and Node; Linux evidence is WSL 2 Ubuntu 24.04, which is
not native Ubuntu. Every child was verified with `aegis check --task <id> --strict --run` (lint, typecheck, i18n) exit 0
and focused vitest runs recorded in its journal; reviews approved in each journal.

Linux run (2026-11-14, after the master merge 33227dc): the focused IoT tests (the eight plugin integration files,
scpi-instruments, runner, leases, credentials, shared schemas, packaging; 20 files) ran in a separate WSL 2 Ubuntu 24.04
clone with Node 24.21.0 and a Python 3.12 venv holding the pinned test packages (`VERA_TEST_PYTHON`). All pass. The run
found three Windows-only test assumptions, fixed in the tests: the micropython case-insensitive `com5` match (Linux
device names are case-sensitive), and the fake PyVISA and fake Bleak "stuck" calls, which Linux's SIGTERM interrupted so
the helper unwound itself and the separate cleanup never ran; they now ignore SIGTERM like a call stuck in a driver.

## Scenarios

| # | Scenario (ticket) | Plugin, AEGIS task | Offline | Real tool | Test service | Real hardware / cloud |
|---|---|---|---|---|---|---|
| 1 | Arduino: identified compile/upload, serial capture, handoff without choosing another board; no Runtime/Firmata | arduino-cli, TASK-239a7379 | identity keys, port guard, upload refusals for another identity, compile result with hashes | real compiles arduino:avr 1.8.8 and arduino:samd 1.8.14 with arduino-cli 1.6.0 (VERA_TEST_ARDUINO_CLI) | - | **open**: real upload, serial readback, two boards |
| 2 | MicroPython and CircuitPython: deploy and run on their targets, a failed transfer and a real traceback | micropython TASK-fa2b0429, circuitpython TASK-0bc542d8 | simulated board/drive: hashed `.vera-part` deploy, run with deadline and verdict, interrupted and unplugged transfers incomplete, tracebacks captured | real mpremote 1.29.0 against the simulated board; real circup 3.1.0 with a fixture bundle | - | **open**: real MicroPython and CircuitPython boards, a real bundle download |
| 3 | Bus Tools: transactions on declared peripherals, capture/report, verified cleanup | bus-tools, TASK-06f52fc5 | simulated BPIO2 Bus Pirate: I2C/SPI/UART requests sent once, NACK/no-response/count-mismatch distinct, release cleanup through the real runner after Stop/timeout/crash | - | - | **open**: Bus Pirate 5/6, I2C sensor, SPI fixture, unplug and Stop on a live bus |
| 4 | MQTT/BLE: authorized telemetry and command, reconnect without implicit physical replay, no secrets in evidence | mqtt-tools TASK-b055791d, ble-tools TASK-b0622500 | fake Bleak: profile-bound reads, notifications, one write with delivery recorded, never re-sent | real paho-mqtt 2.1.0; real Bleak 3.1.0 scan backend | stdlib TLS MQTT broker with a generated CA and a paho fixture device: publish once, request/correlation, reconnect for subscribe only, password only on stdin | passive BLE scan on this Windows 11 adapter (3 advertisers, nothing connected); **open**: product broker, real MQTT device, BLE read/notify/write fixture, pairing |
| 5 | Wokwi: firmware compatible with the Arduino test, explicit cloud job, pass and fail scenario; not equal to real hardware | wokwi, TASK-55160e0d | scripted wokwi-cli: job of exact copies, every outcome distinct, Stop leaves remote unknown, token only on stdin and in the one child | real wokwi-cli 0.29.1 offline: version, `lint --offline`, argument acceptance up to the missing-token check | - | **open**: a cloud run (no Wokwi token, by the user's decision on 2026-11-14) |
| 6 | Raspberry Pi: deploy a test project and collect logs, a finite task and a selected service; a broker on the Pi only when configured explicitly | raspberry-pi-linux, TASK-a31dbad3 | refusals before any connection (paths, sudo/shell commands, unlisted services, registry) | asyncssh 2.24.1 client and server | asyncssh SSH server on 127.0.0.1, commands in WSL Ubuntu 24.04: pinned host key and `host-key-changed`, agent-only login, helper install and hash check, deploy with conflicts and no deletion, tasks with handle/PID/budget/output limit, Stop, SSH loss and reboot record, a real `systemctl --user` unit and its journal, runner lease and `stop-owned` cleanup | **open**: a Raspberry Pi with Raspberry Pi OS 12 (no broker on the Pi is configured or assumed) |
| 7 | Aggregate report with versions, hashes, conditions, results and limits; Stop/disconnection shown for local, cloud and remote resources | all | each helper writes `format: 1` results under `arduino-iot-results/<run-id>/` with versions, hashes, status pass/fail/incomplete/blocked/skipped/error, and a `report` operation (JSON, Markdown, HTML; JUnit for Wokwi) | - | see rows 4 and 6 | see the open items |

Stop and disconnection, by resource kind:

- Local (serial, volume, bus adapter, BLE device): LAB-01's stop request, grace and cleanup run through the real
  ProgramRunner and lease folder (IOT-02...IOT-06 tests); physical state confirmed or `unknown`, never success.
- Cloud (Wokwi): Stop and the real-time budget ask wokwi-cli to close its WebSocket; the remote state is reported
  `unknown` because the API has no cancel (IOT-07, scripted CLI).
- Remote (Raspberry Pi): Stop ends the owned task and confirms its PID, start time and boot id are gone; a lost SSH
  connection ends `connection-lost` with the remote state unknown, and VERA's `stop-owned` cleanup reconnects and stops
  it; a task recorded before a reboot is `lost-by-reboot` and never signalled (IOT-08, test SSH server on WSL).

## Open blockers

No physical board, adapter, radio fixture, Raspberry Pi or Wokwi token was connected or used for these children, and
native Ubuntu was not run. Each item stays open until it is proven on the real thing:

1. IOT-01 T01: real upload of the verified binary, serial readback, the two-board handoff, native Ubuntu.
2. IOT-02 / IOT-03: a real MicroPython board and a real CircuitPython board (deploy, run, traceback, unplug), a real
   Adafruit bundle download, native Ubuntu (vfat sync, by-id links).
3. IOT-04 T04-B/E/F: Bus Pirate 5 or 6 with an I2C sensor and an SPI fixture, unplug and Stop on a live bus, the firmware's
   NACK text, UART receive, native Ubuntu.
4. IOT-05: a product broker and a real MQTT device; the Linux SIGTERM graceful stop on native Ubuntu.
5. IOT-06 T06-B/F: real read, notify and write on a BLE fixture, a permitted write fixture, pairing behaviour, BlueZ on
   native Ubuntu.
6. IOT-07 T07-A: a real cloud run with hash and model identified (needs a Wokwi token and the user's approval of the
   transmission); the linuxstatic binary and the SIGTERM stop path on native Ubuntu.
7. IOT-08 T08-A/B/C/E: a real Raspberry Pi (Raspberry Pi OS 12 64-bit, serial and model from the device tree, aarch64)
   reached from Windows and from native Ubuntu: host-key pinning and a changed key, the fixture deploy, a finite task and
   a user service with real status and logs, Stop, SSH loss and an external reboot. T08-D (spaces, injection, sudo,
   unlisted services) is shown against the test server and needs no board.
8. All: native Ubuntu x64 runs of the focused tests and of the hardware proofs (WSL evidence does not replace them).

## Re-running the evidence

From `05_Software`, after `python ../02_Tools/environment/npmw.py npm run typecheck` (integration tests import dist/):

```bash
python ../02_Tools/environment/npmw.py npx vitest run tests/integration/arduino-cli.test.ts tests/integration/micropython.test.ts tests/integration/circuitpython.test.ts tests/integration/bus-tools.test.ts tests/integration/mqtt-tools.test.ts tests/integration/ble-tools.test.ts tests/integration/wokwi.test.ts tests/integration/raspberry-pi-linux.test.ts
```

The opt-in real-tool variables are in `.agentic/context/environment.md` (VERA_TEST_ARDUINO_CLI, VERA_TEST_BLE_PYTHON,
VERA_TEST_WOKWI_CLI and the IOT-02/IOT-03 provisioner runs); VERA_TEST_PI_REMOTE=none skips the SSH block of IOT-08.
