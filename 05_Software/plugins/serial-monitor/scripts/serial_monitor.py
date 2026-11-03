# /// script
# requires-python = ">=3.11"
# dependencies = ["pyserial==3.5"]
# ///
"""List serial ports, capture a board's console and send it one line.

VERA runs this script as program `serial` of the serial-monitor plugin. It is not named serial.py because
that name would shadow pyserial's `serial` package. Exit codes: 0 done, 2 invalid arguments, 3 the port
could not be opened or failed, 4 the --until expression never matched.
"""

import argparse
import codecs
import contextlib
import errno
import json
import math
import os
import re
import sys
import time

import serial
from serial.tools import list_ports

VERSION = "1.0.0"
BY_ID = "/dev/serial/by-id"
# The partial line searched by --until keeps at most this many characters.
LINE_CHARS = 4096
RESET_SECONDS = 0.2
# (vendor ID, product ID or None for any product) -> board family
FAMILIES = {
    (0x303A, None): "Espressif native USB",
    (0x10C4, 0xEA60): "Silicon Labs CP210x",
    (0x1A86, 0x7523): "WCH CH340",
    (0x1A86, 0x55D4): "WCH CH343",
    (0x0403, 0x6001): "FTDI FT232R",
    (0x0403, 0x6010): "FTDI FT2232H (ESP-Prog)",
    (0x0403, 0x6014): "FTDI FT232H",
}
EOL = {"crlf": b"\r\n", "lf": b"\n", "cr": b"\r", "none": b""}
PERMISSION = """Permission denied. Add your user to the group that owns serial ports, then log out and in again:
  Debian, Ubuntu, Fedora: sudo usermod -aG dialout $USER
  Arch: sudo usermod -aG uucp $USER"""
HINT = (
    "List the ports again with: serial list. A port that another program or a background capture holds "
    "cannot be opened; close it or stop that run."
)


def family(vid, pid):
    if vid is None or pid is None:
        return None
    return FAMILIES.get((vid, pid)) or FAMILIES.get((vid, None))


def by_id_links():
    """Maps each device a /dev/serial/by-id link resolves to onto the first such link in name order."""
    try:
        names = sorted(os.listdir(BY_ID))
    except OSError:
        return {}
    links = {}
    for name in names:
        links.setdefault(os.path.realpath(os.path.join(BY_ID, name)), f"{BY_ID}/{name}")
    return links


def list_command():
    links = by_id_links()
    ports = []
    for info in sorted(list_ports.comports(), key=lambda port: port.device):
        usb = info.vid is not None and info.pid is not None
        ports.append(
            {
                "port": info.device,
                "vid_pid": f"{info.vid:04X}:{info.pid:04X}" if usb else None,
                "serial_number": info.serial_number or None,
                "family": family(info.vid, info.pid),
                "description": info.description if info.description not in (None, "", "n/a") else None,
                "by_id": links.get(os.path.realpath(info.device)) if links else None,
            }
        )
    print(json.dumps(ports, indent=2))
    return 0


def open_port(port, baud):
    """Opens the port, then releases DTR and RTS, without the reset state DTR released with RTS asserted.

    Linux raises both lines when a port opens and pyserial then applies DTR before RTS, so DTR stays asserted
    until RTS is released: the lines go from both asserted, to DTR only, to none.
    """
    connection = serial.Serial()
    connection.port = port
    connection.baudrate = baud
    connection.timeout = 0.1
    connection.dtr = True
    connection.rts = False
    if os.name == "posix":
        connection.exclusive = True
    connection.open()
    connection.dtr = False
    return connection


def reset(port):
    """Pulses EN low through RTS with IO0 high (DTR released): the chip restarts into its application."""
    port.dtr = False
    port.rts = True
    # Windows usbser.sys sends a new RTS state only together with a DTR update.
    port.dtr = port.dtr
    time.sleep(RESET_SECONDS)
    # Drop what the old firmware printed while the chip is still held in reset, so --until sees only the new boot.
    port.reset_input_buffer()
    port.rts = False
    port.dtr = port.dtr


