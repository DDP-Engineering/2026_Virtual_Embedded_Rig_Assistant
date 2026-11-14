"""Arguments, dispatch and the one JSON document of ble-tool (spec REQ-DATA-e8502710).

There is no raw write, pairing, unpairing, firmware-update, advertising or Bluetooth Classic operation: every device
call names a registry alias and, for reads, subscriptions and writes, a profile file that VERA's approval binds by hash.
"""

from __future__ import annotations

import argparse
import os
import signal
import sys
from pathlib import Path
from typing import Any

from . import BLEAK, TOOL, VERSION, operations, report, scan, workspace
from .backend import SUPPORTED, WINDOWS_MIN_BUILD, Backend
from .lifecycle import Lifecycle
from .report import Ended, Refused, problem

OPERATIONS = ("capabilities", "scan", *operations.CONNECTED, "release", "report")


class Interrupted(BaseException):
    """SIGTERM on Linux: ends the run as incomplete; VERA's cleanup run releases a connection left behind."""


def _terminate(_signum: int, _frame: Any) -> None:
    raise Interrupted()


class Parser(argparse.ArgumentParser):
    """argparse that refuses with a JSON document instead of printing usage."""

    def error(self, message: str) -> None:  # type: ignore[override]
        raise Refused([problem("arguments", f"{self.prog}: {message}")])


def _parser() -> Parser:
    parser = Parser(prog=TOOL, description="Bounded BLE discovery and profile-bound GATT operations through Bleak.", allow_abbrev=False)
    parser.add_argument("--version", action="version", version=f"{TOOL} {VERSION}")
    sub = parser.add_subparsers(dest="operation", required=True, parser_class=Parser)
    commands: dict[str, Parser] = {}
    caps = sub.add_parser("capabilities", help="the backend, platform support and limits; with --profile a profile's summary", allow_abbrev=False)
    caps.add_argument("--profile", metavar="FILE")
    found = sub.add_parser("scan", help="scan for advertisers for a bounded time; no connection", allow_abbrev=False)
    found.add_argument("--duration", type=int, required=True, metavar="SECONDS")
    found.add_argument("--max-devices", type=int, metavar="N")
    found.add_argument("--active", action="store_true")
    found.add_argument("--profile", metavar="FILE")
    commands["scan"] = found
    for name, text in (
        ("identify", "find, connect and confirm a registry device against its profile"),
        ("discover-services", "list a registry device's services and characteristics without reading values"),
        ("read-characteristic", "read a profile characteristic a bounded number of times"),
        ("subscribe-notifications", "record a profile characteristic's notifications for a bounded time"),
        ("write-characteristic", "send one named write operation of the profile, once"),
        ("release", "end a connection this computer still holds to a registry device"),
    ):
        command = sub.add_parser(name, help=text, allow_abbrev=False)
        command.add_argument("--device", required=True, metavar="ALIAS")
        if name in ("identify", "read-characteristic", "subscribe-notifications", "write-characteristic"):
            command.add_argument("--profile", required=True, metavar="FILE")
        elif name == "discover-services":
            command.add_argument("--profile", metavar="FILE")
        if name in ("read-characteristic", "subscribe-notifications", "write-characteristic"):
            command.add_argument("--characteristic", required=True, metavar="NAME")
        if name in ("read-characteristic", "subscribe-notifications"):
            command.add_argument("--side-effects", action="store_true")
        commands[name] = command
    commands["read-characteristic"].add_argument("--count", type=int, default=1, metavar="N")
    commands["read-characteristic"].add_argument("--interval", type=float, default=1.0, metavar="SECONDS")
    commands["subscribe-notifications"].add_argument("--duration", type=int, required=True, metavar="SECONDS")
    commands["subscribe-notifications"].add_argument("--max-notifications", type=int, metavar="N")
    commands["write-characteristic"].add_argument("--write", required=True, metavar="NAME")
    commands["write-characteristic"].add_argument("--value", metavar="NUMBER")
    commands["write-characteristic"].add_argument("--persistent", action="store_true")
    summary = sub.add_parser("report", help="summarize run folders", allow_abbrev=False)
    summary.add_argument("--run", action="append", required=True, metavar="DIR")
    summary.add_argument("--title")
    commands["report"] = summary
    for command in commands.values():
        command.add_argument("--run-id", metavar="ID")
        command.add_argument("--results-dir", default=report.DEFAULT_RESULTS, metavar="DIR")
    return parser


def _check(args: Any) -> None:
    def bound(name: str, value: Any, low: float, high: float) -> None:
        if value is not None and not low <= value <= high:
            raise Refused([problem("arguments", f"--{name} takes {low:g} to {high:g}.")])

    if getattr(args, "run_id", None) and not workspace.valid_run_id(args.run_id):
        raise Refused([problem("arguments", "--run-id takes 1-64 letters, digits, '.', '_' or '-', starting and ending with a letter or digit.")])
    if args.operation == "scan":
        bound("duration", args.duration, 1, 30)
        bound("max-devices", args.max_devices, 1, 500)
    if args.operation == "subscribe-notifications":
        bound("duration", args.duration, 1, 3600)
        bound("max-notifications", args.max_notifications, 1, 100000)
    if args.operation == "read-characteristic":
        bound("count", args.count, 1, 100)
        bound("interval", args.interval, 0.1, 60)


