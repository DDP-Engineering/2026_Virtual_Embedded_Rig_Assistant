# REQ-DATA-e444904d - arduino-tool operations, VERA Arduino environment, run folders and result documents

## Behavior

`arduino-tool` (program of the official `arduino-cli` plugin, a standard-library PEP 723 script) is the only way the
agent reaches arduino-cli. It runs arduino-cli as `$VERA_PROGRAM_ARDUINO_CLI --config-file <generated> --json
<command> ...`, argv only, no shell, closed stdin, cwd the operation's staging folder, and prints exactly one JSON
document on stdout. A search text, FQBN part, core or library name that starts with `-` is refused (`arguments`,
`fqbn-invalid`, `version-required`), so no agent value can become an arduino-cli option. Exit codes: 0 the operation
completed and its document has status `pass`; 2 refused before arduino-cli acted (status `blocked`, `errors[]` say
why; no run folder is written); 3 the operation ran and failed (status `fail`, `error` for an arduino-cli call that
failed where its answer was needed (`tool-failed`) or an unexpected error (`internal`), or `incomplete`).

### VERA Arduino environment

The environment root is `$VERA_ARDUINO_HOME` when set (tests), else `<HOME or USERPROFILE>/.vera-arduino`. Layout:
`data/` (arduino-cli `directories.data`: indexes, cores, tools), `downloads/`, `user/` (`directories.user`; index
libraries under `user/libraries/`), `cache/` (`build_cache.path`), `staging/<run-id>-<6 hex>/` (build folders and copies of a
running operation; created as `.starting-<name>` with `owner.json` naming the helper's pid, then renamed into place),
`environment.json`
(`{"format": 1, "indexUrls": [https URL, ...]}`). The Arduino IDE's folders (Arduino15, the sketchbook) are never
named. Two generated configurations, written per operation into its staging folder:

- offline (every operation except `install`): the directories above, `board_manager.additional_urls` from
  environment.json, `network.proxy: http://127.0.0.1:9`, `updater.enable_notification: false`,
  `library.enable_unsafe_install: false`, `output.no_color: true`. The dead loopback proxy makes any HTTP access fail at
  once, so analysis, compile and upload never download indexes, tools, cores or libraries and never query Arduino's
  board-identification service.
- online (`install` only): the same without `network.proxy`.

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
| `install index [--index-url URL]...` | `core update-index`, `lib update-index` (online) | environment.json, data/ |
| `install core VENDOR:ARCH@VERSION` | `core install X@V --skip-post-install` (online) | data/, downloads/ |
| `install library NAME@VERSION` | `lib install NAME@V --no-deps` (online) | user/libraries/, downloads/ |
| `compile --sketch DIR --fqbn FQBN [...]` | `board details`, `core list`, `lib list`, `compile` | run folder |
| `upload --build FILE --port PORT --identity KEY [...]` | `board list`, `upload`, `board list` | run folder |
| `report --run DIR...` | none | run folder |
| `clean` | none | removes staging/ entries of ended runs, and cache/ when no staging entry is in use |

Searches read the index files themselves: arduino-cli 1.6 refreshes an index older than a day before `core search` and
`lib search`, which the offline configuration makes fail. Every word of the text must appear (case-insensitive) in the
id, name, sentence or board names; libraries rank the exact name first, then names holding every word; at most 50
results, each with its latest version. A missing index file is refused (`index-missing`). `clean` keeps a staging
entry whose owner process runs, or which has no readable `owner.json` and changed within the last hour.

Versions are explicit: `install core` and `install library` need `@VERSION` (digits and dots, optional pre-release),
never `latest`. An index URL is `https://` only. `install core` replaces another installed version of the same
platform; the document records the replaced version.

`compile` options: `--sketch DIR` (a folder inside the working directory holding `<folder name>.ino`), `--fqbn
VENDOR:ARCH:BOARD[:KEY=VALUE,...]`, `--core VENDOR:ARCH@VERSION` (asserts the installed version), `--library
NAME@VERSION` (repeatable; declares an installed index library), `--library-dir DIR` (repeatable; a library folder in
the working directory), `--warnings none|default|more|all` (default `default`), `--run-id`, `--results-dir` (default
`arduino-iot-results`). Order of checks, all before arduino-cli compiles: options, sketch folder (at most 2000 files and
16 MiB; links and Windows junctions refused), tool present, platform installed (`core-missing`) and in the asserted
version (`core-version`), no `platform.local.txt` or `boards.local.txt` in the platform folder (`local-override`), FQBN
known (`board details`; unknown board refused `fqbn-unknown` with up to 10 boards of the same platform as candidates)
and every option key and value declared by the board (`fqbn-option`), each declared library installed in its version
(`library-missing`, `library-version`). Then the sketch is copied to `<run>/sketch/<name>/` without `sketch.yaml`, `sketch.json` and a
top-level `build/` folder (reported under `excluded`), library folders to `<run>/libraries/<folder>/`, and arduino-cli
compiles the copy with `--build-path <staging>/build --output-dir <run>/binary --warnings W`. Right before
arduino-cli compiles, the run folder gets a `result.json` with status `incomplete` and error `interrupted`, so a Stop,
timeout or crash leaves a run that reads as interrupted; the final document replaces it. The staging folder is removed
when the operation ends.

Compile result (`operation: "compile"`): `fqbn`, `board` (name), `options`, `platform` `{id, version, recipesSha256,
hooks[]}` (hooks are the `recipe.hooks.*` build properties, recorded, never run separately), `arduinoCli` `{version}`,
`configSha256` (the offline configuration with the environment root written as `<arduino-home>`), `source`
`{path, sha256, files[{path, sha256, bytes}]}` (the original sketch, relative to the working directory), `libraries[]`
`{name, version, location, declared, sha256?}` (`location` `platform` for libraries of the core, `index` for
`user/libraries`, `local` for `--library-dir`), `sizes[]` `{section, bytes, maxBytes}` from the toolchain (text = flash,
data = RAM), `binaries[]` `{path, sha256, bytes}`, `diagnostics[]` `{severity, file, line, column, message}` with files
relative to the sketch, `log` (`compile.log`). A used index library that was not declared makes the status `fail`
(`undeclared-library`); "Multiple libraries were found" becomes a warning `library-ambiguous`. Compiler errors make the
status `fail`, exit 3, and no binary of a failed compile is listed.

`upload` options: `--build FILE` (the `result.json` of a compile run inside the working directory; VERA's approval
binds its hash), `--port PORT`, `--identity KEY`, `--programmer ID`, `--board-unverified`, `--verify`, `--run-id`,
`--results-dir`. Checks before the board is touched: the document is a format 1 compile result with status `pass`
(`build-invalid`, `build-failed`); every file of `<run>/sketch` and `<run>/binary` and the original sketch hash as
recorded (`conflict`; a missing original sketch is a conflict too); the port is present (`port-missing`), carries
the identity (`identity-mismatch`, naming where the identity is now), no other port carries the same identity
(`identity-ambiguous`); an identified board matches the FQBN's board (`board-mismatch`); an unidentified board (no
match, or a common USB bridge) needs `--board-unverified` (`board-unverified`); a programmer is one of the board's
(`programmer-unknown`). The recorded sketch files (never another file of the copy, such as a `sketch.yaml` added
later) and the binary folder are copied to staging, their hashes checked again (`conflict`), and arduino-cli uploads
those copies with `--fqbn --port --protocol serial [--programmer] [--verify] --input-dir <staged binaries> <staged
sketch>`. Right before it uploads, the run folder gets an `incomplete` record saying the board's state is unknown if
the run ends there. Upload result (`operation:
"upload"`): `build` (path and sha256 of the result file), `fqbn`, `binary` (primary file and sha256), `port`
`{before, after}`, `identity`, `board` `{identified, names[], bridge?}`, `programmer?`, `verified` (true only with
`--verify` and success), `log`.

