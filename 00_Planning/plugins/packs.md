# Plugins — ecosystem packs

PURPOSE: what each ecosystem pack contains, which external program each plugin wraps and at which
risk level its commands run. Format and rules: [architecture.md](architecture.md).
DONE-WHEN: the ESP32 pack of §1 is published as `official` (PLG-08…PLG-11); the other packs have a
named first plugin to seed them.
STATUS: proposed 2026-11-01. Program facts checked against Espressif documentation in October and
November 2026; the plugin owner rechecks them when writing the manifest.

## 1. ESP32 (Espressif)

### 1.1 Tool map

| Area | Programs | Plugin | Risk of typical commands |
|---|---|---|---|
| Ports and console | pyserial (in a plugin script) | `serial-monitor` | list: `safe`; capture, reset by DTR/RTS: `device-read`; write a line: `device-write` |
| Flashing and chip info | esptool v5 (`chip-id`, `read-mac`, `flash-id`, `read-flash`, `verify-flash`, `write-flash`, `erase-flash`, `erase-region`, `merge-bin`, `image-info`, `elf2image`) | `esp32-esptool` | see the canonical example in architecture §2.1 |
| Build and project | ESP-IDF `idf.py` through EIM (`set-target`, `build`, `size*`, `fullclean`, `flash`, `erase-flash`, `app-flash`, `coredump-info`), component manager | `esp32-idf` | build, size, set-target: `safe`; flash, erase: `device-write`; coredump-info: `device-read`; `monitor`, `menuconfig`: `blocked` |
| Crash analysis | toolchain `addr2line` (from EIM), `esp-coredump` | `esp32-idf` (programs `xtensa-addr2line`, `riscv-addr2line`) | `safe` |
| Partitions and data images | `parttool.py`, `gen_esp32part.py`, `otatool.py`, `nvs_partition_gen`, `spiffsgen.py` / `mklittlefs` | `esp32-idf` | generate: `safe`; write to the chip: `device-write` |
| eFuses and secure boot | `espefuse` (`summary`, `dump`, `burn-efuse`, `burn-key`, `burn-block-data`, `write-protect-efuse`, `read-protect-efuse`, `set-flash-voltage`), `espsecure` | `esp32-efuse` (off by default) | summary, dump: `device-read`; every `burn-*`, `*-protect-*`, `set-flash-voltage`: `irreversible`; `espsecure` key generation and signing: `safe` |
| JTAG debug | OpenOCD-esp32 (portable download), GDB batch mode | `esp32-openocd` | server start, read registers: `device-read`; `program_esp`, flash writes: `device-write` |
| Emulation and tests | Espressif QEMU (`idf.py qemu`), Wokwi CLI, pytest-embedded | `esp32-qemu` | `safe` |
| Alternative stacks | Arduino CLI with arduino-esp32, PlatformIO, espflash / espup (Rust), MicroPython `mpremote` | community candidates | as esptool |

Not wrappable: Flash Download Tool (Windows GUI only). Not needed in the first release: Espressif's
`idf.py mcp-server`, since `idf.py` covers the same four actions (architecture §11).

USB identifiers used by `serial-monitor` to name the board family:

| VID:PID | Bridge |
|---|---|
| `303A:*` | Espressif native USB (USB-Serial-JTAG on S3, C3, C6, H2; USB-OTG CDC on S2, S3) |
| `10C4:EA60` | Silicon Labs CP210x |
| `1A86:7523`, `1A86:55D4` | WCH CH340, CH343 |
| `0403:6001`, `0403:6010`, `0403:6014` | FTDI (ESP-Prog uses `6010`) |

### 1.2 Plugins of the pack

| Group | Plugin | Install kind | Default |
|---|---|---|---|
| Core | `serial-monitor` | `script` (`scripts/serial.py`, pyserial) | on |
| Core | `esp32-esptool` | `pip: esptool>=5,<6` | on |
| ESP-IDF build | `esp32-idf` | `find` EIM and ESP-IDF ≥ 5.4; `hint` links the EIM installer | on |
| JTAG debug | `esp32-openocd` | `download` OpenOCD-esp32 release per platform | off |
| Emulation | `esp32-qemu` | through EIM (`idf.py qemu`) | off |
| Security (irreversible) | `esp32-efuse` | `pip: esptool>=5,<6` (provides `espefuse`, `espsecure`) | off |

### 1.3 Excerpts

`esp32-idf`: a vendor program behind a launcher, with a blocked interactive subcommand.

