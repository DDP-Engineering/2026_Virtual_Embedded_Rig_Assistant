Arduino CLI: native Arduino sketches (`.ino` projects) built and uploaded with a pinned arduino-cli, without the
Arduino IDE, an Arduino Runtime or a conversion to PlatformIO. Skills: `arduino-build-fix`, `arduino-libraries`,
`arduino-test-sketch`. Requires the `serial-monitor` plugin, which reads the board's console after an upload.

Programs:

- `arduino-cli`: the official arduino-cli 1.6.0, which VERA downloads and checks by SHA-256 (Windows x64
  `arduino-cli_1.6.0_Windows_64bit.zip`, sha256 `2769b9b282ce597db9679d8ec14d726d57004ca4205ef4d7a795bf36b6cdc9d8`;
  Linux x64 `arduino-cli_1.6.0_Linux_64bit.tar.gz`, sha256
  `321ee249f44c78053234fec0f36101092bc6021bf24939e15e0cc2449c5ed250`), preferred over an arduino-cli 1.6 or newer
  (below 2) found on PATH. arduino-cli is licensed under GPL-3.0 by Arduino. Every direct `arduino-cli` command is
  blocked for the agent.
- `arduino-tool`: a standard-library Python script that is the only way the agent reaches arduino-cli.

VERA's Arduino environment is a folder of its own, `~/.vera-arduino` (`%USERPROFILE%\.vera-arduino` on Windows):
`data/` (indexes, cores, tools), `downloads/`, `user/libraries/`, `cache/` and `staging/`. The Arduino IDE's folders
(Arduino15, the sketchbook) are never read or changed. Cores and libraries are installed only by `arduino-tool
install`, always in an exact version, without post-install scripts (no drivers or udev rules are installed) and
without library dependencies. Every other operation runs arduino-cli with a dead loopback proxy, so it cannot download
anything or ask Arduino's online board-identification service.

| Operation | Risk | What it does |
|---|---|---|
| `inspect --sketch DIR` | safe | sketch files and hashes, ignored `sketch.yaml`, installed cores and libraries |
| `boards details --fqbn F`, `boards search [TEXT]` | safe | installed board definitions, options and programmers |
| `cores list`, `cores search`, `libraries list`, `libraries search` | safe | installed packages and the downloaded indexes |
| `report --run DIR...`, `clean` | safe | summary of run folders; removal of the build cache and ended staging folders |
| `boards list` | device-read | serial ports with identity keys; runs the installed discovery tools (serial, mDNS) |
| `compile --sketch DIR --fqbn F` | device-read | runs the core's compiler, recipes and hooks on a copy of the sketch |
| `install index`, `install core`, `install library` | device-write | downloads into VERA's Arduino environment |
| `upload --build RESULT --port P --identity K` | device-write | writes the verified binary to the board |

Results go to `arduino-iot-results/<run-id>/` in the workbench (`result.json`, `report.md`, logs, the sketch copy and
the binaries), never inside `.vera`. The daemon, the interactive monitor, burning a bootloader, fuses and OTA upload
are not offered. On Linux the user must be in the group that owns serial ports (`dialout` on Debian, Ubuntu and Fedora)
for `boards list` and `upload`.
