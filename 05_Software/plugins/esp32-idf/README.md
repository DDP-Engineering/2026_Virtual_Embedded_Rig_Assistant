# ESP32 ESP-IDF

Build/repair ESP-IDF projects, flash, and decode crash addresses with the matching ELF. Install this plugin
and serial-monitor, enable them for the workbench, then detect programs. VERA detects the vendor suite;
the user installs EIM, ESP-IDF and USB drivers. Select the intended installed IDF with `eim select` before
starting VERA. Detection probes `idf.py --version` through EIM; supported IDF versions are `>=5.4,<7`.

`idf.py` resolves the `eim` executable, not a Python file. It uses launcher `[eim, run]` with
`launcherMode: string`. Put EIM on PATH or use a declared location. The two local-file decoders detect
`xtensa-esp-elf-addr2line` and `riscv32-esp-elf-addr2line` under EIM's tools directory. For a custom tools
root set `IDF_TOOLS_PATH` before starting VERA. Detection does not install either toolchain. Check that
the detected decoder is appropriate to the flashed build; VERA's highest-name glob selection is not
evidence that a particular toolchain built an ELF.

## Verified EIM command transport

Verified 2026-11-03 with **official EIM CLI 0.20.1**, Windows x64 and native Ubuntu x64 under WSL2.
Both binaries report `run [OPTIONS] <COMMAND> [IDF]`. `COMMAND` is **one string**, not trailing argv:
`run idf.py build extra` exits 2 (unexpected extra argument); `build` alone in the second position would
be interpreted as the IDF selector. Passing one string `idf.py build` executed a synthetic `idf.py`
function in an isolated selected installation on both systems, exit 0.

The activation probe deliberately used a temporary EIM configuration and synthetic activation functions.
It tested EIM's real command parser and executor, not ESP-IDF compilation or hardware. No existing EIM
installation/configuration was modified. Spaces, an empty argument and a trailing backslash survived.

| Platform | Command string generated for tokens `idf.py`, `build`, `spaced path`, empty, `tail\` | Result |
|---|---|---|
| Linux/Bash | `"idf.py" "build" "spaced path" "" "tail\\"` | exact tokens, exit 0 |
| Windows/PowerShell | `& "idf.py" "build" "spaced path" "" "tail\"` | exact tokens, exit 0 |

A quoted executable without the generated `&` fails PowerShell parsing (exit 1); that same call operator
is invalid at the start of Bash (exit 1). Bash doubles literal backslashes throughout quoted tokens;
PowerShell keeps them literal. VERA adds the call operator itself. Agent command tokens containing
quotes, `& | ; < > ^ % $`, a backtick, NUL or line breaks are refused with INVALID before spawning.
Rules, file hashes and serial locking still use the original program argument array. VERA starts EIM
with an argument array and `shell: false`; **EIM itself executes its activation and command through the
vendor's Bash/PowerShell executor**.

Sources: [official CLI reference](https://docs.espressif.com/projects/idf-im-ui/en/latest/cli_commands.html#run-command),
[official 0.20.1 release](https://github.com/espressif/idf-im-ui/releases/tag/v0.20.1), and inspected current
source commit [043ca81de5b723c4e1b95635929da912811e9586](https://github.com/espressif/idf-im-ui/tree/043ca81de5b723c4e1b95635929da912811e9586):
`src-tauri/src/cli/cli_args.rs` (`Run.command: String`), `src-tauri/src/lib/version_manager.rs`
(`run_command_in_context`, `build_activation_script`) and `src-tauri/src/lib/command_executor.rs`
(Bash `-c`, Windows PowerShell script). Other EIM versions have not been executed for this verification.

Downloaded artifact SHA-256:

- `eim-cli-windows-x64-v0.20.1.exe`: `ed5130ed1d88f4f567c08847f76090b27f528cf3ec580cfcaf5888a63c074d2b`
- `eim-cli-linux-x64-v0.20.1.zip`: `33fdf62fd00dd7a72ef3e922522b85bf31ed09406e260f47136e6c06fdb0d7ac`

## Commands and skills

- Safe host operations: set-target, build, size, size-components, size-files, fullclean, reconfigure;
  set-target/fullclean remove generated output. Both addr2line programs decode host ELF files.
- Device-read: coredump-info, which reads the board's dump partition and may reset it.
- Device-write: flash, app-flash, erase-flash, erase-otadata.
- Irreversible: efuse-* and secure-*; normal typed confirmation/mode rules apply.
- Blocked: monitor, menuconfig, gdb, gdbtui. The agent sees the rule note explaining interactive
  operation, serial-monitor capture and sdkconfig.defaults. A mixed `flash monitor` is also blocked.

Load `esp32-build-fix` for diagnostics/edit/rebuild and `esp32-panic` for Guru Meditation capture,
correct-architecture address decoding, matching ELF and core dump analysis. Never edit generated
`sdkconfig` directly; use the project's defaults and reconfigure, then verify the effective generated
configuration. Defaults do not replace existing values; changing those needs the project's agreed
regeneration workflow. Stop background capture before flash
or core-dump reading on its port.

## Verification limits and remaining acceptance

Deterministic tests use a vendor stand-in, the real provisioner/runner/session and platform string
parsers. They repair a seeded source error, rebuild a fixture ELF and decode fixture addresses; these
results are not a real ESP-IDF build, flash or panic. EIM/ESP-IDF was not found installed on either
verification host, and no board was available to this task. Real acceptance remains: on Windows and
Linux, repair and build with the actual toolchain, flash a confirmed board, capture its seeded panic
with serial-monitor and decode it to a source line with the exact flashed ELF. Do not publish this
plugin as hardware-verified until those logs exist.

Reference: [IDF frontend](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-guides/tools/idf-py.html),
[core dumps](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-guides/core_dump.html),
[5.4 toolchain paths](https://github.com/espressif/esp-idf/blob/v5.4.3/tools/tools.json).
