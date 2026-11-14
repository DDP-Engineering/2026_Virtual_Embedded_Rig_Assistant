
CircuitPython: code and compatible libraries on a board that already runs CircuitPython 9, 10 or 11. Skills:
`circuitpython-deploy`, `circuitpython-libraries`.

Program:

- `circuitpython-tool`: a PEP 723 Python script with pinned dependencies `circup==3.1.0` (MIT, by Adafruit) and
  `pyserial==3.5`, which VERA installs from PyPI with its uv. From circup it takes only the library-bundle conventions
  (platform names, supported versions, library names, requirements); circup's own commands are never run, so there is
  no "first board found", no "latest bundle" and no update-all.

Operations: `devices`, `identify`, `inspect-code`, `inspect-libraries`, `prepare-libraries`, `deploy`,
`capture-output` and `report`. The board is reached through its CIRCUITPY drive with ordinary file operations and,
for console capture, its serial port; nothing is typed into the REPL.

- `devices` lists the mounted CIRCUITPY drives (firmware, board id and UID from `boot_out.txt`, read-only state) and
  the serial ports. A drive whose UID equals one port's USB serial number is bound to that port and shares its
  identity key `usb:<vid>:<pid>:<serial>`; otherwise its key is `circuitpy-uid:<uid>` or, without a UID,
  `volume-serial:<serial>` (unstable). Volume operations take `--volume` and `--identity` and refuse a missing drive,
  another identity, firmware other than CircuitPython 9-11 and, for a deploy, two drives with one key.
- `prepare-libraries --library adafruit_bme280 --circuitpython 9 --bundle-tag 20261110` is the only operation that
  reaches the network: it downloads the bundle zips of exactly that tag from github.com (once; cached in
  `~/.vera-circuitpython` with their SHA-256 and verified on every later use), resolves the dependencies, refuses any
  `.mpy` file that is not CircuitPython 9+ bytecode, and writes `libraries/` plus `library-set.json` (every file's
  SHA-256) into the run folder. No board is touched.
- `deploy` is offline: the library set and `--source FILE --target /path` pairs go to the drive one file at a time -
  libraries first, `code.py` last - each through `<target>.vera-part`, a read-back hash and a replace. `boot.py`
  needs `--boot`. Space, read-only state, a library set changed since it was prepared or made for another major
  version, and files changed since an `inspect-code` run (`--expect-from`) are refused before anything is written. A
  USB drive has no transaction across files: the result lists every file as confirmed or unconfirmed, and an unplug
  or Stop leaves an `incomplete` result. CircuitPython reloads `code.py` after the files change; `--capture N --port
  PORT` reads the console run that follows (output, traceback, autoreload on/off).
- `capture-output` reads the console for a bounded time; `--reload` sends Ctrl-C and Ctrl-D to start code.py again.

Results (`format: 1`) go to `arduino-iot-results/<run-id>/` in the workbench: `result.json`, `report.md`, copies of
inspected files, the library set and `console.txt`. Exit codes: 0 pass, 1 fail, 2 refused before anything was written
to a drive or sent to a board, 3 incomplete or error.

VERA reserves the named drive (`--volume`) and serial port for the run, across the desktop app and the CLI: another
VERA run on them is BUSY. Stop ends the helper; code already running on the board keeps running. Firmware (UF2) is
never installed here.
