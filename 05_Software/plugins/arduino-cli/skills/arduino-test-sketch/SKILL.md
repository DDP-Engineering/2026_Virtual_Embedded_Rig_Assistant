---
name: arduino-test-sketch
description: How to write a small Arduino test sketch, upload exactly its verified build to the right board and read its serial output. Use whenever a task uploads to an Arduino board, needs a quick hardware check or a sensor test, or hands a board between upload and the serial monitor.
---
# arduino-test-sketch

Test sketches are ordinary Arduino code: no VERA runtime, Firmata or bridge firmware. Uploading writes the board's
flash and starts the new firmware at once, and it may drive whatever is wired to the board's pins.

## Writing the sketch

- Print a version banner at boot and periodically, at 115200 baud, for example
  `Serial.println("VERA-FIXTURE <name> <version>");`, then one line per measurement or step (`name=value unit`).
- Keep outputs safe by default: do not switch pins that drive motors, relays or heaters unless the user confirmed
  what is connected. A sensor sketch only reads.
- Compile it as described in `arduino-build-fix`.

## Choosing the board

1. `arduino-tool boards list`: each port has an `identity` (`usb:<vid>:<pid>:<serial>` is stable, others are not),
   `identified` and `boards`. A port behind a USB bridge (`bridge`: CH340, FTDI, CP210x...) is never identified: its
   `candidates` are guesses. Ask the user which port and board to use when more than one is connected or none is
   identified; never pick the first or newest port.
2. Pass that identity on upload; the upload refuses when the port now carries another identity, two ports share it, or
   the identified board does not match the build's FQBN. For an unidentified board add `--board-unverified` only after
   the user confirmed the board.

## Upload and readback

1. Stop any serial capture on the port first: while a capture (or any other run) names the port, VERA refuses the
   upload with BUSY.
2. `arduino-tool upload --build arduino-iot-results/<compile-run>/result.json --port <port> --identity <identity>
   [--verify]`. The approval binds that result file; the upload re-checks the binary and the sketch and refuses with
   `conflict` if either changed after the compile: compile again instead of editing the result.
3. The result's `port.after` is where the board's identity is now (boards like the Leonardo re-enumerate). Read the
   banner there with the serial-monitor plugin: `serial capture --port <port.after> --until "VERA-FIXTURE"
   --duration 10`.
4. Report the build's binary hash, the port before and after, and what the banner showed. If the banner never comes,
   say so; do not upload again on your own.
