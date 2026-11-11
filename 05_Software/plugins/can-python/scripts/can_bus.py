# /// script
# requires-python = ">=3.11"
# dependencies = ["python-can[serial,gs-usb,pcan,multicast]==4.6.1"]
# ///
"""List CAN interfaces, capture a bus listen-only to a log file, and send or replay frames.

VERA runs this script as program `can` of the can-python plugin. It is not named can.py because that name
would shadow python-can's `can` package, which is imported only by the commands that need it. Exit codes:
0 done, 2 invalid arguments or a refused capture (no bus opened), 3 the interface could not be opened or failed.
"""

import argparse
import ctypes.util
import json
import math
import os
import re
import shutil
import subprocess
import sys
import time
from typing import NoReturn

VERSION = "1.0.0"
# The first argument must name the command: VERA's rules classify it, and argparse would otherwise accept a
# leading "--" before the subcommand.
FIRST = {"list", "capture", "send", "replay", "--version", "--help", "-h"}
# udp_multicast joins processes on one host without hardware; it is passed directly rather than listed.
INTERFACES = ["pcan", "vector", "kvaser", "slcan", "gs_usb", "socketcan"]
LOG_SUFFIXES = (".asc", ".blf", ".log")
# Buses without a physical node: nothing acknowledges frames, so a capture is passive by nature.
SOFTWARE = {"virtual", "udp_multicast"}
# python-can opens these at 500 kbit/s when no bitrate is given; never let that happen silently.
BITRATE_REQUIRED = {"pcan", "kvaser", "gs_usb"}
FD_LENGTHS = {0, 1, 2, 3, 4, 5, 6, 7, 8, 12, 16, 20, 24, 32, 48, 64}
HINTS = {
    "pcan": "Install the PEAK device driver with PCAN-Basic from https://www.peak-system.com/ "
    "(Linux: PCAN-Basic for Linux, or use the kernel driver through socketcan).",
    "vector": "Install the Vector driver setup and the XL Driver Library (vxlapi64.dll) from https://www.vector.com/; "
    "assign the channel in Vector Hardware Config.",
    "kvaser": "Install the Kvaser drivers and CANlib SDK from https://www.kvaser.com/ (canlib32.dll or libcanlib.so).",
    "slcan": "Connect the slcan adapter and pass its serial port as the channel (COM5, /dev/ttyACM0); "
    "on Linux your user may need the dialout group.",
    "gs_usb": "Windows: bind WinUSB to the candleLight/gs_usb adapter with Zadig. Linux: the gs_usb kernel driver "
    "exposes the adapter as a SocketCAN interface (can0); use --interface socketcan.",
    "socketcan": "Bring the interface up yourself: sudo ip link set can0 up type can bitrate 500000 (add listen-only on "
    "for a passive capture). Virtual bus: sudo modprobe vcan; sudo ip link add dev vcan0 type vcan; "
    "sudo ip link set up vcan0.",
}


def fail(code, message, hint=None) -> NoReturn:
    print(f"can: {message}", file=sys.stderr)
    if hint:
        print(hint, file=sys.stderr)
    sys.exit(code)


def positive_float(text):
    value = float(text)
    if not math.isfinite(value) or value <= 0:
        raise argparse.ArgumentTypeError("must be a finite number above 0")
    return value


def non_negative_float(text):
    value = float(text)
    if not math.isfinite(value) or value < 0:
        raise argparse.ArgumentTypeError("must be a finite number of 0 or more")
    return value


def positive_int(text):
    value = int(text)
    if value < 1:
        raise argparse.ArgumentTypeError("must be 1 or more")
    return value