```yaml
programs:
  idf.py:
    launcher: [eim, run]
    install:
      find: { windows: ["%USERPROFILE%/.espressif/tools/eim/eim.exe"], linux: ["~/.espressif/tools/eim/eim"] }
      hint: Install ESP-IDF with the ESP-IDF Installation Manager (EIM), then press Detect again.
    version: { args: [--version], match: 'v(\d+\.\d+(?:\.\d+)?)' }
    timeout: 1200
rules:
  - { match: "idf.py * {set-target,build,size,size-components,size-files,fullclean,reconfigure} *", risk: safe }
  - { match: "idf.py * coredump-info *", risk: device-read, note: Reads the core dump partition from the chip. }
  - { match: "idf.py * {flash,app-flash,erase-flash,erase-otadata} *", risk: device-write, note: Overwrites firmware on the chip. }
  - { match: "idf.py * {efuse-*,secure-*} *", risk: irreversible, note: Uses espefuse or espsecure on the chip. }
  - { match: "idf.py * {monitor,menuconfig,gdb,gdbtui} *", risk: blocked, note: Interactive. Use serial-monitor, or edit sdkconfig.defaults. }
```

`esp32-efuse`: irreversible rules.

```yaml
rules:
  - { match: "espefuse * {summary,dump,check-error,get-custom-mac,adc-info} *", risk: device-read, note: Resets the chip into its bootloader. }
  - { match: "espefuse * {burn-*,write-protect-efuse,read-protect-efuse,set-flash-voltage} *", risk: irreversible, note: eFuse bits are one-time programmable. The change can never be undone and may brick the chip. }
  - { match: "espsecure *", risk: safe, note: Works on local key and image files only. }
```

Tests run irreversible paths with `espefuse --virt` (virtual eFuses, no chip) wherever the
installed version supports it.

### 1.4 Skills of the pack

| Skill | Plugin | Covers |
|---|---|---|
| `esp32-identify` | `serial-monitor` | list ports, map VID:PID to a family, confirm the chip with `esptool chip-id`, record it in the conversation |
| `esp32-flash` | `esp32-esptool` | choose images and offsets from `build/flasher_args.json`, flash, verify, reset, capture the boot log |
| `esp32-build-fix` | `esp32-idf` | build, read compiler diagnostics from the log, edit, rebuild; never edits `sdkconfig` directly |
| `esp32-panic` | `esp32-idf` | capture a Guru Meditation, decode the backtrace with the matching `addr2line` and ELF, read the core dump |
| `esp32-efuse-review` | `esp32-efuse` | read `summary`, explain each requested burn, refuse to batch burns, require a written plan in an artifact before any irreversible call |

## 2. CAN

| Plugin | Programs | Risk |
|---|---|---|
| `can-python` | script on python-can: list interfaces; capture N seconds listen-only to ASC/BLF; replay | list: `safe`; capture: `device-read`; **any transmit or replay: `irreversible`** (actuation on a live bus) |
| `can-dbc` | `cantools` (`pip`): decode, dump, convert | `safe` |
| `can-utils` (Linux) | `candump`, `cansend`, `cangen` (`find`) | `candump`: `device-read`; `cansend`, `cangen`: `irreversible` |

Backends: PCAN (PEAK driver), Vector XL, Kvaser CANlib, slcan (serial), gs_usb/candleLight
(libusb), SocketCAN on Linux. Vendor drivers are `find` + `hint` steps, never bundled.

## 3. Wireshark

| Plugin | Programs | Risk |
|---|---|---|
| `wireshark-tshark` | `tshark` (`find`): read and filter captures, fields export, statistics | `-r`: `safe`; live capture `-i`: `device-read` (listens on an interface) |

Live capture needs Npcap on Windows (installed with Wireshark) and `dumpcap` permissions on Linux.
Both are user steps. Community MCP servers for tshark exist (`wireshark-mcp`, `mcp-wireshark`);
they are candidates for the deferred MCP path, not a requirement.

## 4. Microchip

| Plugin | Programs | Risk |
|---|---|---|
| `microchip-pymcuprog` | `pymcuprog` (`pip`): ping, read, write, erase over UPDI, PICkit 4/5, nEDBG | ping, read: `device-read`; write, erase: `device-write`; fuse or config-word writes that enable code protection or lock bits: `irreversible` |
| `microchip-avrdude` | `avrdude` (`find`) | same split; `-U lock:` and fuse writes: `irreversible` |
| `microchip-mplab` | MPLAB X IPE `ipecmd`, MDB (`find` in the MPLAB X install) | program: `device-write`; code protect: `irreversible` |

## 5. STM32

| Plugin | Programs | Risk |
|---|---|---|
| `stm32-cubeprog` | `STM32_Programmer_CLI` (`find`) | `-r`, `-ob displ`: `device-read`; `-w`, `-e`: `device-write`; any option-byte write (`-ob`), above all `RDP=0xCC` (level 2, permanent): `irreversible` |
| `stm32-openocd` | OpenOCD (`download` or `find`) | as `esp32-openocd` |

NOTES:
- Exact subcommand spellings, defaults and version ranges belong in each plugin's manifest and are
  checked by its owner against the installed tool's `--help` before publishing.
- Linux steps for serial, USB JTAG, SocketCAN and capture permissions: architecture §9.
