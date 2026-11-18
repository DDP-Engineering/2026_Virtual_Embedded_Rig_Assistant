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
| `wireshark-tshark` | [CAN, network capture and bus transactions](official-plugins-communication.md) |
| `wokwi` | [Virtual boards (Renode and Wokwi)](official-plugins-virtual-boards.md) |
| `zephyr` | [Zephyr and PlatformIO builds](official-plugins-firmware-build.md) |

The platform that installs, classifies, approves and runs these programs (store, provisioner, rules, gate, runner,
serial-port guard, run_program) is [Plugins](plugins.md); plugin skill discovery is [Skills](skills.md).

## Purpose and boundaries

Each folder is an ordinary plugin package in format 1 that the user installs from the folder (`vera plugin
install --path`, IPC `plugins.install`) or from the catalog, and enables per workbench. The folder is also a catalog
source: `packs.yaml` (ESP32, Firmware analysis, Wireshark, CAN, Microchip, STM32, Electronics design and Embedded lab groups, default on except Security), `catalog.yaml` (all packaged plugins
`official`, reviewed low-risk rules for esp32-efuse and stm32-cubeprog, discovery metadata), `CONTRIBUTING.md` and the hosted repository's CI template `.ci/catalog.yml`; `vera
catalog check --source 05_Software/plugins` finds no issue. `npm run prepare:plugins` builds it into the bundled
catalog release `07_Delivery/plugins/` (git-ignored), which packaging ships as `<resources>/plugins/` for
an offline first install. Nothing installs them automatically. A package holds content only: a manifest, PEP 723
scripts that the provisioner runs with the bundled uv, and Markdown skills; a pip program such as esptool comes from
PyPI at install time and is not part of the folder. `requires`: esp32-esptool lists `serial-monitor`; `vera catalog check`
reports a `requires` that names no catalog plugin, and catalog installs review required plugins first, while installs
from a folder or zip ignore it. Platform behaviour such as risk
policy, approvals, timeouts and the serial-port guard is not repeated in the packages.

Each manifest's version records its evidence level (table and reasons in `00_Planning/plan/plugin-management.md`):
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
