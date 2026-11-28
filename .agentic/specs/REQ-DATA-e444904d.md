# REQ-DATA-e444904d - arduino-tool operations, VERA Arduino environment, run folders and result documents

## Behavior

`arduino-tool` (program of the official `arduino-cli` plugin, a standard-library PEP 723 script) is the only way the
agent reaches arduino-cli. It runs arduino-cli as `$VERA_PROGRAM_ARDUINO_CLI --config-file <generated> --json
<command> ...`, argv only, no shell, closed stdin, cwd the operation's staging folder, and prints exactly one JSON
document on stdout. A search text, FQBN part, core or library name that starts with `-` is refused (`arguments`,
`fqbn-invalid`, `version-invalid`), so no agent value can become an arduino-cli option. Exit codes: 0 the operation
completed and its document has status `pass`; 2 refused before arduino-cli acted (status `blocked`, `errors[]` say
why; no run folder is written); 3 the operation ran and failed (status `fail`, `error` for an arduino-cli call that
failed where its answer was needed (`tool-failed`) or an unexpected error (`internal`), or `incomplete`).

### VERA Arduino environment

The environment root is `$VERA_ARDUINO_HOME` when set (tests), else `<HOME or USERPROFILE>/.vera-arduino`. Layout:
`data/` (arduino-cli `directories.data`: indexes, cores, tools), `downloads/`, `user/` (`directories.user`; index
libraries under `user/libraries/`), `cache/` (`build_cache.path`), `builds/<sketch>-<16 hex>/` (one kept build folder
per sketch folder and FQBN: `sketch/<name>/` and `libraries/<name>/` as last compiled, `build/` as arduino-cli's
build path, and `owner.json` naming the helper's pid while a compile uses it), `staging/<run-id>-<6 hex>/` (the
configuration and copies of a running operation; created as `.starting-<name>` with `owner.json` naming the helper's
pid, then renamed into place), `environment.json` (`{"format": 1, "indexUrls": [https URL, ...]}`). The Arduino IDE's
folders (Arduino15, the sketchbook) are never named. Two generated configurations, written per operation into its
staging folder:

- offline (every operation except `install`): the directories above, `board_manager.additional_urls` from
  environment.json, `network.proxy: http://127.0.0.1:9`, `updater.enable_notification: false`,
  `library.enable_unsafe_install: false`, `output.no_color: true`. The dead loopback proxy makes any HTTP access fail at
  once, so analysis, compile, upload and the serial monitor never download indexes, tools, cores or libraries and never
  query Arduino's board-identification service.
- online (`install`, and a `cli` command given `--online`): the same without `network.proxy`.

A missing `$VERA_PROGRAM_ARDUINO_CLI` executable is refused (`tool-missing`, exit 2).

### Operations

| Operation | arduino-cli calls | Writes |
|---|---|---|
| `inspect --sketch DIR` | `version`, `core list`, `lib list` (when the tool exists) | nothing |
| `boards list` | `board list` | nothing |
| `boards details --fqbn FQBN` | `board details` | nothing |
| `boards search [TEXT]` | `board listall` | nothing |
| `cores list` / `cores search TEXT` | `core list` (search reads `data/package_index.json` and `data/package_*_index.json`) | nothing |
| `libraries list` / `libraries search TEXT` | `lib list` (search reads `data/library_index.json`) | nothing |
| `examples list [--library NAME] [--fqbn FQBN]` | `lib examples` | nothing |
| `examples copy --library NAME --example NAME [--to DIR] [--fqbn FQBN]` | `lib examples` | a new sketch folder in the working directory |
| `install index [--index-url URL]...` | `core update-index`, `lib update-index` (online) | environment.json, data/ |
| `install core VENDOR:ARCH[@VERSION]` | `core list`, `core install X[@V] --skip-post-install`, `core list` (online) | data/, downloads/ |
| `install library NAME[@VERSION]... [--no-deps]` | `lib list`, `lib install NAME[@V]... [--no-deps]`, `lib list` (online) | user/libraries/, downloads/ |
| `attach --sketch DIR [--fqbn FQBN] [--port PORT]` | `board details`, `board attach` | the sketch's `sketch.yaml` |
| `compile --sketch DIR [--fqbn FQBN] [...]` | `board list` (only without a board), `core list`, `board details`, `lib list` (only with `--library`), `compile`, `version` | run folder, builds/ |
| `upload --build FILE [--port PORT] [...]` | `board list`, `upload`, `board list`, `monitor` (with `--watch`) | run folder |
| `compile ... --upload [...]` | those of compile, then those of upload | two run folders |
| `report --run DIR...` | none | run folder |
| `clean` | none | removes staging/ entries of ended runs, builds/ entries no compile holds, and cache/ when no staging entry is in use |
| `clean --runs [--keep N] [--results-dir DIR]` | none | removes arduino-tool's run folders from the results folder, except the newest N (default 5) |
| `cli [--online] -- COMMAND ...` | the command as given | whatever the command writes |