def _capabilities(args: Any, document: dict[str, Any], cwd: Path, spelled: Path) -> None:
    document["engine"] = {
        "bleak": BLEAK,
        "backends": SUPPORTED,
        "windowsMinBuild": WINDOWS_MIN_BUILD,
        "platform": sys.platform,
        "role": "central only: scan, connect, GATT discovery, read, write, notifications",
        "notOffered": ["pairing", "unpairing", "PIN entry", "raw writes", "firmware update (DFU)", "advertising", "Bluetooth Classic", "adapter settings"],
        "operations": [name for name in OPERATIONS if name not in ("capabilities", "report")],
        "caps": {"scanSeconds": [1, 30], "maxDevices": [1, 500], "reads": [1, 100], "readIntervalS": [0.1, 60], "subscribeSeconds": [1, 3600], "attWriteBytes": 512},
        "verified": "fake Bleak offline; a real passive scan on Windows 11",
    }
    if args.profile:
        document["profile"] = operations.load_profile(cwd, spelled, args.profile).summary()


def _report(cwd: Path, spelled: Path, args: Any, document: dict[str, Any]) -> Path:
    runs = []
    for raw in args.run:
        try:
            folder = workspace.confined(cwd, raw, "--run", spelled)
        except workspace.PathRefused as error:
            raise Refused([problem("path", str(error))]) from error
        runs.append(report.summary(cwd, folder))
    document.update({"title": (args.title or "BLE operations")[:200], "runs": runs})
    return _folder(cwd, spelled, args, document)


def _folder(cwd: Path, spelled: Path, args: Any, document: dict[str, Any]) -> Path:
    run_id = args.run_id or report.new_run_id(args.operation)
    folder = report.run_folder(cwd, spelled, args.results_dir, run_id)
    document["runId"] = run_id
    document["resultPath"] = workspace.relative(cwd, folder / "result.json")
    return folder


def _scan(args: Any, document: dict[str, Any], cwd: Path, spelled: Path, lifecycle: Lifecycle) -> Path:
    from . import registry

    profile = operations.load_profile(cwd, spelled, args.profile) if args.profile else None
    try:
        known = registry.load() if os.environ.get("BLE_REGISTRY") and Path(os.environ["BLE_REGISTRY"]).is_file() else None
    except Refused:
        known = None
        document["warnings"].append({"code": "registry", "message": "lab/resources.json could not be read; registry devices are not marked."})
    backend = Backend()
    scan.mode(args, backend)
    folder = _folder(cwd, spelled, args, document)
    try:
        scan.run(args, document, backend, known, profile, lifecycle)
    except (Refused, Ended) as stop:
        stop.folder = folder  # type: ignore[attr-defined]
        raise
    return folder


def _device(args: Any, document: dict[str, Any], cwd: Path, spelled: Path, lifecycle: Lifecycle) -> Path:
    entry, profile, request = operations.prepare(args, cwd, spelled)
    folder = _folder(cwd, spelled, args, document)
    try:
        operations.run(args, document, lifecycle, entry, profile, request, folder, cwd)
    except (Refused, Ended) as stop:
        stop.folder = folder  # type: ignore[attr-defined]
        raise
    except Interrupted as stop:
        stop.folder = folder  # type: ignore[attr-defined]
        raise
    except Exception as error:  # noqa: BLE001 - the run folder gets the same document as stdout
        end = Ended("error", "internal", f"{type(error).__name__}: {str(error)[:300]}")
        end.folder = folder  # type: ignore[attr-defined]
        raise end from error
    return folder


def main(argv: list[str]) -> int:
    started = report.stamp()
    operation = next((value for value in argv if not value.startswith("-")), "arguments")
    document = report.header(operation if operation in OPERATIONS else "arguments", started)
    if hasattr(signal, "SIGTERM") and os.name != "nt":
        signal.signal(signal.SIGTERM, _terminate)
    lifecycle = Lifecycle()
    folder: Path | None = None
    supervised = operation in operations.OPERATIONS
    try:
        args = _parser().parse_args(argv)
        _check(args)
        cwd = Path(workspace.entered_directory()).resolve()
        spelled = workspace.entered_directory()
        if args.operation == "capabilities":
            _capabilities(args, document, cwd, spelled)
        elif args.operation == "report":
            folder = _report(cwd, spelled, args, document)
        elif args.operation == "scan":
            folder = _scan(args, document, cwd, spelled, lifecycle)
        else:
            folder = _device(args, document, cwd, spelled, lifecycle)
        code = 0
    except Refused as refusal:
        folder = getattr(refusal, "folder", folder)
        document.update(refusal.fields)
        document["status"] = "blocked"
        document["errors"] = refusal.problems
        code = 2
    except Ended as end:
        folder = getattr(end, "folder", folder)
        document.update(end.fields)
        document["status"] = end.status
        document["errors"] = [end.problem]
        code = report.EXIT[end.status]
    except Interrupted as stop:
        folder = getattr(stop, "folder", folder)
        document["status"] = "incomplete"
        document["errors"] = [problem("stopped", "VERA ended the run (SIGTERM).")]
        if lifecycle.physical == "pending":
            lifecycle.physical = "unknown"
        code = 3
    except SystemExit as exit_:
        # --version and --help print their text and exit 0.
        return int(exit_.code or 0)
    except Exception as error:  # noqa: BLE001 - one JSON document on every path
        document["status"] = "error"
        document["errors"] = [problem("internal", f"{type(error).__name__}: {str(error)[:300]}")]
        code = 3
    if supervised:
        if lifecycle.physical == "pending":
            lifecycle.physical = "unknown"
        document["lifecycle"] = {"phases": lifecycle.phases + ["released"], "physical": lifecycle.physical, "stopRequested": lifecycle.stopped}
        lifecycle.report("released")
    document.setdefault("finishedAt", report.stamp())
    if folder is not None:
        report.write(folder, document)
    report.emit(document)
    return code
