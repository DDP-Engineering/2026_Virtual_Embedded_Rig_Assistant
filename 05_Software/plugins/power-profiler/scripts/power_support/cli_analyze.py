"""power-analyze: offline acquisition checks, import and analysis (spec REQ-DATA-dd3e4fe1 sections 2 and 7).

Every number is computed here from the run folders' files (hash-checked); nothing opens a device, a network
connection or another process. Criteria and verdicts belong to lab-validate.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from pathlib import Path
from typing import Any

from . import VERSION, acquisition, battery, capfile, compare, importer, measure, profiles, render, segment
from .capture import _conditions, text_option as _text
from .errors import Refused
from .firmware import identify as firmware_identity
from .result import Result, emit
from .signals import prepare
from .workspace import PathRefused, confined, entered_directory

USAGE = """power-analyze <operation> [options]

  acquisition --profile <id> --duration <s> --rate <Hz> [--current-range auto|<label>] [--voltage-range <label>]
              [--markers <n>,...]                    check a capture plan offline (configure-acquisition); writes nothing
  import --csv <file> (--time-column <c> --time-unit s|ms|us|ns | --rate <Hz>) --current-column <c> --current-unit
         A|mA|uA|nA --voltage-column <c> --voltage-unit V|mV [--power-column <c> --power-unit W|mW|uW]
         [--marker <n>=<column>]... [--delimiter ,|;|tab] [--uniform true|false] [--meter-model <text>]
         [--meter-serial <text>] [--firmware <file>] [--board <text>] [--condition <name>=<value>]... [--label <text>]
  inspect --capture <dir>                             what a capture holds; writes nothing
  measure-energy --capture <dir> [--from <s>] [--to <s>] [--sign 1|-1] [--current-offset <A>] [--offset-source <text>]
  segment --capture <dir> (--markers <n> --event high|low|cycle | --timestamps <file> | --threshold <A> [--min-gap <s>])
          [--states <name>:<upper A>,...,<name>] [--from <s>] [--to <s>] [--sign 1|-1] [--current-offset <A>]
  compare --a <segment run> --b <segment run> [--supply-tolerance <percent>] [--energy-limit <J per period>]
  battery --profile <segment run> --battery <file>
  report --run <dir> ... [--title <text>]
  common: [--results-dir <dir>] [--run-id <id>]

Energy is the trapezoid integral of power, charge of current; an interval without data is never counted as zero:
energy and charge over it are withheld (null) with the covered values reported. Exit codes: 0 pass, 2 refused,
3 incomplete, 4 error."""


class _Parser(argparse.ArgumentParser):
    def error(self, message: str) -> None:  # type: ignore[override]
        raise Refused("request", message)


def _parser() -> argparse.ArgumentParser:
    parser = _Parser(prog="power-analyze", allow_abbrev=False, add_help=False)
    sub = parser.add_subparsers(dest="operation", required=True, parser_class=_Parser)

    def op(name: str, writes: bool = True) -> argparse.ArgumentParser:
        found = sub.add_parser(name, allow_abbrev=False, add_help=False)
        if writes:
            found.add_argument("--results-dir")
            found.add_argument("--run-id")
        return found

    acq = op("acquisition", writes=False)
    acq.add_argument("--profile", required=True)
    acq.add_argument("--duration", type=float, required=True)
    acq.add_argument("--rate", type=float, required=True)
    acq.add_argument("--current-range", default="auto")
    acq.add_argument("--voltage-range")
    acq.add_argument("--markers")
    imp = op("import")
    for name in ("--csv", "--current-column", "--current-unit", "--voltage-column", "--voltage-unit"):
        imp.add_argument(name, required=True)
    for name in ("--time-column", "--time-unit", "--power-column", "--power-unit", "--meter-model", "--meter-serial",
                 "--firmware", "--board", "--label"):
        imp.add_argument(name)
    imp.add_argument("--rate", type=float)
    imp.add_argument("--marker", action="append")
    imp.add_argument("--condition", action="append")
    imp.add_argument("--delimiter", default=",")
    imp.add_argument("--uniform", choices=["true", "false"], default="true")
    ins = op("inspect", writes=False)
    ins.add_argument("--capture", required=True)
    for name in ("measure-energy", "segment"):
        found = op(name)
        found.add_argument("--capture", required=True)
        found.add_argument("--from", dest="start", type=float)
        found.add_argument("--to", dest="end", type=float)
        found.add_argument("--sign", type=int, default=1)
        found.add_argument("--current-offset", type=float, default=0.0)
        if name == "measure-energy":
            found.add_argument("--offset-source")
        else:
            found.add_argument("--markers", type=int)
            found.add_argument("--event", choices=["high", "low", "cycle"])
            found.add_argument("--timestamps")
            found.add_argument("--threshold", type=float)
            found.add_argument("--min-gap", type=float, default=0.0)
            found.add_argument("--states")
    cmp_ = op("compare")
    cmp_.add_argument("--a", required=True)
    cmp_.add_argument("--b", required=True)
    cmp_.add_argument("--supply-tolerance", type=float, default=1.0)
    cmp_.add_argument("--energy-limit", type=float)
    bat = op("battery")
    bat.add_argument("--profile", required=True)
    bat.add_argument("--battery", required=True)
    rep = op("report")
    rep.add_argument("--run", action="append", required=True)
    rep.add_argument("--title", default="Power profiling report")
    return parser


def _capture_info(capture: capfile.Capture) -> dict[str, Any]:
    """The setup a capture ran with: the meter's readback (settings.applied) where it exists, never only the request."""
    document = capture.document
    acq = document.get("acquisition") or {}
    meter = document.get("meter") or {}
    applied = (document.get("settings") or {}).get("applied") or {}
    if applied:
        mode = applied.get("s/i/range/mode")
        current = "auto" if isinstance(mode, str) and mode.casefold() == "auto" else f"{mode} {applied.get('s/i/range/select')}"
        voltage = f"{applied.get('s/v/range/mode')} {applied.get('s/v/range/select')}"
        rate = applied.get("h/fs")
    else:
        current, voltage, rate = acq.get("currentRange"), acq.get("voltageRange"), (document.get("timebase") or {}).get("rate")
    return {"meterModel": meter.get("model"), "meterSerial": meter.get("serial"), "rate": rate, "currentRange": current,
            "voltageRange": voltage, "board": document.get("board"), "conditions": document.get("conditions") or {},
            "firmware": document.get("firmware")}