Searches read the index files themselves: arduino-cli 1.6 refreshes an index older than a day before `core search` and
`lib search`, which the offline configuration makes fail. Every word of the text must appear (case-insensitive) in the
id, name, sentence or board names; libraries rank the exact name first, then names holding every word; at most 50
results, each with its latest version. A missing index file is refused (`index-missing`). `clean` keeps a staging
entry whose owner process runs, or which has no readable `owner.json` and changed within the last hour.

Installs: `install core` and `install library` take the latest version unless `@VERSION` (digits and dots, optional
pre-release) names one; anything else after `@`, such as `latest`, is refused (`version-invalid`). `install library`
takes several names in one call and brings each library's dependencies unless `--no-deps` is given (a dependency left
out is then the warning `dependency-missing`). When the index file an install needs was never downloaded, the install
runs both `update-index` calls first. The document's `installed[]` lists every package the call added or changed,
`{id | name, version, replaced?}`, from the difference of the installed lists before and after; `install core` replaces
another installed version of the same platform. An index URL is `https://` only, without credentials.

`attach` writes `default_fqbn` and, with `--port`, `default_port` and `default_protocol: serial` into the sketch's
`sketch.yaml` with arduino-cli's own `board attach`, after checking the board and its options like a compile; it needs
`--fqbn`, `--port` or both, and its document's `sketch.defaults` shows what the file now names.

