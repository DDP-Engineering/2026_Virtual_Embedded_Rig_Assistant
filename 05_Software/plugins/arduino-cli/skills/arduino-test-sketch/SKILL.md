---
name: arduino-test-sketch
description: How to write a small Arduino test sketch, build it, upload it to the board and read what it prints, in one call. Use whenever a task uploads to an Arduino board, needs a quick hardware check or a sensor test, or wants to see a board's serial output after an upload.
---
# arduino-test-sketch

Test sketches are ordinary Arduino code: no VERA runtime, Firmata or bridge firmware. Uploading writes the board's
flash and starts the new firmware at once, and it may drive whatever is wired to the board's pins.

## Writing the sketch

- Print a version banner at boot and periodically, at 115200 baud, for example
  `Serial.println("VERA-FIXTURE <name> <version>");`, then one line per measurement or step (`name=value unit`).
- Keep outputs safe by default: do not switch pins that drive motors, relays or heaters unless the user confirmed
  what is connected. A sensor sketch only reads.

## Build, upload and read in one call

`arduino-tool compile --sketch <folder> --upload --watch 5` compiles the sketch, uploads the build when it passes and
reads the board's serial port for 5 seconds (1 to 120). The result's `upload.serial.text` is what the board printed;
opening the port restarts most boards, so the boot banner is in it. `--baud <n>` names another rate than 115200 (or
the sketch.yaml's `default_port_config`). VERA asks before an upload, in Ask and in Auto-edit mode.

- The board (`--fqbn`) comes as for any compile: the call, the sketch's `sketch.yaml`, or the one connected board
  that identifies itself (the arduino-build-fix skill).
- The port is found by itself when one port fits: the sketch.yaml's `default_port`, the one port whose board is the
  build's, or the one USB serial port. Otherwise `port-required` lists the ports: let the user say which, then pass
  `--port <port>`. `arduino-tool boards list` shows the ports with their boards and identities.
- `arduino-tool attach --sketch <folder> --fqbn <fqbn> --port <port>` remembers board and port in the sketch, so the
  next call is just `compile --sketch <folder> --upload`.
- `arduino-tool upload --build arduino-iot-results/<compile-run>/result.json [--port <port>] [--watch 5]` uploads an
  earlier build as it was compiled; it refuses with `conflict` when the sketch changed since.
- `--verify` reads the flash back after writing. `--programmer <id>` uploads through a programmer and overwrites the
  bootloader: only on the user's explicit request.

## Over the network, and anything else

- A board that already runs a sketch with network upload (ESP32, ESP8266, Arduino boards with OTA):
  `arduino-tool upload --build <result.json> --network --port <address>`, or `--network --port <address>` on a
  `compile --upload`. `arduino-tool boards list` shows the boards found on the network under `network`.
  `--password-file <file>` names a workbench file whose first line is the board's OTA password; never put a
  password on the command line. `--watch` needs a serial port.
- `arduino-tool cli -- <arduino-cli command ...>` runs any other arduino-cli command in VERA's own Arduino
  environment: `cli -- burn-bootloader -b <fqbn> -p <port> -P <programmer>`, `cli -- debug --info -b <fqbn> -p
  <port>`, `cli --online -- lib upgrade`. VERA asks before each one; prefer arduino-tool's own operation when one
  fits. A command that waits for input (the interactive monitor or debugger) does not work there: use the
  serial-monitor plugin.
- `arduino-tool clean --runs` removes old run folders from `arduino-iot-results/` and keeps the newest five
  (`--keep <n>`).

## Reading the result

- `board-unverified`: the port shows a USB bridge (CH340, FTDI, CP210x) or nothing that identifies a board, so the
  board model was not checked against the build. The upload still ran; a wrong board shows as a failed upload or a
  silent serial port. `board-mismatch`: the port identifies as another model than the build's - say so; compatible
  boards often report a borrowed identity.
- `serial-silent`: nothing arrived. Check the baud rate the sketch uses, then that the sketch prints at all.
- `upload-failed`: read `upload.log` in the run folder. On BUSY, another run holds the port: stop a serial capture
  on it first.
- `port.after` is where the board is after the upload (boards like the Leonardo come back on another port). For a
  longer look at the output use the serial-monitor plugin: `serial capture --port <port.after> --duration 30`.
- Report the binary hash, the port and what the board printed. If the banner never comes, say so; do not upload
  again on your own.