### Board identity

`boards list` returns serial ports only (other protocols counted under `ignored`). Identity key: `usb:<vid>:<pid>:<serial
number>` (lower-case hex, serial as reported) when the port reports a USB serial number, else `usb:<vid>:<pid>` with
`stable: false`, else `serial:<address>` with `stable: false`. Boards matched by arduino-cli are listed with name and
FQBN; a port whose VID:PID is a common USB bridge (FTDI 0403:6001/6010/6011/6014/6015, WCH 1a86:7523/7522/55d4/55d3,
Silicon Labs 10c4:ea60/ea70, Prolific 067b:2303) is `identified: false` with `bridge` named and any matches kept as
`candidates`, never as the board. After an upload the identity is looked up again; `port.after` is where it is now
(a board that re-enumerates in its bootloader may return on another port). An identity on no port or on several gives
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
arduino-tool --version            -> "arduino-tool 1.0.0"
arduino-tool inspect --sketch Blink
arduino-tool install core arduino:avr@1.8.8
arduino-tool compile --sketch Blink --fqbn arduino:avr:nano:cpu=atmega328 --core arduino:avr@1.8.8
arduino-tool upload --build arduino-iot-results/20261113T120000Z-compile-1a2b/result.json --port COM5 --identity usb:2341:0043:8573531303735151E0A1
```

## Examples

- `--fqbn arduino:avr:unoo` -> exit 2, `fqbn-unknown`, candidates include `arduino:avr:uno`; nothing compiled.
- A sketch including a missing header -> exit 3, status `fail`, diagnostic `fatal error` at `Miss.ino:1:10`; no binary.
- Editing `Blink.ino` after compile -> upload exit 2 `conflict`; arduino-cli never runs.

## Acceptance

The requirements on the journal's `requirements:` line, verified offline with a fake arduino-cli and with the real
arduino-cli 1.6.0 and the cores arduino:avr 1.8.8 and arduino:samd 1.8.14 when `VERA_TEST_ARDUINO_CLI` names it.

## Assumptions and open decisions

- arduino-cli's JSON field names (`builder_result.used_libraries`, `executable_sections_size`, `build_properties`,
  `detected_ports[].port.properties.{vid,pid,serialNumber}`, `matching_boards`) are those of 1.6.0; the version range is
  `>=1.6,<2`. Observed for compile and board list without USB boards; the USB properties come from its serial-discovery
  documentation and stay unverified until a board is connected.
- No cross-process lease: a CLI process and the desktop app can still both open one port (LAB-01 lease registry).