def driver_status(interface):
    """Whether the driver library or package a backend loads is present; no bus is opened."""
    windows = sys.platform == "win32"
    if interface == "pcan":
        return bool(ctypes.util.find_library("PCANBasic" if windows else "pcanbasic"))
    if interface == "vector":
        return windows and bool(ctypes.util.find_library("vxlapi64"))
    if interface == "kvaser":
        return bool(ctypes.util.find_library("canlib32" if windows else "canlib"))
    if interface == "slcan":
        try:
            import serial  # noqa: F401
        except ImportError:
            return False
        return True
    if interface == "gs_usb":
        try:
            import usb.backend.libusb1
        except ImportError:
            return False
        return usb.backend.libusb1.get_backend() is not None
    if interface == "socketcan":
        return sys.platform.startswith("linux")
    return True


def list_command(args):
    import can

    wanted = args.interfaces.split(",") if args.interfaces else INTERFACES
    configs = [
        {key: value for key, value in config.items() if isinstance(value, (str, int, float, bool))}
        for config in can.detect_available_configs(interfaces=wanted)
    ]
    drivers = [
        {"interface": name, "available": driver_status(name), "hint": HINTS[name]} for name in wanted if name in HINTS
    ]
    print(json.dumps({"configs": configs, "drivers": drivers}, indent=2))


def socketcan_listen_only(channel):
    """True when `ip` reports the SocketCAN link in listen-only mode."""
    ip = shutil.which("ip")
    if not ip:
        return False
    result = subprocess.run([ip, "-json", "-details", "link", "show", channel], capture_output=True, text=True)
    if result.returncode != 0:
        return False
    try:
        links = json.loads(result.stdout)
    except json.JSONDecodeError:
        return False
    return any("LISTEN-ONLY" in link.get("linkinfo", {}).get("info_data", {}).get("ctrlmode", []) for link in links)


def listen_only(interface, channel):
    """(python-can arguments that keep the adapter silent, mode label), or None without such a switch."""
    import can

    if interface in SOFTWARE or (interface == "socketcan" and channel.startswith("vcan")):
        return {}, "software bus"
    if interface == "socketcan":
        return ({}, "listen-only") if socketcan_listen_only(channel) else None
    switches = {
        "pcan": {"state": can.BusState.PASSIVE},
        "vector": {"listen_only": True},
        "slcan": {"listen_only": True},
        "kvaser": {"driver_mode": False},
    }
    return (switches[interface], "listen-only") if interface in switches else None


def open_bus(args, extra=None):
    import can

    # ignore_config: no ~/.canrc, can.ini or CAN_* variable may add settings the approval did not show. It also
    # skips python-can's string casting, so a numeric channel (vector, kvaser, gs_usb index) is converted here.
    channel = int(args.channel) if re.fullmatch(r"\d+", args.channel) else args.channel
    options = {"interface": args.interface, "channel": channel, "ignore_config": True, **(extra or {})}
    if args.bitrate:
        options["bitrate"] = args.bitrate
    if args.fd:
        options["fd"] = True
        if args.data_bitrate:
            options["data_bitrate"] = args.data_bitrate
    try:
        return can.Bus(**options)
    except Exception as error:  # Every backend reports open failures differently.
        fail(3, f"cannot open {args.interface} channel {args.channel}: {error}", HINTS.get(args.interface))


def check_bitrate(args):
    if args.interface in BITRATE_REQUIRED and not args.bitrate:
        fail(2, f"give --bitrate for {args.interface}; python-can would otherwise assume 500000 bit/s")


def line(message):
    """A candump-style line: (timestamp) channel ID#DATA, or ID##<flags>DATA for CAN FD."""
    width = 8 if message.is_extended_id else 3
    data = "R" if message.is_remote_frame else message.data.hex().upper()
    if message.is_fd:
        flags = (1 if message.bitrate_switch else 0) | (2 if message.error_state_indicator else 0)
        data = f"#{flags:X}{data}"
    return f"({message.timestamp:.6f}) {message.channel or '-'} {message.arbitration_id:0{width}X}#{data}"


