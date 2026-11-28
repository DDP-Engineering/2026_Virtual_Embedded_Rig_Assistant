---
name: arduino-build-fix
description: How to compile an Arduino sketch with arduino-tool and fix what the compiler reports - the board, the core, missing libraries and code errors. Use whenever a task builds an .ino sketch, picks a board (FQBN) or core, or reads Arduino compile errors.
---
# arduino-build-fix

`arduino-tool` (plugin arduino-cli) compiles a sketch with VERA's own pinned arduino-cli, in VERA's own Arduino
environment. Run it only through `run_program`. A compile never installs anything and never changes the sketch.

## Compile

`arduino-tool compile --sketch <folder>` builds the sketch; the main file is named after its folder
(`Blink/Blink.ino`). It needs no approval and is quick to repeat: VERA keeps a build folder per sketch and board, so
only what changed is rebuilt (`--clean` rebuilds everything).

The board is the first of these that exists:

1. `--fqbn <vendor:arch:board>` on the call, with options when the board has them (`arduino:avr:nano:cpu=atmega328old`).
2. `default_fqbn` in the sketch's `sketch.yaml`. `arduino-tool attach --sketch <folder> --fqbn <fqbn> [--port <port>]`
   writes it there once, so later calls need no board.
3. The one connected board that identifies itself.

Find a board's FQBN with `arduino-tool boards search <name>` and its options with `arduino-tool boards details
--fqbn <fqbn>`. Never take the board model from a USB bridge chip (CH340, FTDI, CP210x): ask the user which board it is.

## What a compile may ask for

- `core-missing`: the message holds the command, `arduino-tool install core <vendor:arch>` (a download: the latest
  version, or `@<version>` for a named one). A core outside Arduino's own index needs its index first:
  `arduino-tool install index --index-url <https url>` (ESP32:
  `https://espressif.github.io/arduino-esp32/package_esp32_index.json`).
- `header-missing`: a library is not installed. The error names the libraries that provide the header and the
  command for the likeliest one; see the arduino-libraries skill.
- `fqbn-unknown` (with `candidates`), `fqbn-option` (with the `declared` values), `fqbn-required`: fix the board; do
  not guess when the candidates do not settle it.

## Variants, and a sketch that does not fit

- `--define NAME[=VALUE]` (repeatable) defines a preprocessor symbol for the sketch, its libraries and the core
  (`--define DEBUG=1`); `--build-property KEY=VALUE` overrides a build property of the core (`--build-property
  build.f_cpu=8000000L`). Each set of defines keeps its own build folder, so switching between a debug and a plain
  build stays quick. The result records them (`defines`, `buildProperties`).
- A sketch that does not fit fails with "exceeds available space", and its result already holds `symbols`: the
  largest symbols in flash and in RAM with their bytes (`kind` text, rodata, data or bss). On a passing build near a
  maximum, ask for them with `--symbols 20`. Shrink or move the largest first (on AVR, `PROGMEM` and `F()` keep
  tables and strings out of RAM).
- `--compile-commands` keeps the build's `compile_commands.json` in the run folder, for clangd or another tool.

## Reading the result

- Exit 3, status `fail`: `diagnostics[]` give `file` (relative to the sketch), `line`, `column`, `severity` and
  `message`. Fix the first error first: later ones often follow from it.
- Exit 0, status `pass`: `sizes` (text = flash, data = static RAM, with the board's maxima), `libraries` (every
  library used, with version and where it came from), `platform` (the core and its version) and `profile` - the
  same versions as an Arduino build profile, also saved as `profile.yaml`. A build near a maximum needs attention
  before an upload.
- `--core <vendor:arch@version>` and `--library <name[@version]>` are checks for a build that must use exact
  versions: the compile refuses when something else is installed.
- The run folder `arduino-iot-results/<run-id>/` holds `result.json`, `report.md`, `compile.log`, the sources as
  compiled and the binaries. `sketch-profile-unused`: the profiles of a `sketch.yaml` are not used.
- To build and upload in one call, add `--upload` (the arduino-test-sketch skill).
