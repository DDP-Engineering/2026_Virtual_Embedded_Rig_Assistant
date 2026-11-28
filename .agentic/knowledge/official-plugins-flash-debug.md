# Official plugins: flashing and debug

## Routing

Select for `probe-rs` (local debug probes, flash/memory/RTT/tests/profiling with six skills); `stm32-cubeprog` (find-only
STM32_Programmer_CLI with command-line classification; skills stm32-flash and stm32-option-bytes);
`microchip-pymcuprog` (pip pymcuprog with pymcuprog option-role classification; skills microchip-flash and
microchip-fuses); and `gdb-debug` (programs `gdb-elf` for offline ELF/DWARF inspection and fault re-diagnosis and
`gdb-debug` for finite supervised GDB/OpenOCD sessions on a declared probe; skill debug-sessions).

For gdb-debug, start at plugins/gdb-debug/plugin.yaml (programs `gdb-elf`, `gdb-debug` with `uses` and `resources`,
find-only `arm-none-eabi-gdb` and `openocd`, both blocked), scripts/gdb_elf.py, scripts/gdb_debug.py and
scripts/gdb_support/ (elf.py and dwarf.py the offline reader, cli_elf.py inspect/diagnose, cli_debug.py validation,
tools and release, operations.py the session flow, session.py and mi.py GDB/MI, openocd.py, faults.py, symbols.py,
validate.py, profiles.py with profiles/*.json, registry.py, lifecycle.py, report.py, workspace.py the shared copy) with
spec .agentic/specs/REQ-DATA-d7da2a71.md; tests/plugins/gdb-debug.test.ts and tests/fixtures/gdb-debug/ (fixture
ELFs built by firmware/build.py with zig cc, the GDB/OpenOCD stand-ins fake_gdb.py and fake_openocd.py made executable
by make_tools.py, internals.py unit checks) own its coverage - offline evidence, never a real GDB, OpenOCD or target.
Its probe reservation is the platform's `probe` registry kind, see [Plugin bench resources](plugins-bench-resources.md).

The conventions shared by all official plugins (package format, catalog source, packs, versions and evidence
levels) and the page of every other plugin are in [Official plugins](official-plugins.md). The platform that
installs, classifies, approves and runs these programs is [Plugins](plugins.md); plugin skill discovery is
[Skills](skills.md).

## Public interface

- `probe-rs` 0.3.0, general, Windows x64/Linux x64/Linux arm64: probe-rs exactly 0.32.0,
  PATH then ~/.cargo/bin discovery, explicit user-triggered SHA-256-pinned portable fallback.
  A found unsupported version reports range/unavailable and takes precedence over the download.
  All three official archive hashes/member layouts and Linux host headers are inspected. Six
  skills select probes/chips, flash/verify/restart the exact build ELF in one `download --verify --reset`
  run with approval hashes (and back up the board's firmware first), stream background RTT and catch a
  HardFault or reset with its stack trace, inspect registers with decode_register, run embedded-test
  suites and profile. `probe-rs verify` exits 0 on a mismatch: only its `Verification successful` line
  is a pass, which the HIL step `probe-rs.verify` checks. README carries CLI/source evidence.
  Hardware acceptance on Nucleo/ST-Link, RP2040/CMSIS-DAP and ESP32-C3/USB-JTAG on both systems and
  real RTT with closed stdin/down channels remains outstanding. Replay is explicitly simulated.

- `stm32-cubeprog` 0.2.0, ecosystem `stm32` (STM32 pack, Programming (STM32CubeProgrammer), default on), Windows
  x64/Linux x64: find-only program `stm32_programmer_cli` (program names are lower case; Windows matches the file
  case-insensitively): Windows `%PATH%`, `%ProgramFiles%/STMicroelectronics/STM32Cube/STM32CubeProgrammer/bin`,
  `%SystemDrive%/ST/STM32CubeCLT*` and `STM32CubeIDE_*` plugins; Linux `~/STMicroelectronics/...`,
  `/usr/local/STMicroelectronics/...`, `/opt/st/stm32cubeclt*`, `/opt/st` and `~/st` STM32CubeIDE plugins, then
  `$PATH`, which finds only a lower-case stm32_programmer_cli link; hint with the st.com link (ST account required); `--version` probe
  without range; timeout 600 s; `optionSyntax: stm32cubeprog`. The projection folds every command (case-insensitive,
  exact names, measured on 2.23.0) to its canonical short name and adds `displ`/`<write>` for -ob/-otp/-psrss,
  `<write>` for core-register assignments, `debugauth` for any word starting debugauth except debugauth=2 (anywhere
  on the line), whole numbers (-1, -0x10) as arguments, `<list-only>` for
  board-free listings; a dash word the help does not spell exactly (the CLI accepts extra dashes and trims spaces)
  is `<unknown>` plus every command its name or its parts (split at any non-alphanumeric character) could mean; `word=` is allowed only after `-otp displ`. Rules: help/version/modifiers/host-file tools and `<list-only>` safe;
  connect, reads, verify, resets, core control and displays device-read; writes, erases, fill, go, core writes and
  wireless-stack start/delete device-write; option-byte writes, RDP/TZ regression and locks, OTP, keys, SFI/SSFI/SSP,
  IP modules, FUS upgrade, antirollback, security/default OB, product-state and OB-RSS changes, PMIC, debug
  authentication, HSM licenses and probe power irreversible (typed command; `rdp=0xcc` for an option-byte
  write that sets readout protection level 2); `-script` blocked. catalog.yaml reviews
  the `{-ob,-otp,-psrss} displ` rule for the `otp` token. Tests check every command of the recorded 2.23.0 help.

- `microchip-pymcuprog` 0.2.0, ecosystem `microchip` (Microchip pack, Programming (pymcuprog), default on), Windows
  x64/Linux x64: pip `pymcuprog>=3.19,<4` (probe `pymcuprog version (\d+(?:\.\d+)+)`, range `>=3.19,<4`), timeout
  300 s, `optionSyntax: pymcuprog`. The projection mimics pymcuprog 3.19.4.61's argparse (abbreviations, attached
  short values with one leading `=` dropped as argparse 3.12+ does, grouped short options, last-wins repeats, action anywhere, `-l` lists that run to the next option but take only an attached
  value, `--`) and returns the action (or `<none>`) plus `<info>`, `<protect>`, `<high-voltage>`, `<locked>`,
  `<unknown>`. Rules: help/version/release info and makeuf2 safe; ping/read/verify/reset/voltage reads device-read; write, erase,
  reboot-debugger, locked-device switches and unknown arguments device-write; writes to fuses, lockbits,
  config_words or all (the default memory), every hex-file write and protection-memory erases irreversible
  (typed action); setsupplyvoltage and any -H irreversible. Skills cover ping/flash/verify/read-back and
  single fuse changes. Opt-in VERA_MCU_UV provisions real pymcuprog, converts a hex file and fails a ping on a
  missing port; board acceptance is pending hardware.

- `gdb-debug` 0.2.0, ecosystem `lab` (pack Embedded lab, group Debugging (GDB and OpenOCD), default on; activities
  `debug`, `firmware-analysis`), Windows x64/Linux x64. `gdb-elf inspect <elf>` and `gdb-elf diagnose <run> [--elf]`
  (safe, standard library, no process): SHA-256, class, machine, ARM Tag_CPU_name/arch/profile, float ABI, entry,
  segments, symbol counts, GNU build id, DWARF 2-5 unit versions, producers, languages and the `-O` level when a
  producer records it; diagnose recomputes a saved snapshot's fault and attribution, none for another ELF.
  `gdb-debug tools` (safe; versions, GDB target, `set architecture` support per profile), `snapshot|break|step --probe
  <alias> --elf <elf> --firmware-effect none|actuates --on-exit halted|resume [--read VAR]... [--frames 1-64]` (break:
  `--at <function|file:line|*0xflash>` `--timeout 1-3000`; step: `--count 1-100` `[--instruction]`; device-write,
  irreversible with `actuates`; rule timeout 3600 for break) and the cleanup `release --probe` (safe, touches nothing,
  physical unknown). Profiles `stm32f4-stlink` (Cortex-M4F, v7m faults) and `stm32g0-stlink` (Cortex-M0+, v6m), both
  `unverified`. Results in `embedded-lab-results/<run-id>/` (result.json kind `gdb-debug-result`, mi.log,
  openocd.log). Exit 0 pass, 2 refused before any process, 3 incomplete/blocked/error. Evidence: Windows 11 offline
  (fixture ELFs from zig cc 0.13.0, pyelftools 0.32 oracle, GDB/OpenOCD stand-ins, VERA's real runner); no
  real GDB, OpenOCD, probe, board or native Ubuntu run yet.

## Invariants

- probe-rs rules use highest-risk-wins, including command tokens after global options. Version/help,
  chip/list safe (`chip info <name>` too: `info` is matched only as the command); exact `<command> --help`
  safe for every hardware command; info/mi/read/verify/attach/profile/trace/reset device-read;
  download/run/erase/benchmark and any `--flash` (profile) device-write; rule time limits 1800 s for
  download/verify/erase/read/profile and 3600 s for run/attach, else the program's 120 s; itm explicitly device-write for trace configuration; write device-write too (asked, no typed word);
  debug/gdb/dap-server/serve/complete and every --host blocked.
  Help does not lower a dangerous match; --host=value is blocked. Unknown commands default device-write.
  Memory widths are b8/b16/b32/b64, read takes word count, write takes values, default hex-table.
  Background run/attach use existing program_output until and program_stop, closed stdin and tree kill.
  The package neither installs drivers/udev rules nor elevates. Xtensa ESP32/S2/S3 is in upstream
  0.32.0; vendor tooling remains for unverified features.

- gdb-debug: the agent never reaches GDB's or OpenOCD's input - the direct programs are blocked, the helper owns the
  pipes and sends only its fixed MI command set; `--read` and `--at` values pass a whitelist (identifiers, `.member`,
  `[index]`, function, `file:line`, flash `*0x`) before any process starts; GDB starts with `-nx` and auto-load,
  debuginfod, history and target function calls (`may-call-functions`) off; OpenOCD runs only the profile's own scripts with the probe serial (charset without Tcl
  metacharacters), GDB port on 127.0.0.1, telnet/Tcl off, GDB flash programming off, hardware breakpoints.
- gdb-debug reads target memory only inside the profile's flash and RAM and the SCB fault registers (`mem` regions,
  all read-only, inaccessible by default); OpenOCD runs in an empty temporary folder outside the workbench and never writes target memory or flash; the ELF match reads flash back (GDB
  `compare-sections` is not used: OpenOCD would run a CRC routine in target RAM); a mismatch withholds every symbol,
  source, variable and fault-site attribution, as does an ELF of which no byte could be compared (`unchecked`, compared
  0); a partly compared, all-equal ELF keeps them with an `elf-unchecked` problem and a limit.
- gdb-debug's exit policy is applied by OpenOCD's gdb-detach event on every end (also when GDB is killed); only its
  printed state confirms the physical state; `release` never reconnects. An MI result is matched only to its own
  token; stale and untokened results are events.

## Change map

| Change requested | Start with | Focused verification |
|---|---|---|
| probe-rs pins, risk rows, device guidance or RTT | `plugins/probe-rs/` | `probe-rs.test.ts`; real archive opt-in plus separately recorded bench acceptance |
| STM32 command map, rules or skills | `plugins/stm32-cubeprog/`, `shared/src/stm32-options.ts` | `stm32-cubeprog.test.ts` (matrix, recorded-help coverage, fake-host find, stub gate, real CLI where installed) |
| A new STM32CubeProgrammer release | re-record `tests/fixtures/stm32/STM32_Programmer_CLI-<v>-help.txt`, then `stm32-options.ts` and the rules | "classifies every command of a line" |
| pymcuprog roles, rules or skills | `plugins/microchip-pymcuprog/`, `shared/src/pymcuprog-options.ts` | `microchip-pymcuprog.test.ts` matrix and stub-resolver gate; `VERA_MCU_UV` real run |
| A gdb-debug board/probe profile | `plugins/gdb-debug/profiles/*.json`, `gdb_support/profiles.py` | profile tests in `tests/fixtures/gdb-debug/internals.py`, OpenOCD argument test in `gdb-debug.test.ts`; a real board run before `verified` |
| A gdb-debug operation or MI handling | `gdb_support/operations.py`, `session.py`, `mi.py`, `tests/fixtures/gdb-debug/fake_gdb.py` | the session tests of `gdb-debug.test.ts` and the session checks of `internals.py` |
| ELF/DWARF facts or fault decoding | `gdb_support/elf.py`, `dwarf.py`, `faults.py`, `symbols.py` | inspect and diagnose tests, `internals.py`, opt-in `VERA_GDB_ORACLE_PYTHON` (pyelftools) |

## Key behaviors

- `REQ-FUNC-19b10001` — exact 0.32.0 official package, ordered discovery and pinned portable fallback.
- `REQ-SEC-19b10002` through `REQ-SEC-19b10006` — all five risk levels and blocked-host escalation.
- `REQ-UX-19b10007` through `REQ-UX-19b1000a` — connect/flash/RTT/register skills.
- `REQ-PLAT-19b1000b` — real three-board workflow on Windows/Linux (pending hardware acceptance).

- `REQ-FUNC-6ea24516` / `REQ-REL-e4731e39` — STM32_Programmer_CLI discovery and install hint.
- `REQ-SEC-967391b8` / `REQ-SEC-08036a89` / `REQ-SEC-248961d6` — STM32 command classes, irreversible protection/security, blocked scripts.
- `REQ-UX-301c8fa4` / `REQ-TEST-6f33cbba` / `REQ-PLAT-b6e64a02` — STM32 skills, tests, Nucleo acceptance (pending).
- `REQ-FUNC-dd9f71eb` / `REQ-SEC-9dbe7de8` / `REQ-SEC-f626bf83` / `REQ-SEC-c2108ca1` — pymcuprog install, roles, protection and physical outputs.
- `REQ-UX-d3193aa3` / `REQ-TEST-9b1ed1aa` / `REQ-PLAT-35de3f5d` — Microchip skills, tests, UPDI board acceptance (pending).

## Files

- `05_Software/plugins/probe-rs/` — manifest, six skills and measured upstream evidence/limits.
- `05_Software/tests/plugins/probe-rs.test.ts`, `tests/fixtures/probe-rs/replay.mjs` — exhaustive
  risk matrix, discovery/range, installed skills, exact-ELF approval/refusal, real closed-stdin
  fixture RTT and optional real local-archive CLI acceptance.

- `05_Software/plugins/stm32-cubeprog/` — manifest, README (risk table, parsing, limits), skills stm32-flash and stm32-option-bytes.
- `05_Software/src/libraries/shared/src/stm32-options.ts`, `05_Software/tests/plugins/stm32-cubeprog.test.ts`, `tests/fixtures/stm32/` (recorded 2.23.0 help, blink.hex) — projection and tests.
- `05_Software/plugins/microchip-pymcuprog/` — manifest, README (risk table, argument parsing, limits), skills microchip-flash and microchip-fuses.
- `05_Software/src/libraries/shared/src/pymcuprog-options.ts`, `05_Software/tests/plugins/microchip-pymcuprog.test.ts`, `tests/fixtures/microchip/app.hex` — projection, matrix, gate, opt-in real run.

- `05_Software/plugins/gdb-debug/` — manifest, README (operations, guarantees, limits), profiles `stm32f4-stlink.json` and `stm32g0-stlink.json`, skill debug-sessions, `scripts/gdb_elf.py` and `scripts/gdb_debug.py` (entries), `scripts/gdb_support/` (`elf`, `dwarf`, `symbols`, `faults`, `validate`, `profiles`, `registry`, `mi`, `session`, `openocd`, `operations`, `lifecycle`, `report`, `errors`, `cli_elf`, `cli_debug`, `workspace` shared).
- `05_Software/tests/plugins/gdb-debug.test.ts`, `tests/fixtures/gdb-debug/` (`firmware/` sources, linker scripts, `build.py` and the four ELFs; `fake_gdb.py`, `fake_openocd.py`, `make_tools.py`, `internals.py`).