def capture_command(args):
    import can

    if args.duration is None and args.max_messages is None:
        fail(2, "give --duration or --max-messages so the capture ends by itself")
    if args.output:
        if not args.output.lower().endswith(LOG_SUFFIXES):
            fail(2, f"--output must end with one of {', '.join(LOG_SUFFIXES)}")
        if os.path.exists(args.output):
            fail(2, f"{args.output} already exists; choose another file name")
    silent = listen_only(args.interface, args.channel)
    if silent is None and not args.active:
        fail(
            2,
            f"{args.interface} channel {args.channel} cannot be opened listen-only, so the adapter would acknowledge "
            "frames (and a wrong bitrate can raise error frames on the bus). Pass --active to capture anyway.",
            HINTS.get(args.interface) if args.interface == "socketcan" else None,
        )
    check_bitrate(args)
    switches, mode = silent if silent is not None else ({}, "active")
    try:
        writer = can.Logger(args.output) if args.output else None
    except OSError as error:
        fail(2, f"cannot write {args.output}: {error}")
    bus = None
    count = 0
    reason = "duration"
    try:
        bus = open_bus(args, switches)
        deadline = time.monotonic() + args.duration if args.duration is not None else None
        while True:
            remaining = None if deadline is None else deadline - time.monotonic()
            if remaining is not None and remaining <= 0:
                break
            message = bus.recv(timeout=0.2 if remaining is None else min(0.2, remaining))
            if message is None:
                continue
            count += 1
            if writer:
                writer.on_message_received(message)
                if not args.output.lower().endswith(".blf"):
                    writer.file.flush()
            else:
                print(line(message), flush=True)
            if args.max_messages is not None and count >= args.max_messages:
                reason = "max-messages"
                break
    except can.CanError as error:
        fail(3, f"{args.interface} channel {args.channel} failed: {error}", HINTS.get(args.interface))
    finally:
        if writer:
            writer.stop()
            if bus is None and os.path.exists(args.output) and count == 0:
                os.remove(args.output)
        if bus is not None:
            bus.shutdown()
    target = args.output or "stdout"
    print(
        f"[can] {count} frames from {args.interface}:{args.channel} ({mode}) to {target}, stopped by {reason}",
        file=sys.stderr,
    )


def send_command(args):
    import can

    limit = 0x1FFFFFFF if args.extended else 0x7FF
    try:
        identifier = int(args.id, 16)
    except ValueError:
        fail(2, "--id must be hexadecimal, such as 0x123")
    if not 0 <= identifier <= limit:
        fail(2, f"--id 0x{identifier:X} is outside 0..0x{limit:X}")
    try:
        data = bytes.fromhex(args.data)
    except ValueError:
        fail(2, "--data must be hexadecimal bytes, such as DEADBEEF")
    if args.fd and len(data) not in FD_LENGTHS:
        fail(2, f"--data has {len(data)} bytes; a CAN FD frame holds 0-8, 12, 16, 20, 24, 32, 48 or 64")
    if not args.fd and len(data) > 8:
        fail(2, f"--data has {len(data)} bytes; a classic CAN frame holds at most 8 (use --fd)")
    if args.brs and not args.fd:
        fail(2, "--brs needs --fd")
    check_bitrate(args)
    try:
        message = can.Message(
            arbitration_id=identifier,
            data=data,
            is_extended_id=args.extended,
            is_fd=args.fd,
            bitrate_switch=args.brs,
            check=True,
        )
    except ValueError as error:
        fail(2, f"invalid frame: {error}")
    bus = open_bus(args)
    sent = 0
    try:
        for index in range(args.count):
            if index:
                time.sleep(args.period_ms / 1000)
            bus.send(message)
            sent += 1
    except can.CanError as error:
        fail(3, f"sending on {args.interface} channel {args.channel} stopped after {sent} frame(s): {error}",
             HINTS.get(args.interface))
    finally:
        bus.shutdown()
    print(f"[can] sent {sent} frame(s) {line(message).split(' ', 2)[2]} on {args.interface}:{args.channel}")


