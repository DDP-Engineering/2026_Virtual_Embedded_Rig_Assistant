---
name: micropython-test-script
description: How to write and run a short MicroPython test script from RAM with micropython-tool, read its verdict and capture a board's console. Use whenever a task runs code on a MicroPython board for a check, a sensor reading or a hardware test.
---
# micropython-test-script

`run-file` soft-resets the board (a clean interpreter; boot.py runs, main.py does not) and runs a workbench script from
RAM. Nothing is stored on the board. The script's code may drive the board's pins and anything wired to them, so the
approval is a device-write: state what the script does to the hardware.

## Writing the script

- Print one line per step or measurement (`name=value unit`) and end normally on success.
- Raise an exception (for example `raise AssertionError('no ACK from 0x48')`) to fail: the verdict is `fail` with the
  traceback, `pass` when the script ends without one.
- Keep outputs safe: do not switch pins that drive motors, relays or heaters unless the user confirmed the wiring, and
  switch them off again before the script ends.
- Bound loops yourself; `time.sleep` keeps the script interruptible.

## Running it

`micropython-tool run-file --port COM5 --identity usb:2e8a:0005:E661 --source tests/i2c_scan.py --timeout 30`

- `--timeout` (1-3500 s): past it the helper sends Ctrl-C and reports `incomplete` / `timeout` with the application
  `interrupted`.
- `--max-output` caps the kept output; `outputTruncated` counts the rest. The full kept text is in the run folder.
- After the run the board's program is `stopped`; add `--restart` to start main.py again.
- program_stop ends the helper on this computer only: code already running on the board keeps running until it
  ends, the board is reset (`micropython-tool reset --mode soft`) or it is unplugged.

## Console

`micropython-tool capture-output --port ... --identity ... --duration 10` reads the console without sending anything;
`--restart` first restarts the board's program so its start-up output is captured.
