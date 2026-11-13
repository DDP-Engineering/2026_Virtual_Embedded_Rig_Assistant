---
name: arduino-build-fix
description: How to compile an Arduino sketch with arduino-tool and fix what the compiler or the checks before it report. Use whenever a task builds an .ino sketch, picks an FQBN or core version, or reads Arduino compile errors.
---
# arduino-build-fix

`arduino-tool` (plugin arduino-cli) compiles a copy of a sketch with VERA's own pinned arduino-cli. Run it only through
`run_program`. It never installs anything during a compile and never changes the sketch.

## Before compiling

1. `arduino-tool inspect --sketch <folder>`: the sketch's main file must be named after its folder
   (`Blink/Blink.ino`). It also lists the installed cores and libraries. A `sketch.yaml` is reported and ignored:
   its `default_fqbn`, `default_port` or profiles are not used.
2. Choose the FQBN from the board the user names: `arduino-tool boards search <name>` and `arduino-tool boards
   details --fqbn <vendor:arch:board>` (options such as `cpu=atmega328old` and the programmers). Never take an FQBN from a
   USB bridge chip (CH340, FTDI, CP210x): ask the user which board it is.
3. If the core is missing, the compile says so with the exact command; ask before running `arduino-tool install core
   <vendor:arch@version>` (a download). Use the version the user or the project names; otherwise propose the latest
   from `arduino-tool cores search <vendor:arch>` and say which one you chose.

## Compile

`arduino-tool compile --sketch <folder> --fqbn <fqbn> --core <vendor:arch@version> [--library NAME@VERSION]...
[--library-dir <folder>]... [--warnings more]`. Always pass `--core` so the result is pinned. The run folder
`arduino-iot-results/<run-id>/` holds `result.json`, `report.md`, `compile.log`, the sketch copy and the binaries.

## Reading the result

- Exit 2 (`blocked`): nothing compiled. `errors[].code` says why: `fqbn-unknown` (with `candidates`), `fqbn-option`
  (with `declared` values), `core-missing`, `core-version`, `library-missing`, `library-version`, `local-override`,
  `sketch-invalid`, `tool-missing`. Do not retry with a guessed FQBN; ask when the candidates do not settle it.
- Exit 3, status `fail`: the compiler failed, or the build used an undeclared library (see `arduino-libraries`).
  `diagnostics[]` give `file` (relative to the sketch), `line`, `column`, `severity` and `message`. Fix the first error
  first: later ones often follow from it. A `fatal error: X.h: No such file or directory` is a missing library, not a
  code error.
- Exit 0, status `pass`: report `sizes` (text = flash, data = static RAM, with the toolchain's maxima) and the binary
  hashes. A build near its maximum needs attention before upload.
- `platform.hooks` lists the core's build hooks: they ran on this computer as part of the compile.
