Arduino CLI: native Arduino sketches (`.ino` projects) built and uploaded with a pinned arduino-cli, without the
Arduino IDE, an Arduino Runtime or a conversion to PlatformIO. Skills: `arduino-build-fix`, `arduino-libraries`,
`arduino-test-sketch`. Requires the `serial-monitor` plugin for longer looks at a board's console.

Programs:

- `arduino-cli`: the official arduino-cli 1.6.0, which VERA downloads and checks by SHA-256 (Windows x64
  `arduino-cli_1.6.0_Windows_64bit.zip`, sha256 `2769b9b282ce597db9679d8ec14d726d57004ca4205ef4d7a795bf36b6cdc9d8`;
  Linux x64 `arduino-cli_1.6.0_Linux_64bit.tar.gz`, sha256
  `321ee249f44c78053234fec0f36101092bc6021bf24939e15e0cc2449c5ed250`), preferred over an arduino-cli 1.6 or newer
  (below 2) found on PATH. arduino-cli is licensed under GPL-3.0 by Arduino. Every direct `arduino-cli` command is
  blocked for the agent, because it would use the Arduino IDE's folders.
- `arduino-tool`: a standard-library Python script that is the only way the agent reaches arduino-cli;
  `arduino-tool cli -- ...` passes any arduino-cli command on in VERA's own Arduino environment.

VERA's Arduino environment is a folder of its own, `~/.vera-arduino` (`%USERPROFILE%\.vera-arduino` on Windows):
`data/` (indexes, cores, tools), `downloads/`, `user/libraries/`, `cache/`, `builds/` and `staging/`. The Arduino
IDE's folders (Arduino15, the sketchbook) are never read or changed. Cores and libraries are installed only by
`arduino-tool install`, without post-install scripts (no drivers or udev rules are installed). Every other operation
runs arduino-cli with a dead loopback proxy, so it cannot download anything or ask Arduino's online
board-identification service.

| Operation | Risk | What it does |
|---|---|---|
| `inspect --sketch DIR` | safe | sketch files and hashes, the defaults of its `sketch.yaml`, installed cores and libraries |
| `boards list`, `boards details --fqbn F`, `boards search [TEXT]` | safe | serial ports with their boards and identity keys (runs the installed discovery tools); installed board definitions, options and programmers |
| `cores list`, `cores search`, `libraries list`, `libraries search` | safe | installed packages and the downloaded indexes |
| `examples list [--library NAME] [--fqbn F]` | safe | the example sketches of installed libraries |
| `compile --sketch DIR [--fqbn F] [--define NAME=VALUE] [--symbols N]` | safe | runs the core's compiler, recipes and hooks on a copy of the sketch |
| `report --run DIR...`, `clean` | safe | summary of run folders; removal of the build cache, the kept build folders and ended staging folders |
| `install index`, `install core V:A[@VERSION]`, `install library NAME[@VERSION]...` | device-read | downloads into VERA's Arduino environment |
| `attach --sketch DIR [--fqbn F] [--port P]` | device-read | writes the board and port into the sketch's `sketch.yaml` |
| `examples copy --library NAME --example NAME [--to DIR]` | device-read | copies one example into the workbench as a new sketch; nothing is overwritten |
| `clean --runs [--keep N]` | device-read | removes arduino-tool's run folders from the workbench, except the newest (five by default) |
| `upload --build RESULT [--port P] [--watch S]`, `compile ... --upload [--watch S]` | device-write | writes the build to the board, then reads its serial output; `--network --port ADDRESS` uploads over the network (OTA) |
| `cli [--online] -- COMMAND ...` | device-write | any other arduino-cli command, in VERA's own Arduino environment and in the workbench |
| `upload` or `compile --upload` with `--programmer ID`; `cli` with `burn-bootloader` or a programmer | irreversible | also overwrites the bootloader; needs the typed confirmation |

How a call finds what it does not name:

- **The board**: `--fqbn`, else `default_fqbn` of the sketch's `sketch.yaml` (which `attach` writes with arduino-cli's
  own `board attach`), else the one connected board that identifies itself; otherwise `fqbn-required`. The profiles
  of a `sketch.yaml` are not used (`sketch-profile-unused`): they would make arduino-cli install platforms during a
  compile.
- **The port**: `--port`, else the port that carries `--identity`, else `default_port` of `sketch.yaml`, else the one
  port whose board is the build's, else the one USB serial port; otherwise `port-required` with the ports. A given
  `--identity` is still checked against the port. A port behind a USB bridge (CH340, FTDI, CP210x) or one that
  identifies as another model is a warning (`board-unverified`, `board-mismatch`), not a refusal.
- **Versions**: an install without a version takes the latest and brings a library's dependencies (`--no-deps`
  leaves them out); the result's `installed` lists what was added. A compile uses whatever is installed and records
  it: `platform`, `libraries[]` and `profile`, the same versions as an Arduino build profile (also `profile.yaml`).
  `--core V:A@VERSION` and `--library NAME[@VERSION]` turn that into a check that refuses another version.

A compile reads the sources from a copy in `builds/<sketch>-<key>/`, one folder per sketch and board whose files are
rewritten only when they changed, and builds there, so a later compile rebuilds only what changed (`--clean` rebuilds
everything; the twelve most recently used folders are kept). With arduino-cli 1.6.0 and the AVR core a Blink
compiles in about 3.4 s the first time and 1.1 s after that. A header the compiler does not find is reported as
`header-missing` with the index libraries that provide it.

`--define NAME[=VALUE]` and `--build-property KEY=VALUE` reach the compile as build properties (defines as
`compiler.c.extra_flags` and `compiler.cpp.extra_flags`), and each set keeps its own build folder. `--symbols N`
adds the N largest symbols in flash and in RAM, read with the toolchain's `nm`; a sketch that does not fit reports
them without being asked. `--compile-commands` keeps the build's `compile_commands.json` in the run folder (its
paths point into VERA's Arduino environment).

`--watch SECONDS` (1 to 120) runs arduino-cli's monitor on the board's port after the upload and returns what
arrived (`serial.text`, and `serial.log` in the run folder); `--baud` names the rate, else the sketch.yaml's
`default_port_config`, else 115200. It has not been run against a real board yet, and neither has an upload.

`--network --port ADDRESS` uploads with arduino-cli's network protocol to a board that already runs a sketch with
network upload; `--password-file FILE` names a workbench file whose first line is the board's OTA password (it is
not recorded). `boards list` shows the boards found on the network under `network`. Not run against a real board.

`cli [--online] -- COMMAND ...` runs the arduino-cli command as it is, with VERA's configuration (offline unless
`--online`) and the workbench as its folder, and returns its exit code and the end of its output. The daemon and
commands that wait for input are not for it.

Results go to `arduino-iot-results/<run-id>/` in the workbench (`result.json`, `report.md`, logs, the sources as
compiled and the binaries), never inside `.vera`; `clean --runs` removes the old ones. Burning a bootloader, fuses
and whatever else arduino-tool has no operation for go through `arduino-tool cli -- ...`. On Linux the user must be in the group that owns serial ports (`dialout` on Debian, Ubuntu and Fedora)
for `boards list` and `upload`.
