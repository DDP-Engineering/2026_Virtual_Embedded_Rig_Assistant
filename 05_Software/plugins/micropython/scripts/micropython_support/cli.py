"""Arguments, dispatch and the one JSON document of micropython-tool (spec REQ-DATA-cb0ccbea).

There is no REPL, connect, exec, eval, mount, mip or firmware operation, and no argument is ever run as code
(REQ-SEC-bf7892ca): run-file and deploy-file take workbench files, which VERA's approval binds by hash.
"""

from __future__ import annotations

import argparse
import hashlib
import re
from pathlib import Path
from typing import Any

from . import TOOL, VERSION, deploy, operations, ports, remote, report, workspace
from .device import BoardError, BoardOSError, Session
from .report import Ended, Refused, problem

OPERATIONS = ("ports", "identify", "files", "read-file", "deploy-file", "run-file", "capture-output", "reset", "report")
DEVICE = OPERATIONS[1:8]
RESTARTABLE = ("identify", "files", "read-file", "deploy-file", "run-file", "capture-output")
DEPLOY_LIMIT = 1024 * 1024
RUN_LIMIT = 256 * 1024
SHA256 = re.compile(r"[0-9a-fA-F]{64}")


class Parser(argparse.ArgumentParser):
    """argparse that refuses with a JSON document instead of printing usage."""

    def error(self, message: str) -> None:  # type: ignore[override]
        raise Refused([problem("arguments", f"{self.prog}: {message}")])


def _parser() -> Parser:
    parser = Parser(prog=TOOL, description="Finite operations on MicroPython boards through mpremote's serial transport.", allow_abbrev=False)
    parser.add_argument("--version", action="version", version=f"{TOOL} {VERSION}")
    sub = parser.add_subparsers(dest="operation", required=True, parser_class=Parser)
    sub.add_parser("ports", help="list serial ports with their identity keys", allow_abbrev=False)
    commands: dict[str, Parser] = {}
    for name, text in (
        ("identify", "firmware, machine, unique id, memory and file system of the board"),
        ("files", "list the board's files"),
        ("read-file", "copy a board file into the run folder"),
        ("deploy-file", "write a workbench file to the board through a verified temporary copy"),
        ("run-file", "run a workbench script from RAM with a deadline"),
        ("capture-output", "read the board's console for a bounded time"),
        ("reset", "soft or hard reset, finding the board again by identity"),
    ):
        command = sub.add_parser(name, help=text, allow_abbrev=False)
        command.add_argument("--port", required=True)
        command.add_argument("--identity", required=True)
        command.add_argument("--baud", type=int, default=115200)
        if name in RESTARTABLE:
            command.add_argument("--restart", action="store_true")
        commands[name] = command
    commands["files"].add_argument("--path", default="/")
    commands["files"].add_argument("--depth", type=int, default=8)
    commands["read-file"].add_argument("--remote", required=True)
    put = commands["deploy-file"]
    put.add_argument("--source", required=True)
    put.add_argument("--remote", required=True)
    expect = put.add_mutually_exclusive_group()
    expect.add_argument("--expect-sha256")
    expect.add_argument("--expect-absent", action="store_true")
    put.add_argument("--mkdir", action="store_true")
    put.add_argument("--startup", action="store_true")
    commands["run-file"].add_argument("--source", required=True)
    commands["run-file"].add_argument("--timeout", type=int, default=60)
    commands["run-file"].add_argument("--max-output", type=int, default=65536)
    commands["capture-output"].add_argument("--duration", type=int, required=True)
    commands["reset"].add_argument("--mode", choices=("soft", "hard"), required=True)
    summary = sub.add_parser("report", help="summarize run folders", allow_abbrev=False)
    summary.add_argument("--run", action="append", required=True, metavar="DIR")
    summary.add_argument("--title")
    for name in (*DEVICE, "report"):
        command = commands.get(name) or summary
        command.add_argument("--run-id", metavar="ID")
        command.add_argument("--results-dir", default=report.DEFAULT_RESULTS, metavar="DIR")
    return parser


def _range(value: int, low: int, high: int, option: str) -> None:
    if not low <= value <= high:
        raise Refused([problem("arguments", f"{option} takes {low} to {high}.")])


