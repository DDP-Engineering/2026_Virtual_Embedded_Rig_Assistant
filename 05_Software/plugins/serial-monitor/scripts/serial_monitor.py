# /// script
# requires-python = ">=3.11"
# dependencies = ["pyserial==3.5"]
# ///
"""List serial ports, capture a board's console and send it one line or a few bytes.

While a capture runs it owns its port. `send` without --port hands its bytes to that capture through a local
socket, so a console can be watched and typed into at the same time.

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
import secrets
import select
import socket
import sys
import tempfile
import time

import serial
from serial.tools import list_ports

VERSION = "0.3.0"
BY_ID = "/dev/serial/by-id"
SYS_TTY = "/sys/class/tty"
# The partial line searched by --until keeps at most this many characters.
LINE_CHARS = 4096
# Generous bounds, so one call cannot hold a port without end or compile an arbitrarily large pattern.
MAX_DURATION = 7 * 24 * 3600
UNTIL_CHARS = 1024
RESET_SECONDS = 0.2
# After --until matched in a line that has not ended, the rest of the line is awaited for this long without bytes.
SETTLE_SECONDS = 0.2
HEX_ROW = 16
# Rates tried by --baud auto, the usual ones first; each is listened to for at most this long.
BAUD_RATES = (115200, 9600, 57600, 74880, 38400, 19200, 230400, 460800, 921600)
PROBE_SECONDS = 0.8
PROBE_BYTES = 256
# A sender that connected has this long to state what it wants written.
REQUEST_SECONDS = 2.0
# (vendor ID, product ID or None for any product) -> what is behind the port
FAMILIES = {
    (0x303A, None): "Espressif native USB",
    (0x10C4, 0xEA60): "Silicon Labs CP210x",
    (0x10C4, 0xEA70): "Silicon Labs CP2105",
    (0x1A86, 0x7523): "WCH CH340",
    (0x1A86, 0x5523): "WCH CH341",
    (0x1A86, 0x55D3): "WCH CH343",
    (0x1A86, 0x55D4): "WCH CH9102",
    (0x0403, 0x6001): "FTDI FT232R",
    (0x0403, 0x6010): "FTDI FT2232H (ESP-Prog)",
    (0x0403, 0x6011): "FTDI FT4232H",
    (0x0403, 0x6014): "FTDI FT232H",
    (0x0403, 0x6015): "FTDI FT231X",
    (0x067B, 0x2303): "Prolific PL2303",
    (0x2341, None): "Arduino",
    (0x2A03, None): "Arduino",
    (0x2E8A, None): "Raspberry Pi Pico",
    (0x16C0, 0x0483): "Teensy",
    (0x0483, 0x374B): "ST-Link V2-1 virtual COM port",
    (0x0483, 0x3752): "ST-Link V2-1 virtual COM port",
    (0x0483, 0x374E): "ST-Link V3 virtual COM port",
    (0x0483, 0x374F): "ST-Link V3 virtual COM port",
    (0x0483, 0x3753): "ST-Link V3 virtual COM port",
    (0x0483, 0x5740): "STM32 USB CDC",
    (0x1366, None): "SEGGER J-Link virtual COM port",
    (0x0D28, 0x0204): "CMSIS-DAP (DAPLink) virtual COM port",
    (0x0451, 0xBEF3): "Texas Instruments XDS110",
    (0x1915, None): "Nordic Semiconductor",
    (0x1FC9, None): "NXP",
    (0x03EB, None): "Microchip (Atmel)",
    (0x04D8, None): "Microchip",
}
EOL = {"crlf": b"\r\n", "lf": b"\n", "cr": b"\r", "none": b""}
ESCAPES = {b"r": b"\r", b"n": b"\n", b"t": b"\t", b"0": b"\0", b"e": b"\x1b", b"\\": b"\\"}
PERMISSION = """Permission denied. Add your user to the group that owns serial ports, then log out and in again:
  Debian, Ubuntu, Fedora: sudo usermod -aG dialout $USER
  Arch: sudo usermod -aG uucp $USER"""
HINT = (
    "List the ports again with: serial list. A port that another program or a background capture holds "
    "cannot be opened; close it or stop that run. To write to a board while your capture reads it, use send "
    "without --port."
)
MISSING = "This port does not exist. List the ports again with: serial list."
NO_SERVER = "Nothing answered at this address. Start the simulator or the serial server first, then check the host and port."
NO_DATA = (
    "No bytes arrived at any baud rate, so the rate cannot be detected. The board must be printing while it is "
    "listened to: add --reset, or give the rate with --baud."
)
NO_CAPTURE = "No capture is running to send through. Give the port with --port, or start a capture first."
NO_LINES = (
    "--reset needs the DTR and RTS lines, which this port does not have (a simulator's terminal or socket). "
    "Restart the simulation instead."
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


def absent(device):
    """A legacy port Linux lists without hardware behind it: its UART type reads 0 (unknown)."""
    try:
        with open(os.path.join(SYS_TTY, os.path.basename(device), "type"), encoding="ascii") as file:
            return file.read().strip() == "0"
    except OSError:
        return False


def list_command():
    links = by_id_links()
    ports = []
    for info in sorted(list_ports.comports(), key=lambda port: port.device):
        if absent(info.device):
            continue
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


def open_port(args):
    """Opens the port, then releases DTR and RTS, without the reset state DTR released with RTS asserted.

    Linux raises both lines when a port opens and pyserial then applies DTR before RTS, so DTR stays asserted
    until RTS is released: the lines go from both asserted, to DTR only, to none. Returns the port and whether
    it has the two lines: a simulator's pseudo-terminal and a raw socket have none.
    """
    network = "://" in args.port
    connection = serial.serial_for_url(args.port, do_not_open=True)
    connection.baudrate = args.baud
    connection.bytesize = args.bytesize
    connection.parity = args.parity
    connection.stopbits = args.stopbits
    connection.timeout = 0.1
    connection.dtr = True
    connection.rts = False
    if os.name == "posix" and not network:
        connection.exclusive = True
    connection.open()
    try:
        connection.dtr = False
    except OSError as error:
        if error.errno not in (errno.ENOTTY, errno.EINVAL):
            raise
        return connection, False
    return connection, not network or args.port.lower().startswith("rfc2217://")


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


def readable(data):
    """The share of bytes that read as text: printable ASCII, line ends, tabs and the escape of a colour code."""
    return sum(1 for byte in data if 32 <= byte < 127 or byte in (9, 10, 13, 27)) / len(data)


def detect_baud(port, restart):
    """Listens at each usual rate and returns (share readable, rate) of the best, or None when nothing arrived."""
    best = None
    for rate in BAUD_RATES:
        port.baudrate = rate
        if restart:
            reset(port)
        else:
            port.reset_input_buffer()
        data = b""
        deadline = time.monotonic() + PROBE_SECONDS
        while time.monotonic() < deadline and len(data) < PROBE_BYTES:
            data += port.read(max(port.in_waiting, 1))
        if len(data) < 8:
            continue
        share = readable(data)
        if best is None or share > best[0]:
            best = (share, rate)
        if share >= 0.95 and len(data) >= 32:
            break
    return best


def state_folder():
    """Where running captures leave their address: a folder of this user in the system's temporary directory."""
    # The temporary directory is the user's own on Windows and shared on Linux.
    owner = f"-{os.getuid()}" if hasattr(os, "getuid") else ""
    folder = os.path.join(tempfile.gettempdir(), f"vera-serial-monitor{owner}")
    os.makedirs(folder, mode=0o700, exist_ok=True)
    return folder


