# Official plugins

## Routing

Select for the plugin packages VERA maintainers ship in `05_Software/plugins/<id>/`: their `plugin.yaml` programs and
rules, helper scripts, Agent Skills and README. This page holds what all of them share; each plugin's interface,
invariants, change map, requirements and files are on the page the table names. Start at
`05_Software/plugins/<id>/plugin.yaml`.

| Plugin id | Page |
|---|---|
| `analysis-skills` | [Firmware analysis, Git and analysis skills](official-plugins-analysis.md) |
| `arduino-cli` | [Arduino, MicroPython and CircuitPython](official-plugins-arduino.md) |
| `binutils` | [Firmware analysis, Git and analysis skills](official-plugins-analysis.md) |
| `ble-tools` | [MQTT, BLE and Raspberry Pi Linux](official-plugins-iot.md) |
| `bus-tools` | [CAN, network capture and bus transactions](official-plugins-communication.md) |
| `can-dbc` | [CAN, network capture and bus transactions](official-plugins-communication.md) |
| `can-python` | [CAN, network capture and bus transactions](official-plugins-communication.md) |
| `circuitpython` | [Arduino, MicroPython and CircuitPython](official-plugins-arduino.md) |
| `electrical-network` | [Electrical power and distribution](official-plugins-electrical.md) |
| `electronics-calc` | [Electronics calculation, parts and SPICE simulation](official-plugins-electronics.md) |
| `esp32-efuse` | [ESP32 and serial console](official-plugins-esp32-serial.md) |
| `esp32-esptool` | [ESP32 and serial console](official-plugins-esp32-serial.md) |
| `esp32-idf` | [ESP32 and serial console](official-plugins-esp32-serial.md) |
| `freerouting` | [KiCad review, PCB layout and autorouting](official-plugins-pcb.md) |
| `gdb-debug` | [Flashing and debug](official-plugins-flash-debug.md) |
| `git` | [Firmware analysis, Git and analysis skills](official-plugins-analysis.md) |
| `hil-testing` | [Lab instruments, validation and HIL](official-plugins-lab.md) |
| `industrial-catalog` | [Electrical power and distribution](official-plugins-electrical.md) |
| `kicad` | [KiCad review, PCB layout and autorouting](official-plugins-pcb.md) |
| `kicad-layout` | [KiCad review, PCB layout and autorouting](official-plugins-pcb.md) |
| `lab-validation` | [Lab instruments, validation and HIL](official-plugins-lab.md) |
| `lighting-design` | [Electrical power and distribution](official-plugins-electrical.md) |
| `ltspice` | [Electronics calculation, parts and SPICE simulation](official-plugins-electronics.md) |
| `microchip-pymcuprog` | [Flashing and debug](official-plugins-flash-debug.md) |
| `micropython` | [Arduino, MicroPython and CircuitPython](official-plugins-arduino.md) |
| `motor-drives` | [Electrical power and distribution](official-plugins-electrical.md) |
| `mqtt-tools` | [MQTT, BLE and Raspberry Pi Linux](official-plugins-iot.md) |
| `ngspice` | [Electronics calculation, parts and SPICE simulation](official-plugins-electronics.md) |
| `parts-search` | [Electronics calculation, parts and SPICE simulation](official-plugins-electronics.md) |
| `platformio` | [Zephyr and PlatformIO builds](official-plugins-firmware-build.md) |
| `power-profiler` | [Lab instruments, validation and HIL](official-plugins-lab.md) |
| `power-quality-pfc` | [Electrical power and distribution](official-plugins-electrical.md) |
| `probe-rs` | [Flashing and debug](official-plugins-flash-debug.md) |
| `protection-coordination` | [Electrical power and distribution](official-plugins-electrical.md) |
| `raspberry-pi-linux` | [MQTT, BLE and Raspberry Pi Linux](official-plugins-iot.md) |
| `renode` | [Virtual boards (Renode and Wokwi)](official-plugins-virtual-boards.md) |
| `scpi-instruments` | [Lab instruments, validation and HIL](official-plugins-lab.md) |
| `serial-monitor` | [ESP32 and serial console](official-plugins-esp32-serial.md) |
| `sigrok` | [Lab instruments, validation and HIL](official-plugins-lab.md) |
| `stm32-cubeprog` | [Flashing and debug](official-plugins-flash-debug.md) |
| `wireshark-dumpcap` | [CAN, network capture and bus transactions](official-plugins-communication.md) |
| `wireshark-tshark` | [CAN, network capture and bus transactions](official-plugins-communication.md) |
| `wokwi` | [Virtual boards (Renode and Wokwi)](official-plugins-virtual-boards.md) |
| `zephyr` | [Zephyr and PlatformIO builds](official-plugins-firmware-build.md) |

