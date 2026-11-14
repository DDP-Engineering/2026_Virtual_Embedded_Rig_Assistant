"""Arguments, dispatch and the one JSON document of bus-tool (spec REQ-DATA-634d35da).

There is no terminal, scan, bootloader, reset, firmware or script operation (REQ-SEC-9350b6ae): every adapter call
names a registry alias and, for bus operations, a profile file that VERA's approval binds by hash.
"""

from __future__ import annotations

import argparse
import os
import signal
from pathlib import Path
from typing import Any

from . import BACKEND, TOOL, VERSION, operations, ports, report, workspace
from . import profile as profiles
from .lifecycle import Lifecycle
from .report import Ended, Refused, problem

OPERATIONS = ("devices", "capabilities", "identify", "configure-bus", "read-register", "transfer", "capture", "release", "report")


class Interrupted(BaseException):
    """SIGTERM on Linux: ends the run as incomplete without the helper's own final state; VERA's cleanup run releases the adapter."""


def _terminate(_signum: int, _frame: Any) -> None:
    raise Interrupted()


class Parser(argparse.ArgumentParser):
    """argparse that refuses with a JSON document instead of printing usage."""

    def error(self, message: str) -> None:  # type: ignore[override]
        raise Refused([problem("arguments", f"{self.prog}: {message}")])


def _parser() -> Parser:
    parser = Parser(prog=TOOL, description="Active I2C, SPI and UART transactions through an identified Bus Pirate (BPIO2).", allow_abbrev=False)
    parser.add_argument("--version", action="version", version=f"{TOOL} {VERSION}")
    sub = parser.add_subparsers(dest="operation", required=True, parser_class=Parser)
    sub.add_parser("devices", help="list serial ports by identity without opening them", allow_abbrev=False)
    caps = sub.add_parser("capabilities", help="the backend's support and, with --bus, a profile's devices and limits", allow_abbrev=False)
    caps.add_argument("--bus", metavar="PROFILE")
    commands: dict[str, Parser] = {}
    for name, text in (
        ("identify", "the adapter's hardware, firmware and BPIO version"),
        ("configure-bus", "configure the bus from a profile and read it back"),
        ("read-register", "read one declared register in one transaction"),
        ("transfer", "one bounded write/read transaction to a device that allows raw transfers"),
        ("capture", "record a UART for a bounded time"),
        ("release", "HiZ with pull-ups and supply off, read back"),
    ):
        command = sub.add_parser(name, help=text, allow_abbrev=False)
        command.add_argument("--adapter", required=True, metavar="ALIAS")
        if name in operations.BUS:
            command.add_argument("--bus", required=True, metavar="PROFILE")
            command.add_argument("--power", action="store_true")
        commands[name] = command
    commands["read-register"].add_argument("--device", required=True)
    commands["read-register"].add_argument("--register", required=True)
    commands["read-register"].add_argument("--clears", action="store_true")
    commands["transfer"].add_argument("--device", required=True)
    commands["transfer"].add_argument("--write", metavar="HEX")
    commands["transfer"].add_argument("--read", type=int, metavar="N")
    commands["capture"].add_argument("--duration", type=int, required=True, metavar="SECONDS")
    commands["capture"].add_argument("--write", metavar="HEX")
    summary = sub.add_parser("report", help="summarize run folders", allow_abbrev=False)
    summary.add_argument("--run", action="append", required=True, metavar="DIR")
    summary.add_argument("--title")
    commands["report"] = summary
    for command in commands.values():
        command.add_argument("--run-id", metavar="ID")
        command.add_argument("--results-dir", default=report.DEFAULT_RESULTS, metavar="DIR")
    return parser


def _check(args: Any) -> None:
    if getattr(args, "run_id", None) and not workspace.valid_run_id(args.run_id):
        raise Refused([problem("arguments", "--run-id takes 1-64 letters, digits, '.', '_' or '-', starting and ending with a letter or digit.")])
    if getattr(args, "read", None) is not None and not 0 <= args.read <= 512:
        raise Refused([problem("arguments", "--read takes 0 to 512.")])
    if args.operation == "capture" and not 1 <= args.duration <= 60:
        raise Refused([problem("arguments", "--duration takes 1 to 60.")])


def _capabilities(args: Any, document: dict[str, Any], cwd: Path, spelled: Path) -> None:
    document["backend"] = {
        "id": BACKEND,
        "adapter": "Bus Pirate (BPIO2 binary mode on its second USB serial port)",
        "hardwareMajors": [5, 6],
        "protocolMajor": 2,
        "modes": ["i2c", "spi", "uart"],
        "operations": [name for name in OPERATIONS if name not in ("devices", "capabilities", "report")],
        "caps": {**profiles.CAPS, "i2cSpeedHz": list(profiles.SPEED["i2c"]), "spiSpeedHz": list(profiles.SPEED["spi"]), "uartBaud": list(profiles.BAUD), "captureSeconds": [1, 60], "powerMv": [800, 5000], "powerMa": [1, 500]},
        "verified": "simulated adapter only",
    }
    if args.bus:
        try:
            file = workspace.regular_file(cwd, args.bus, "--bus", spelled)
        except workspace.PathRefused as error:
            raise Refused([problem("path", str(error))]) from error
        document["profile"] = profiles.load(file, workspace.relative(cwd, file)).summary()


def _report(cwd: Path, spelled: Path, args: Any, document: dict[str, Any]) -> Path:
    runs = []
    for raw in args.run:
        try:
            folder = workspace.confined(cwd, raw, "--run", spelled)
        except workspace.PathRefused as error:
            raise Refused([problem("path", str(error))]) from error
        runs.append(report.summary(cwd, folder))
    document.update({"title": (args.title or "Bus transactions")[:200], "runs": runs})
    return _folder(cwd, spelled, args, document)


def _folder(cwd: Path, spelled: Path, args: Any, document: dict[str, Any]) -> Path:
    run_id = args.run_id or report.new_run_id(args.operation)
    folder = report.run_folder(cwd, spelled, args.results_dir, run_id)
    document["runId"] = run_id
    document["resultPath"] = workspace.relative(cwd, folder / "result.json")
    return folder


def _adapter(cwd: Path, spelled: Path, args: Any, document: dict[str, Any], lifecycle: Lifecycle) -> Path:
    entry, profile, request = operations.prepare(args, document, cwd, spelled)
    operations.check_state(lifecycle, entry.alias, args.operation)
    folder = _folder(cwd, spelled, args, document)
    session = operations.Session(args, document, lifecycle, entry, profile, request)
    session.folder, session.cwd = folder, cwd
    try:
        session.run()
    except (Refused, Ended) as stop:
        stop.folder = folder  # type: ignore[attr-defined]
        raise
    except Interrupted:
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
        if args.operation == "devices":
            document.update(ports.devices())
        elif args.operation == "capabilities":
            _capabilities(args, document, cwd, spelled)
        elif args.operation == "report":
            folder = _report(cwd, spelled, args, document)
        else:
            folder = _adapter(cwd, spelled, args, document, lifecycle)
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
    except Interrupted:
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
