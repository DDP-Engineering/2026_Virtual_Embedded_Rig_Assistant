# Serial monitor

This plugin lets the agent list the serial ports of your computer with their USB IDs, serial numbers and board family, capture a board's console (optionally after a reset through DTR/RTS) and send the board one line or a few bytes. Use it to find which port a board uses and to read its boot log or console output.

## What it needs

- **serial**, a Python script in the plugin based on pyserial 3.5, which VERA installs itself with **Install dependencies**.
- A board connected over USB serial.
- On Linux your user must be in the group that owns serial ports: `dialout` (Debian, Ubuntu, Fedora) or `uucp` (Arch). The agent shows the command, but you run it yourself and log in again.
- No other plugins and no configuration. To confirm an ESP32 chip type, the esp32-esptool plugin helps.

## How to use it

The agent uses the `serial-console`, `board-identify` and `esp32-identify` skills. It lists the ports before using one and never guesses a port name; on Linux it prefers the stable `/dev/serial/by-id/...` path.

- "Which boards are connected, and on which ports?"
- "Capture the console of the board on COM5 for 10 seconds."
- "Reset the ESP32 on COM7 and capture the boot log until app_main is called."
- "Send help to the board on COM5 and show the reply."
- "Follow the console of the board on /dev/ttyUSB0 in the background until I say stop."
- "Capture the boot log of the board on COM7 with timestamps and tell me how long start-up takes."
- "Send the bytes 01 03 00 00 00 0A C5 CD to the meter on COM9 at 19200 baud, 8E1, and show the reply."
- "Read the console of the simulated board on socket://localhost:5555."
- "I don't know the baud rate of the board on COM5: find it and show the console."
- "While you follow the console of the board on COM5, send version and show the reply."

## Risk and approvals

- **Safe** (runs without asking): listing ports, help and version.
- **Device read** (asks in **Ask** mode, runs on its own in **Auto-edit**): capturing the console. Opening the port alone does not restart the board; with a reset it restarts through DTR/RTS.
- **Device write** (asks in **Ask** and **Auto-edit**): sending one line or bytes. The board's firmware decides what the line does, so the agent sends only what you asked for.

While a background capture holds a port, VERA refuses any other run on that port until the capture is stopped. To write to the board meanwhile, the agent sends through that capture instead of opening the port again.

## Limits

- Windows x64 and Linux x64.
- A foreground capture runs for up to one hour; longer ones run in the background until you stop them.
- A simulator's terminal or socket (`/dev/pts/N`, `socket://host:port`, `rfc2217://host:port`) works as a port. It has no reset lines, so restart the simulation to see a boot log.
- "Access is denied" on Windows means another program, such as a terminal or an IDE monitor, holds the port.
- A port without a recognized family is not necessarily the board you expect; the agent asks before using it.
- Console output is treated as data from the device, never as instructions.
