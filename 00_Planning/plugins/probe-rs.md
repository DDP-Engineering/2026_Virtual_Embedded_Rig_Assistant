# Plugin `probe-rs` — vendor-neutral flashing, memory access and RTT logs

PURPOSE: specify the official `probe-rs` plugin, which gives the agent one debug-probe tool for
ARM Cortex-M and RISC-V microcontrollers from many vendors: identify the target, flash and verify,
reset, read memory and stream RTT logs.
DONE-WHEN: on Windows x64 and Linux x64 the agent identifies, flashes, verifies and resets an STM32
Nucleo (ST-Link), an RP2040 (CMSIS-DAP) and an ESP32-C3 (built-in USB-JTAG), reads a peripheral
register and streams RTT output in a background run.
STATUS: proposed 2026-11-01; not implemented. Plugin format and rules: [architecture.md](architecture.md).
Work package: PLG-19 in [plan.md](plan.md).

## 1. Why this plugin

One plugin replaces most vendor flashers for everyday work. probe-rs supports CMSIS-DAP, ST-Link,
SEGGER J-Link, FTDI (FT232H, FT2232, FT4232; for example ESP-Prog), the ESP32 built-in USB-JTAG,
WCH-Link and the Glasgow Interface Explorer, plus Linux GPIO/SPI SWD on a Raspberry Pi. It reads
target descriptions from CMSIS packs, so new chips arrive with probe-rs releases rather than VERA
releases. Vendor plugins keep only what probe-rs cannot do, for example STM32 option bytes
(`stm32-cubeprog`).

## 2. Provisioning

| Platform | Install kind | Artifact (release v0.32.0, 2026-07-22) |
|---|---|---|
| `windows-x64` | `download` (zip) | `probe-rs-tools-x86_64-pc-windows-msvc.zip` |
| `linux-x64` | `download` (tar.xz) | `probe-rs-tools-x86_64-unknown-linux-gnu.tar.xz` |
| `linux-arm64` | `download` (tar.xz) | `probe-rs-tools-aarch64-unknown-linux-gnu.tar.xz` |

- Source: `https://github.com/probe-rs/probe-rs/releases/download/v0.32.0/<artifact>`. The release
  publishes `.sha256` files; the manifest pins those values. The official installer scripts write to
  `~/.cargo/bin` and are not used.
- Fallback: `find` an existing `probe-rs` on `PATH` or in `~/.cargo/bin` (from `cargo install` or the
  installer), with the version probe `probe-rs --version`.

## 3. Device access (user steps, shown as hints)

| Platform | Step |
|---|---|
| Linux / Raspberry Pi | install `69-probe-rs.rules` from probe.rs into `/etc/udev/rules.d/`, `udevadm control --reload && udevadm trigger`, join `plugdev` (a system group on systemd ≥ 258). Since 0.32.0 inaccessible probes are listed as such. |
| Windows | CMSIS-DAP: no driver. ST-Link: the official ST driver (STSW-LINK009). J-Link: switch to WinUSB in J-Link Configurator, or Zadig. FTDI: WinUSB via Zadig (the VCP/D2xx drivers do not work). ESP32 USB-JTAG: normally no driver; Zadig if `DeviceInterfaceGUIDs` is missing. |

## 4. Manifest

```yaml
format: 1
id: probe-rs
version: 1.0.0
name: probe-rs
description: Flash, verify, reset, read memory and stream RTT logs on ARM Cortex-M and RISC-V microcontrollers through CMSIS-DAP, ST-Link, J-Link, FTDI, WCH-Link or ESP32 USB-JTAG probes.
ecosystem: general
platforms: [windows-x64, linux-x64, linux-arm64]
programs:
  probe-rs:
    install:
      download:
        windows-x64: { url: ".../v0.32.0/probe-rs-tools-x86_64-pc-windows-msvc.zip", sha256: "…", path: "…/probe-rs.exe" }
        linux-x64:   { url: ".../v0.32.0/probe-rs-tools-x86_64-unknown-linux-gnu.tar.xz", sha256: "…", path: "…/probe-rs" }
        linux-arm64: { url: ".../v0.32.0/probe-rs-tools-aarch64-unknown-linux-gnu.tar.xz", sha256: "…", path: "…/probe-rs" }
    version: { args: [--version], match: 'probe-rs (\d+\.\d+\.\d+)' }
    timeout: 120
rules:
  - { match: "probe-rs {--version,help} *", risk: safe }
  - { match: "probe-rs chip *", risk: safe, note: Lists or describes supported targets; no hardware. }
  - { match: "probe-rs list *", risk: safe, note: Lists attached probes without connecting to a target. }
  - { match: "probe-rs {info,mi,read,verify,attach,profile,trace} *", risk: device-read, note: Connects to the target; may halt it briefly. }
  - { match: "probe-rs reset *", risk: device-read, note: Resets the target; stored firmware is unchanged. }
  - { match: "probe-rs {download,run,erase,benchmark} *", risk: device-write, note: Overwrites flash or RAM on the target. }
  - match: "probe-rs write *"
    risk: irreversible
    note: Writes arbitrary memory. A write to a flash controller or option register can enable permanent read protection, and a write to a GPIO register drives pins.
  - { match: "probe-rs {debug,gdb,dap-server,serve,complete} *", risk: blocked, note: Interactive, opens a server or changes shell configuration. }
  - { match: "probe-rs * --host *", risk: blocked, note: Remote probe servers are not supported by this plugin. }
```

- `run` and `attach` stream RTT until stopped: they run with `background: true`; the agent reads
  with `program_output { until }` and ends with `program_stop`.
- Blocked commands also cover interactive REPLs that would hang with stdin closed.
- `--chip` names come from `probe-rs chip list` (long output: the skill filters by family with
  `chip info <name>`) or from `probe-rs info`, which auto-detects since 0.32.0.

## 5. Skills

| Skill | Covers |
|---|---|
| `probe-rs-connect` | `list`, `info`, choosing `--probe` and `--chip`, protocol and speed, connect-under-reset; platform hints for permissions |
| `probe-rs-flash` | `download` + `verify` + `reset` with the ELF from the build (never a guessed address); report the image hash from the approval |
| `probe-rs-rtt` | background `attach`/`run`, waiting for a log pattern, stopping cleanly |
| `probe-rs-inspect` | `read` of peripheral registers and RAM, decoded with `decode_register` (CAP-02) and an SVD-derived definition; stacked PC/LR after a HardFault, passed to `binutils` `addr2line` |

## 6. Verification

- Matcher tests for every rule row, including `write` as `irreversible` and `serve`/`--host` as
  `blocked`.
- Bench smoke on Windows and Linux: STM32 Nucleo (ST-Link), RP2040 (CMSIS-DAP), ESP32-C3 (USB-JTAG):
  identify, flash, verify, reset, register read, RTT stream started and stopped from a background run.

NOTES:
- Verify while implementing: archive layouts and executable paths inside each release archive; the
  `read`/`write` word-size syntax and output formats (default `hex-table` since 0.32.0); that `attach`
  keeps streaming with stdin closed (0.32.0 added an RTT input prompt); Xtensa (ESP32, ESP32-S3)
  coverage, which decides whether `esp32-openocd` stays.
- Sources: probe.rs/docs/tools/probe-rs, probe.rs/docs/getting-started/probe-setup, GitHub releases
  of probe-rs/probe-rs (v0.32.0), read 2026-11-01.
