"""Command line of the `platformio` helper (spec REQ-DATA-865c8fbd section 3)."""

from __future__ import annotations

import argparse
import sys
import traceback
from pathlib import Path

from . import VERSION
from .errors import Refused
from .result import emit, refuse
from .workspace import entered_directory

OPERATIONS = ("tools", "inspect-project", "inspect-environments", "prepare-packages", "build", "artifacts",
              "test-host", "test-device", "test-run", "clean")


class Parser(argparse.ArgumentParser):
    def error(self, message: str) -> None:  # type: ignore[override]
        raise Refused("usage", message)


def parser() -> Parser:
    root = Parser(prog="platformio", add_help=True)
    root.add_argument("--version", action="store_true")
    sub = root.add_subparsers(dest="operation", parser_class=Parser)
    tools = sub.add_parser("tools")
    tools.add_argument("--request")
    for name in ("inspect-project", "inspect-environments"):
        sub.add_parser(name).add_argument("--request", required=True)
    for name in ("prepare-packages", "artifacts", "clean"):
        item = sub.add_parser(name)
        item.add_argument("--request", required=True)
        item.add_argument("--results-dir")
    for name in ("build", "test-host", "test-device"):
        item = sub.add_parser(name)
        item.add_argument("--request", required=True)
        item.add_argument("--pristine", action="store_true")
        item.add_argument("--results-dir")
    run = sub.add_parser("test-run")
    run.add_argument("--test-device", required=True)
    run.add_argument("--suite", required=True)
    run.add_argument("--evidence", required=True)
    run.add_argument("--results-dir")
    return root


def main(argv: list[str] | None = None) -> int:
    operation = "platformio"
    try:
        args = parser().parse_args(argv)
        if args.version:
            print(f"platformio {VERSION}")
            return 0
        if not args.operation:
            raise Refused("usage", f"Name an operation: {', '.join(OPERATIONS)}.")
        operation = args.operation
        spelled = entered_directory()
        cwd = Path(spelled).resolve()
        from . import ops, prepare, tests  # noqa: PLC0415

        if operation == "tools":
            return ops.tools(cwd, spelled, args.request)
        if operation == "inspect-project":
            return ops.inspect_project(cwd, spelled, args.request)
        if operation == "inspect-environments":
            return ops.inspect_environments(cwd, spelled, args.request)
        if operation == "prepare-packages":
            return prepare.prepare(cwd, spelled, args.request, args.results_dir)
        if operation == "build":
            return ops.build(cwd, spelled, args.request, args.pristine, args.results_dir)
        if operation == "artifacts":
            return ops.artifacts_op(cwd, spelled, args.request, args.results_dir)
        if operation == "clean":
            return ops.clean_op(cwd, spelled, args.request, args.results_dir)
        if operation == "test-host":
            return tests.test_host(cwd, spelled, args.request, args.pristine, args.results_dir)
        if operation == "test-device":
            return tests.test_device(cwd, spelled, args.request, args.pristine, args.results_dir)
        return tests.test_run(cwd, spelled, args.test_device, args.suite, args.evidence, args.results_dir)
    except Refused as error:
        return refuse(error, operation)
    except Exception as error:  # noqa: BLE001 - every failure ends in one JSON document
        emit({"format": 1, "kind": "platformio-result", "operation": operation, "status": "error", "code": "internal",
              "reason": f"{type(error).__name__}: {str(error)[:300]}",
              "trace": traceback.format_exc(limit=6)[-1500:]})
        return 3


if __name__ == "__main__":
    sys.exit(main())
