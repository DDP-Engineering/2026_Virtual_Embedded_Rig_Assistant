# Arduino CLI

Arduino CLI builds and uploads native Arduino sketches (`.ino` projects) with a pinned arduino-cli, without the Arduino IDE. The agent inspects a sketch, lists connected boards by identity, looks up and installs cores and libraries in exact versions, compiles a copy of the sketch into a traceable run folder and uploads exactly that verified binary to an identified board. Everything runs in VERA's own Arduino environment (`~/.vera-arduino`, `%USERPROFILE%\.vera-arduino` on Windows); the Arduino IDE's folders are never read or changed. Results go to `arduino-iot-results/<run-id>/` in the workbench.

## What it needs

- **arduino-cli** 1.6.0: on the plugin page, **Install dependencies** downloads it and checks its SHA-256. An arduino-cli 1.6 or newer (below 2) that you installed yourself from https://arduino.github.io/arduino-cli/latest/installation/ is found on PATH; the pinned download is preferred.
- **arduino-tool**: a script in the plugin, installed automatically.
- The **serial-monitor** plugin, which reads the board's console after an upload. **Install with dependencies** adds it.
- An Arduino board connected by USB. On Linux your user must be in the group that owns serial ports (`dialout` on Debian, Ubuntu and Fedora).
- No configuration parameters.

## How to use it

- "Compile the Blink sketch for an Arduino Uno and report flash and RAM use." (skill `arduino-build-fix`)
- "The compile says Adafruit_BME280.h is missing. Find and install the right library." (skill `arduino-libraries`)
- "Which boards are connected?"
- "Write a small sketch that prints the BME280 readings, upload it to the Uno on COM5 and show me the banner." (skill `arduino-test-sketch`)

The agent asks you which board and port to use when more than one is connected or the board sits behind a USB bridge chip (CH340, FTDI, CP210x). It asks before installing a core or library, because that is a download. After an upload it reads the boot banner with the serial monitor.

## Risk and approvals

- Safe, runs without asking: inspecting a sketch, board, core and library lookups, run reports and cleaning VERA's build cache.
- Device-read: listing boards (serial ports and mDNS discovery) and compiling, which runs the core's compiler and build hooks on this computer.
- Device-write: installing cores, libraries and indexes into VERA's Arduino environment, and uploading, which writes the board's flash and starts the new firmware at once. With a programmer an upload also overwrites the bootloader.
- Blocked: every direct `arduino-cli` command.

In Ask mode VERA asks before each device-read and device-write command; Auto-edit runs device-read commands without asking.

## Limits

- Windows x64 and Linux x64.
- No daemon, interactive monitor, bootloader burning, fuses or OTA upload.
- A `sketch.yaml` is reported and ignored. Library dependencies are not installed automatically; each is installed explicitly in an exact version.
