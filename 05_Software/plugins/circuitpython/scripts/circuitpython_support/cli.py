"""Arguments, dispatch and the one JSON document of circuitpython-tool (spec REQ-DATA-8f309a53).

There is no REPL, exec, eval, firmware, UF2, install, update or update-all operation, and no argument is run as code
(REQ-SEC-a6773cd2): deploy takes workbench files and a library set, which VERA's approval binds by hash.
"""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

from . import TOOL, VERSION, bundle, console, conventions, deploy, inspection, ports, report, volumes, workspace
from .report import Ended, Refused, problem

OPERATIONS = ("devices", "identify", "inspect-code", "inspect-libraries", "prepare-libraries", "deploy", "capture-output", "report")
VOLUME = ("identify", "inspect-code", "inspect-libraries", "deploy")


class Parser(argparse.ArgumentParser):
    """argparse that refuses with a JSON document instead of printing usage."""

    def error(self, message: str) -> None:  # type: ignore[override]
        raise Refused([problem("arguments", f"{self.prog}: {message}")])


def _parser() -> Parser:
    parser = Parser(prog=TOOL, description="CircuitPython code and compatible libraries on an identified board.", allow_abbrev=False)
    parser.add_argument("--version", action="version", version=f"{TOOL} {VERSION}")
    sub = parser.add_subparsers(dest="operation", required=True, parser_class=Parser)
    sub.add_parser("devices", help="list CIRCUITPY volumes and serial ports with their identity keys", allow_abbrev=False)
    commands: dict[str, Parser] = {}
    for name, text in (
        ("identify", "firmware, board, UID, space and read-only state of a volume"),
        ("inspect-code", "list a volume's files and copy its startup code"),
        ("inspect-libraries", "list a volume's /lib modules with versions and .mpy compatibility"),
        ("deploy", "write approved files and a library set to a volume, one verified file at a time"),
    ):
        command = sub.add_parser(name, help=text, allow_abbrev=False)
        command.add_argument("--volume", required=True)
        command.add_argument("--identity", required=True)
        commands[name] = command
    put = commands["deploy"]
    put.add_argument("--libraries", metavar="LIBRARY_SET")
    put.add_argument("--source", action="append", metavar="FILE")
    put.add_argument("--target", action="append", metavar="PATH")
    put.add_argument("--boot", action="store_true")
    put.add_argument("--expect-from", metavar="RESULT")
    put.add_argument("--capture", type=int, metavar="SECONDS")
    put.add_argument("--port")
    prepare = sub.add_parser("prepare-libraries", help="a library set from a pinned bundle tag", allow_abbrev=False)
    prepare.add_argument("--library", action="append", required=True)
    prepare.add_argument("--circuitpython", type=int, required=True, metavar="MAJOR")
    prepare.add_argument("--bundle-tag", required=True, metavar="YYYYMMDD")
    commands["prepare-libraries"] = prepare
    capture = sub.add_parser("capture-output", help="read the serial console for a bounded time", allow_abbrev=False)
    capture.add_argument("--port", required=True)
    capture.add_argument("--identity", required=True)
    capture.add_argument("--duration", type=int, required=True)
    capture.add_argument("--reload", action="store_true")
    commands["capture-output"] = capture
    summary = sub.add_parser("report", help="summarize run folders", allow_abbrev=False)
    summary.add_argument("--run", action="append", required=True, metavar="DIR")
    summary.add_argument("--title")
    commands["report"] = summary
    for command in commands.values():
        command.add_argument("--run-id", metavar="ID")
        command.add_argument("--results-dir", default=report.DEFAULT_RESULTS, metavar="DIR")
    return parser


def _range(value: int, low: int, high: int, option: str) -> None:
    if not low <= value <= high:
        raise Refused([problem("arguments", f"{option} takes {low} to {high}.")])


def _check(args: Any) -> None:
    if getattr(args, "run_id", None) and not workspace.valid_run_id(args.run_id):
        raise Refused([problem("arguments", "--run-id takes 1-64 letters, digits, '.', '_' or '-', starting and ending with a letter or digit.")])
    if args.operation == "prepare-libraries":
        if not bundle.TAG.fullmatch(args.bundle_tag):
            raise Refused([problem("arguments", "--bundle-tag takes the bundle's release tag, eight digits such as 20261110.")])
        majors = conventions.supported_majors()
        if args.circuitpython not in majors:
            raise Refused([problem("arguments", f"--circuitpython takes {', '.join(map(str, majors))}.")])
        if not 1 <= len(args.library) <= 32:
            raise Refused([problem("arguments", "--library takes 1 to 32 names.")])
        names = []
        for raw in args.library:
            name = conventions.clean_name(raw) if len(raw) <= 128 else ""
            if not bundle.NAME.fullmatch(name):
                raise Refused([problem("arguments", f"--library {raw[:64]!r} is not a library name such as adafruit_bme280.")])
            if name not in names:
                names.append(name)
        args.library = names
    if args.operation == "deploy":
        sources, targets = args.source or [], args.target or []
        if len(sources) != len(targets):
            raise Refused([problem("arguments", "Each --source needs one --target, in the same order.")])
        if not sources and not args.libraries:
            raise Refused([problem("arguments", "deploy needs --libraries or at least one --source/--target pair.")])
        if len(sources) > 32:
            raise Refused([problem("arguments", "deploy takes at most 32 --source/--target pairs.")])
        args.target = [deploy.target(value) for value in targets]
        for value in args.target:
            if value.casefold() == deploy.BOOT and not args.boot:
                raise Refused([problem("startup-file", f"{value} runs before code.py at every start and can take the drive away from this computer; add --boot to replace it on purpose.")])
        if args.capture is not None:
            _range(args.capture, 1, 120, "--capture")
            if not args.port:
                raise Refused([problem("arguments", "--capture needs --port, the serial port bound to the volume.")])
            ports.check_address(args.port)
        elif args.port:
            raise Refused([problem("arguments", "--port is used only with --capture.")])
    if args.operation == "capture-output":
        _range(args.duration, 1, 600, "--duration")