# ---- operations ----


def do_acquisition(args: Any) -> int:
    profile = profiles.load(args.profile)
    plan = acquisition.check(profile, args.rate, args.duration, args.current_range, args.voltage_range, args.markers)
    emit({"format": 1, "kind": "power-acquisition", "status": "pass", **acquisition.describe(profile, plan)})
    return 0


def do_import(args: Any, cwd: Path, spelled: Path) -> int:
    conditions = _conditions(args.condition)
    board, label = _text(args.board, "--board"), _text(args.label, "--label")
    model, serial = _text(args.meter_model, "--meter-model"), _text(args.meter_serial, "--meter-serial")
    firmware = firmware_identity(cwd, spelled, args.firmware) if args.firmware else None
    imported = importer.read(cwd, spelled, args)
    uniform = args.uniform == "true"
    result = Result("import", args.run_id, "power-analyze")
    result.create_folder(cwd, spelled, args.results_dir)
    result["inputs"] = {"csv": imported["csv"], "columns": imported["columns"]}
    result["meter"] = {"model": model, "serial": serial, "profile": None, "profileStatus": None, "source": "declared"}
    result["timebase"] = {"clock": "file", "rate": imported["rate"], "uniform": uniform, "samples": len(imported["t"])}
    result["channels"] = [{"name": "current", "unit": "A", "column": "current_A"}, {"name": "voltage", "unit": "V", "column": "voltage_V"},
                          *([{"name": "power", "unit": "W", "column": "power_W", "source": "file"}] if imported["power"] is not None else []),
                          *({"name": f"gpi{n}", "unit": "", "column": f"gpi{n}"} for n in imported["gpi"])]
    result["firmware"], result["board"], result["conditions"], result["label"] = firmware, board, conditions, label
    result["overflow"] = {"current": 0, "voltage": 0}
    found = importer.gaps(imported, uniform)
    result["gaps"] = found
    assert result.folder is not None
    result.files.append(importer.write(result.folder, imported))
    if found:
        result.problem("gaps", f"{len(found)} gap(s) in the imported samples; they stay missing, never zero.", "incomplete")
    return result.finish()


def do_inspect(args: Any, cwd: Path, spelled: Path) -> int:
    capture = capfile.read(cwd, spelled, args.capture)
    document = capture.document
    out = {"format": 1, "kind": "power-inspection", "status": document.get("status"), "capture": capture.identity(),
           "operation": document.get("operation"), "meter": document.get("meter"), "timebase": document.get("timebase"),
           "rows": len(capture.t), "from": capture.t[0], "to": capture.t[-1],
           "missing": sum(1 for value in capture.current if value is None), "gaps": len(document.get("gaps") or []),
           "overflow": document.get("overflow"), "markers": sorted(f"gpi{n}" for n in capture.gpi),
           "firmware": document.get("firmware"), "conditions": document.get("conditions"), "problems": document.get("problems")}
    emit(out)
    return 0


