# Official plugins

## Routing

Select for the plugin packages VERA maintainers ship in `05_Software/plugins/<id>/`: their `plugin.yaml`
programs and rules, helper scripts, Agent Skills and README; today `serial-monitor` (program `serial`: list
serial ports with board family, capture a console with an optional DTR/RTS reset, send one line; skills
`serial-console` and `esp32-identify`) and `esp32-esptool` (program `esptool`, esptool v5 from PyPI: identify, flash,
verify, erase and read ESP32 chips; skill `esp32-flash`); `esp32-idf` (EIM-activated idf.py, Xtensa/RISC-V addr2line;
skills `esp32-build-fix` and `esp32-panic`); `binutils` (ARM/RISC-V size, nm, readelf, objdump and addr2line, with firmware-size, crash-decode and elf-inspect); probe-rs (local debug probes, flash/memory/RTT with four skills); sigrok (logic, analog and instrument work with five skills); git (workbench version control, three skills and Git option-role classification). Start at `05_Software/plugins/<id>/plugin.yaml`, and for
serial-monitor at `scripts/serial_monitor.py`; tests are in `05_Software/tests/integration/serial-monitor.test.ts` and
`esp32-esptool.test.ts` and `esp32-idf.test.ts` with fixtures in `05_Software/tests/fixtures/serial-monitor/`, `esp32-esptool/` and `esp32-idf/`. The platform that installs, classifies, approves and runs these
programs (store, provisioner, rules, gate, runner, serial-port guard, run_program) is [Plugins](plugins.md);
plugin skill discovery is [Skills](skills.md).

## Purpose and boundaries

