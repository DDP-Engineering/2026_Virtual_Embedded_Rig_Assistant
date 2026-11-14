"""Arguments, dispatch and the one JSON document of mqtt-tool (spec REQ-DATA-96d18686 sections 2 and 6).

There is no broker administration, free client or console (REQ-SEC-5423bb1e): every network operation names a
profile file that VERA's approval binds by hash, and publishes only to the topics it declares.
"""

from __future__ import annotations

import argparse
import os
import signal
from pathlib import Path
from typing import Any

from . import TOOL, VERSION, report, workspace
from . import profile as profiles
from .connection import STOP
from .report import Ended, Refused, problem

OPERATIONS = ("capabilities", "check-profile", "connect-test", "subscribe", "publish", "request")
NETWORK = ("connect-test", "subscribe", "publish", "request")


def _terminate(_signum: int, _frame: Any) -> None:
    """SIGTERM (VERA's Stop on Linux): the running operation unsubscribes and disconnects at its next step."""
    STOP.requested = True


class Parser(argparse.ArgumentParser):
    """argparse that refuses with a JSON document instead of printing usage."""

    def error(self, message: str) -> None:  # type: ignore[override]
        raise Refused([problem("usage", f"{self.prog}: {message}")])


def _parser() -> Parser:
    parser = Parser(prog=TOOL, description="Bounded MQTT telemetry and controlled commands on a configured broker.", allow_abbrev=False)
    parser.add_argument("--version", action="version", version=f"{TOOL} {VERSION}")
    sub = parser.add_subparsers(dest="operation", required=True, parser_class=Parser)
    sub.add_parser("capabilities", help="the client, protocols and operations", allow_abbrev=False)
    check = sub.add_parser("check-profile", help="validate a broker profile offline", allow_abbrev=False)
    check.add_argument("--profile", required=True, metavar="FILE")
    commands: dict[str, Parser] = {}
    for name, text in (
        ("connect-test", "TLS, authentication and CONNACK, then a normal disconnect"),
        ("subscribe", "a bounded capture of declared topic filters"),
        ("publish", "one PUBLISH to a declared topic, sent once"),
        ("request", "one correlated request and its response"),
    ):
        command = sub.add_parser(name, help=text, allow_abbrev=False)
        command.add_argument("--profile", required=True, metavar="FILE")
        command.add_argument("--credential", metavar="REF")
        command.add_argument("--run-id", metavar="ID")
        command.add_argument("--results-dir", default=report.DEFAULT_RESULTS, metavar="DIR")
        commands[name] = command
    commands["subscribe"].add_argument("--topic", action="append", required=True, metavar="FILTER")
    commands["subscribe"].add_argument("--duration", type=int, metavar="S")
    commands["subscribe"].add_argument("--max-messages", type=int, metavar="N")
    commands["subscribe"].add_argument("--max-bytes", type=int, metavar="B")
    for name in ("publish", "request"):
        commands[name].add_argument("--topic", required=True, metavar="TOPIC")
        commands[name].add_argument("--payload", metavar="TEXT")
        commands[name].add_argument("--payload-file", metavar="FILE")
    commands["publish"].add_argument("--retain", action="store_true")
    commands["request"].add_argument("--timeout", type=int, metavar="MS")
    return parser


def _network(args: Any, document: dict[str, Any], cwd: Path, spelled: Path) -> Path:
    from . import operations  # noqa: PLC0415 - paho is imported only by network operations

    if args.run_id and not workspace.valid_run_id(args.run_id):
        raise Refused([problem("usage", "--run-id takes 1-64 letters, digits, '.', '_' or '-', starting and ending with a letter or digit.")])
    profile = profiles.load(cwd, spelled, args.profile)
    run = operations.Run(args, document, profile, cwd, spelled)
    operations.prepare(run)
    run_id = args.run_id or report.new_run_id(args.operation)
    folder = report.run_folder(cwd, spelled, args.results_dir, run_id)
    document["runId"] = run_id
    document["resultPath"] = workspace.relative(cwd, folder / "result.json")
    run.folder = folder
    try:
        operations.OPERATIONS[args.operation](run)
    except (Refused, Ended) as stop:
        stop.folder = folder  # type: ignore[attr-defined]
        raise
    except Exception as error:  # noqa: BLE001 - the run folder gets the same document as stdout
        end = Ended("error", "internal", f"{type(error).__name__}: {str(error)[:300]}")
        end.folder = folder  # type: ignore[attr-defined]
        raise end from error
    finally:
        if run.connection is not None and run.connection.connected:
            run.connection.close()
    return folder


def main(argv: list[str]) -> int:
    started = report.stamp()
    operation = next((value for value in argv if not value.startswith("-")), "usage")
    document = report.header(operation if operation in OPERATIONS else "usage", started)
    if hasattr(signal, "SIGTERM") and os.name != "nt":
        signal.signal(signal.SIGTERM, _terminate)
    folder: Path | None = None
    try:
        args = _parser().parse_args(argv)
        cwd = Path(workspace.entered_directory()).resolve()
        spelled = workspace.entered_directory()
        if args.operation == "capabilities":
            from . import operations  # noqa: PLC0415

            operations.capabilities(document)
        elif args.operation == "check-profile":
            profile = profiles.load(cwd, spelled, args.profile)
            document.update({"profile": profile.summary(), "effective": profile.effective()})
        else:
            folder = _network(args, document, cwd, spelled)
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
    except SystemExit as exit_:
        # --version and --help print their text and exit 0.
        return int(exit_.code or 0)
    except Exception as error:  # noqa: BLE001 - one JSON document on every path
        document["status"] = "error"
        document["errors"] = [problem("internal", f"{type(error).__name__}: {str(error)[:300]}")]
        code = 3
    document["finishedAt"] = report.stamp()
    if folder is not None:
        try:
            report.write(folder, document)
        except OSError as error:
            document["warnings"].append(problem("result-not-written", f"result.json could not be written: {error.strerror or error}."))
    report.emit(document)
    return code