def _analysis(args: Any, cwd: Path, spelled: Path, operation: str) -> tuple[capfile.Capture, Any, float, float, Result]:
    capture = capfile.read(cwd, spelled, args.capture)
    signals = prepare(capture, args.sign, args.current_offset)
    a, b = measure.window_of(signals, args.start, args.end)
    result = Result(operation, args.run_id, "power-analyze")
    Result.results_base(cwd, spelled, args.results_dir)
    result["inputs"] = {"capture": capture.identity()}
    result["window"] = {"from": a, "to": b, "seconds": b - a}
    result["corrections"] = {"sign": args.sign, "currentOffset": args.current_offset,
                             "offsetSource": getattr(args, "offset_source", None)}
    return capture, signals, a, b, result


def do_measure(args: Any, cwd: Path, spelled: Path) -> int:
    if args.offset_source is not None:
        _text(args.offset_source, "--offset-source")
    capture, signals, a, b, result = _analysis(args, cwd, spelled, "measure-energy")
    metrics, problems = measure.measure(signals, a, b)
    result.create_folder(cwd, spelled, args.results_dir)
    result["metrics"] = metrics
    result["definitions"] = measure.DEFINITIONS
    result["setup"] = _capture_info(capture)
    if args.current_offset == 0:
        result.problem("offset-not-corrected", "No current offset was declared; the meter's zero is used as it is.")
    for code, message in problems:
        result.problem(code, message, "incomplete")
    if capture.document.get("status") == "incomplete":
        result.problem("source-incomplete", "The capture is incomplete elsewhere; this window's own gaps and overflow decide "
                       "this result.")
    return result.finish()


def do_segment(args: Any, cwd: Path, spelled: Path) -> int:
    chosen = [args.markers is not None, args.timestamps is not None, args.threshold is not None]
    if sum(chosen) != 1:
        raise Refused("request", "Segment by exactly one of --markers (with --event), --timestamps or --threshold.")
    if args.markers is not None and args.event is None:
        raise Refused("request", "--markers needs --event high, low or cycle.")
    thresholds = segment.parse_states(args.states) if args.states else None
    capture, signals, a, b, result = _analysis(args, cwd, spelled, "segment")
    if args.markers is not None:
        events, partial, sync = segment.by_markers(signals, args.markers, args.event, a, b)
    elif args.timestamps is not None:
        events, partial, sync = segment.by_timestamps(signals, cwd, spelled, args.timestamps, a, b)
    else:
        events, partial, sync = segment.by_threshold(signals, args.threshold, args.min_gap, a, b)
    metrics, problems = measure.measure(signals, a, b)
    rows = segment.per_event(signals, events)
    withheld = any(code in ("gaps", "overflow") for code, _ in problems)
    result.create_folder(cwd, spelled, args.results_dir)
    result["sync"] = sync
    result["events"] = rows
    result["partial"] = partial
    result["statistics"] = segment.statistics_of(rows)
    result["periods"] = segment.periods(signals, rows)
    result["states"] = segment.states(signals, a, b, thresholds, args.markers, withheld)
    result["metrics"] = {"voltage": metrics["voltage"], "current": metrics["current"], "energy": metrics["energy"],
                         "charge": metrics["charge"], "energySource": metrics["energySource"]}
    result["setup"] = _capture_info(capture)
    result.write("events.csv", segment.events_csv(rows))
    for code, message in problems:
        if code != "no-voltage":
            result.problem(code, message, "incomplete")
    if not rows:
        result.problem("no-events", "No whole event lies in the window.", "incomplete")
    elif any(row["status"] != "ok" for row in rows):
        result.problem("events-incomplete", "Some events hold gaps or overflow; their energy and charge are withheld.", "incomplete")
    if capture.document.get("status") == "incomplete":
        result.problem("source-incomplete", "The capture is incomplete elsewhere; this window's own gaps and overflow decide "
                       "this result.")
    return result.finish()


