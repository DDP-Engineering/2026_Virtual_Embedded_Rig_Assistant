"""`renode-sim`: tools, profiles, validate, run, capture-uart, test and report (spec REQ-DATA-8a943977).

Options and paths are refused before anything is written (exit 2). For the engine operations, a profile, firmware,
test set or engine that does not fit makes a run folder with status `blocked` and never starts the engine
(REQ-REL-0423211e); `validate` refuses with exit 2. Exit codes: 0 pass, 1 fail or timeout, 2 refused, 3 incomplete,
blocked, error or stopped.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any

from . import VERSION, firmware, profiles, report, testsets
from .engine import probe_version
from .errors import EngineError, Refused
from .operations import Plan, execute
from .result import Run, emit
from .workspace import PathRefused, entered_directory, regular_file, relative

PLUGIN = Path(__file__).resolve().parent.parent.parent
USAGE = (
    "renode-sim {tools | profiles [--profile ID] | validate|run|capture-uart|test --profile ID --firmware ELF --arch ARCH "
    "--boot-address 0x... [--virtual-budget S] [--real-timeout S] [--uart NAME] [--until REGEX] [--test-set ID] "
    "[--param NAME=VALUE]... [--results-dir DIR] [--run-id ID] [--label TEXT] | report --run DIR [--hil DIR]}"
)
DEFAULT_VIRTUAL = {"run": 1.0, "capture-uart": 5.0}
MAX_VIRTUAL = 3600.0
MAX_REAL = 3500


class _Parser(argparse.ArgumentParser):
    def error(self, message: str) -> None:  # type: ignore[override]
        raise Refused("request", f"{message}. Usage: {USAGE}")


def _seconds(low: float, high: float, name: str):
    def parse(text: str) -> float:
        if not re.fullmatch(r"[0-9]{1,5}(?:\.[0-9]{1,6})?", text) or not low <= float(text) <= high:
            raise argparse.ArgumentTypeError(f"{name} must be a number of seconds from {low} to {high}")
        return float(text)

    return parse


def _parser() -> argparse.ArgumentParser:
    parser = _Parser(prog="renode-sim", allow_abbrev=False, add_help=False)
    sub = parser.add_subparsers(dest="operation", required=True, parser_class=_Parser)
    sub.add_parser("tools", allow_abbrev=False, add_help=False)
    listing = sub.add_parser("profiles", allow_abbrev=False, add_help=False)
    listing.add_argument("--profile")
    for name in ("validate", "run", "capture-uart", "test"):
        op = sub.add_parser(name, allow_abbrev=False, add_help=False)
        op.add_argument("--profile", required=True)
        op.add_argument("--firmware", required=True)
        op.add_argument("--arch", required=True)
        op.add_argument("--boot-address", required=True)
        if name == "validate":
            continue
        op.add_argument("--virtual-budget", type=_seconds(0.001, MAX_VIRTUAL, "--virtual-budget"))
        op.add_argument("--real-timeout", type=_seconds(1, MAX_REAL, "--real-timeout"), default=300.0)
        op.add_argument("--uart")
        op.add_argument("--results-dir")
        op.add_argument("--run-id")
        op.add_argument("--label")
        if name == "capture-uart":
            op.add_argument("--until", required=True)
        if name == "test":
            op.add_argument("--test-set", required=True)
            op.add_argument("--param", action="append", default=[])
    rep = sub.add_parser("report", allow_abbrev=False, add_help=False)
    rep.add_argument("--run", required=True)
    rep.add_argument("--hil")
    return parser


def _engine_path() -> Path | None:
    value = os.environ.get("VERA_PROGRAM_RENODE")
    return Path(value) if value else None


def _firmware_path(cwd: Path, spelled: Path, raw: str) -> tuple[Path, str]:
    try:
        path = regular_file(cwd, raw, "--firmware", spelled)
    except PathRefused as error:
        raise Refused("request", str(error)) from error
    return path, relative(cwd, path)


def tools() -> int:
    engine = _engine_path()
    if engine is None:
        emit({"format": 1, "kind": "renode-tools", "status": "blocked", "code": "engine-missing",
              "reason": "The Renode engine was not provided (VERA_PROGRAM_RENODE); install the plugin's programs."})
        return 3
    try:
        line, version = probe_version(engine)
    except EngineError as error:
        emit({"format": 1, "kind": "renode-tools", "status": "error", "code": "engine", "reason": error.message})
        return 3
    root = profiles.engine_root(engine)
    emit({"format": 1, "kind": "renode-tools", "status": "pass", "engine": {"path": str(engine), "versionLine": line,
          "version": version, "platforms": str(root / "platforms") if root else None}, "helper": VERSION})
    return 0


def list_profiles(cwd: Path, only: str | None) -> int:
    valid, refused = profiles.listing(PLUGIN, cwd)
    # The full facts of one profile, or one compact row per profile (the listing stays inside the output limit).
    shown = [profile.summary() if only else profile.row() for profile in valid if only in (None, profile.id)]
    refused = [entry for entry in refused if only in (None, entry["id"])]
    emit({"format": 1, "kind": "renode-profiles", "status": "pass", "profiles": shown, "refused": refused})
    return 0


def validate(args: argparse.Namespace, cwd: Path, spelled: Path) -> int:
    path, shown = _firmware_path(cwd, spelled, args.firmware)
    profile = profiles.find(PLUGIN, cwd, args.profile)
    document = firmware.check(profile, path, shown, args.arch, args.boot_address)
    emit({"format": 1, "kind": "renode-validation", "status": "validated", "profile": profile.id,
          "profileSha256": profile.sha256, "firmware": document})
    return 0


def _blocked(run: Run, cwd: Path, spelled: Path, raw_dir: str | None, error: Refused) -> int:
    run.create_folder(cwd, spelled, raw_dir)
    run.set_status("blocked", error.code, error.message)
    if error.detail:
        run["refusal"] = error.detail
    run.document["state"] = "done"
    assert run.folder is not None
    with open(run.folder / "junit.xml", "w", encoding="utf-8", newline="\n") as handle:
        handle.write(report.junit(run.document))
    return run.finish()


def engine_operation(args: argparse.Namespace, cwd: Path, spelled: Path) -> int:
    operation = args.operation
    if args.label is not None and (not 0 < len(args.label) <= 120 or any(ord(c) < 32 for c in args.label)):
        raise Refused("request", "--label takes 1-120 printable characters.")
    path, shown = _firmware_path(cwd, spelled, args.firmware)
    until = None
    if operation == "capture-uart":
        if not 0 < len(args.until) <= 256:
            raise Refused("request", "--until takes a pattern of 1-256 characters.")
        try:
            until = re.compile(args.until)
        except re.error as error:
            raise Refused("request", f"--until is not a valid regular expression: {error}.") from error
    given = testsets.parse_params(args.param) if operation == "test" else {}
    run = Run(operation, args.run_id, args.label)
    run["budgets"] = {"virtualSeconds": None, "realSeconds": args.real_timeout}
    deadline = time.monotonic() + args.real_timeout
    try:
        profile = profiles.find(PLUGIN, cwd, args.profile)
        run["profile"] = {"id": profile.id, "origin": profile.origin, "sha256": profile.sha256, "files": profile.files,
                          "engineFiles": profile.data["engineFiles"], "verification": profile.data["verification"]}
        run["firmware"] = {"path": shown, "validation": None}
        validation = firmware.check(profile, path, shown, args.arch, args.boot_address)
        run["firmware"] = {k: validation[k] for k in ("path", "sha256", "buildId", "arch", "isa", "bootAddress", "entry")}
        run["firmware"]["validation"] = "validated"
        uart = args.uart or profile.data["console"]
        if uart not in profile.data["uarts"]:
            raise Refused("uart", f"--uart {uart[:32]} is not a UART of profile {profile.id} ({', '.join(profile.data['uarts'])}).")
        testset = None
        if operation == "test":
            testset = testsets.find(PLUGIN, cwd, args.test_set, profile, given)
            run["testSet"] = {"id": testset.id, "origin": testset.origin, "sha256": testset.sha256, "params": testset.params}
        budget = args.virtual_budget
        if budget is None:
            budget = min(MAX_VIRTUAL, sum(case["budget"] for case in testset.cases)) if testset else DEFAULT_VIRTUAL[operation]
        run["budgets"]["virtualSeconds"] = budget
        engine = _engine_path()
        if engine is None:
            raise Refused("engine-missing", "The Renode engine was not provided (VERA_PROGRAM_RENODE); install the plugin's programs.")
        try:
            line, version = probe_version(engine)
        except EngineError as error:
            raise Refused("engine", error.message) from error
        run["engine"] = {"path": str(engine), "version": version, "versionLine": line}
        if version != profile.data["engine"]:
            raise Refused("engine-version", f"The engine is Renode {version}; profile {profile.id} was made for {profile.data['engine']}.")
        run["profile"]["engineFiles"] = profiles.check_engine_files(profile, engine)
    except Refused as error:
        if error.code in ("request", "param"):
            raise
        if run["firmware"] and run["firmware"].get("validation") is None:
            run["firmware"]["validation"] = f"refused: {error.code}"
        return _blocked(run, cwd, spelled, args.results_dir, error)
    run["coverage"]["simulated"] = [
        f"firmware {shown} (SHA-256 {validation['sha256']}, build id {validation['buildId']}) loaded at {validation['bootAddress']}",
        f"engine Renode {version}",
        f"profile {profile.id} ({profile.origin}, SHA-256 {profile.sha256}): {profile.data['platform']}",
        "modeled peripherals relied on: " + ", ".join(p["name"] for p in profile.data["peripherals"]),
        f"UART {uart} recorded to a file in the run folder",
    ]
    if testset is not None:
        stimuli = sorted({step["name"] for case in testset.cases for step in case["steps"] if step["do"] == "stimulus"})
        run["coverage"]["simulated"].append(f"test set {testset.id} (SHA-256 {testset.sha256}); stimuli: {', '.join(stimuli) or 'none'}")
    run["coverage"]["notCovered"] += [f"profile limit: {item}" for item in profile.data["unsupported"]]
    run.create_folder(cwd, spelled, args.results_dir)
    plan = Plan(profile, path, validation, uart, budget, deadline, until, testset)
    try:
        execute(run, plan, engine, operation)
    except KeyboardInterrupt:
        run.set_status("stopped", "interrupted", "The helper was interrupted.")
    run.document["state"] = "done"
    if run.folder is not None:
        # The JUnit view of every engine run is written with the run; `report` rewrites it with the md/html report.
        with open(run.folder / "junit.xml", "w", encoding="utf-8", newline="\n") as handle:
            handle.write(report.junit(run.document))
    return run.finish()


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if argv in (["--version"],):
        print(f"renode-sim {VERSION}")
        return 0
    if argv and argv[0] in ("--help", "-h"):
        print(__doc__.strip() + "\n\nUsage: " + USAGE)
        return 0
    spelled = entered_directory()
    cwd = Path(os.path.realpath(spelled))
    try:
        args = _parser().parse_args(argv)
        if args.operation == "tools":
            return tools()
        if args.operation == "profiles":
            return list_profiles(cwd, args.profile)
        if args.operation == "validate":
            return validate(args, cwd, spelled)
        if args.operation == "report":
            return report.report(cwd, spelled, args.run, args.hil)
        return engine_operation(args, cwd, spelled)
    except Refused as error:
        document: dict[str, Any] = {"format": 1, "kind": "renode-refusal", "operation": argv[0] if argv else None,
                                    "status": "refused", "code": error.code, "reason": error.message}
        if error.detail:
            document["detail"] = error.detail
        print(json.dumps(document, ensure_ascii=False))
        return 2
