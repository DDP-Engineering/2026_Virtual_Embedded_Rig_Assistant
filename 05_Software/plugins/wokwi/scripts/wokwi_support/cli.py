"""Arguments, dispatch and the one JSON document of wokwi-tool (spec REQ-DATA-d985bb3d section 2; REQ-DATA-d985bb3d).

wokwi-cli is never reachable directly: the only cloud operation, run-scenario, names a job.json that VERA's approval
binds by hash, and runs exactly that job once.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from . import TOOL, VERSION, collect, operations, report, run, workspace
from .report import Ended, Refused, problem

OPERATIONS = ("capabilities", "inspect-project", "validate-diagram", "prepare-job", "run-scenario", "collect-results", "report")


class Parser(argparse.ArgumentParser):
    """argparse that refuses with a JSON document instead of printing usage."""

    def error(self, message: str) -> None:  # type: ignore[override]
        raise Refused([problem("usage", f"{self.prog}: {message}")])


def _parser() -> Parser:
    parser = Parser(prog=TOOL, description="Wokwi cloud firmware simulation jobs and finite scenarios.", allow_abbrev=False)
    parser.add_argument("--version", action="version", version=f"{TOOL} {VERSION}")
    sub = parser.add_subparsers(dest="operation", required=True, parser_class=Parser)
    sub.add_parser("capabilities", help="tool and wokwi-cli versions, forms, scenario commands and limits", allow_abbrev=False)
    inspect = sub.add_parser("inspect-project", help="wokwi.toml, firmware, ELF and diagram of a project, offline", allow_abbrev=False)
    inspect.add_argument("--project", required=True, metavar="DIR")
    inspect.add_argument("--firmware", metavar="FILE")
    inspect.add_argument("--elf", metavar="FILE")
    validate = sub.add_parser("validate-diagram", help="structural checks and wokwi-cli lint --offline", allow_abbrev=False)
    validate.add_argument("--diagram", required=True, metavar="FILE")
    prepare = sub.add_parser("prepare-job", help="a job folder of exact copies with the send list, offline", allow_abbrev=False)
    prepare.add_argument("--project", required=True, metavar="DIR")
    prepare.add_argument("--account", required=True, metavar="REF")
    prepare.add_argument("--virtual-timeout-ms", required=True, type=int, metavar="N")
    prepare.add_argument("--firmware", metavar="FILE")
    prepare.add_argument("--elf", metavar="FILE")
    prepare.add_argument("--diagram", metavar="FILE")
    prepare.add_argument("--scenario", metavar="FILE")
    prepare.add_argument("--expect-text", metavar="TEXT")
    prepare.add_argument("--fail-text", metavar="TEXT")
    prepare.add_argument("--real-budget-s", type=int, metavar="N")
    prepare.add_argument("--vcd", action="store_true")
    prepare.add_argument("--screenshot-part", metavar="ID")
    prepare.add_argument("--screenshot-ms", type=int, metavar="N")
    simulate = sub.add_parser("run-scenario", help="run a prepared job once in Wokwi's cloud", allow_abbrev=False)
    simulate.add_argument("--job", required=True, metavar="FILE")
    simulate.add_argument("--credential", required=True, metavar="REF")
    collected = sub.add_parser("collect-results", help="derive a run folder's outcome again, offline", allow_abbrev=False)
    collected.add_argument("--run", required=True, metavar="DIR")
    reported = sub.add_parser("report", help="JSON, Markdown, HTML and JUnit over run folders, offline", allow_abbrev=False)
    reported.add_argument("--run", required=True, action="append", metavar="DIR")
    for command in (prepare, simulate, reported):
        command.add_argument("--results-dir", default=report.DEFAULT_RESULTS, metavar="DIR")
        command.add_argument("--run-id", metavar="ID")
    return parser


HANDLERS = {
    "capabilities": operations.capabilities,
    "inspect-project": operations.inspect_project,
    "validate-diagram": operations.validate_diagram,
    "prepare-job": operations.prepare_job,
    "report": report.report,
}


def main(argv: list[str]) -> int:
    started = report.stamp()
    operation = next((value for value in argv if value in OPERATIONS), "unknown")
    document = report.header(operation, started)
    try:
        cwd = Path(workspace.entered_directory()).resolve()
        spelled = workspace.entered_directory()
        args = _parser().parse_args(argv)
        document["operation"] = args.operation
        if args.operation == "run-scenario":
            run.install_signals()
            document = run.run_scenario(args, document, cwd, spelled)
        elif args.operation == "collect-results":
            document = collect.collect_results(args, document, cwd, spelled)
        else:
            HANDLERS[args.operation](args, document, cwd, spelled)
    except Refused as error:
        document["status"] = "blocked"
        document["errors"] = error.problems
        document.update(error.fields)
    except Ended as error:
        document["status"] = error.status
        document["errors"] = [error.problem]
        document.update(error.fields)
    except SystemExit as exit_:
        # --version and --help print their text and exit 0.
        return int(exit_.code or 0)
    except KeyboardInterrupt:
        document["status"] = "incomplete"
        document["errors"] = [problem("stopped", "Interrupted before the operation finished.")]
    except Exception as error:  # noqa: BLE001 - one JSON document on every path
        document["status"] = "error"
        document["errors"] = [problem("internal", f"{type(error).__name__}: {str(error)[:300]}")]
    document["finishedAt"] = report.stamp()
    report.emit(document)
    return report.EXIT.get(document["status"], 3)