def replay_command(args):
    import can

    if not os.path.isfile(args.input):
        fail(2, f"no such log file: {args.input}")
    try:
        reader = can.LogReader(args.input)
    except Exception as error:  # Unknown suffixes and unreadable files.
        fail(2, f"cannot read {args.input}: {error}")
    check_bitrate(args)
    bus = open_bus(args)
    count = 0
    try:
        frames = (message for message in reader if not message.is_error_frame)
        for message in can.MessageSync(frames, timestamps=not args.ignore_timestamps, gap=0.0001):
            message.channel = None
            bus.send(message)
            count += 1
            if args.max_messages is not None and count >= args.max_messages:
                break
    except Exception as error:  # A send failure or a log that turns unreadable after frames went out.
        fail(3, f"replay on {args.interface} channel {args.channel} stopped after {count} frame(s): {error}",
             HINTS.get(args.interface) if isinstance(error, can.CanError) else None)
    finally:
        bus.shutdown()
    print(f"[can] replayed {count} frame(s) from {args.input} on {args.interface}:{args.channel}")


def bus_options(parser):
    parser.add_argument("--interface", required=True, help="python-can interface, such as pcan, socketcan, slcan")
    parser.add_argument("--channel", required=True, help="channel, such as PCAN_USBBUS1, can0, COM5 or 0")
    parser.add_argument("--bitrate", type=positive_int, help="nominal bitrate in bit/s (ignored by socketcan)")
    parser.add_argument("--fd", action="store_true", help="CAN FD")
    parser.add_argument("--data-bitrate", type=positive_int, help="CAN FD data-phase bitrate in bit/s")


def parser():
    root = argparse.ArgumentParser(prog="can", description=__doc__.splitlines()[0], allow_abbrev=False)
    root.add_argument("--version", action="version", version=f"can-python {VERSION}")
    commands = root.add_subparsers(dest="command", required=True)
    listing = commands.add_parser("list", help="detected interfaces and driver availability", allow_abbrev=False)
    listing.add_argument("--interfaces", help=f"comma-separated subset of {','.join(INTERFACES)}")
    capture = commands.add_parser("capture", help="listen-only capture to a log file", allow_abbrev=False)
    bus_options(capture)
    capture.add_argument("--duration", type=positive_float, help="seconds to capture")
    capture.add_argument("--max-messages", type=positive_int, help="stop after this many frames")
    capture.add_argument("--output", help="new log file (.asc, .blf or .log); omitted: print frames")
    capture.add_argument("--active", action="store_true", help="allow a backend without listen-only (acknowledges)")
    send = commands.add_parser("send", help="transmit one frame", allow_abbrev=False)
    bus_options(send)
    send.add_argument("--id", required=True, help="arbitration ID in hex")
    send.add_argument("--data", default="", help="payload in hex")
    send.add_argument("--extended", action="store_true", help="29-bit identifier")
    send.add_argument("--brs", action="store_true", help="CAN FD bitrate switch")
    send.add_argument("--count", type=positive_int, default=1, help="frames to send")
    send.add_argument("--period-ms", type=non_negative_float, default=100, help="gap between repeated frames")
    replay = commands.add_parser("replay", help="transmit the frames of a log file", allow_abbrev=False)
    bus_options(replay)
    replay.add_argument("--input", required=True, help="log file (.asc, .blf, .log, .csv, .trc)")
    replay.add_argument("--ignore-timestamps", action="store_true", help="send back to back")
    replay.add_argument("--max-messages", type=positive_int, help="stop after this many frames")
    return root


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in FIRST:
        fail(2, f"the first argument must be one of {', '.join(sorted(FIRST))}")
    args = parser().parse_args()
    {"list": list_command, "capture": capture_command, "send": send_command, "replay": replay_command}[args.command](
        args
    )


if __name__ == "__main__":
    main()
