#!python
"""A stand-in for esptool 5 in tests; it never opens a serial port.

The fake uv of tests/integration/esp32-esptool.test.ts installs this file as the esptool entry point after replacing
the CONFIG line with the run's settings: `version`, the text `esptool version` prints, and `record`, a JSON-lines
file that gets one line per run with the arguments, the working directory and the SHA-256 of every argument that
names an existing file. The chip-id and write-flash outputs follow esptool v5's format; they are representative,
not captured from a board (the `version` default is the real esptool 5.6.0 output).
"""
import hashlib
import json
import os
import sys

CONFIG = {"version": "esptool v5.6.0\n5.6.0", "record": None}

BANNER = "esptool v5.6.0"
CONNECTED = """Connected to ESP32-S3 on {port}:
Chip type:          ESP32-S3 (QFN56) (revision v0.2)
Features:           Wi-Fi, BT 5 (LE), Dual Core + LP Core, 240MHz, Embedded PSRAM 8MB (AP_3v3)
Crystal frequency:  40MHz
USB mode:           USB-Serial/JTAG
MAC:                f4:12:fa:00:11:22

Stub flasher running.
"""
RESET = "\nHard resetting via RTS pin..."


def port(args):
    for index, arg in enumerate(args):
        if arg in ("--port", "-p") and index + 1 < len(args):
            return args[index + 1]
        if arg.startswith("--port="):
            return arg.split("=", 1)[1]
    return "COM1"


def command(args):
    """The first argument that names an esptool command, with `_` read as `-` like esptool v5."""
    names = {"version", "chip-id", "read-mac", "flash-id", "write-flash", "verify-flash", "erase-flash"}
    for arg in args:
        if arg.replace("_", "-") in names:
            return arg.replace("_", "-")
    return None


def files(args):
    found = {}
    for arg in args:
        if os.path.isfile(arg):
            with open(arg, "rb") as handle:
                found[arg] = hashlib.sha256(handle.read()).hexdigest()
    return found


def pairs(args):
    """Offset and file pairs: an integer argument followed by an existing file."""
    result = []
    for first, second in zip(args, args[1:]):
        try:
            offset = int(first, 0)
        except ValueError:
            continue
        if os.path.isfile(second):
            result.append((offset, second))
    return result


def write_flash(args):
    print("Configuring flash size...")
    for offset, name in pairs(args):
        size = os.path.getsize(name)
        end = offset + ((size + 0xFFF) // 0x1000) * 0x1000 - 1
        print(f"Flash will be erased from 0x{offset:08x} to 0x{end:08x}...")
        print(f"Wrote {size} bytes ({max(1, size // 2)} compressed) at 0x{offset:08x} in 0.4 seconds.")
        print("Hash of data verified.")


def main():
    args = sys.argv[1:]
    name = command(args)
    if CONFIG["record"] and name != "version":
        with open(CONFIG["record"], "a", encoding="utf-8") as log:
            log.write(json.dumps({"args": args, "cwd": os.getcwd(), "files": files(args)}) + "\n")
    if name == "version":
        print(CONFIG["version"])
        return 0
    if name is None:
        print("Error: No such command.", file=sys.stderr)
        return 2
    print(BANNER)
    print(CONNECTED.format(port=port(args)))
    if name == "chip-id":
        print("Warning: ESP32-S3 has no chip ID. Reading MAC address instead.")
        print("MAC:                f4:12:fa:00:11:22")
    elif name == "write-flash":
        write_flash(args)
    else:
        print(f"{name} done.")
    print(RESET)
    return 0


sys.exit(main())
