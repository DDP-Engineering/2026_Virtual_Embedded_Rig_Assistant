# /// script
# requires-python = ">=3.11"
# dependencies = ["cantools==45.1.2", "python-can==4.6.1"]
# ///
"""Decode the frames of a CAN log file (.asc, .blf, .log) with a DBC, KCD, SYM or ARXML database.

VERA runs this script as program `can-decode` of the can-dbc plugin, because `cantools decode` reads frames only
from standard input, which VERA closes. Exit codes: 0 done, 2 invalid arguments or unreadable files.
"""

import argparse
import collections
import os
import sys
from typing import NoReturn

VERSION = "1.0.0"


def fail(message) -> NoReturn:
    print(f"can-decode: {message}", file=sys.stderr)
    sys.exit(2)


def value_text(value, unit):
    # 15 significant digits keep every scaled value exact without float noise such as 0.30000000000000004.
    text = format(value, ".15g") if isinstance(value, float) else str(value)
    return f"{text} {unit}" if unit else text


def main():
    parser = argparse.ArgumentParser(prog="can-decode", description=__doc__.splitlines()[0], allow_abbrev=False)
    parser.add_argument("--version", action="version", version=f"can-decode {VERSION}")
    parser.add_argument("--dbc", required=True, help="database file (.dbc, .kcd, .sym, .arxml)")
    parser.add_argument("--input", required=True, help="log file (.asc, .blf, .log, .csv, .trc)")
    parser.add_argument("--id", action="append", default=[], help="only this arbitration ID in hex; repeatable")
    parser.add_argument("--limit", type=int, help="print at most this many decoded frames")
    parser.add_argument("--no-choices", action="store_true", help="print raw values instead of choice names")
    parser.add_argument("--no-strict", action="store_true", help="skip database consistency checks")
    args = parser.parse_args()
    for path in (args.dbc, args.input):
        if not os.path.isfile(path):
            fail(f"no such file: {path}")
    try:
        only = {int(text, 16) for text in args.id}
    except ValueError:
        fail("--id must be hexadecimal, such as 0x100")

    import can
    import cantools

    try:
        database = cantools.database.load_file(args.dbc, strict=not args.no_strict)
    except Exception as error:  # cantools raises parser-specific errors.
        fail(f"cannot load {args.dbc}: {error}")
    try:
        reader = can.LogReader(args.input)
    except Exception as error:  # Unknown suffixes and unreadable files.
        fail(f"cannot read {args.input}: {error}")
    decoded = collections.Counter()
    unknown = collections.Counter()
    errors = collections.Counter()
    printed = 0
    for message in reader:
        if message.is_error_frame or message.is_remote_frame:
            continue
        if only and message.arbitration_id not in only:
            continue
        try:
            definition = database.get_message_by_frame_id(message.arbitration_id)
        except KeyError:
            unknown[message.arbitration_id] += 1
            continue
        try:
            signals = definition.decode(message.data, decode_choices=not args.no_choices)
        except Exception as error:  # Wrong length or a malformed multiplexer.
            errors[definition.name] += 1
            print(f"{message.timestamp:.6f} {message.arbitration_id:03X} {definition.name} error: {error}")
            continue
        decoded[definition.name] += 1
        if args.limit is not None and printed >= args.limit:
            continue
        printed += 1
        units = {signal.name: signal.unit for signal in definition.signals}
        fields = " ".join(f"{name}={value_text(value, units.get(name))}" for name, value in signals.items())
        print(f"{message.timestamp:.6f} {message.arbitration_id:03X} {definition.name} {fields}")
    print("-- summary")
    for name, count in sorted(decoded.items()):
        print(f"{name}: {count} decoded" + (f", {errors[name]} errors" if errors[name] else ""))
    for name, count in sorted(errors.items()):
        if not decoded[name]:
            print(f"{name}: 0 decoded, {count} errors")
    for identifier, count in sorted(unknown.items()):
        print(f"unknown {identifier:03X}: {count}")
    if args.limit is not None and printed < sum(decoded.values()):
        print(f"(printed {printed} of {sum(decoded.values())} decoded frames; raise --limit or filter with --id)")


if __name__ == "__main__":
    main()