Each folder is an ordinary plugin package in format 1 that the user installs from the folder (`vera plugin
install --path`, IPC `plugins.install`) or from the catalog, and enables per workbench. The folder is also a catalog
source: `packs.yaml` (ESP32 and Firmware analysis groups, default on), `catalog.yaml` (all packaged plugins
`official`, no reviewed rules), `CONTRIBUTING.md` and the hosted repository's CI template `.ci/catalog.yml`; `vera
catalog check --source 05_Software/plugins` finds no issue. `npm run prepare:plugins` builds it into the bundled
catalog release `05_Software/src/bundled-plugins/` (git-ignored), which packaging ships as `<resources>/plugins/` for
an offline first install. Nothing installs them automatically. A package holds content only: a manifest, PEP 723
scripts that the provisioner runs with the bundled uv, and Markdown skills; a pip program such as esptool comes from
PyPI at install time and is not part of the folder. `requires`: esp32-esptool lists `serial-monitor`; `vera catalog check`
reports a `requires` that names no catalog plugin, and catalog installs review required plugins first, while installs
from a folder or zip ignore it. Platform behaviour such as risk
policy, approvals, timeouts and the serial-port guard is not repeated in the packages.

## Public interface

- `git` 1.0.0 discovers user Git >=2.40 through PATH and standard Windows/Linux paths, without downloads. Fixed prefix/env plus the mandatory no-ext-diff execution guard neutralise fsmonitor, hooks, pager and external diff; an inert no-hooks/README.txt preserves the hooks directory in catalog zips. `optionSyntax: git` keeps option case/arity/boundaries for highest-risk rules, blocking executable aliases, configuration overrides and explicit helpers. Read inspections/listings are safe, mutations/remotes default to device-write, discard/force/delete paths irreversible. Skills git-inspect/git-commit/git-branches bound history, cite hashes, stage reviewed explicit paths, use messages and preserve conflicts. Git bypasses the write queue/Changes panel; run logs and the index watcher retain visibility. Local filters/textconv and other user Git configuration are not sandboxed. tests/integration/git.test.ts exercises actual catalog installation, native Git markers, replay Ask and controlled credential failure; Windows/Linux environment receipts name the actual platform.

- `sigrok` 1.0.0, general, Windows x64/Linux x64/Linux arm64: provision the
  SHA-256-pinned DDP PulseView 66540df asset or use a local sigrok-cli fallback.
  An installed pinned executable takes precedence. AppImage arguments apply
  to managed downloads only and force extraction before CLI launch. The LAN HTTPS
  release is a proposed endpoint. Check the full `-L` log or the driver's
  `--show` output for fork-only drivers before a hardware
  workflow. Skills cover bounded srzip capture, background streaming, offline
  decoding, instrument reads and approved changes, and the Hantek/ATK drivers.

- `probe-rs` 1.0.0, general, Windows x64/Linux x64/Linux arm64: probe-rs exactly 0.32.0,
  PATH then ~/.cargo/bin discovery, explicit user-triggered SHA-256-pinned portable fallback.
  A found unsupported version reports range/unavailable and takes precedence over the download.
  All three official archive hashes/member layouts and Linux host headers are inspected. Four
  skills select probes/chips, flash/verify/reset the exact build ELF with approval hashes, stream
  background RTT and inspect SVD-defined registers/fault addresses. CAP-02 decode_register is used
  only if present; no such built-in tool is currently implemented. README carries CLI/source evidence.
  Hardware acceptance on Nucleo/ST-Link, RP2040/CMSIS-DAP and ESP32-C3/USB-JTAG on both systems and
  real RTT with closed stdin/down channels remains outstanding. Replay is explicitly simulated.

- `binutils` 1.0.0, general, windows-x64/linux-x64/linux-arm64: ten `arm-none-eabi-` and
  `riscv-none-elf-` programs (`size`, `nm`, `readelf`, `objdump`, `addr2line`), all safe. Per-program
  `--version` probes, timeout 60 s. Ordered PATH/ST/PlatformIO/Arduino/Zephyr/xPack discovery;
  only a user action installs a missing tool from SHA-256-pinned xPack ARM 15.2.1-1.1 or RISC-V
  15.2.0-1 archives, five entry points sharing each archive. Zephyr uses explicit alternate names;
  Espressif remains in esp32-idf. Three skills compare sections/symbol deltas, decode exact-build
  PC/LR with inline frames and inspect linker/flash mapping with bounded disassembly.
  Fixture source, linker script, DWARF4 ELFs and reproduction instructions are in tests/fixtures/elf.
  Windows/native Ubuntu x64 acceptance uses real local archives via VERA_BINUTILS_ARCHIVES;
  linux-arm64 archive hashes/members/AArch64 host headers are inspected, not executed.

- `serial-monitor` 1.0.0, ecosystem `general`, platforms `windows-x64`, `linux-x64`, program `serial` with
  `install: { script: scripts/serial_monitor.py }` (pyserial 3.5), probed with `--version`
  (`serial-monitor <version>`).
- Commands (spec `.agentic/specs/REQ-FUNC-42818bb7.md`): `serial list` prints a JSON array of `{port, vid_pid,
  serial_number, family, description, by_id}` sorted by port; `serial capture --port P [--baud 115200]
  [--duration 10] [--until REGEX] [--max-bytes 1048576] [--reset]` streams console bytes to stdout and ends with
  `[serial-monitor] P: N bytes, stopped by duration|until|max-bytes` on stderr; `serial send --port P --text LINE
  [--eol crlf|lf|cr|none] [--duration 1] ...` writes one line, then reads like capture.
- Exit codes: 0 done, 2 invalid arguments (no port opened), 3 port failure (EACCES adds the `dialout`/`uucp`
  instruction, others a list-again hint), 4 `--until` never matched.
- `esp32-esptool` 1.0.0, ecosystem `esp32`, `requires: [serial-monitor]`, program `esptool` with
  `install: { pip: "esptool>=5,<6" }`, resolved to `<runtime>/tools/esp32-esptool/bin/esptool[.exe]`, probed with
  `esptool version` (`v(\d+\.\d+\.\d+)`, range `>=5,<6`; any other version is unavailable with problem `range`),
  program timeout 120 s. Skill `esp32-flash`: port and chip first, offsets and images from `build/flasher_args.json`
  as explicit pairs, stop for encrypted or secure-boot builds, `Hash of data verified.` per file or `verify-flash`,
  boot log with `serial capture --port P --reset`.

## Invariants

- Sigrok rules use the `sigrok-cli` option syntax to distinguish flags and values and
  classify output settings regardless of argument order. The CLI applies `--config`
  on reads and captures, so the manifest protects output-driving drivers and PWM
  groups in these forms as well as `--set`. An implicit driver with configuration is
  irreversible. Ask uses the typed approval gate. Exact raw argv is retained for
  the approval and launch.

- probe-rs rules use highest-risk-wins, including command tokens after global options. Version/help,
  chip/list safe; info/mi/read/verify/attach/profile/trace/reset device-read; download/run/erase/benchmark
  device-write; itm explicitly device-write for trace configuration; every write irreversible;
  debug/gdb/dap-server/serve/complete and every --host blocked.
  Help does not lower a dangerous match; --host=value is blocked. Unknown commands default device-write.
  Memory widths are b8/b16/b32/b64, read takes word count, write takes values, default hex-table.
  Background run/attach use existing program_output until and program_stop, closed stdin and tree kill.
  The package neither installs drivers/udev rules nor elevates. Xtensa ESP32/S2/S3 is in upstream
  0.32.0; vendor tooling remains for unverified features.

- esp32-idf is format 1, requires serial-monitor and detects user-installed EIM/IDF (`>=5.4,<7`).
  Its idf.py find search locates eim and invokes `run` with `launcherMode: string`. Official EIM 0.20.1
  on Windows and native Ubuntu takes one COMMAND string through PowerShell/Bash; the README records
  the measured platform quoting and its limits. VERA starts the launcher without a shell.
- Xtensa/RISC-V addr2line are local binaries found under IDF_TOOLS_PATH/default EIM roots; selection
  must match the target and exact flashed ELF. VERA never installs the vendor suite or drivers.
- idf.py build/size/configure commands are safe; coredump-info device-read; flash/app-flash/erase
  device-write; efuse-* and secure-* irreversible; monitor/menuconfig/gdb/gdbtui blocked with an
  explanatory note. Mixed flash+monitor is blocked. Skills change sdkconfig.defaults, never sdkconfig directly,
  verify effective generated values and require an agreed project regeneration workflow for already-set values.
- esp32-idf replay repairs a fixture compile error, rebuilds, performs fixture flash, captures Guru
  Meditation via serial-monitor/fake pyserial and decodes fixture addresses. Real ESP-IDF compile,
  flash, panic and source-line acceptance on both systems remains unverified without vendor tools/board.

- Rules: `serial {--version,--help,-h}` and `serial list *` are `safe`, `serial capture *` is `device-read` with a
  reset note, `serial send *` is `device-write` with a firmware note; any other command line keeps the platform's
  unmatched default `device-write`.
- `list` never opens a port. Capture and send open with DTR asserted and RTS released, then release DTR, so the
  lines never pass through the reset state DTR released + RTS asserted (Linux raises both lines on open; POSIX
  also `exclusive=True`); only `capture --reset` asserts RTS (200 ms, DTR re-applied after each RTS change for
  Windows usbser.sys) and clears the input buffer before releasing RTS, so the new boot output is kept.
- Any exception from the port (SerialException; OSError or termios.error on Linux; ValueError for an unsupported
  setting) is exit 3 with
  the bytes already read kept.
- Console bytes reach stdout unchanged and flushed per read, so background runs stream to `program_output`.
- `--until` is searched in each complete line and the current partial line (at most its last 4096 characters),
  decoded as UTF-8 with replacement characters and without a trailing CR.
- esp32-esptool rules (every command esptool 5.6.0 lists matches one; recorded help in
  `tests/fixtures/esp32-esptool/esptool-5.6.0-help.txt`): `esptool {version,--help,-h}` and `merge-bin`, `image-info`,
  `elf2image` safe; `chip-id`, `read-mac`, `flash-id`, `read-mem`, `read-flash-status`, `read-flash-sfdp`,
  `get-security-info`, `read-sdc-chip-info`, `verify-sdc-certificate`, `run`, and with a 1800 s timeout `read-flash`,
  `verify-flash`, `dump-mem` device-read ("Resets the chip into its bootloader."); `write-flash`, `erase-flash`,
  `erase-region` device-write with a 1800 s timeout, `load-ram` device-write; `write-mem`, `write-flash-status` and any
  `--force` irreversible (confirm word: the command, or `--force`). Global options may precede the command; the
  matcher's lowercase and `_`→`-` cover esptool v4 spellings. Other lines keep the default `device-write`.
- Safe esptool commands write host files (`merge-bin -o`, `elf2image -o`) without approval, like other safe programs.
- The script is not named `serial.py`: that name would make `import serial` load the script itself.
- The installed copy must not change after install (integrity hash): tests run installed copies with
  `PYTHONDONTWRITEBYTECODE=1`, and `uv run --script` executes the file as `__main__` without a bytecode cache.

## Change map

| Change requested | Start with | Focused verification |
|---|---|---|
| probe-rs pins, risk rows, device guidance or RTT | `plugins/probe-rs/` | `probe-rs.test.ts`; real archive opt-in plus separately recorded bench acceptance |
| IDF rules, launcher detection or decoder paths | `plugins/esp32-idf/plugin.yaml` | `esp32-idf.test.ts`, core `provisioning.test.ts` |
| Build repair or panic guidance | `plugins/esp32-idf/skills/` and README | `esp32-idf.test.ts` skill and replay cases |
| Risk rules or notes | `plugins/serial-monitor/plugin.yaml` `rules` | `serial-monitor.test.ts` "risk rules" |
| Family table, list fields, by-id | `serial_monitor.py` `FAMILIES`, `list_command`, `by_id_links` | "list" tests; `fixtures/serial-monitor/by_id.py` |
| Capture/send stop conditions, reset, exit codes | `serial_monitor.py` `read`, `reset`, `main`, `fail` | "capture", "send", "failures" tests |
| Agent guidance | `skills/serial-console/SKILL.md`, `skills/esp32-identify/SKILL.md` | "offers the plugin's skills" test |
| Fake port behaviour for tests | `fixtures/serial-monitor/fake-pyserial/serial/` | the whole file |
| esptool rules, notes, timeouts | `plugins/esp32-esptool/plugin.yaml` `rules` | `esp32-esptool.test.ts` "risk rules" |
| A new esptool release | re-record `fixtures/esp32-esptool/esptool-<v>-help.txt`, then rules and `version.range` | "names only esptool 5.6.0 commands" |
| Flashing guidance | `plugins/esp32-esptool/skills/esp32-flash/SKILL.md` | "offers esp32-flash" test |
| Stub esptool output | `fixtures/esp32-esptool/fake_esptool.py` | "in VERA" tests |

## Key behaviors

- `REQ-FUNC-19b10001` — exact 0.32.0 official package, ordered discovery and pinned portable fallback.
- `REQ-SEC-19b10002` through `REQ-SEC-19b10006` — all five risk levels and blocked-host escalation.
- `REQ-UX-19b10007` through `REQ-UX-19b1000a` — connect/flash/RTT/register skills.
- `REQ-PLAT-19b1000b` — real three-board workflow on Windows/Linux (pending hardware acceptance).

- `REQ-FUNC-20b10003` / `REQ-SEC-20b10004` — official binutils package, pinned find-first sources and safe analysis.
- `REQ-UX-20b10005` / `REQ-UX-20b10006` / `REQ-UX-20b10007` — size, crash and ELF inspection skills.
- `REQ-TEST-20b10008` — reproducible genuine ARM/RISC-V ELF corpus.

- `REQ-FUNC-10e10007` / `REQ-SEC-10e10008` — ESP-IDF package, vendor hints and risk rules.
- `REQ-UX-10e1000a` / `REQ-UX-10e1000b` — build-fix/panic skills and deterministic replay.
- `REQ-PLAT-10e1000c` — executed EIM transport; `REQ-PLAT-10e1000d` — outstanding real-board workflow.

- `REQ-FUNC-b7ceddbc` — the folder installs without issues; `serial` resolves to `uv run --quiet --offline --script <installed>/scripts/serial_monitor.py`.
- `REQ-FUNC-3e33dbe8` — `--version` prints the manifest version for the probe.
- `REQ-SEC-79b6adad` / `REQ-SEC-22dd5e18` / `REQ-SEC-5fd0ed52` — list/help safe, capture device-read, send device-write.
- `REQ-FUNC-e80e3dd7` / `REQ-FUNC-742426ac` / `REQ-PLAT-19d5189a` — JSON list without opening, family table, Linux by-id.
- `REQ-FUNC-42818bb7` / `REQ-FUNC-3ee59f30` / `REQ-REL-46027e04` — capture stop conditions and summary, RTS reset, exit 4.
- `REQ-FUNC-6f7569e2` — send one line, then read the reply.
- `REQ-PLAT-4013192c` / `REQ-REL-3c25e5c0` / `REQ-FUNC-0a001d5d` — EACCES group instruction, other failures, usage errors.
- `REQ-UX-7dc52524` — skills `serial-console` and `esp32-identify`.
- `REQ-TEST-4041b893` — a replay session lists without approval and captures after approval through the real runner.
- `REQ-PLAT-f215472a` — real ESP32-S3 and ESP32+CP210x boards on Windows 11 and Ubuntu (manual).
- `REQ-FUNC-b0d7c102` / `REQ-FUNC-3b4c7274` / `REQ-REL-a69bbfc4` — esptool installs from pip, its version probe, versions outside 5.x unavailable.
- `REQ-SEC-bfed58fa` / `REQ-SEC-c8cf4a75` / `REQ-SEC-b3fe3c10` / `REQ-SEC-d1d8978f` — esptool safe, device-read, device-write and irreversible rules.
- `REQ-SEC-9c665082` — the rules name only esptool 5.6.0 commands and classify all of them.
- `REQ-FUNC-a3a042ec` — flash transfers may run 1800 s.
- `REQ-UX-6a22c4dc` — skill `esp32-flash`.
- `REQ-TEST-fe972de0` — a replay session identifies, flashes with image hashes on the card and captures the boot log.
- `REQ-PLAT-d2b3fa4a` — real boards on Windows 11 and Ubuntu (manual).
- `REQ-DATA-b4e317de` / `REQ-SEC-f98d4fd3` (Plugins) — write-flash approvals list each image's SHA-256; a rebuilt image fails CONFLICT.
- `REQ-SEC-016c9aad` (Plugins) — a background capture makes another run naming its port BUSY.

## Files

- `05_Software/plugins/probe-rs/` — manifest, four skills and measured upstream evidence/limits.
- `05_Software/tests/integration/probe-rs.test.ts`, `tests/fixtures/probe-rs/replay.mjs` — exhaustive
  risk matrix, discovery/range, installed skills, exact-ELF approval/refusal, real closed-stdin
  fixture RTT and optional real local-archive CLI acceptance.

- `05_Software/plugins/binutils/` — manifest, measured source pins README and three skills.
- `05_Software/tests/integration/binutils.test.ts`, `tests/fixtures/elf/` — genuine cross-architecture corpus, fake-root discovery and real offline archive/replay acceptance.

- `05_Software/plugins/esp32-idf/` — manifest, measured EIM transport README, build-fix and panic skills.
- `05_Software/tests/integration/esp32-idf.test.ts`, `tests/fixtures/esp32-idf/` — deterministic vendor executable/parser and session replay; no hardware or network.

- `05_Software/plugins/serial-monitor/plugin.yaml` — manifest: program `serial`, version probe, rules, docs.
- `05_Software/plugins/serial-monitor/scripts/serial_monitor.py` — PEP 723 script: list, capture, send.
- `05_Software/plugins/serial-monitor/skills/serial-console/SKILL.md` — how to use the program.
- `05_Software/plugins/serial-monitor/skills/esp32-identify/SKILL.md` — identifying ESP32 boards and bridges.
- `05_Software/plugins/serial-monitor/README.md` — catalog description.
- `05_Software/tests/integration/serial-monitor.test.ts` — package, rules, script behaviour, guard, replay session, skills.
- `05_Software/tests/fixtures/serial-monitor/fake-pyserial/` — fake `serial` package driven by `FAKE_SERIAL_SCENARIO`, recording to `FAKE_SERIAL_RECORD`.
- `05_Software/tests/fixtures/serial-monitor/by_id.py` — runs `list` with a test by-id folder.
- `05_Software/tests/fixtures/serial-monitor/esp32s3-boot.log` — sample ESP32-S3 boot log.
- `05_Software/plugins/esp32-esptool/plugin.yaml` — manifest: program `esptool` (pip), version probe, rules, docs.
- `05_Software/plugins/esp32-esptool/skills/esp32-flash/SKILL.md` — identify, flash from flasher_args.json, verify, boot log.
- `05_Software/plugins/esp32-esptool/README.md` — catalog description.
- `05_Software/plugins/packs.yaml`, `catalog.yaml` — packs and the maintainers' file of the catalog source.
- `05_Software/plugins/CONTRIBUTING.md`, `.ci/catalog.yml` — contribution guide and CI template for `vera-plugins`.
- `05_Software/scripts/prepare-plugins.mjs` — builds and checks the bundled catalog release.
- `05_Software/tests/integration/esp32-esptool.test.ts` — package, provisioning, rules, replay session, skill.
- `05_Software/tests/fixtures/esp32-esptool/fake_esptool.py` — stub esptool a fake uv installs as the pip entry point (distlib `.exe` launcher on Windows); records arguments and file hashes.
- `05_Software/tests/fixtures/esp32-esptool/esptool-5.6.0-help.txt` — recorded `esptool --help` of 5.6.0.
- `05_Software/tests/fixtures/esp32-esptool/flasher_args.json` — ESP-IDF esp32s3 hello_world flash layout.
