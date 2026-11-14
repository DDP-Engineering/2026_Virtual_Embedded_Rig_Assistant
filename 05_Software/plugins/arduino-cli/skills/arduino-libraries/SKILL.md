---
name: arduino-libraries
description: How to choose, install and declare Arduino libraries for a sketch with arduino-tool, in exact versions. Use whenever a sketch includes a library header, a compile reports a missing or undeclared library, or the user asks which library to use for a sensor or protocol.
---
# arduino-libraries

Libraries live in VERA's own Arduino environment, never in the Arduino IDE's sketchbook. A build may use three kinds:
libraries of the core (`SPI`, `Wire`, `EEPROM` ...: location `platform`, pinned by the core version), index libraries
installed with `arduino-tool install library` (location `index`) and library folders in the workbench passed with
`--library-dir` (location `local`).

## Choosing

1. `arduino-tool libraries search <topic>`: compare name, latest version, sentence and `architectures` (the library
   must support the board's architecture). Prefer the vendor's own or the most widely used maintained library; tell
   the user what you chose and why.
2. `arduino-tool libraries list` shows what is installed and in which version.

## Installing

- `arduino-tool install library NAME@VERSION` always needs an exact version and installs that library alone, without
  its dependencies. A `dependency-missing` warning names each dependency still to install: install each explicitly,
  in the version the result names. Installing is a download: ask the user first.
- `arduino-tool install index` refreshes the indexes first when a version is unknown.

## Declaring

Every index library a build uses must be declared: `--library NAME@VERSION` on the compile. A compile that used an
undeclared one ends with status `fail` and `undeclared-library` naming the library and version; add the flag rather
than ignoring it. `library-ambiguous` means arduino-cli found several libraries for one header: read `compile.log`,
then keep only the intended one installed or pass the intended local one with `--library-dir`. The result's
`libraries[]` records name, version, location and whether each was declared.