def _check(args: Any) -> None:
    if getattr(args, "run_id", None) and not workspace.valid_run_id(args.run_id):
        raise Refused([problem("arguments", "--run-id takes 1-64 letters, digits, '.', '_' or '-', starting and ending with a letter or digit.")])
    if args.operation in DEVICE:
        _range(args.baud, 9600, 2_000_000, "--baud")
    if args.operation == "files":
        args.path = remote.path(args.path, "--path")
        _range(args.depth, 1, 16, "--depth")
    if args.operation == "read-file":
        args.remote = remote.path(args.remote, "--remote")
    if args.operation == "deploy-file":
        args.remote = remote.path(args.remote, "--remote")
        if args.remote == "/":
            raise Refused([problem("remote-path", "--remote must name a file.")])
        if remote.startup(args.remote) and not args.startup:
            raise Refused([problem("startup-file", f"{args.remote} runs at every start of the board; add --startup to replace it on purpose.")])
        if args.expect_sha256 is not None and not SHA256.fullmatch(args.expect_sha256):
            raise Refused([problem("arguments", "--expect-sha256 takes 64 hexadecimal digits.")])
    if args.operation == "run-file":
        _range(args.timeout, 1, 3500, "--timeout")
        _range(args.max_output, 1024, 1024 * 1024, "--max-output")
    if args.operation == "capture-output":
        _range(args.duration, 1, 600, "--duration")


def _source(cwd: Path, spelled: Path, raw: str, limit: int) -> tuple[Path, bytes]:
    try:
        path = workspace.regular_file(cwd, raw, "--source", spelled)
    except workspace.PathRefused as error:
        raise Refused([problem("path", str(error))]) from error
    if path.stat().st_size > limit:
        raise Refused([problem("too-large", f"--source has {path.stat().st_size} bytes; at most {limit} are accepted.")])
    return path, path.read_bytes()


def _device(cwd: Path, spelled: Path, args: Any, document: dict[str, Any]) -> int:
    data = b""
    if args.operation in ("deploy-file", "run-file"):
        _, data = _source(cwd, spelled, args.source, DEPLOY_LIMIT if args.operation == "deploy-file" else RUN_LIMIT)
        if args.operation == "run-file":
            try:
                data.decode("utf-8")
            except UnicodeDecodeError as error:
                raise Refused([problem("source-invalid", "--source must be UTF-8 text.")]) from error
    if args.operation == "deploy-file":
        document["remote"] = args.remote
    entry = ports.find(args.port, args.identity)
    run_id = args.run_id or report.new_run_id(args.operation)
    folder = report.run_folder(cwd, spelled, args.results_dir, run_id)
    document["runId"] = run_id
    document["resultPath"] = workspace.relative(cwd, folder / "result.json")
    if data:
        copy = folder / "files" / "source"
        copy.parent.mkdir()
        copy.write_bytes(data)
        document["source"] = {"path": workspace.relative(cwd, copy), "size": len(data), "sha256": hashlib.sha256(data).hexdigest()}
    session = Session(entry, args.baud, document)
    try:
        try:
            if args.operation == "capture-output":
                # Without --restart nothing is sent, so the firmware is not read; with it the raw REPL checks it first.
                session.open(repl=args.restart)
                if not args.restart:
                    document["firmware"] = None
                operations.capture(session, cwd, folder, document, args.duration, args.restart)
            elif args.operation == "reset" and args.mode == "soft":
                session.open()
            else:
                session.open(soft_reset=args.operation == "run-file")
                if args.operation == "identify":
                    operations.identify(session, document)
                elif args.operation == "files":
                    operations.files(session, document, args.path, args.depth)
                elif args.operation == "read-file":
                    operations.read_file(session, cwd, folder, document, args.remote)
                elif args.operation == "deploy-file":
                    deploy.run(session, folder, document, data, args.remote, args)
                elif args.operation == "run-file":
                    operations.run_file(session, cwd, folder, document, data, args.timeout, args.max_output)
                else:
                    operations.hard_reset(session, document)
        except BoardOSError as error:
            raise Ended("error", "board-error", f"The board raised {str(error).strip().splitlines()[-1][:200]}") from error
        except BoardError as error:
            raise Ended("error", "board-error", f"The board raised {str(error).strip().splitlines()[-1][:200]}") from error
        except (Refused, Ended):
            raise
        except Exception as error:  # noqa: BLE001 - the run folder gets the same document as stdout
            raise Ended("error", "internal", f"{type(error).__name__}: {str(error)[:300]}") from error
        finally:
            restart = bool(getattr(args, "restart", False)) and args.operation != "capture-output"
            restart = restart or (args.operation == "reset" and args.mode == "soft")
            session.finish(restart=restart and document.get("application") != "unknown")
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
    run_id = args.run_id or report.new_run_id("report")
    folder = report.run_folder(cwd, spelled, args.results_dir, run_id)
    document.update({"runId": run_id, "resultPath": workspace.relative(cwd, folder / "result.json"), "title": (args.title or "MicroPython runs")[:200], "runs": runs})
    document["finishedAt"] = report.stamp()
    report.write(folder, document)
    return 0


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
        if args.operation == "ports":
            document["ports"] = ports.listing()
            code = 0
        elif args.operation == "report":
            code = _report(cwd, spelled, args, document)
        else:
            code = _device(cwd, spelled, args, document)
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

