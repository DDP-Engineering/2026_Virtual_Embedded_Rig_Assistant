# MicroPython

This plugin lets the agent work with a board that already runs MicroPython 1.22 or newer. It lists serial ports, identifies the board's firmware, lists and reads its files, deploys a workbench file through a verified temporary copy, runs a workbench script from RAM with a deadline and a pass/fail verdict, captures the console and resets the board. There is no interactive REPL and no firmware installation. Results go to `arduino-iot-results/`.

## What it needs

- **micropython-tool**, a Python script in the plugin with a pinned mpremote, which VERA installs itself with **Install dependencies**.
- A board connected over USB serial that already runs MicroPython 1.22 or newer. Other firmware, CircuitPython included, is refused. To install MicroPython, use the board vendor's tool first (for example esptool for an ESP32).
- No other plugins and no configuration.

## How to use it

The agent uses the `micropython-deploy` and `micropython-test-script` skills. It names the board by its port and the identity that the port listing shows, and asks you which board is behind a USB-to-serial bridge.

- "List the serial ports and identify the MicroPython board on COM5."
- "Show the files in /lib on the board and free space."
- "Deploy app/sensor.py to /lib/sensor.py on the board, then restart it."
- "Write a script that scans the I2C bus, run it on the board with a 30 second timeout and tell me the verdict."
- "Capture the board's console for 10 seconds after a restart."

## Risk and approvals

Almost every board operation interrupts the program the board runs (Ctrl-C), so the agent says so first; with `--restart` the program starts again afterwards.

- **Safe** (runs without asking): listing ports without opening them and summarizing run folders.
- **Device read** (asks in **Ask** mode, runs on its own in **Auto-edit**): identifying the board, listing and reading files, capturing the console and resetting the board, which starts the stored program again.
- **Device write** (asks in **Ask** and **Auto-edit**): deploying a file and running a script from RAM. The approval binds the file's hash. A script may drive the board's pins and whatever is wired to them.
- **Irreversible** (asks, and you type the confirmation word shown on the card): replacing boot.py or main.py, which run at every start; a faulty one can lock out the REPL until the firmware is reinstalled. In **Bypass — full access** this runs without asking.

## Limits

- Windows x64 and Linux x64.
- There is no backup or restore of the board's files.
- Stop ends the helper on your computer only; code already running on the board keeps running.
- VERA reserves the serial port for the run.
