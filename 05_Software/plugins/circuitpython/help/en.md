# CircuitPython

CircuitPython puts code and compatible libraries on a board that already runs CircuitPython 9, 10 or 11. The agent lists CIRCUITPY drives and serial ports by identity, inspects the firmware, code and `/lib`, prepares libraries from a pinned Adafruit bundle tag, deploys approved files one verified file at a time and captures the console run that follows. Results go to `arduino-iot-results/<run-id>/` in the workbench.

## What it needs

- **circuitpython-tool**: a script installed automatically by **Install dependencies** on the plugin page.
- A board running CircuitPython 9, 10 or 11, connected by USB with its CIRCUITPY drive mounted. Installing the firmware (UF2) is your step; this plugin never does it.
- The Adafruit bundle tag to pin, a release date of the Adafruit CircuitPython Bundle (see https://circuitpython.org/libraries). The agent asks you when the workbench does not already use one.
- No required plugins and no configuration parameters.

## How to use it

- "Which CircuitPython boards are connected?" (skill `circuitpython-deploy`)
- "Identify the board on E: and show the code and libraries on it."
- "Check whether the libraries in /lib match the board's firmware." (skill `circuitpython-libraries`)
- "Prepare adafruit_bme280 and neopixel for CircuitPython 9 from bundle 20261110."
- "Deploy app/code.py with that library set to the board on E: and capture 10 seconds of console output from COM7."

Before writing, the agent can inspect the drive so that a deploy refuses files you changed on the board since then. `settings.toml` and `secrets.py` are listed but never read.

## Risk and approvals

- Safe, runs without asking: listing drives and ports, and run reports.
- Device-read: identifying the board, inspecting its code and libraries, and reading the console without sending anything.
- Device-write: preparing libraries (a download from github.com into VERA's cache and the workbench; no board is touched), deploying files to the drive, and a console capture with `--reload`, which stops and restarts `code.py`. The new code runs right after a deploy and may drive anything wired to the board's pins; Stop does not stop it.
- Irreversible: a deploy with `--boot`, which replaces `boot.py`. It can take the drive away from this computer or disable USB until the board is started in safe mode. VERA asks you to type the confirmation word, except in Bypass.

In Ask and Auto-edit modes VERA asks before every device-write command.

## Limits

- Windows x64 and Linux x64.
- No REPL, no code given as an argument, no firmware installation and no update of all libraries.
- A USB drive has no transaction across files: after an unplug or Stop the result lists which files are confirmed.
- Reference: https://docs.circuitpython.org/en/latest/docs/workflows.html
