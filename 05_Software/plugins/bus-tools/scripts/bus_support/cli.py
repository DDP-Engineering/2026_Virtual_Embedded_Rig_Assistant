"""Arguments, dispatch and the one JSON document of bus-tool (spec REQ-DATA-634d35da).

There is no terminal, bootloader, reset, firmware or script operation (REQ-SEC-9350b6ae): every adapter call names a
registry alias, and a bus operation names a profile file or describes the bus with its own options.
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

OPERATIONS = ("devices", "capabilities", "identify", "pins", "scan", "configure-bus", "read-register", "write-register", "transfer", "sequence", "capture", "release", "report")
# Operations that take the bus from --bus or from their own options; the register operations need a profile.
DIRECT = ("scan", "configure-bus", "transfer", "sequence", "capture")
# Operations that only look and leave no run folder.
WITHOUT_RUN_FOLDER = ("pins",)


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
        ("pins", "the voltage on each IO pin, the supply and the pull-ups"),
        ("scan", "the I2C addresses that acknowledge"),
        ("configure-bus", "configure the bus and read it back"),
        ("read-register", "read declared registers, each in one transaction"),
        ("write-register", "write a value to a declared register"),
        ("transfer", "one write/read transaction"),
        ("sequence", "several reads, writes, transfers and pauses on the configured bus"),
        ("capture", "record a UART for a bounded time"),
        ("release", "HiZ with pull-ups and supply off, read back"),
    ):
        command = sub.add_parser(name, help=text, allow_abbrev=False)
        command.add_argument("--adapter", required=True, metavar="ALIAS")
        if name in operations.BUS:
            command.add_argument("--bus", required=name not in DIRECT, metavar="PROFILE", help="a bus profile file")
            command.add_argument("--supply", type=int, metavar="MV", help="power the circuit from the adapter at this voltage")
            command.add_argument("--supply-ma", type=int, metavar="MA", help="the supply's current limit (default 100)")
            command.add_argument("--keep", action="store_true", help="leave the bus configured instead of releasing it")
        if name in DIRECT:
            command.add_argument("--mode", choices=("i2c", "spi", "uart"), help="the bus, without a profile")
            command.add_argument("--address", metavar="0xNN", help="the 7-bit address of an I2C device, without a profile")
            command.add_argument("--speed", type=int, metavar="HZ", help="I2C or SPI clock in Hz, UART baud rate")
            command.add_argument("--spi-mode", type=int, choices=(0, 1, 2, 3))
            command.add_argument("--pullups", choices=("on", "off"), help="the adapter's pull-ups (default: on for I2C)")
        commands[name] = command
    commands["scan"].add_argument("--from", dest="first", default="0x08", metavar="0xNN")
    commands["scan"].add_argument("--to", dest="last", default="0x77", metavar="0xNN")
    commands["read-register"].add_argument("--device")
    commands["read-register"].add_argument("--register", action="append", help="repeat for several; none reads every declared register")
    commands["read-register"].add_argument("--clears", action="store_true")
    commands["write-register"].add_argument("--device")
    commands["write-register"].add_argument("--register", required=True)
    commands["write-register"].add_argument("--value", required=True, metavar="HEX")
    commands["transfer"].add_argument("--device")
    commands["transfer"].add_argument("--write", metavar="HEX")
    commands["transfer"].add_argument("--read", type=int, metavar="N")
    commands["sequence"].add_argument("--device")
    commands["sequence"].add_argument("--step", action="append", required=True, metavar="STEP", help="read REG, write REG HEX, transfer HEX|- [N] or delay MS")
    commands["sequence"].add_argument("--clears", action="store_true")
    commands["capture"].add_argument("--duration", type=int, required=True, metavar="SECONDS")
    commands["capture"].add_argument("--write", metavar="HEX")
    summary = sub.add_parser("report", help="summarize run folders", allow_abbrev=False)
    summary.add_argument("--run", action="append", required=True, metavar="DIR")
    summary.add_argument("--title")
    commands["report"] = summary
    for name, command in commands.items():
        if name in WITHOUT_RUN_FOLDER:
            continue
        command.add_argument("--run-id", metavar="ID")
        command.add_argument("--results-dir", default=report.DEFAULT_RESULTS, metavar="DIR")
    return parser


def _check(args: Any) -> None:
    if getattr(args, "run_id", None) and not workspace.valid_run_id(args.run_id):
        raise Refused([problem("arguments", "--run-id takes 1-64 letters, digits, '.', '_' or '-', starting and ending with a letter or digit.")])
    if getattr(args, "read", None) is not None and not 0 <= args.read <= 512:
        raise Refused([problem("arguments", "--read takes 0 to 512.")])
    if args.operation == "capture" and not 1 <= args.duration <= 300:
        raise Refused([problem("arguments", "--duration takes 1 to 300.")])
    supply, limit = getattr(args, "supply", None), getattr(args, "supply_ma", None)
    if supply is not None and not 800 <= supply <= 5000:
        raise Refused([problem("arguments", "--supply takes 800 to 5000 mV.")])
    if limit is not None and not 1 <= limit <= 500:
        raise Refused([problem("arguments", "--supply-ma takes 1 to 500.")])


def _capabilities(args: Any, document: dict[str, Any], cwd: Path, spelled: Path) -> None:
    document["backend"] = {
        "id": BACKEND,
        "adapter": "Bus Pirate (BPIO2 binary mode on its second USB serial port)",
        "hardwareMajors": [5, 6],
        "protocolMajor": 2,
        "modes": ["i2c", "spi", "uart"],
        "operations": [name for name in OPERATIONS if name not in ("devices", "capabilities", "report")],
        "caps": {**profiles.CAPS, "i2cSpeedHz": list(profiles.SPEED["i2c"]), "spiSpeedHz": list(profiles.SPEED["spi"]), "uartBaud": list(profiles.BAUD), "captureSeconds": [1, 300], "captureBytes": operations.CAPTURE_BYTES, "sequenceSteps": operations.STEPS, "powerMv": [800, 5000], "powerMa": [1, 500]},
        "defaults": {**profiles.DEFAULTS, "limits": profiles.LIMITS},
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


def _adapter(cwd: Path, spelled: Path, args: Any, document: dict[str, Any], lifecycle: Lifecycle) -> Path | None:
    entry, profile, request = operations.prepare(args, document, cwd, spelled)
    folder = None if args.operation in WITHOUT_RUN_FOLDER else _folder(cwd, spelled, args, document)
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
