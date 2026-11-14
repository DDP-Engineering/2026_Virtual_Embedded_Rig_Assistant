"""Arguments, dispatch and the one JSON document of pi-tool (spec REQ-DATA-44547a17 section 2)."""

from __future__ import annotations

import argparse
import asyncio
import os
import signal
from pathlib import Path
from typing import Any

from . import TOOL, VERSION, operations, report, workspace
from .lifecycle import Lifecycle
from .report import Ended, Refused, problem

BOARD_OPERATIONS = (
    "check-host-key", "install-helper", "identify", "deploy-candidate", "apply-candidate", "run-task", "task-status",
    "stop-owned", "service-status", "service-start", "service-stop", "collect-logs",
)
OPERATIONS = ("capabilities", "inspect-project", "report", *BOARD_OPERATIONS)


class Parser(argparse.ArgumentParser):
    """argparse that refuses with a JSON document instead of printing usage."""

    def error(self, message: str) -> None:  # type: ignore[override]
        raise Refused([problem("usage", f"{self.prog}: {message}")])


def _parser() -> Parser:
    parser = Parser(prog=TOOL, description="Projects, tasks and user services on a Linux board (Raspberry Pi) over verified SSH.", allow_abbrev=False)
    parser.add_argument("--version", action="version", version=f"{TOOL} {VERSION}")
    sub = parser.add_subparsers(dest="operation", required=True, parser_class=Parser)
    sub.add_parser("capabilities", help="versions, supported matrix, operations and limits", allow_abbrev=False)
    inspect = sub.add_parser("inspect-project", help="a project manifest and its files, offline", allow_abbrev=False)
    inspect.add_argument("--project", required=True, metavar="FILE")
    reported = sub.add_parser("report", help="JSON, Markdown and HTML over run folders, offline", allow_abbrev=False)
    reported.add_argument("--run", required=True, action="append", metavar="DIR")
    commands = [reported]
    for name in BOARD_OPERATIONS:
        command = sub.add_parser(name, allow_abbrev=False)
        command.add_argument("--board", required=True, metavar="ALIAS")
        commands.append(command)
        if name in ("deploy-candidate", "run-task", "service-status", "service-start", "service-stop", "collect-logs"):
            command.add_argument("--project", required=True, metavar="FILE")
        if name == "apply-candidate":
            command.add_argument("--candidate", required=True, metavar="FILE")
            command.add_argument("--overwrite", action="append", default=[], metavar="PATH")
        if name == "run-task":
            command.add_argument("--task", required=True, metavar="NAME")
            command.add_argument("--arg", action="append", default=[], metavar="VALUE")
        if name == "task-status":
            command.add_argument("--handle", required=True, metavar="H")
        if name.startswith("service-"):
            command.add_argument("--service", required=True, metavar="UNIT")
        if name == "collect-logs":
            command.add_argument("--service", action="append", default=[], metavar="UNIT")
            command.add_argument("--handle", action="append", default=[], metavar="H")
            command.add_argument("--lines", type=int, default=200, metavar="N")
    for command in commands:
        command.add_argument("--results-dir", default=report.DEFAULT_RESULTS, metavar="DIR")
        command.add_argument("--run-id", metavar="ID")
    return parser


async def _board(args: Any, document: dict[str, Any], lifecycle: Lifecycle, folder: Path, cwd: Path, spelled: Path) -> None:
    operation = args.operation
    if operation == "check-host-key":
        await operations.check_host_key(args, document, lifecycle)
    elif operation == "install-helper":
        await operations.install_helper(args, document, lifecycle)
    elif operation == "identify":
        await operations.identify(args, document, lifecycle)
    elif operation == "deploy-candidate":
        await operations.deploy_candidate(args, document, lifecycle, folder, cwd, spelled)
    elif operation == "apply-candidate":
        await operations.apply_candidate(args, document, lifecycle, cwd, spelled)
    elif operation == "run-task":
        await operations.run_task(args, document, lifecycle, folder, cwd, spelled)
    elif operation == "task-status":
        await operations.task_status(args, document, lifecycle)
    elif operation == "stop-owned":
        await operations.stop_owned(args, document, lifecycle)
    elif operation.startswith("service-"):
        await operations.service(args, document, lifecycle, cwd, spelled, operation.removeprefix("service-"))
    elif operation == "collect-logs":
        await operations.collect_logs(args, document, lifecycle, folder, cwd, spelled)


def _folder(cwd: Path, spelled: Path, args: Any, document: dict[str, Any]) -> Path:
    run_id = args.run_id or report.new_run_id(args.operation)
    if not workspace.valid_run_id(run_id):
        raise report.refused("usage", "--run-id is 1 to 64 letters, digits, dot, underscore or dash.")
    folder = report.run_folder(cwd, spelled, args.results_dir, run_id)
    document["runId"] = run_id
    document["runFolder"] = workspace.relative(cwd, folder)
    return folder


def main(argv: list[str]) -> int:
    started = report.stamp()
    operation = next((value for value in argv if not value.startswith("-")), "arguments")
    document = report.header(operation if operation in OPERATIONS else "arguments", started)
    lifecycle = Lifecycle()
    if hasattr(signal, "SIGTERM") and os.name != "nt":
        # VERA's Stop on Linux: finish at the next safe point like a stop request.
        signal.signal(signal.SIGTERM, lambda *_: setattr(lifecycle, "stopped", True))
    folder: Path | None = None
    supervised = operation in BOARD_OPERATIONS
    if supervised:
        lifecycle.report("start")
    try:
        args = _parser().parse_args(argv)
        cwd = Path(workspace.entered_directory()).resolve()
        spelled = workspace.entered_directory()
        if args.operation == "capabilities":
            operations.capabilities(args, document)
        elif args.operation == "inspect-project":
            operations.inspect_project(args, document, cwd, spelled)
        elif args.operation == "report":
            operations.report_runs(args, document, cwd, spelled)
            folder = _folder(cwd, spelled, args, document)
        else:
            folder = _folder(cwd, spelled, args, document)
            asyncio.run(_board(args, document, lifecycle, folder, cwd, spelled))
        code = 0
    except Refused as refusal:
        # The helper refuses before it acts, so a refusal leaves the board as it was; only a helper that failed
        # without its own document (remote-error) may have stopped halfway.
        if lifecycle.physical == "pending" and refusal.problems[0]["code"] != "remote-error":
            lifecycle.physical = "unchanged"
        document.update(refusal.fields)
        document["status"] = "blocked"
        document["errors"] = refusal.problems
        code = 2
    except Ended as end:
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