class Relay:
    """Lets `serial send` use the port this capture holds: the capture writes, the sender gets a copy of what is read."""

    def __init__(self, port_name, name):
        self.server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.server.bind(("127.0.0.1", 0))
        self.server.listen(4)
        self.server.setblocking(False)
        self.token = secrets.token_hex(16)
        self.waiting = {}
        self.clients = []
        self.notes = []
        # A capture that was stopped leaves its file behind: looking for the ones that still run clears those.
        for _, _, connection, _ in running_captures(None):
            connection.close()
        self.file = os.path.join(state_folder(), f"{os.getpid()}.json")
        state = {"port": port_name, "name": name, "tcp": self.server.getsockname()[1], "token": self.token}
        descriptor = os.open(self.file, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as file:
            json.dump(state, file)

    def poll(self, port):
        """Admits senders and writes what a sender asked for; never waits."""
        ready, _, _ = select.select([self.server, *self.waiting, *self.clients], [], [], 0)
        for item in ready:
            if item is self.server:
                connection, _ = self.server.accept()
                connection.setblocking(False)
                self.waiting[connection] = (b"", time.monotonic() + REQUEST_SECONDS)
            elif item in self.waiting:
                self.request(item, port)
            else:
                # A sender says nothing after its request: readable means it closed.
                self.drop(item)
        for connection, (_, deadline) in list(self.waiting.items()):
            if time.monotonic() > deadline:
                self.drop(connection)

    def request(self, connection, port):
        received, deadline = self.waiting[connection]
        try:
            more = connection.recv(65536)
        except OSError:
            more = b""
        received += more
        if not more or len(received) > 65536:
            return self.drop(connection)
        if b"\n" not in received:
            self.waiting[connection] = (received, deadline)
            return None
        del self.waiting[connection]
        try:
            asked = json.loads(received.split(b"\n", 1)[0])
            if not secrets.compare_digest(str(asked.get("token")), self.token):
                raise ValueError("token")
            payload = bytes.fromhex(asked["hex"])
            port.write(payload)
            port.flush()
            connection.sendall(b'{"ok": true}\n')
        except Exception:
            return self.drop(connection)
        self.notes.append(f"[serial-monitor] sent {len(payload)} bytes: {payload!r}")
        connection.settimeout(1.0)
        self.clients.append(connection)
        return None

    def tell(self):
        """Says in the capture's own output what was written; called between console lines, never inside one."""
        for note in self.notes:
            print(note, file=sys.stderr, flush=True)
        self.notes.clear()

    def copy(self, chunk):
        for connection in list(self.clients):
            try:
                connection.sendall(chunk)
            except OSError:
                self.drop(connection)

    def drop(self, connection):
        self.waiting.pop(connection, None)
        if connection in self.clients:
            self.clients.remove(connection)
        with contextlib.suppress(OSError):
            connection.close()

    def close(self):
        for connection in [*self.waiting, *self.clients]:
            self.drop(connection)
        with contextlib.suppress(OSError):
            self.server.close()
        with contextlib.suppress(OSError):
            os.remove(self.file)


class Through:
    """The reply side of a hand-off: reads what the capture copies, as a port would be read."""

    def __init__(self, connection):
        self.connection = connection
        self.connection.settimeout(0.1)
        self.in_waiting = 4096

    def read(self, size):
        try:
            data = self.connection.recv(size)
        except TimeoutError:
            return b""
        except OSError:
            data = b""
        if not data:
            # The capture ended; wait out the caller's own limits without spinning.
            time.sleep(0.1)
        return data


def running_captures(name):
    """Connects to the captures that still run; returns [(port name, capture name, connection, token)]."""
    found = []
    folder = state_folder()
    for entry in sorted(os.listdir(folder)):
        file = os.path.join(folder, entry)
        try:
            with open(file, encoding="utf-8") as handle:
                state = json.load(handle)
            if name is not None and state.get("name") != name:
                continue
            connection = socket.create_connection(("127.0.0.1", int(state["tcp"])), timeout=1.0)
        except (OSError, ValueError, KeyError, TypeError):
            # A capture that was stopped leaves its file behind: nothing answers at its address.
            with contextlib.suppress(OSError):
                os.remove(file)
            continue
        found.append((state.get("port", "?"), state.get("name"), connection, state["token"]))
    return found


def send_through(args, payload, sink):
    """Hands `payload` to the running capture and prints the reply it copies back; returns the exit code."""
    captures = running_captures(args.capture)
    if len(captures) != 1:
        for _, _, connection, _ in captures:
            connection.close()
        if not captures:
            print(f"serial-monitor: {NO_CAPTURE}", file=sys.stderr)
        else:
            shown = ", ".join(f"{port} (--capture {label})" if label else f"{port} (no name)" for port, label, _, _ in captures)
            print(
                f"serial-monitor: {len(captures)} captures are running: {shown}. Name one with --capture; "
                "a capture gets its name from --name.",
                file=sys.stderr,
            )
        return 3
    port_name, _, connection, token = captures[0]
    try:
        connection.settimeout(REQUEST_SECONDS)
        connection.sendall(json.dumps({"token": token, "hex": payload.hex()}).encode("ascii") + b"\n")
        # Exactly the answer line: what follows it is already the device's reply.
        answer = b""
        while not answer.endswith(b"\n"):
            byte = connection.recv(1)
            if not byte:
                raise OSError("the running capture refused the request")
            answer += byte
        reason, total, matched = read(Through(connection), sink, args.duration, args.until, args.max_bytes)
        sink.close()
    except Exception as error:
        with contextlib.suppress(Exception):
            sink.close()
        return fail(error)
    finally:
        with contextlib.suppress(OSError):
            connection.close()
    print(f"[serial-monitor] {port_name} through its running capture: {total} bytes, stopped by {reason}", file=sys.stderr)
    return 4 if args.until and not matched else 0


class Text:
    """Console bytes as they arrive; with stamps every line starts with the seconds since reading began."""

    def __init__(self, out, stamps):
        self.out = out
        self.stamps = stamps
        self.began = time.monotonic()
        self.fresh = True

    def write(self, chunk):
        if not self.stamps:
            self.out.write(chunk)
        else:
            start = 0
            while start < len(chunk):
                if self.fresh:
                    self.out.write(b"[%9.3f] " % (time.monotonic() - self.began))
                    self.fresh = False
                end = chunk.find(b"\n", start)
                if end < 0:
                    self.out.write(chunk[start:])
                    break
                self.out.write(chunk[start : end + 1])
                self.fresh = True
                start = end + 1
        self.out.flush()

    def idle(self):
        pass

    def close(self):
        pass


class Hex:
    """Bytes as offset, hexadecimal and printable text, 16 to a row; a pause in the data ends the row."""

    def __init__(self, out):
        self.out = out
        self.pending = b""
        self.offset = 0

    def row(self, row):
        text = "".join(chr(byte) if 32 <= byte < 127 else "." for byte in row)
        self.out.write(f"{self.offset:08x}  {row.hex(' '):<47}  |{text}|\n".encode("ascii"))
        self.offset += len(row)

    def write(self, chunk):
        data = self.pending + chunk
        whole = len(data) - len(data) % HEX_ROW
        for start in range(0, whole, HEX_ROW):
            self.row(data[start : start + HEX_ROW])
        self.pending = data[whole:]
        self.out.flush()

    def idle(self):
        if self.pending:
            self.row(self.pending)
            self.pending = b""
            self.out.flush()

    def close(self):
        self.idle()


def read(port, sink, duration, until, max_bytes, relay=None):
    """Copies the port to `sink` until the first stop; returns (reason, bytes read, until matched)."""
    decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
    deadline = time.monotonic() + duration
    total = 0
    line = ""
    # --until matched in a line that has not ended: the rest of that line is still read.
    matched = False
    fresh = True
    last = time.monotonic()
    while True:
        if total >= max_bytes:
            return ("until" if matched else "max-bytes"), total, matched
        now = time.monotonic()
        if now >= deadline:
            return ("until" if matched else "duration"), total, matched
        if relay:
            relay.poll(port)
        chunk = port.read(min(max(port.in_waiting, 1), max_bytes - total))
        if chunk and relay:
            relay.copy(chunk)
        if not chunk:
            sink.idle()
            if relay:
                relay.tell()
            # A prompt such as ">>> " ends without a line break: silence ends the wait.
            if matched and now - last >= SETTLE_SECONDS:
                return "until", total, True
            continue
        last = time.monotonic()
        # What a sender had written is told before the console line that follows it, never inside a line.
        if relay and fresh:
            relay.tell()
        sink.write(chunk)
        fresh = chunk.endswith(b"\n")
        total += len(chunk)
        if until:
            *lines, line = (line + decoder.decode(chunk)).split("\n")
            line = line[-LINE_CHARS:]
            if matched:
                if lines:
                    return "until", total, True
            elif any(until.search(text.rstrip("\r")) for text in lines):
                return "until", total, True
            elif until.search(line):
                matched = True


def fail(error, port=""):
    print(f"serial-monitor: {error}", file=sys.stderr)
    code = getattr(error, "errno", None)
    if code == errno.EACCES:
        hint = PERMISSION
    elif "://" in port:
        hint = NO_SERVER
    elif code == errno.ENOENT:
        hint = MISSING
    else:
        hint = HINT
    print(hint, file=sys.stderr)
    return 3


def positive_float(text):
    try:
        value = float(text)
    except ValueError:
        value = math.nan
    if not math.isfinite(value) or value <= 0:
        raise argparse.ArgumentTypeError(f"expected a number above 0, got {text!r}")
    return value


def duration(text):
    value = positive_float(text)
    if value > MAX_DURATION:
        raise argparse.ArgumentTypeError(f"expected at most {MAX_DURATION} seconds (7 days), got {text!r}")
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
    if len(text) > UNTIL_CHARS:
        raise argparse.ArgumentTypeError(f"expected a regular expression of at most {UNTIL_CHARS} characters, got {len(text)}")
    try:
        return re.compile(text)
    except re.error as error:
        raise argparse.ArgumentTypeError(f"invalid regular expression: {error}") from error


def baud_rate(text):
    return text if text == "auto" else positive_int(text)


def capture_name(text):
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,31}", text) or re.fullmatch(r"com\d+", text):
        raise argparse.ArgumentTypeError(f"expected 1 to 32 lowercase letters, digits or dashes, not a port name, got {text!r}")
    return text


