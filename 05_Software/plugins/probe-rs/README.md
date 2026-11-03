# probe-rs

Local vendor-neutral debug-probe operations with probe-rs **0.32.0**. Install this folder or the
official catalog package, enable it in the workbench, and explicitly choose **Install programs**
when needed. Four skills cover connection, exact-build flashing, RTT and register/fault inspection.

## Sources and installation

The existing provisioner tries PATH first, then `~/.cargo/bin`. A found executable is version-probed
with `--version`; only `==0.32.0` is accepted. An unsupported found version reports unavailable
(`range`) and takes precedence over a cached download: fix PATH/the user installation to continue.
If neither location contains the program, the explicit install action downloads the portable archive
below into VERA's plugin runtime and checks its SHA-256 before extraction. Status/resolve/run never
download. VERA does not run the upstream installer or write to `~/.cargo/bin`.

All assets are from [release v0.32.0](https://github.com/probe-rs/probe-rs/releases/tag/v0.32.0),
published 2026-07-22. Each digest below was compared to that asset's published `.sha256` file and
to the actual downloaded bytes on 2026-11-03.

| Platform | Release asset | Executable member | SHA-256 |
|---|---|---|---|
| windows-x64 | probe-rs-tools-x86_64-pc-windows-msvc.zip | probe-rs.exe | `56fc0564cc23d604b27dc2d57606194159c49f951999f3e47bd2cbffcba64103` |
| linux-x64 | probe-rs-tools-x86_64-unknown-linux-gnu.tar.xz | probe-rs-tools-x86_64-unknown-linux-gnu/probe-rs | `c2ccc46049e52a5d403ef212078cd637ecda55b662708327960558f83e851ff5` |
| linux-arm64 | probe-rs-tools-aarch64-unknown-linux-gnu.tar.xz | probe-rs-tools-aarch64-unknown-linux-gnu/probe-rs | `7c818cfd77808e806bf8f4d108c9137910b4fb28e0fe5c464d39782dbbc8af31` |

Windows archive members are at the zip root; Linux archives have their named root folder. The
Linux binaries are ELF64 x86-64 and AArch64 respectively, with executable permission. ARM64 bytes,
hash and member/header are inspected; execution requires an ARM64 host. No ARM64 execution is claimed.

## Risk matrix

| Commands/tokens | Risk | Effect |
|---|---|---|
| --version/-V, --help/-h, help; chip; list | safe | Help/target registry/probe enumeration |
| info, mi, read, verify, attach, profile, trace | device-read | Connects; may halt target |
| reset | device-read | Resets target; firmware unchanged |
| download, run, erase, benchmark | device-write | Overwrites target flash/RAM |
| itm | device-write | Configures target trace hardware; preserves the unmatched hardware-operation floor |
| write | irreversible | Arbitrary memory can affect flash protection/option registers or drive GPIO pins |
| debug, gdb, dap-server, serve, complete | blocked | Interactive/server/shell configuration |
| every --host, including --host=value | blocked | Remote probes unsupported |

Highest risk wins. Patterns permit tokens before the command and match host in every position,
including missing values. A help/version match never lowers a write or blocked match: `help write`
and `write --help` remain irreversible; `help serve` and `list --host=x` remain blocked. Matching
is conservatively token-based: an option value equal to a command may also raise the risk. Every
shipped 0.32.0 command has an explicit rule, including `itm`, so filenames such as `--log-file list`
cannot lower a hardware operation to safe. Other unmatched lines keep the platform's **device-write** default.
`serve`/`--host` are feature-gated out of the shipped upstream binary, but remain blocked for found
builds with that feature. The irreversible confirmation word is `write`; no tests perform real writes.

## Measured CLI and source details

The downloaded Windows CLI reports `probe-rs 0.32.0 (git commit: 48f5e4d)`. Native x64 CLI tests
exercise version, read/write/attach help, local chip descriptions and probe listing through VERA's
real provisioner/runner, using local cached archives for transport. The deterministic replay uses
the real runner and closed stdin with a clearly labelled hardware stand-in; it proves approvals,
changed-ELF refusal and background attach/run output/stop, not real-board operation.

- Memory syntax is `read <b8|b16|b32|b64> <address> <word-count>` and
  `write <b8|b16|b32|b64> <address> [values]...`. Width is bits, count is words.
  `--format` values are `ihex`, `simple-hex`, `hex-table`, `binary`; default **hex-table** prints
  `address: values` rows. The help introduction still describes the old simple-hex default; the
  actual option default and [read.rs](https://github.com/probe-rs/probe-rs/blob/v0.32.0/probe-rs-tools/src/bin/probe-rs/cmd/read.rs)
  agree on hex-table. The write help's RAM-only note is not a safety boundary:
  [write.rs](https://github.com/probe-rs/probe-rs/blob/v0.32.0/probe-rs-tools/src/bin/probe-rs/cmd/write.rs)
  directly calls core memory writes without a RAM-region check. Every write stays irreversible.
- `attach [ELF]` does not flash/reset. Without an ELF RTT symbol, use a known `--scan-region`; no
  region means no RTT polling. `--rtt-scan-memory` was replaced in 0.32.0. `run` flashes and starts.
  Both should use `background: true`, then `program_output {until, waitMs}` and `program_stop`.
- VERA closes stdin and kills the process tree on stop. The
  [0.32.0 monitor UI](https://github.com/probe-rs/probe-rs/blob/v0.32.0/probe-rs-tools/src/bin/probe-rs/util/cli.rs)
  has an output-only mode when no down channels exist. Discovered down channels activate readline:
  readline initialization failure waits for Ctrl+C, `Closed`/I/O error exits the UI, and an EOF
  event cycles channels. Source inspection alone does not prove real closed-stdin down-channel
  streaming; that bench check remains outstanding. A real `attach --dry-run` without hardware
  still failed with "No connected probes were found", so it is not presented as RTT evidence.
- The [Espressif vendor implementation](https://github.com/probe-rs/probe-rs/blob/v0.32.0/probe-rs-espressif/src/lib.rs)
  includes Xtensa ESP32, ESP32-S2 and ESP32-S3 sequences as well as RISC-V ESP32-C3 and others.
  The CLI registry uses names `esp32`, `esp32s3`, `esp32c3` (no inserted hyphens). This makes probe-rs
  a candidate for ordinary Xtensa operations too; it does not establish full parity with
  esp32-openocd or justify removing it. Keep vendor tooling for unverified/vendor-specific needs.

## User-managed device access

Follow [upstream probe setup](https://probe.rs/docs/getting-started/probe-setup/). On Linux the user/admin
installs `69-probe-rs.rules` in `/etc/udev/rules.d/`, reloads/triggers udev and configures `plugdev`
membership. VERA does not install rules/drivers or elevate. On Windows use the official STSW-LINK009
for ST-Link; J-Link Configurator or Zadig for J-Link WinUSB; Zadig WinUSB for FTDI (VCP/D2xx is
insufficient); CMSIS-DAP normally needs no additional driver. ESP32 USB-JTAG normally needs none;
Zadig can remedy a missing DeviceInterfaceGUIDs on the correct interface.

## Acceptance still requiring a bench

No probe was reported by the Windows CLI or Windows USB inventory; Ubuntu WSL exposes no USB bus
in sysfs. These observations do not identify or validate any board. For **each** of Windows x64
and Linux x64, real acceptance still requires STM32 Nucleo/ST-Link, RP2040/CMSIS-DAP and
ESP32-C3/USB-JTAG: identify, flash the matching build ELF, verify, reset, read a documented peripheral
register and start/read/stop background RTT. Include firmware with RTT down channels to settle its
closed-stdin behavior. No eFuse/option-byte/lock-bit write belongs in this check. See TASK-bc643d04.
