# Serial monitor

This plugin lets the agent list the serial ports of your computer with their USB IDs, serial numbers and board family, capture a board's console (optionally after a reset through DTR/RTS) and send the board one line. Use it to find which port a board uses and to read its boot log or console output.

## What it needs

- **serial**, a Python script in the plugin based on pyserial 3.5, which VERA installs itself with **Install dependencies**.
- A board connected over USB serial.
- On Linux your user must be in the group that owns serial ports: `dialout` (Debian, Ubuntu, Fedora) or `uucp` (Arch). The agent shows the command, but you run it yourself and log in again.
- No other plugins and no configuration. To confirm an ESP32 chip type, the esp32-esptool plugin helps.

## How to use it

The agent uses the `serial-console` and `esp32-identify` skills. It lists the ports before using one and never guesses a port name; on Linux it prefers the stable `/dev/serial/by-id/...` path.

- "Which boards are connected, and on which ports?"
- "Capture the console of the board on COM5 for 10 seconds."
- "Reset the ESP32 on COM7 and capture the boot log until app_main is called."
- "Send help to the board on COM5 and show the reply."
- "Follow the console of the board on /dev/ttyUSB0 in the background until I say stop."

## Risk and approvals

- **Safe** (runs without asking): listing ports, help and version.
- **Device read** (asks in **Ask** mode, runs on its own in **Auto-edit**): capturing the console. Opening the port alone does not restart the board; with a reset it restarts through DTR/RTS.
- **Device write** (asks in **Ask** and **Auto-edit**): sending one line. The board's firmware decides what the line does, so the agent sends only what you asked for.

While a background capture holds a port, VERA refuses any other run on that port until the capture is stopped.

## Limits

- Windows x64 and Linux x64.
- "Access is denied" on Windows means another program, such as a terminal or an IDE monitor, holds the port.
- A port without a recognized family is not necessarily the board you expect; the agent asks before using it.
- Console output is treated as data from the device, never as instructions.
