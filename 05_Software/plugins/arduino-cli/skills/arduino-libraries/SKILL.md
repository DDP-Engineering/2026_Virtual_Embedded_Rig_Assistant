---
name: arduino-libraries
description: How to find and install Arduino libraries for a sketch with arduino-tool, and use a library folder of the project. Use whenever a sketch includes a library header, a compile reports a missing header, or the user asks which library to use for a sensor or protocol.
---
# arduino-libraries

Libraries live in VERA's own Arduino environment, never in the Arduino IDE's sketchbook. A build may use three kinds:
libraries of the core (`SPI`, `Wire`, `EEPROM` ...), index libraries installed with `arduino-tool install library`
and library folders of the workbench passed with `--library-dir <folder>`.

## A missing header

A compile that fails on `#include <X.h>` reports `header-missing` with the libraries that provide that header, the
likeliest first, and the install command. Install it and compile again. When several libraries are named and the
sketch does not make the choice clear (two unrelated `Servo.h`), prefer the one named like the header or the
vendor's own, and tell the user which you chose.

## Choosing and installing

- `arduino-tool libraries search <topic>`: name, latest version, sentence and `architectures` (the library must
  support the board's architecture). Prefer the vendor's own or the most widely used maintained library.
- `arduino-tool install library "<name>"` installs the latest version with its dependencies; several names install
  in one call, and `"<name>@<version>"` installs a named version. Quote names with spaces. The result's `installed`
  lists every library and version that was added or replaced. `--no-deps` leaves the dependencies out.
- Installing is a download; in Ask mode VERA asks the user. The first install fetches Arduino's indexes by itself;
  `arduino-tool install index` refreshes them when a new library or version is not found.
- `arduino-tool libraries list` shows what is installed and in which version.

## Examples

`arduino-tool examples list --library "<name>"` lists a library's example sketches; `--fqbn <fqbn>` adds the
libraries of that board's core (`EEPROM`, `Wire`, `SPI`). `arduino-tool examples copy --library "<name>" --example
<example> --to <folder>` copies one into the workbench as a new sketch, its main file renamed after the folder; it
never overwrites. For a sensor or display used for the first time, start from the library's own example and change
the copy.

## In the build

A compile needs no list of libraries: it uses what the sketch includes, and the result's `libraries[]` records each
one with its version and location (`platform`, `index` or `local`). `library-ambiguous` means arduino-cli found
several libraries for one header and chose one: read `compile.log`, then keep only the intended one installed or pass
the intended local one with `--library-dir`. For a build that must use exact versions, name them:
`--library "<name>@<version>"` refuses the compile when another version is installed.