def read(port, out, duration, until, max_bytes):
    """Copies the port to `out` until the first stop; returns (reason, bytes written, until matched)."""
    decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
    deadline = time.monotonic() + duration
    total = 0
    line = ""
    while True:
        if total >= max_bytes:
            return "max-bytes", total, False
        if time.monotonic() >= deadline:
            return "duration", total, False
        chunk = port.read(min(max(port.in_waiting, 1), max_bytes - total))
        if not chunk:
            continue
        out.write(chunk)
        out.flush()
        total += len(chunk)
        if until:
            *lines, line = (line + decoder.decode(chunk)).split("\n")
            line = line[-LINE_CHARS:]
            if any(until.search(text.rstrip("\r")) for text in (*lines, line)):
                return "until", total, True


def fail(error):
    print(f"serial-monitor: {error}", file=sys.stderr)
    print(PERMISSION if getattr(error, "errno", None) == errno.EACCES else HINT, file=sys.stderr)
    return 3


def positive_float(text):
    try:
        value = float(text)
    except ValueError:
        value = math.nan
    if not math.isfinite(value) or value <= 0:
        raise argparse.ArgumentTypeError(f"expected a number above 0, got {text!r}")
    return value


def positive_int(text):
    try:
        value = int(text)
    except ValueError:
        value = 0
    if value <= 0:
        raise argparse.ArgumentTypeError(f"expected a whole number above 0, got {text!r}")
    return value


def expression(text):
    try:
        return re.compile(text)
    except re.error as error:
        raise argparse.ArgumentTypeError(f"invalid regular expression: {error}") from error


def parser():
    root = argparse.ArgumentParser(
        prog="serial", description="List serial ports, capture a console, send one line.", allow_abbrev=False
    )
    root.add_argument("--version", action="version", version=f"serial-monitor {VERSION}")
    commands = root.add_subparsers(dest="command", required=True)
    commands.add_parser("list", help="list the serial ports as JSON", allow_abbrev=False)

    def port_options(command, duration):
        command.add_argument("--port", required=True, help="COM7, /dev/ttyUSB0 or /dev/serial/by-id/...")
        command.add_argument("--baud", type=positive_int, default=115200)
        command.add_argument("--duration", type=positive_float, default=duration, help="seconds to read")
        command.add_argument("--until", type=expression, help="stop when a line matches this regex")
        command.add_argument("--max-bytes", type=positive_int, default=1048576)

    capture = commands.add_parser("capture", help="read the console", allow_abbrev=False)
    port_options(capture, 10.0)
    capture.add_argument("--reset", action="store_true", help="restart the board through DTR/RTS first")
    send = commands.add_parser("send", help="write one line, then read the reply", allow_abbrev=False)
    port_options(send, 1.0)
    send.add_argument("--text", required=True)
    send.add_argument("--eol", choices=list(EOL), default="crlf")
    return root


def main(argv=None):
    args = parser().parse_args(argv)
    if args.command == "list":
        return list_command()
    # Every failure of the port is exit 3: pyserial raises SerialException, but also OSError (in_waiting on Linux),
    # termios.error (flush on Linux) or ValueError (an unsupported baud rate).
    try:
        port = open_port(args.port, args.baud)
    except Exception as error:
        return fail(error)
    try:
        if args.command == "capture" and args.reset:
            reset(port)
        if args.command == "send":
            port.write(args.text.encode("utf-8") + EOL[args.eol])
            port.flush()
        reason, total, matched = read(port, sys.stdout.buffer, args.duration, args.until, args.max_bytes)
    except Exception as error:
        return fail(error)
    finally:
        with contextlib.suppress(Exception):
            port.close()
    print(f"[serial-monitor] {args.port}: {total} bytes, stopped by {reason}", file=sys.stderr)
    return 4 if args.until and not matched else 0


if __name__ == "__main__":
    sys.exit(main())
