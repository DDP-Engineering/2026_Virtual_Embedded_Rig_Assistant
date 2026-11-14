MicroPython: finite file and run operations on a board that already runs MicroPython 1.22 or newer. Skills:
`micropython-deploy`, `micropython-test-script`.

Program:

- `micropython-tool`: a PEP 723 Python script with pinned dependencies `mpremote==1.29.0` (MIT, by the MicroPython
  project), `pyserial==3.5` and `platformdirs==4.14.0`, which VERA installs from PyPI with its uv. It uses mpremote's
  serial transport and sends the board only its own fixed snippets.

Operations: `ports`, `identify`, `files`, `read-file`, `deploy-file`, `run-file`, `capture-output`, `reset` and
`report`. Device operations take `--port` and `--identity` (the identity key `ports` lists) and refuse a missing port
or another identity before the port opens. Entering MicroPython's raw REPL sends Ctrl-C, so every operation except
`ports`, `report` and a plain `capture-output` interrupts the program the board runs; `--restart` soft-resets the board
afterwards so boot.py and main.py run again. Firmware other than MicroPython 1.22 or newer (CircuitPython included)
is refused before anything else.

`deploy-file` records the current target's hash, writes the workbench file to `<target>.vera-part`, compares the hash
the board computes, checks that the target did not change meanwhile, then renames the copy over the target (or, where
the file system refuses with EEXIST, removes the target and renames - reported as `remove-then-rename`) and verifies the result.
`boot.py` and `main.py` (in any letter case) are replaced only with `--startup`. `run-file` runs a workbench script from RAM after a soft
reset, with a deadline (Ctrl-C after `--timeout`) and a verdict from its traceback; nothing is stored on the board.

Results (`format: 1`) go to `arduino-iot-results/<run-id>/` in the workbench: `result.json`, `report.md`, copies of the
source and read files, and the captured output. Exit codes: 0 pass, 1 fail, 2 refused before the board's files or code
were touched, 3 incomplete or error (`disconnected`, `device-reset`, `no-response`, `timeout`, `port-lost`).

VERA reserves the named serial port for the run, across the desktop app and the CLI: another VERA run on that port is
BUSY. Stop ends the helper; code already running on the board keeps running. Firmware is never installed or backed up
here; use the board vendor's tool (for example esptool for an ESP32) first.
