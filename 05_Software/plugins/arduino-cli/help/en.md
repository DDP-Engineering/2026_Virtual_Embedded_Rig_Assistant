# Arduino CLI

Arduino CLI builds and uploads native Arduino sketches (`.ino` projects) with a pinned arduino-cli, without the Arduino IDE. The agent installs cores and libraries, compiles a sketch, uploads the build to your board and reads what the board prints, in one step when you ask for it. Everything runs in VERA's own Arduino environment (`~/.vera-arduino`, `%USERPROFILE%\.vera-arduino` on Windows); the Arduino IDE's folders are never read or changed. Results go to `arduino-iot-results/<run-id>/` in the workbench.

## What it needs

- **arduino-cli** 1.6.0: on the plugin page, **Install dependencies** downloads it and checks its SHA-256. An arduino-cli 1.6 or newer (below 2) that you installed yourself from https://arduino.github.io/arduino-cli/latest/installation/ is found on PATH; the pinned download is preferred.
- **arduino-tool**: a script in the plugin, installed automatically.
- The **serial-monitor** plugin, for longer looks at the board's console. **Install with dependencies** adds it.
- An Arduino board connected by USB. On Linux your user must be in the group that owns serial ports (`dialout` on Debian, Ubuntu and Fedora).
- No configuration parameters.

## How to use it

- "Compile the Blink sketch for an Arduino Uno and report flash and RAM use." (skill `arduino-build-fix`)
- "The compile says Adafruit_BME280.h is missing. Install the right library." (skill `arduino-libraries`)
- "Write a small sketch that prints the BME280 readings, upload it and show me what it prints." (skill `arduino-test-sketch`)
- "Remember that this sketch is for the Nano on COM7."
- "Which boards are connected?"
- "Start from the BME280 library's example sketch."
- "The sketch no longer fits on the Uno. What takes the most flash?"

The agent finds the board and the port by itself when only one fits, and asks you when several are connected. A board behind a USB bridge chip (CH340, FTDI, CP210x) cannot identify itself, so tell the agent which board it is; the upload then runs with a note that the model was not checked.

## Risk and approvals

- Safe, runs without asking: inspecting a sketch, listing boards and library examples, board, core and library lookups, compiling (which runs the core's compiler and build hooks on this computer), run reports and cleaning VERA's build folders.
- Device-read: installing cores, libraries and indexes, which downloads into VERA's Arduino environment, remembering a sketch's board and port in its `sketch.yaml`, copying a library example into the workbench as a new sketch, and removing old run folders.
- Device-write: uploading, over USB or the network, also as part of a compile, which writes the board's flash and starts the new firmware at once; and any other arduino-cli command the agent passes on with `arduino-tool cli`.
- Irreversible: uploading with `--programmer` or burning a bootloader, which overwrites the bootloader. VERA asks you to type the confirmation word, except in Bypass.
- Blocked: every direct `arduino-cli` command.

In Ask mode VERA asks before each device-read and device-write command; Auto-edit runs device-read commands without asking.

## Limits

- Windows x64 and Linux x64. Uploading and reading the serial port have not been run against a real board yet.
- Uploading over the network (OTA) has not been run against a real board either.
- Commands that wait for input, such as arduino-cli's interactive monitor and debugger, and its daemon are not run.
- The profiles of a `sketch.yaml` are not used; its default board and port are.