`examples list` returns `examples[]` `{library, version, location, examples[]}` for the installed libraries that
have examples (with `--library`, that one; with `--fqbn`, also the libraries of that board's core), each example
named by its path below the library's `examples` folder, at most 300 names. `examples copy` finds the example by that
name or by its last part (case-insensitive; `example-unknown` and `example-ambiguous` list the names), and copies its
files into `--to` (default: a folder named like the example), which must be a new sketch folder name inside the
working directory and outside `.vera` (`path`, `exists`); the main `.ino` is renamed after the new folder. Its
document holds `example` `{library, version, name}` and `sketch` `{path, main, files}`.

`cli [--online] -- COMMAND ...` runs `arduino-cli --config-file <generated> COMMAND ...` with the working directory
as its folder, closed stdin and no `--json` of its own. Its document holds `command`, `exitCode` and `output` (stdout
and stderr together, the environment root written as `<arduino-home>`, the last 8000 characters); a non-zero exit is
status `fail` with `command-failed`, exit 3. An empty command, `daemon` and a command naming `--config-file` or
`--config-dir` are refused (`arguments`). `clean --runs` removes the folders of the results folder whose
`result.json` is a format 1 `arduino-tool-result`, except the newest `--keep` by `startedAt`; other folders and files
stay. Its document holds `clean.runs` `{folder, kept, removed, bytesFreed, failed[]}`.

`compile` options: `--sketch DIR` (a folder inside the working directory holding `<folder name>.ino`), `--fqbn
VENDOR:ARCH:BOARD[:KEY=VALUE,...]`, `--core VENDOR:ARCH@VERSION` (refuses another installed version), `--library
NAME[@VERSION]` (repeatable; refuses unless that index library is installed, in that version when one is named),
`--library-dir DIR` (repeatable; a library folder in the working directory), `--warnings none|default|more|all`
(default `default`), `--define NAME[=VALUE]` and `--build-property KEY=VALUE` (both repeatable), `--symbols N` (1 to
50), `--compile-commands`, `--clean`, `--upload` with the upload options below, `--run-id`, `--results-dir` (default
`arduino-iot-results`). The board is `--fqbn`, else `default_fqbn` of the sketch's `sketch.yaml`, else the one FQBN
among the connected ports that identify their board (`board list`); otherwise the compile is refused
(`fqbn-required`, naming the connected boards and the `attach` command). The result's `fqbnFrom` is `argument`,
`sketch.yaml` or `connected board`. Order of checks, all before arduino-cli compiles: options, sketch folder (at most
2000 files and 16 MiB; links and Windows junctions refused), tool present, board chosen, platform installed
(`core-missing`, naming `arduino-tool install core <vendor:arch>`) and in the `--core` version (`core-version`), FQBN
known (`board details`; unknown board refused `fqbn-unknown` with up to 10 boards of the same platform as candidates)
and every option key and value declared by the board (`fqbn-option`), each `--library` installed in its version
(`library-missing`, `library-version`). A `platform.local.txt` or `boards.local.txt` in the platform folder is the
warning `local-override`.

The sketch is copied to `<run>/sketch/<name>/` without `sketch.yaml`, `sketch.json` and a top-level `build/` folder
(reported under `excluded` and `ignored`): the record of what was compiled, which an upload verifies. arduino-cli
reads the same files from the kept build folder `builds/<name>-<key>/sketch/<name>/` (key: the first 16 hex digits of
the SHA-256 of the sketch folder's path, the FQBN and the build properties given), where a file is rewritten only when its bytes changed and files
no longer in the sketch are removed, so unchanged sources keep their times; `--library-dir` folders are synchronized
to `builds/<name>-<key>/libraries/<folder>/` the same way. arduino-cli compiles with `--build-path
<kept>/build --output-dir <run>/binary --warnings W --dump-profile`, so it rebuilds only what changed (`incremental:
true`); `--clean` removes `<kept>/build` first. Each `--build-property` is passed on as given; the `--define` values
become `compiler.c.extra_flags` and `compiler.cpp.extra_flags` (`-DNAME=VALUE`, in single quotes when the value is
more than letters, digits and `_.+:/-`, which is how arduino-cli keeps spaces and double quotes; a value with a
single quote or a control character is refused, `define-invalid`, and one of those two properties cannot be given
besides a define, `property-invalid`). While another running compile holds the kept folder, the compile
builds in its staging folder instead (`incremental: false`). The twelve most recently used build folders stay. A
`sketch.yaml` never reaches arduino-cli, because its `default_profile` would turn the compile into a profile build
that installs platforms; a sketch.yaml with `profiles` or `default_profile` gives the warning `sketch-profile-unused`.
Right before arduino-cli compiles, the run folder gets a `result.json` with status `incomplete` and error
`interrupted`, so a Stop, timeout or crash leaves a run that reads as interrupted; the final document replaces it.
The staging folder is removed when the operation ends.

Compile result (`operation: "compile"`): `fqbn`, `fqbnFrom`, `incremental`, `board` (name), `options`, `platform`
`{id, version, recipesSha256, hooks[]}` (hooks are the `recipe.hooks.*` build properties, recorded, never run
separately), `arduinoCli` `{version}`, `configSha256` (the offline configuration with the environment root written as
`<arduino-home>`), `source` `{path, sha256, files[{path, sha256, bytes}]}` (the original sketch, relative to the
working directory), `libraries[]` `{name, version, location, platform? | sha256?}` (`location` `platform` for
libraries of the core, `index` for `user/libraries`, `local` for `--library-dir`; every library the build used, none
needs declaring), `profile` (the build profile arduino-cli prints for this build - platform and library versions -
also written as `profile.yaml`), `sizes[]` `{section, bytes, maxBytes}` from the toolchain (text = flash, data =
RAM), `binaries[]` `{path, sha256, bytes}`, `diagnostics[]` `{severity, file, line, column, message}` with files
relative to the sketch, `log` (`compile.log`), `defines[]` and `buildProperties[]` when given, `compileCommands`
(the path of `compile_commands.json` copied from the build path into the run folder, with `--compile-commands`;
warning `compile-commands-missing` when arduino-cli wrote none) and `symbols` `{flash[], ram[]}`, each `{name, bytes,
kind}` largest first, with `--symbols N` or, with 15 entries, when arduino-cli's error says the program "exceeds
available space". The symbols come from `<tool> --size-sort --print-size --reverse-sort --demangle` on the build
path's `<name>.ino.elf`, where the tool is the `nm` next to the build property `compiler.size.cmd` in
`compiler.path`; `kind` is `text` or `rodata` (flash), `data` (flash and RAM) or `bss` (RAM); warning
`symbols-unavailable` when `--symbols` was given and the tool or the program is missing. A build that does not fit
reports its `sizes` from the text arduino-cli prints. "Multiple libraries were found" becomes a warning `library-ambiguous`.
Compiler errors make the status `fail`, exit 3, and no binary of a failed compile is listed; each `fatal error:
<header>: No such file or directory` adds an error `header-missing` with `header` and `libraries[]` `{name, latest}`,
up to five index libraries that provide the header - the library named like the header first, then those listing it
in `providesIncludes`, then those whose name holds every word of the header's name - and the install command for the
first.

`upload` options: `--build FILE` (the `result.json` of a compile run inside the working directory; VERA's approval
binds its hash), `--port PORT`, `--identity KEY`, `--programmer ID`, `--verify`, `--watch SECONDS` (1 to 120),
`--baud N` (300 to 4000000), `--network`, `--password-file FILE`, `--run-id`, `--results-dir`. Checks before the board is touched: the document is a
format 1 compile result with status `pass` (`build-invalid`, `build-failed`); every file of `<run>/sketch` and
`<run>/binary` and the original sketch hash as recorded (`conflict`; a missing original sketch is a conflict too); a
programmer is one of the board's (`programmer-unknown`). The port:

1. `--port`: it must be connected (`port-missing`) and, when `--identity` is given, carry it (`identity-mismatch`,
   naming where the identity is now).
2. else `--identity`: the one port that carries it (`port-missing` for none, `identity-ambiguous` for several).
3. else the first of these that is exactly one port: `default_port` of the sketch's `sketch.yaml` as it is now, the
   ports whose identified board is the build's, the USB serial ports, all serial ports; otherwise `port-required`
   with the ports.

With `--network`, `--port` is the board's network address (a host name or IP address) and none of the three steps
runs: no serial port is listed before or after, the identity is `network:<address>`, `port.after` is the address and
`port.protocol` is `network`; `--identity`, `--programmer` and `--watch` are refused with it (`arguments`).
arduino-cli uploads with `--protocol network --upload-field password=<P>`, where P is the first line of
`--password-file` (a file of the working directory) or empty; the password is written to no document or log.

A port that identifies as another board than the build's is the warning `board-mismatch`, and one that identifies no
board (no match, or a common USB bridge) the warning `board-unverified`; the upload runs. The recorded sketch files
(never another file of the copy, such as a `sketch.yaml` added later) and the binary folder are copied to staging,
their hashes checked again (`conflict`), and arduino-cli uploads those copies with `--fqbn --port --protocol serial
[--programmer] [--verify] --input-dir <staged binaries> <staged sketch>`. Right before it uploads, the run folder gets
an `incomplete` record saying the board's state is unknown if the run ends there. With `--watch`, after a successful
upload, arduino-cli runs as `monitor --port <port.after or the used port> --protocol serial --config baudrate=<N>
--quiet` with an open stdin for the given seconds; closing stdin ends it. The baud rate is `--baud`, else
`default_port_config.baudrate` of the sketch.yaml, else 115200. Upload result (`operation: "upload"`): `build` (path
and sha256 of the result file), `fqbn`, `binary` (primary file and sha256), `port` `{before, after, reported?}`,
`identity`, `board` `{identified, names[], bridge?}`, `programmer?`, `verified` (true only with `--verify` and
success), `log`, and with `--watch` `serial` `{port, baud, seconds, characters, text, log}` (`text` whole up to 4000
characters, else its first 1200 and last 2500; everything in `serial.log`), with warning `serial-silent` when nothing
arrived.

`compile --upload` runs the upload of the build it just wrote, in the same process and with the upload options of the
call; they are refused without `--upload` (`arguments`). The compile's run folder and result stand as written
(status `pass`); the printed document carries the upload under `upload` `{status, runId, port, identity, board,
binary, verified, programmer?, serial?, log}`, the upload's errors and warnings, and the upload's status and exit
code as its own.

### Board identity

`boards list` returns the serial ports under `ports` (other protocols counted under `ignored`) and the ports of the
network protocol under `network` `{address, label, boards[]}`, when there are any. Identity key: `usb:<vid>:<pid>:<serial
number>` (lower-case hex, serial as reported) when the port reports a USB serial number, else `usb:<vid>:<pid>` with
`stable: false`, else `serial:<address>` with `stable: false`. Boards matched by arduino-cli are listed with name and
FQBN; a port whose VID:PID is a common USB bridge (FTDI 0403:6001/6010/6011/6014/6015, WCH 1a86:7523/7522/55d4/55d3,
Silicon Labs 10c4:ea60/ea70, Prolific 067b:2303) is `identified: false` with `bridge` named and any matches kept as
`candidates`, never as the board. After an upload the identity is looked up again; `port.after` is where it is now
(a board that re-enumerates in its bootloader may return on another port). When several ports share the identity and
the used port is among them, `port.after` is the used port. An identity on no port, or on several others, gives
`port.after: null` with warning `identity-not-found` or `identity-ambiguous`; a board list that fails after the upload
keeps the upload's status and gives `port.after: null` with warning `ports-unlisted` (the port is unknown).

### Run folders and documents

Run folders are `<results-dir>/<run-id>/`, created exclusively inside the working directory and never inside `.vera`;
the run id is `<UTC yyyymmddThhmmssZ>-<operation>-<4 hex>` unless `--run-id` names a new one. Every written document
is `result.json` (`format: 1`, `kind: "arduino-tool-result"`, `operation`, `runId`, `startedAt`, `finishedAt`,
`status` (`pass`, `fail`, `incomplete`, `blocked` or `error`), `errors[]`, `warnings[]`, plus the operation's fields) and `report.md`; no absolute path appears in them
(the environment root is `<arduino-home>`, the staging folder `<staging>`). stdout carries the same document without
long lists past 11000 UTF-16 units, counting what it omits.

## Data / interface

```text
arduino-tool --version            -> "arduino-tool 0.3.0"
arduino-tool inspect --sketch Blink
arduino-tool install core arduino:avr
arduino-tool install library "Adafruit BME280 Library"
arduino-tool attach --sketch Blink --fqbn arduino:avr:nano:cpu=atmega328 --port COM5
arduino-tool compile --sketch Blink
arduino-tool compile --sketch Blink --upload --watch 5
arduino-tool upload --build arduino-iot-results/20261113T120000Z-compile-1a2b/result.json --port COM5
arduino-tool upload --build arduino-iot-results/20261113T120000Z-compile-1a2b/result.json --network --port 192.168.1.20
arduino-tool examples copy --library "Adafruit BME280 Library" --example bme280test --to sketches/Climate
arduino-tool compile --sketch Blink --define DEBUG=1 --symbols 20
arduino-tool cli -- burn-bootloader -b arduino:avr:uno -p COM5 -P usbasp
arduino-tool clean --runs --keep 3
```

## Examples

- `--fqbn arduino:avr:unoo` -> exit 2, `fqbn-unknown`, candidates include `arduino:avr:uno`; nothing compiled.
- A sketch including a missing header -> exit 3, status `fail`, diagnostic `fatal error` at `Miss.ino:1:10` and
  `header-missing` naming the libraries that provide it; no binary.
- Editing `Blink.ino` after compile -> upload exit 2 `conflict`; arduino-cli never runs.
- `compile --upload` with no board connected -> exit 2, `port-required`; the compile's run folder holds a passing
  result that a later `upload --build` can send.

## Acceptance

The requirements on the journal's `requirements:` line, verified offline with a fake arduino-cli and with the real
arduino-cli 1.6.0 and the cores arduino:avr 1.8.8 and arduino:samd 1.8.14 when `VERA_TEST_ARDUINO_CLI` names it.

## Assumptions and open decisions

- arduino-cli's JSON field names (`builder_result.used_libraries`, `executable_sections_size`, `build_properties`,
  `profile_out`, `detected_ports[].port.properties.{vid,pid,serialNumber}`, `matching_boards`) are those of 1.6.0; the
  version range is `>=1.6,<2`. Observed for compile and board list without USB boards; the USB properties come from
  its serial-discovery documentation and stay unverified until a board is connected.
- Observed with arduino-cli 1.6.0 and arduino:avr 1.8.8 on Windows 11: a reused `--build-path` rebuilds only what
  changed (Blink 3.4 s, then 1.1 s) and is wiped by arduino-cli itself when the build options differ; `monitor` ends
  when its stdin closes. An upload and the monitor have not run against a real board. A sketch that does not fit
  fails with "text section exceeds available space in board", lists no section sizes and leaves the linked ELF in the
  build path; `avr-nm` lies next to `avr-size`. A define in single quotes reaches the compiler with its spaces and
  double quotes.
- The network upload is argv-level only: `--upload-field password=` for a board without a password and the behaviour
  of arduino-cli's network protocol under the offline configuration are unverified until a board is on the network.
- No cross-process lease: a CLI process and the desktop app can still both open one port (LAB-01 lease registry).