def hex_bytes(text):
    """Bytes written as hexadecimal pairs: `01 03 00 00`, `0x01,0x03` and `01:03` are the same two bytes."""
    digits = re.sub(r"0[xX]|[\s,:;-]", "", text)
    if not digits or len(digits) % 2 or not re.fullmatch(r"[0-9A-Fa-f]+", digits):
        raise argparse.ArgumentTypeError(f"expected pairs of hexadecimal digits such as '01 03 00 00', got {text!r}")
    return bytes.fromhex(digits)


def unescape(data):
    r"""Replaces \xNN, \r, \n, \t, \0, \e and \\ in the text; any other backslash stays as written."""
    return re.sub(
        rb"\\(x[0-9A-Fa-f]{2}|[rnt0e\\])",
        lambda found: bytes([int(found[1][1:], 16)]) if found[1][:1] == b"x" else ESCAPES[found[1]],
        data,
    )


def parser():
    root = argparse.ArgumentParser(
        prog="serial", description="List serial ports, capture a console, send one line or bytes.", allow_abbrev=False
    )
    root.add_argument("--version", action="version", version=f"serial-monitor {VERSION}")
    commands = root.add_subparsers(dest="command", required=True)
    commands.add_parser("list", help="list the serial ports as JSON", allow_abbrev=False)

    def port_options(command, default_duration, capture):
        command.add_argument(
            "--port",
            required=capture,
            help="COM7, /dev/ttyUSB0, /dev/serial/by-id/..., a simulator's /dev/pts/N, socket://host:port, rfc2217://host:port"
            + ("" if capture else "; without it the line goes through the capture that is running"),
        )
        if capture:
            command.add_argument("--baud", type=baud_rate, default=115200, help="a rate, or auto to detect it")
        else:
            command.add_argument("--baud", type=positive_int, default=115200)
        command.add_argument("--bytesize", type=int, choices=[5, 6, 7, 8], default=8, help="data bits")
        command.add_argument(
            "--parity", type=str.upper, choices=list("NEOMS"), default="N", help="none, even, odd, mark, space"
        )
        command.add_argument("--stopbits", type=float, choices=[1, 1.5, 2], default=1)
        command.add_argument("--duration", type=duration, default=default_duration, help="seconds to read")
        command.add_argument("--until", type=expression, help="stop when a line matches this regex")
        command.add_argument("--max-bytes", type=positive_int, default=1048576)
        command.add_argument("--timestamps", action="store_true", help="start every line with the seconds since reading began")

    capture = commands.add_parser("capture", help="read the console", allow_abbrev=False)
    port_options(capture, 10.0, True)
    capture.add_argument("--reset", action="store_true", help="restart the board through DTR/RTS first")
    capture.add_argument("--name", type=capture_name, help="a name for `send --capture`, when several captures run")
    capture.add_argument("--hex", action="store_true", help="print the bytes as a hexadecimal dump")
    send = commands.add_parser("send", help="write one line or bytes, then read the reply", allow_abbrev=False)
    port_options(send, 1.0, False)
    send.add_argument("--capture", type=capture_name, help="without --port: the name of the running capture to send through")
    what = send.add_mutually_exclusive_group(required=True)
    what.add_argument("--text", help="the line to write")
    what.add_argument("--hex", type=hex_bytes, help="bytes to write, as '01 03 00 00'; the reply is printed as a dump")
    send.add_argument("--escape", action="store_true", help=r"replace \xNN, \r, \n, \t, \0, \e and \\ in --text")
    send.add_argument("--eol", choices=list(EOL), help="line end after --text (default crlf); none after --hex")
    return root


