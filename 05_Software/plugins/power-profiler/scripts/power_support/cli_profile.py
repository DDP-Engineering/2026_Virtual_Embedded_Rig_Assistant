"""power-profile: the live JS220 operations (spec REQ-DATA-dd3e4fe1 sections 2 and 5)."""

from __future__ import annotations

import argparse
import json
import platform
import sys
from pathlib import Path
from typing import Any

from . import VERSION, capture, usb
from .errors import Problem, Refused
from .meter import driver_module, driver_version
from .result import emit
from .workspace import entered_directory

USAGE = """power-profile <operation> [options]

  tools [--list]                              pyjoulescope_driver and USB prerequisites (--list: connected meters)
  identify --meter <alias>                    the declared meter's model, serial, versions and range state
  capture --meter <alias> --duration <s> --rate <Hz> [--current-range auto|<label>] [--voltage-range <label>]
          [--markers <n>,...] [--firmware <file>] [--board <text>] [--condition <name>=<value>]... [--label <text>]
  release --meter <alias>                     VERA's cleanup: signals off, current range back to auto, read back
  common: [--results-dir <dir>] [--run-id <id>]

The meter is opened without its defaults; its current path is never switched (a meter whose current range mode is
off is refused); changed settings are restored and read back. Exit codes: 0 pass, 2 refused or blocked before any
setting changed, 3 incomplete, 4 error."""


class _Parser(argparse.ArgumentParser):
    def error(self, message: str) -> None:  # type: ignore[override]
        raise Refused("request", message)


def _parser() -> argparse.ArgumentParser:
    parser = _Parser(prog="power-profile", allow_abbrev=False, add_help=False)
    sub = parser.add_subparsers(dest="operation", required=True, parser_class=_Parser)
    tools = sub.add_parser("tools", allow_abbrev=False, add_help=False)
    tools.add_argument("--list", action="store_true")
    for name in ("identify", "capture", "release"):
        op = sub.add_parser(name, allow_abbrev=False, add_help=False)
        op.add_argument("--meter", required=True)
        if name != "release":
            op.add_argument("--results-dir")
            op.add_argument("--run-id")
        if name == "capture":
            op.add_argument("--duration", type=float, required=True)
            op.add_argument("--rate", type=float, required=True)
            op.add_argument("--current-range", default="auto")
            op.add_argument("--voltage-range")
            op.add_argument("--markers")
            op.add_argument("--firmware")
            op.add_argument("--board")
            op.add_argument("--condition", action="append")
            op.add_argument("--label")
    return parser


def tools(list_devices: bool) -> int:
    out: dict[str, Any] = {"format": 1, "kind": "power-tools", "python": platform.python_version(),
                           "platform": f"{sys.platform}-{platform.machine().lower()}", "usb": usb.check()}
    code = 0
    try:
        module = driver_module()
        out["driver"] = {"package": "pyjoulescope_driver", "version": driver_version(module)}
    except Problem as problem:
        out["driver"] = {"missing": problem.message}
        module = None
        code = 3
    if list_devices and module is not None:
        driver = None
        try:
            driver = module.Driver()
            out["devices"] = sorted(str(path) for path in driver.device_paths())
        except Exception as error:  # the driver's own error types are not stable
            out["devices"] = None
            out["problem"] = f"listing failed: {error}"
            code = 4
        finally:
            if driver is not None:
                try:
                    driver.finalize()
                except Exception:
                    pass
    print(json.dumps(out, ensure_ascii=False))
    return code


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if argv in (["--version"], ["-V"]):
        print(f"power-profile {VERSION}")
        return 0
    if argv in (["--help"], ["-h"]) or not argv:
        print(f"Usage: {USAGE}")
        return 0
    try:
        args = _parser().parse_args(argv)
        if args.operation == "tools":
            return tools(args.list)
        if args.operation == "release":
            return capture.release(args)
        spelled = entered_directory()
        cwd = Path(spelled).resolve()
        if args.operation == "identify":
            return capture.identify(args, cwd, spelled)
        return capture.capture(args, cwd, spelled)
    except Refused as error:
        emit({"format": 1, "kind": "power-refusal", "status": "refused",
              "problems": [{"code": error.code, "message": error.message}]})
        return 2
