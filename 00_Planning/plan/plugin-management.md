# PLG-01...PLG-08 (#262...#269) Plugin management - maturity, plugin page, dependencies, configuration and delivery

PURPOSE: the order and state of the eight packages that make each plugin's maturity, needs, parts,
parameters, operations and state visible on its own entry in the Plugins page, and make the plugin
catalog deliverable as a signed release.
SPEC: Gitea epic [#261](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/261) and its children #262...#269 hold the specification of each work
package (deliverables, Done criteria PLG-0x-A...E); the local copies are
`F:\ProjectsDDP\VERA_Plugin_Management_Plan.md` and `F:\ProjectsDDP\VERA_Plugin_Management_Tickets\`.
This page records only order, state and what was built, so the two never diverge. Where a ticket is
wrong about the code, the code decides.
IDS: the IDs PLG-01...PLG-18 were already used by the first plugin epic (#57...#74). In this initiative an ID
always travels with its issue number: "PLG-01 #262" is this plan, "PLG-01 #57" is the plugin store.
PROCESS: at the user's request (2026-11-14) every child is implemented with AEGIS, in order, on one
branch `feature/261-plugin-management` cut from `master` at 920457e, in the sibling worktree
`F:\2026_Virtual_Embedded_Rig_Assistant_plg`. The implementer hands the candidate back without a commit;
the coordinator checks the evidence and makes one local commit per ticket. Nothing is pushed. Each ticket
runs only its focused tests; the complete suite runs once after PLG-08.
STATE: PLG-01 implemented 2026-11-15 (AEGIS TASK-1cebbbdd); PLG-02 implemented 2026-11-15 (AEGIS TASK-e937e9e6); PLG-03...PLG-08 planned.

## Order

| Order | Package | Issue | Result | State |
|---|---|---|---|---|
| 1 | PLG-01 | [#262](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/262) | Pre-release badge and filter derived from semver; official plugins set to their evidence-based version (table below) | implemented |
| 2 | PLG-02 | [#263](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/263) | manifest `summary`; pre-install card with name, version, type, summary, platform and risk warnings | implemented |
| 3 | PLG-03 | [#264](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/264) | composition (programs, scripts, skills, profiles, documents) and operations by risk on the plugin page | planned |
| 4 | PLG-04 | [#265](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/265) | dependency summary in the catalog index; install with dependencies (required plugins too); re-install | planned |
| 5 | PLG-05 | [#266](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/266) | manifest `settings`; Parts search, MQTT and Wokwi move from App settings to their plugins; configured state | planned |
| 6 | PLG-06 | [#267](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/267) | one status block (dependencies, configuration, use) and pack install from the catalog | planned |
| 7 | PLG-07 | [#268](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/268) | catalog release from `07_Delivery/plugins/`, signed index, stable and pre-release channels | planned |
| 8 | PLG-08 | [#269](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/269) | offline kit per platform of pinned pip and download dependencies | planned |

Each package builds on the page parts of the previous one. PLG-07 and PLG-08 touch delivery only.

## PLG-01 #262 - official plugin versions from their evidence

Maturity comes from the version alone (shared `pluginMaturity`): `0.x.y` or a semver pre-release tag is
pre-release. `1.0.0` needs real-tool proof and, for a plugin that drives hardware or a cloud service, real-hardware
proof on every declared platform. Otherwise one value per evidence level:

- `0.3.0` - every Windows proof exists and no hardware is needed; native Ubuntu x64 is open.
- `0.2.0` - the real third-party tool ran on Windows; real hardware or cloud and native Ubuntu x64 are open.
- `0.1.0` - offline evidence only (simulated devices or tools); the real tool, hardware and native Ubuntu x64 are open.

No plugin has a native-Ubuntu run (WSL2 evidence does not count). Sources: [arduino-iot-acceptance.md](arduino-iot-acceptance.md),
[embedded-lab-acceptance.md](embedded-lab-acceptance.md), [electronics-plugins.md](electronics-plugins.md),
[../plugins/plan.md](../plugins/plan.md) and `.agentic/knowledge/official-plugins.md` (2026-11-14). A plugin moves up
when its open proof is recorded there. A plugin's bundled helper programs print the same version
(`--version`, result records). Installed copies at the old 1.0.0 meet the catalog's downgrade refusal: uninstall and reinstall.

| Plugin | Version | Evidence and what is open |
|---|---|---|
| `ltspice` | 1.0.0 | Windows-only by scope; real LTspice 26.1.1 on Windows 11, nothing open (ELEC-05) |
| `analysis-skills` | 0.3.0 | skills only, no programs or hardware; folder/catalog install and CLI replay on Windows |
| `binutils` | 0.3.0 | real xPack toolchains and genuine fixture ELFs on Windows; no hardware |
| `can-dbc` | 0.3.0 | real cantools decoding on Windows; no hardware |
| `electronics-calc` | 0.3.0 | real uv provisioner run on Windows 11 (ELEC-01); no hardware |
| `freerouting` | 0.3.0 | real Freerouting 2.5.0 + KiCad 10.0.8 on Windows 11 (ELEC-07); no hardware |
| `git` | 0.3.0 | real Git for Windows (and WSL2) fixture receipts; no hardware |
| `kicad` | 0.3.0 | real KiCad 10.0.8 on Windows 11 (ELEC-02); no hardware |
| `kicad-layout` | 0.3.0 | real KiCad 10.0.8 PCB editor on Windows 11 (ELEC-06); no hardware |
| `ngspice` | 0.3.0 | real ngspice-47 on Windows 11 (ELEC-04); no hardware |
| `parts-search` | 0.3.0 | real uv run on Windows 11 (ELEC-03); no hardware |
| `renode` | 0.3.0 | real Renode 1.17.0 on Windows 11 (LAB-06); virtual boards, no hardware |
| `wireshark-tshark` | 0.3.0 | real TShark replay and a live loopback capture on Windows/Npcap; Linux unverified |
| `arduino-cli` | 0.2.0 | real compiles with arduino-cli 1.6.0 (IOT-01); upload, serial readback, two boards open |
| `ble-tools` | 0.2.0 | real Bleak 3.1.0 and one passive scan (IOT-06); read/notify/write, pairing, BlueZ open |
| `can-python` | 0.2.0 | real python-can on a udp_multicast bus on Windows; real adapters and vcan0 open |
| `circuitpython` | 0.2.0 | real circup 3.1.0 on simulated volumes (IOT-03); real board and bundle download open |
| `esp32-efuse` | 0.2.0 | real esptool 5.6.0 against virtual eFuses; real chip open (never burnt) |
| `esp32-esptool` | 0.2.0 | real esptool 5.6.0 provisioned and run; identify/flash on real ESP32 boards open |
| `gdb-debug` | 0.2.0 | real xPack GDB and OpenOCD without a probe (LAB-04); probe and board open |
| `hil-testing` | 0.2.0 | real helper processes and runner (LAB-07); real board and probe open |
| `lab-validation` | 0.2.0 | real runner and uv provisioning (LAB-02); a real capture of a real circuit open |
| `microchip-pymcuprog` | 0.2.0 | real pymcuprog: hex conversion, failed ping on a missing port; UPDI board open |
| `micropython` | 0.2.0 | real mpremote 1.29.0 against a simulated board (IOT-02); real board open |
| `mqtt-tools` | 0.2.0 | real paho-mqtt 2.1.0 against the local TLS test broker (IOT-05); product broker and device open |
| `platformio` | 0.2.0 | real PlatformIO 6.2.0 builds, host tests, Renode device tests (LAB-08); board upload open |
| `power-profiler` | 0.2.0 | real pyjoulescope_driver 2.5.5 without a meter (LAB-05); JS220 and board open |
| `probe-rs` | 0.2.0 | real probe-rs CLI offline; Nucleo, RP2040 and ESP32-C3 probes, RTT open |
| `raspberry-pi-linux` | 0.2.0 | real asyncssh 2.24.1 against an SSH test server in WSL (IOT-08); a Raspberry Pi open |
| `scpi-instruments` | 0.2.0 | real PyVISA 1.16.2 + pyvisa-py against simulated servers (LAB-01); real instruments open |
| `serial-monitor` | 0.2.0 | real pyserial through the real provisioner and runner; real-board capture open |
| `sigrok` | 0.2.0 | real pinned sigrok-cli 0.8.0 installed from the verified archive; ATK-DL16/Hantek captures open |
| `stm32-cubeprog` | 0.2.0 | real STM32CubeProgrammer 2.23.0 CLI without a board; Nucleo open |
| `wokwi` | 0.2.0 | real wokwi-cli 0.29.1 offline (IOT-07); a cloud run open (no token, user decision) |
| `zephyr` | 0.2.0 | real Zephyr 4.4.2 + SDK builds, Twister, ztest on Renode (LAB-07); board flash open |
| `bus-tools` | 0.1.0 | only a simulated BPIO2 adapter (IOT-04); real Bus Pirate, I2C/SPI fixtures open |
| `esp32-idf` | 0.1.0 | EIM transport only; no ESP-IDF installation or board found, real build/flash/panic open |

## Shared rules

- Pre-release rule: no compatibility, migration or format bump; manifests stay `format: 1`; changed fields
  are edited in place in all official plugins. A lowered version meets the catalog's downgrade refusal;
  test machines uninstall and reinstall.
- One source per fact: maturity from the version, operations from `rules`, skills from `SKILL.md`,
  dependencies from `programs` and `requires`, parameters from the new `settings` block.
- Secrets stay in the CredentialStore and reach programs only through the existing stdin hand-off; the page
  shows stored or missing, never the value.
- Automatic install only for pip, script and download programs and for required plugins; `find` programs
  (vendor tools) get detection, the vendor guide and Check again. VERA never installs a vendor program.
- Every new UI text in en/ro/de; Windows x64 and native Ubuntu x64 (WSL2 stands in where no native Ubuntu
  host exists, recorded as such).
