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
STATE: PLG-01 implemented 2026-11-15 (AEGIS TASK-1cebbbdd); PLG-02 implemented 2026-11-15 (AEGIS TASK-e937e9e6); PLG-03 implemented 2026-11-15 (AEGIS TASK-f1dfd67e); PLG-04 implemented 2026-11-15 (AEGIS TASK-f84206e4); PLG-05 implemented 2026-11-15 (AEGIS TASK-41f54714); PLG-06 implemented 2026-11-15 (AEGIS TASK-d4d70d39); PLG-07 implemented 2026-11-15 (AEGIS TASK-2b84817f), publishing open; PLG-08 implemented 2026-11-15 (AEGIS TASK-3b46b9a6, TASK-a793c9bd); kits built without sigrok.

## Order

| Order | Package | Issue | Result | State |
|---|---|---|---|---|
| 1 | PLG-01 | [#262](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/262) | Pre-release badge and filter derived from semver; official plugins set to their evidence-based version (table below) | implemented |
| 2 | PLG-02 | [#263](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/263) | manifest `summary`; pre-install card with name, version, type, summary, platform and risk warnings | implemented |
| 3 | PLG-03 | [#264](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/264) | composition (programs, scripts, skills, profiles, documents) and operations by risk on the plugin page | implemented |
| 4 | PLG-04 | [#265](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/265) | dependency summary in the catalog index; install with dependencies (required plugins too); re-install | implemented |
| 5 | PLG-05 | [#266](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/266) | manifest `settings`; Parts search, MQTT and Wokwi move from App settings to their plugins; configured state | implemented |
| 6 | PLG-06 | [#267](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/267) | one status block (dependencies, configuration, use) and pack install from the catalog | implemented |
| 7 | PLG-07 | [#268](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/268) | catalog release from `07_Delivery/plugins/`, signed index, stable and pre-release channels | implemented (publishing open) |
| 8 | PLG-08 | [#269](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/269) | offline kit per platform of pinned pip and download dependencies | implemented |

Each package builds on the page parts of the previous one. PLG-07 and PLG-08 touch delivery only.

## PLG-01 #262 - official plugin versions from their evidence

Maturity comes from the version alone (shared `pluginMaturity`): `0.x.y` or a semver pre-release tag is
pre-release. `1.0.0` needs real-tool proof and, for a plugin that drives hardware or a cloud service, real-hardware
proof on every declared platform. Otherwise one value per evidence level:

- `0.3.0` - every Windows proof exists and no hardware is needed; native Ubuntu x64 is open.
- `0.2.0` - the real third-party tool ran on Windows; real hardware or cloud and native Ubuntu x64 are open.
- `0.1.0` - offline evidence only (simulated devices or tools); the real tool, hardware and native Ubuntu x64 are open.

No plugin has a native-Ubuntu run (WSL2 evidence does not count). Sources: the open proofs in
[README.md](README.md), [../plugins/plan.md](../plugins/plan.md) and `.agentic/knowledge/official-plugins.md` (2026-11-14). A plugin moves up
when its open proof is recorded there. A plugin's bundled helper programs print the same version
(`--version`, result records). Installed copies at the old 1.0.0 meet the catalog's downgrade refusal: uninstall and reinstall.

| Plugin | Version | Evidence and what is open |
|---|---|---|
| `ltspice` | 1.0.0 | Windows-only by scope; real LTspice 26.1.1 on Windows 11, nothing open (ELEC-05) |
| `analysis-skills` | 0.3.0 | skills only, no programs or hardware; folder/catalog install and CLI replay on Windows |
| `binutils` | 0.3.0 | real xPack toolchains and genuine fixture ELFs on Windows; no hardware |
| `can-dbc` | 0.3.1 | real cantools decoding on Windows; no hardware |
| `electronics-calc` | 0.3.1 | real uv provisioner run on Windows 11 (ELEC-01); no hardware |
| `freerouting` | 0.3.0 | real Freerouting 2.5.0 + KiCad 10.0.8 on Windows 11 (ELEC-07); no hardware |
| `git` | 0.3.0 | real Git for Windows (and WSL2) fixture receipts; no hardware |
| `kicad` | 0.3.1 | real KiCad 10.0.8 on Windows 11 (ELEC-02); no hardware |
| `kicad-layout` | 0.3.1 | real KiCad 10.0.8 PCB editor on Windows 11 (ELEC-06); no hardware |
| `ngspice` | 0.3.1 | real ngspice-47 on Windows 11 (ELEC-04); no hardware |
| `parts-search` | 0.3.1 | real uv run on Windows 11 (ELEC-03); no hardware |
| `renode` | 0.3.0 | real Renode 1.17.0 on Windows 11 (LAB-06); virtual boards, no hardware |
| `wireshark-tshark` | 0.3.0 | real TShark replay and a live loopback capture on Windows/Npcap; Linux unverified |
| `arduino-cli` | 0.2.1 | real compiles with arduino-cli 1.6.0 (IOT-01); upload, serial readback, two boards open |
| `ble-tools` | 0.2.0 | real Bleak 3.1.0 and one passive scan (IOT-06); read/notify/write, pairing, BlueZ open |
| `can-python` | 0.2.1 | real python-can on a udp_multicast bus on Windows; real adapters and vcan0 open |
| `circuitpython` | 0.2.1 | real circup 3.1.0 on simulated volumes (IOT-03); real board and bundle download open |
| `esp32-efuse` | 0.2.0 | real esptool 5.6.0 against virtual eFuses; real chip open (never burnt) |
| `esp32-esptool` | 0.2.1 | real esptool 5.6.0 provisioned and run; identify/flash on real ESP32 boards open |
| `gdb-debug` | 0.2.1 | real xPack GDB and OpenOCD without a probe (LAB-04); probe and board open |
| `hil-testing` | 0.2.1 | real helper processes and runner (LAB-07); real board and probe open |
| `lab-validation` | 0.3.1 | real runner and uv provisioning (LAB-02); a real capture of a real circuit open |
| `microchip-pymcuprog` | 0.2.0 | real pymcuprog: hex conversion, failed ping on a missing port; UPDI board open |
| `micropython` | 0.2.1 | real mpremote 1.29.0 against a simulated board (IOT-02); real board open |
| `mqtt-tools` | 0.2.1 | real paho-mqtt 2.1.0 against the local TLS test broker (IOT-05); product broker and device open |
| `platformio` | 0.2.1 | real PlatformIO 6.2.0 builds, host tests, Renode device tests (LAB-08); board upload open |
| `power-profiler` | 0.2.1 | real pyjoulescope_driver 2.5.5 without a meter (LAB-05); JS220 and board open |
| `probe-rs` | 0.2.0 | real probe-rs CLI offline; Nucleo, RP2040 and ESP32-C3 probes, RTT open |
| `raspberry-pi-linux` | 0.2.0 | real asyncssh 2.24.1 against an SSH test server in WSL (IOT-08); a Raspberry Pi open |
| `scpi-instruments` | 0.2.1 | real PyVISA 1.16.2 + pyvisa-py against simulated servers (LAB-01); real instruments open |
| `serial-monitor` | 0.2.0 | real pyserial through the real provisioner and runner; real-board capture open |
| `sigrok` | 0.2.0 | real pinned sigrok-cli 0.8.0 installed from the verified archive; ATK-DL16/Hantek captures open |
| `stm32-cubeprog` | 0.2.1 | real STM32CubeProgrammer 2.23.0 CLI without a board; Nucleo open |
| `wokwi` | 0.2.0 | real wokwi-cli 0.29.1 offline (IOT-07); a cloud run open (no token, user decision) |
| `zephyr` | 0.2.1 | real Zephyr 4.4.2 + SDK builds, Twister, ztest on Renode (LAB-07); board flash open |
| `bus-tools` | 0.1.0 | only a simulated BPIO2 adapter (IOT-04); real Bus Pirate, I2C/SPI fixtures open |
| `esp32-idf` | 0.1.0 | EIM transport only; no ESP-IDF installation or board found, real build/flash/panic open |

## PLG-04 #265 - dependencies before and after install

`vera catalog build` writes `dependencies` per index entry from the manifest (shared `pluginDependencies`); manifest
download entries carry an optional `bytes` (44 of the 47 official downloads; sigrok's three pinned DDP packages are
unpublished, so their size stays unknown until they are). The catalog card's details list required plugins and each
program as automatic (VERA's program folder) or manual (range, vendor guide). Install with dependencies installs the
plugin, its required plugins and their pip, script and download programs, then shows what is not ready with Check
again. Re-install fetches VERA's copies again against their SHA-256; find programs are never installed.

## PLG-05 #266 - declared parameters and per-plugin configuration

plugin.yaml `settings` (format 1, optional) declares each parameter: `secret` with a credential scope (mqtt, wokwi,
parts), `workbench-file` with a workbench-relative path (`*` = one folder level), optional `format` and `optional`, or
a read-only `value`. Declared by mqtt-tools, wokwi and parts-search (secrets), bus-tools, ble-tools, scpi-instruments,
power-profiler and raspberry-pi-linux (required `lab/resources.json`), gdb-debug, platformio and zephyr (optional
`lab/resources.json`, probes only) and raspberry-pi-linux (optional `*/vera-pi.json`, SSH agent value). The plugin
page's Configuration section shows each state for the open workbench and holds the MQTT credentials, Wokwi tokens and
parts search forms; App settings has no such pages. A missing secret or a missing required or invalid file marks the
plugin Needs configuration and names the parameter.

## PLG-06 #267 - status block and pack install

Each installed plugin card shows one status block: Dependencies (ready, missing, unavailable, external, not checked;
Check, Install, Re-install), Configuration (Configure opens the Configuration section) and Use (enabled in the open
workbench; Open workbench opens its editor, or the folder chooser when none is open). It says Ready only when all three
are ready and otherwise names the rest; it replaces the header summary and the attention line. Install a pack picks a
pack and its groups (defaults from the index), shows one review of every plugin with its dependencies and risk, lists
what is left out (another platform, not in the catalog, requires a left-out plugin), then installs and provisions each
plugin without a per-plugin review screen. Only the open workbench's enablement is shown.

## PLG-07 #268 - signed catalog release and channels

`npm run prepare:plugins` writes the catalog release into `07_Delivery/plugins/` as one flat folder: one zip per
plugin, `index.json` (bundled, every official plugin), `index-stable.json` (version `1.0.0` and higher; today only
ltspice) and `index-pre-release.json` (every plugin). Release assets have no folders, so the two channels are two
index files, not two folders. `vera catalog sign` writes a detached Ed25519 `<index>.sig` for each channel index, and
`vera catalog keygen` creates a key pair. The desktop build pins the public key
`02_Tools/release/catalog-signing-key.pub.pem` (build input `VERA_PLUGIN_CATALOG_KEY`). The private key stays
outside the repository. A remote index without a signature is refused as `unsigned`, and one that does not verify
is refused as `untrusted`; the bundled release stands in and needs no signature. The Plugins page catalog settings
choose the channel (Stable by default). Update checks keep their 24 h rhythm. The procedure is
`02_Tools/release/catalog-release.md`. Open: the hosted https release and the default `VERA_PLUGIN_CATALOG_URL`,
waiting for the user's go-ahead.

## PLG-08 #269 - offline dependency kit per platform

`vera catalog kit --source plugins --platform <windows-x64|linux-x64> --out ../07_Delivery/kit-<platform>` builds
a kit next to the catalog release. It holds, for the official plugins of that platform:

- the pinned download files at `files/<sha256>/<name>`, checked against the manifest SHA-256 and size;
- the wheels of every pip and script program in `wheels/`, resolved for CPython 3.13 with the platform's
  markers by the pinned uv and downloaded by pip with `--require-hashes`;
- the CPython archive that uv installs, in `python/`;
- `kit.json` and a `README.md` with the size and the vendor (find) programs and their download pages.

A failed build leaves no kit. On the bench, the setting `plugins.kit` (settings.json) points Install dependencies
at the kit. Download files go through the same verification as Install from dependency archive, so trust stays with
the manifest hashes, and a changed file is refused and named. uv installs only from the kit's wheels and Python.

Wheels carry no manifest hash. The kit's wheel folder has the trust of the package index the user configures, and
CPython is checked by uv's built-in SHA-256. Hash-pinned wheels (uv lock files per script) are a possible follow-up.
Source-only packages are built into wheels during the kit build. `uptime` (can-python) compiles code, so each kit
is built on its own platform.

Built 2026-11-15 with `--skip sigrok`, whose package is not published:
- `kit-windows-x64`: 9 downloads, 106 wheels and CPython, 1178.0 MiB;
- `kit-linux-x64`: 8 downloads, 97 wheels and CPython, 1095.5 MiB, built on Linux.

Offline installs from them made every managed program of the official plugins ready: 52 on Windows and 50 on WSL2
Ubuntu, with CPython installed from the kit.

Open: sigrok (its package is not published), and a native Ubuntu run.

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
- Every new UI text in en/ro/de/fr; Windows x64 and native Ubuntu x64 (WSL2 stands in where no native Ubuntu
  host exists, recorded as such).