def main(argv=None):
    root = parser()
    args = root.parse_args(argv)
    if args.command == "list":
        return list_command()
    dump = args.hex is not None and args.hex is not False
    if dump and args.timestamps:
        root.error("use --timestamps or --hex, not both")
    if args.command == "send" and args.hex is not None and args.escape:
        root.error("--escape applies to --text")
    if args.command == "send" and args.port is not None and args.capture is not None:
        root.error("--capture names a running capture; it is used without --port")
    sink = Hex(sys.stdout.buffer) if dump else Text(sys.stdout.buffer, args.timestamps)
    if args.command == "send":
        if args.hex is not None:
            payload = args.hex + EOL[args.eol or "none"]
        else:
            text = args.text.encode("utf-8")
            payload = (unescape(text) if args.escape else text) + EOL[args.eol or "crlf"]
        if args.port is None:
            return send_through(args, payload, sink)
    detect = args.baud == "auto"
    if detect:
        args.baud = BAUD_RATES[0]
    # Every failure of the port is exit 3: pyserial raises SerialException, but also OSError (in_waiting on Linux),
    # termios.error (flush on Linux) or ValueError (an unsupported baud rate).
    try:
        port, lines = open_port(args)
    except Exception as error:
        return fail(error, args.port)
    relay = None
    try:
        if args.command == "capture" and args.reset and not lines:
            print(f"serial-monitor: {NO_LINES}", file=sys.stderr)
            return 3
        if detect:
            found = detect_baud(port, args.reset)
            if found is None:
                print(f"serial-monitor: {NO_DATA}", file=sys.stderr)
                return 3
            share, port.baudrate = found
            note = "" if share >= 0.7 else "; little of it reads as text, the data may be binary: look at it with --hex"
            print(
                f"[serial-monitor] baud rate {port.baudrate} detected ({share:.0%} readable text{note})",
                file=sys.stderr,
                flush=True,
            )
        if args.command == "capture" and args.reset:
            reset(port)
        if args.command == "send":
            port.write(payload)
            port.flush()
        else:
            # A capture that cannot offer the hand-off still captures.
            with contextlib.suppress(OSError):
                relay = Relay(args.port, args.name)
        reason, total, matched = read(port, sink, args.duration, args.until, args.max_bytes, relay)
        sink.close()
    except Exception as error:
        with contextlib.suppress(Exception):
            sink.close()
        return fail(error)
    finally:
        if relay:
            relay.close()
        with contextlib.suppress(Exception):
            port.close()
    print(f"[serial-monitor] {args.port}: {total} bytes, stopped by {reason}", file=sys.stderr)
    return 4 if args.until and not matched else 0


if __name__ == "__main__":
    sys.exit(main())