The platform that installs, classifies, approves and runs these programs (store, provisioner, rules, gate, runner,
serial-port guard, run_program) is [Plugins](plugins.md); plugin skill discovery is [Skills](skills.md).

## Purpose and boundaries

Each folder is an ordinary plugin package in format 1 that the user installs from the folder (`vera plugin
install --path`, IPC `plugins.install`) or from the catalog, and enables per workbench. The folder is also a catalog
source: `packs.yaml` (ESP32, Firmware analysis, Wireshark, CAN, Microchip, STM32, Electronics design and Embedded lab groups, including optional Security and Wireshark Local capture), `catalog.yaml` (all packaged plugins
`official`, reviewed low-risk rules for esp32-efuse and stm32-cubeprog, discovery metadata), `CONTRIBUTING.md` and the hosted repository's CI template `.ci/catalog.yml`; `vera
catalog check --source 05_Software/plugins` finds no issue. `npm run prepare:plugins` builds it into the bundled
catalog release `07_Delivery/plugins/` (git-ignored), which packaging ships as `<resources>/plugins/` for
an offline first install. Nothing installs them automatically. A package holds content only: a manifest, PEP 723
scripts that the provisioner runs with the bundled uv, and Markdown skills; a pip program such as esptool comes from
PyPI at install time and is not part of the folder. `requires`: esp32-esptool lists `serial-monitor`; `vera catalog check`
reports a `requires` that names no catalog plugin, and catalog installs review required plugins first, while installs
from a folder or zip ignore it. Platform behaviour such as risk
policy, approvals, timeouts and the serial-port guard is not repeated in the packages.

Each manifest's version records its evidence level (table below):
1.0.0 only with every real-tool and real-hardware proof on each declared platform (today only the Windows-only
ltspice), 0.3.0 when only native Ubuntu is open, 0.2.0 when the real tool ran on Windows but hardware or cloud proof
is open, 0.1.0 with offline evidence only. Each bundled helper's `VERSION` (its `--version`, result and state records) equals its plugin's manifest version.
Every manifest carries a one-line `summary` (at most 160 characters) for the catalog card, written from its
description; the description keeps the details for the install review.

Catalog discovery metadata for the twenty real packages lives in the maintainers' catalog.yaml map,
not plugin manifests. It lists factual activity/keyword classifications. Publication dates remain
absent without catalog release evidence; no commit/build/install timestamps are substituted.
Shared/source tests validate bounds/references; prepare-plugins and focused CLI acceptance prove
that source metadata reaches the deterministic bundled index unchanged.

The helper scripts' `workspace.py` path rules are byte-identical copies of one file; each plugin's page names
its copy and ngspice.test.ts checks every copy.

## Files

- `05_Software/plugins/packs.yaml`, `catalog.yaml` — packs and the maintainers' file of the catalog source.
- `05_Software/plugins/CONTRIBUTING.md`, `.ci/catalog.yml` — contribution guide and CI template for `vera-plugins`.
- `02_Tools/environment/prepare-plugins.mjs` — builds and checks the bundled catalog release.

## Evidence per plugin

The version of each official plugin and the evidence behind it. A row changes with the manifest version.

| Plugin | Version | Evidence and what is open |
|---|---|---|
| `ltspice` | 1.0.0 | Windows-only by scope; real LTspice 26.1.1 on Windows 11, nothing open |
| `analysis-skills` | 0.3.0 | skills only, no programs or hardware; folder/catalog install and CLI replay on Windows |
| `binutils` | 0.3.0 | real xPack toolchains and genuine fixture ELFs on Windows; no hardware |
| `can-dbc` | 0.3.1 | real cantools decoding on Windows; no hardware |
| `electronics-calc` | 0.3.1 | real uv provisioner run on Windows 11; no hardware |
| `freerouting` | 0.3.1 | real Freerouting 2.5.0 + KiCad 10.0.8 on Windows 11; no hardware |
| `git` | 0.3.0 | real Git for Windows (and WSL2) fixture receipts; no hardware |
| `kicad` | 0.3.1 | real KiCad 10.0.8 on Windows 11; no hardware |
| `kicad-layout` | 0.3.1 | real KiCad 10.0.8 PCB editor on Windows 11; no hardware |
| `ngspice` | 0.3.1 | real ngspice-47 on Windows 11; no hardware |
| `parts-search` | 0.3.1 | real uv run on Windows 11; no hardware |
| `renode` | 0.3.1 | real Renode 1.17.0 on Windows 11; virtual boards, no hardware |
| `wireshark-tshark` | 0.6.0 | native Windows offline inspection, traffic statistics, follow, Automotive Ethernet and general networking profiles; earlier live loopback on Windows/Npcap |
| `wireshark-dumpcap` | 0.1.0 | native Windows discovery and isolated WSL2 loopback with offline readback. Native Windows and Ubuntu live acceptance are milestone checks. |
| `arduino-cli` | 0.2.2 | real compiles with arduino-cli 1.6.0; upload, serial readback, two boards open |
| `ble-tools` | 0.2.1 | real Bleak 3.1.0 and one passive scan; read/notify/write, pairing, BlueZ open |
| `can-python` | 0.2.2 | real python-can on a udp_multicast bus on Windows; real adapters and vcan0 open |
| `circuitpython` | 0.2.2 | real circup 3.1.0 on simulated volumes; real board and bundle download open |
| `esp32-efuse` | 0.2.1 | real esptool 5.6.0 against virtual eFuses; real chip open (never burnt) |
| `esp32-esptool` | 0.2.2 | real esptool 5.6.0 provisioned and run; identify/flash on real ESP32 boards open |
| `gdb-debug` | 0.2.1 | real xPack GDB and OpenOCD without a probe; probe and board open |
| `hil-testing` | 0.2.1 | real helper processes and runner; real board and probe open |
| `lab-validation` | 0.3.1 | real runner and uv provisioning; a real capture of a real circuit open |
| `microchip-pymcuprog` | 0.2.0 | real pymcuprog: hex conversion, failed ping on a missing port; UPDI board open |
| `micropython` | 0.2.2 | real mpremote 1.29.0 against a simulated board; real board open |
| `mqtt-tools` | 0.2.3 | real paho-mqtt 2.1.0 against the local TLS test broker; product broker and device open |
| `platformio` | 0.2.2 | real PlatformIO 6.2.0 builds, host tests, Renode device tests; board upload open |
| `power-profiler` | 0.2.2 | real pyjoulescope_driver 2.5.5 without a meter; JS220 and board open |
| `probe-rs` | 0.3.0 | real probe-rs CLI offline; Nucleo, RP2040 and ESP32-C3 probes, RTT open |
| `raspberry-pi-linux` | 0.2.1 | real asyncssh 2.24.1 against an SSH test server in WSL; a Raspberry Pi open |
| `scpi-instruments` | 0.2.1 | real PyVISA 1.16.2 + pyvisa-py against simulated servers; real instruments open |
| `serial-monitor` | 0.2.2 | real pyserial through the real provisioner and runner; real-board capture open |
| `sigrok` | 0.2.0 | real pinned sigrok-cli 0.8.0 installed from the verified archive; ATK-DL16/Hantek captures open |
| `stm32-cubeprog` | 0.2.1 | real STM32CubeProgrammer 2.23.0 CLI without a board; Nucleo open |
| `wokwi` | 0.2.1 | real wokwi-cli 0.29.1 offline; a cloud run open (no token) |
| `zephyr` | 0.2.2 | real Zephyr 4.4.2 + SDK builds, Twister, ztest on Renode; board flash open |
| `bus-tools` | 0.1.1 | only a simulated BPIO2 adapter; real Bus Pirate, I2C/SPI fixtures open |
| `esp32-idf` | 0.1.0 | EIM transport only; no ESP-IDF installation or board found, real build/flash/panic open |
| `electrical-network` | 0.1.0 | offline engine and fixture tests only; real projects and native Ubuntu open |
| `industrial-catalog` | 0.1.0 | offline engine and fixture tests only; real projects and native Ubuntu open |
| `lighting-design` | 0.1.0 | offline engine and fixture tests only; real projects and native Ubuntu open |
| `motor-drives` | 0.1.0 | offline engine and fixture tests only; real projects and native Ubuntu open |
| `power-quality-pfc` | 0.1.1 | offline engine and fixture tests only; real projects and native Ubuntu open |
| `protection-coordination` | 0.1.0 | offline engine and fixture tests only; real projects and native Ubuntu open |