def _volume(cwd: Path, spelled: Path, args: Any, document: dict[str, Any]) -> int:
    entry, _ = volumes.select(args.volume, args.identity, write=args.operation == "deploy")
    document["volume"] = volumes.summary(entry)
    document["firmware"] = entry.get("firmware")
    firmware = volumes.require_firmware(entry)
    run_id = args.run_id or report.new_run_id(args.operation)
    folder = report.run_folder(cwd, spelled, args.results_dir, run_id)
    document["runId"] = run_id
    document["resultPath"] = workspace.relative(cwd, folder / "result.json")
    try:
        try:
            if args.operation == "identify":
                inspection.identify(entry, firmware, document)
            elif args.operation == "inspect-code":
                inspection.inspect_code(cwd, folder, entry, document)
            elif args.operation == "inspect-libraries":
                inspection.inspect_libraries(entry, firmware, document)
            else:
                deploy.run(cwd, spelled, folder, entry, firmware, document, args)
        except (Refused, Ended):
            raise
        except Exception as error:  # noqa: BLE001 - the run folder gets the same document as stdout
            raise Ended("error", "internal", f"{type(error).__name__}: {str(error)[:300]}") from error
    except (Refused, Ended) as stop:
        stop.folder = folder  # type: ignore[attr-defined]
        raise
    document["finishedAt"] = report.stamp()
    report.write(folder, document)
    return 0


def _folder_run(cwd: Path, spelled: Path, args: Any, document: dict[str, Any], work: Any) -> int:
    run_id = args.run_id or report.new_run_id(args.operation)
    folder = report.run_folder(cwd, spelled, args.results_dir, run_id)
    document["runId"] = run_id
    document["resultPath"] = workspace.relative(cwd, folder / "result.json")
    try:
        try:
            work(folder)
        except (Refused, Ended):
            raise
        except Exception as error:  # noqa: BLE001
            raise Ended("error", "internal", f"{type(error).__name__}: {str(error)[:300]}") from error
    except (Refused, Ended) as stop:
        stop.folder = folder  # type: ignore[attr-defined]
        raise
    document["finishedAt"] = report.stamp()
    report.write(folder, document)
    return 0


def _report(cwd: Path, spelled: Path, args: Any, document: dict[str, Any]) -> int:
    runs = []
    for raw in args.run:
        try:
            folder = workspace.confined(cwd, raw, "--run", spelled)
        except workspace.PathRefused as error:
            raise Refused([problem("path", str(error))]) from error
        runs.append(report.summary(cwd, folder))
    document.update({"title": (args.title or "CircuitPython runs")[:200], "runs": runs})
    return _folder_run(cwd, spelled, args, document, lambda folder: None)


def main(argv: list[str]) -> int:
    started = report.stamp()
    operation = next((value for value in argv if not value.startswith("-")), "arguments")
    document = report.header(operation if operation in OPERATIONS else "arguments", started)
    folder: Path | None = None
    try:
        args = _parser().parse_args(argv)
        _check(args)
        cwd = Path(workspace.entered_directory()).resolve()
        spelled = workspace.entered_directory()
        if args.operation == "devices":
            document.update(volumes.listing())
            code = 0
        elif args.operation in VOLUME:
            code = _volume(cwd, spelled, args, document)
        elif args.operation == "prepare-libraries":
            code = _folder_run(cwd, spelled, args, document, lambda folder: bundle.prepare(cwd, folder, document, args.library, args.circuitpython, args.bundle_tag))
        elif args.operation == "capture-output":
            entry = ports.find(args.port, args.identity)
            document["port"] = {"address": entry["address"], "identity": entry["identity"]}
            code = _folder_run(cwd, spelled, args, document, lambda folder: console.capture(cwd, folder, document, args.port, args.duration, args.reload))
        else:
            code = _report(cwd, spelled, args, document)
    except Refused as refusal:
        folder = getattr(refusal, "folder", None)
        document.update(refusal.fields)
        document["status"] = "blocked"
        document["errors"] = refusal.problems
        code = 2
    except Ended as end:
        folder = getattr(end, "folder", None)
        document.update(end.fields)
        document["status"] = end.status
        document["errors"] = [end.problem]
        code = report.EXIT[end.status]
    except SystemExit as exit_:
        # --version and --help print their text and exit 0.
        return int(exit_.code or 0)
    except Exception as error:  # noqa: BLE001 - one JSON document on every path
        document["status"] = "error"
        document["errors"] = [problem("internal", f"{type(error).__name__}: {str(error)[:300]}")]
        code = 3
    document.setdefault("finishedAt", report.stamp())
    if folder is not None:
        report.write(folder, document)
    report.emit(document)
    return code