def do_compare(args: Any, cwd: Path, spelled: Path) -> int:
    if args.energy_limit is not None and not (math.isfinite(args.energy_limit) and args.energy_limit > 0):
        raise Refused("request", "--energy-limit is a positive energy per period in J.")
    a, sha_a, _ = compare.read_segment(cwd, spelled, args.a, "--a")
    b, sha_b, _ = compare.read_segment(cwd, spelled, args.b, "--b")
    outcome = compare.compare(a, b, args.supply_tolerance)
    lab_request, reason = compare.request(a, b, outcome, args.energy_limit)
    result = Result("compare", args.run_id, "power-analyze")
    result.create_folder(cwd, spelled, args.results_dir)
    result["inputs"] = {"a": {"path": args.a, "sha256": sha_a}, "b": {"path": args.b, "sha256": sha_b}}
    result["comparison"] = outcome
    if lab_request is not None:
        result.write("lab-validation-request.json", json.dumps(lab_request, indent=1) + "\n")
        result["labValidation"] = {"request": "lab-validation-request.json", "criteria": len(lab_request["criteria"]),
                                   "run": "lab-validate compare --request <this folder>/lab-validation-request.json"}
        if not lab_request["criteria"]:
            result.problem("no-criteria", "No --energy-limit was given: the request has measurements only; add criteria "
                           "before lab-validate compare.")
    else:
        result.problem("request-not-written", f"No lab-validate request: {reason}.")
    if outcome["classification"] != "firmware-change":
        result.problem(outcome["classification"], outcome["attribution"])
    if a.get("status") != "pass" or b.get("status") != "pass":
        result.problem("source-incomplete", "A segment run is incomplete.", "incomplete")
    return result.finish()


def do_battery(args: Any, cwd: Path, spelled: Path) -> int:
    profile, digest, _ = compare.read_segment(cwd, spelled, args.profile, "--profile")
    document, info = battery.read(cwd, spelled, args.battery)
    estimate = battery.estimate(profile, document)
    result = Result("battery", args.run_id, "power-analyze")
    result.create_folder(cwd, spelled, args.results_dir)
    result["inputs"] = {"profile": {"path": args.profile, "sha256": digest}, "battery": {**info, "document": document}}
    result["estimate"] = estimate
    return result.finish()


def do_report(args: Any, cwd: Path, spelled: Path) -> int:
    if not 1 <= len(args.run) <= 20:
        raise Refused("request", "Give 1 to 20 --run folders.")
    title = _text(args.title, "--title") or "Power profiling report"
    folders: list[tuple[Path, str]] = []
    for raw in args.run:
        try:
            folder = confined(cwd, raw, "--run", spelled)
        except PathRefused as error:
            raise Refused("path", str(error)) from error
        if not folder.is_dir():
            raise Refused("path", f"--run '{raw[:120]}' is not a run folder.")
        folders.append((folder, Path(raw).as_posix()))
    runs = render.runs_of(folders)
    captures = {number: capfile.read(cwd, spelled, raw, "--run") for number, (_folder, raw, document) in enumerate(runs)
                if document.get("operation") in ("capture", "import")}  # every refusal before the run folder exists
    result = Result("report", args.run_id, "power-analyze")
    result.create_folder(cwd, spelled, args.results_dir)
    assert result.folder is not None
    shown: list[tuple[str, dict[str, Any], str | None]] = []
    inputs = []
    for number, (folder, raw, document) in enumerate(runs):
        relative_link = Path(os.path.relpath(folder, result.folder)).as_posix()
        image = None
        if number in captures:
            image = f"current-{number}.svg"
            result.write(image, render.svg(captures[number], f"{raw}: current"))
        shown.append((relative_link, document, image))
        inputs.append({"path": raw, "operation": document.get("operation"), "status": document.get("status")})
        if document.get("status") != "pass":
            result.problem("run-not-pass", f"{raw} has status {document.get('status')}.")
    result["inputs"] = {"runs": inputs}
    result.write("report.md", render.markdown(title, shown))
    result.write("report.html", render.page(title, shown))
    return result.finish()


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if argv in (["--version"], ["-V"]):
        print(f"power-analyze {VERSION}")
        return 0
    if argv in (["--help"], ["-h"]) or not argv:
        print(f"Usage: {USAGE}")
        return 0
    try:
        args = _parser().parse_args(argv)
        if args.operation == "acquisition":
            return do_acquisition(args)
        spelled = entered_directory()
        cwd = Path(spelled).resolve()
        handler = {"import": do_import, "inspect": do_inspect, "measure-energy": do_measure, "segment": do_segment,
                   "compare": do_compare, "battery": do_battery, "report": do_report}[args.operation]
        return handler(args, cwd, spelled)
    except Refused as error:
        emit({"format": 1, "kind": "power-refusal", "status": "refused",
              "problems": [{"code": error.code, "message": error.message}]})
        return 2
