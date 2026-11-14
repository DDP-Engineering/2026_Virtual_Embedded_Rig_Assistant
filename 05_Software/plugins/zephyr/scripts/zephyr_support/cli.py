"""Command line of the `zephyr` helper (spec REQ-DATA-d8ecee6a section 3)."""

from __future__ import annotations

import argparse
import sys
import traceback
from pathlib import Path

from . import VERSION
from .errors import Refused
from .result import emit, refuse
from .workspace import entered_directory


class Parser(argparse.ArgumentParser):
    def error(self, message: str) -> None:  # type: ignore[override]
        raise Refused("usage", message)


def parser() -> Parser:
    root = Parser(prog="zephyr", add_help=True)
    root.add_argument("--version", action="store_true")
    sub = root.add_subparsers(dest="operation", parser_class=Parser)
    tools = sub.add_parser("tools")
    tools.add_argument("--request")
    for name in ("inspect", "prepare-workspace", "artifacts", "clean"):
        item = sub.add_parser(name)
        item.add_argument("--request", required=True)
        item.add_argument("--results-dir")
    for name in ("build", "test-build"):
        item = sub.add_parser(name)
        item.add_argument("--request", required=True)
        item.add_argument("--pristine", action="store_true")
        item.add_argument("--results-dir")
    run = sub.add_parser("test-run")
    run.add_argument("--test-build", required=True)
    run.add_argument("--scenario", required=True)
    run.add_argument("--evidence", required=True)
    run.add_argument("--results-dir")
    diff = sub.add_parser("differences")
    diff.add_argument("--build", required=True)
    diff.add_argument("--evidence", required=True)
    diff.add_argument("--results-dir")
    return root


def main(argv: list[str] | None = None) -> int:
    operation = "zephyr"
    try:
        args = parser().parse_args(argv)
        if args.version:
            print(f"zephyr {VERSION}")
            return 0
        if not args.operation:
            raise Refused("usage", "Name an operation: tools, inspect, prepare-workspace, build, artifacts, test-build, test-run, differences, clean.")
        operation = args.operation
        spelled = entered_directory()
        cwd = Path(spelled).resolve()
        from . import ops, prepare, tests, tools  # noqa: PLC0415

        if operation == "tools":
            return tools.tools(cwd, spelled, args.request)
        if operation == "inspect":
            return ops.inspect(cwd, spelled, args.request)
        if operation == "prepare-workspace":
            return prepare.prepare(cwd, spelled, args.request, args.results_dir)
        if operation == "build":
            return ops.build(cwd, spelled, args.request, args.pristine, args.results_dir)
        if operation == "artifacts":
            return ops.artifacts_op(cwd, spelled, args.request, args.results_dir)
        if operation == "clean":
            return ops.clean_op(cwd, spelled, args.request, args.results_dir)
        if operation == "test-build":
            return tests.test_build(cwd, spelled, args.request, args.pristine, args.results_dir)
        if operation == "differences":
            return tests.differences_op(cwd, spelled, args.build, args.evidence, args.results_dir)
        return tests.test_run(cwd, spelled, args.test_build, args.scenario, args.evidence, args.results_dir)
    except Refused as error:
        return refuse(error, operation)
    except Exception as error:  # noqa: BLE001 - every failure ends in one JSON document
        emit({"format": 1, "kind": "zephyr-result", "operation": operation, "status": "error", "code": "internal",
              "reason": f"{type(error).__name__}: {str(error)[:300]}",
              "trace": traceback.format_exc(limit=6)[-1500:]})
        return 3


if __name__ == "__main__":
    sys.exit(main())
