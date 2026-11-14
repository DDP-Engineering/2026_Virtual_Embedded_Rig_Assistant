"""Command line of ngspice-tool (spec REQ-DATA-29b9a988 §3): validate, run, sweep, measure, compare, report."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import secrets
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import TOOL, VERSION, compare, engine, measure, netlist, report, sweep, workspace
from .request import Problem, Refused, Request, load_json, read

INPUT_LIMIT = 1024 * 1024
OUTPUT_LIMIT = 11000
DEFAULT_RESULTS = "electronics-results"
REQUEST_HELP = """
request: {"netlist": FILE, "analysis": {"kind": op | dc {source, start, stop, step} | ac {sweep: dec|oct|lin,
  points, start, stop} | tran {step, stop, start?, maxStep?} | noise {output, source, sweep, points, start, stop}},
  "vectors": [v(n) | v(n,m) | i(Vname) | vdb(n) | vm(n) | vp(n) | vr(n) | vi(n)], "temperature"?: "27 °C",
  "parameters"?: {NAME: value}, "measurements"?: [{"id", "kind": min|max|average|rms|peak-to-peak|ripple|
  overshoot|settling {band}|value-at {at}|final|ripple (window required), "vector", "window"?: {"from", "to"}} | {"id", "kind":
  "average-power", "voltage": v(a,b), "current": i(Vsense), "window"?}], "criteria"?: [{"measurement", "op": <=|>=|==,
  "value", "tolerance"?}], "profile"?: standard|long, "timeLimit"?: "120 s"}
sweep adds exactly one of "sweep": {"parameter": NAME|temperature, "values": [...]} and "monteCarlo": {"seed",
  "runs", "tolerances": {NAME: {"nominal", "percent", "distribution": uniform|gaussian}}}.
measure takes {"measurements", "criteria"?} for an existing --run folder.
Quantities: a number with an optional prefix (p n u µ m k M G) and unit (s Hz V A °C K Ω W %).
The netlist and its includes are checked before the engine runs: no .control block, no unknown card, no code loading,
includes inside the working directory, every model, subcircuit and pin count defined.
"""


class _Once(argparse.Action):
    def __call__(self, parser, namespace, values, option_string=None):  # type: ignore[no-untyped-def]
        if self.dest == "runs":
            setattr(namespace, "runs", [*(getattr(namespace, "runs", None) or []), values])
            return
        if getattr(namespace, f"_seen_{self.dest}", False):
            parser.error(f"{option_string} was given more than once")
        setattr(namespace, f"_seen_{self.dest}", True)
        setattr(namespace, self.dest, values)


def _run_id(value: str) -> str:
    if not workspace.valid_run_id(value):
        raise argparse.ArgumentTypeError("use 1..64 letters, digits, '.', '_' or '-', starting and ending with a letter or digit")
    return value


def _parser() -> argparse.ArgumentParser:
    formatter = argparse.RawDescriptionHelpFormatter
    parser = argparse.ArgumentParser(prog=TOOL, description="Reproducible circuit simulation with ngspice.", allow_abbrev=False, formatter_class=formatter)
    parser.add_argument("--version", action="version", version=f"{TOOL} {VERSION}")
    commands = parser.add_subparsers(dest="operation", metavar="operation", required=True)
    helps = {"validate": "check a netlist and its includes without running the engine",
             "run": "run one analysis and write a new run folder", "sweep": "run a parameter, temperature or Monte Carlo sweep",
             "measure": "apply measurements to an existing run folder", "compare": "compare two run folders",
             "report": "summarize run folders in one report"}
    for name, text in helps.items():
        command = commands.add_parser(name, help=text, description=text, epilog=REQUEST_HELP, allow_abbrev=False, formatter_class=formatter)
        if name == "validate":
            command.add_argument("--netlist", action=_Once, required=True, metavar="FILE")
            continue
        if name in ("run", "sweep", "measure"):
            source = command.add_mutually_exclusive_group(required=True)
            source.add_argument("--json", action=_Once, metavar="TEXT")
            source.add_argument("--input", action=_Once, metavar="FILE")
        if name in ("measure", "compare", "report"):
            command.add_argument("--run", dest="runs", action=_Once, required=True, metavar="DIR")
        if name == "report":
            command.add_argument("--title", action=_Once, metavar="TEXT")
        command.add_argument("--run-id", action=_Once, type=_run_id, metavar="ID")
        command.add_argument("--results-dir", action=_Once, default=DEFAULT_RESULTS, metavar="DIR")
    return parser


def _stamp(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


def _emit(document: dict[str, Any]) -> None:
    def render(value: dict[str, Any]) -> str:
        return "{\n" + ",\n".join(f"  {json.dumps(k)}: {json.dumps(v, ensure_ascii=False, default=report._default)}" for k, v in value.items()) + "\n}\n"

    text = render(document)
    for key in ("warnings", "errors", "points", "measurements", "criteria", "differences", "inputs"):
        items = document.get(key)
        while isinstance(items, list) and items and len(text.encode("utf-16-le")) // 2 > OUTPUT_LIMIT:
            document.setdefault("omitted", {})[key] = document.get("omitted", {}).get(key, 0) + 1
            items.pop()
            text = render(document)
    sys.stdout.write(text)
    sys.stdout.flush()


def _read_input(cwd: Path, raw: str, spelled: Path) -> tuple[bytes, str]:
    try:
        resolved = workspace.regular_file(cwd, raw, "--input", spelled)
        if resolved.stat().st_size > INPUT_LIMIT:
            raise Refused([Problem("path", "", f"--input '{raw[:120]}' is larger than {INPUT_LIMIT} bytes.")])
        return resolved.read_bytes(), workspace.relative(cwd, resolved)
    except workspace.PathRefused as error:
        raise Refused([Problem("path", "", str(error))]) from error
    except OSError as error:
        raise Refused([Problem("path", "", f"--input '{raw[:120]}' cannot be read: {error.strerror or error}.")]) from error


def _run_folder(cwd: Path, spelled: Path, args: argparse.Namespace, run_id: str) -> Path:
    try:
        results = workspace.results_directory(cwd, args.results_dir, spelled)
    except workspace.PathRefused as error:
        raise Refused([Problem("path", "", str(error))]) from error
    folder = results / run_id
    if folder.exists():
        raise Refused([Problem("output", "", f"The run folder '{workspace.relative(cwd, folder)}' already exists; runs are never overwritten. Use another --run-id.")])
    results.mkdir(parents=True, exist_ok=True)
    try:
        folder.mkdir()
    except FileExistsError as error:
        raise Refused([Problem("output", "", "The run folder appeared meanwhile; use another --run-id.")]) from error
    if not workspace.allowed_output(cwd, folder):
        engine.remove(folder)
        raise Refused([Problem("path", "", "The results directory leads outside the working directory.")])
    return folder


def _simulate(run_dir: Path, prefix: str, request: Request, chain: netlist.Chain, ngspice: engine.Engine,
              parameters: dict[str, float], temperature: float | None) -> dict[str, Any]:
    """One engine run; effective.cir, ngspice.log and series.dat live under `prefix` in the run folder."""
    if prefix:
        (run_dir / prefix).mkdir(parents=True)
    effective = netlist.transformed(chain, 0) + engine.control_block(request, f"{prefix}series.dat", parameters, temperature)
    with open(run_dir / f"{prefix}effective.cir", "x", encoding="utf-8", newline="\n") as handle:
        handle.write(effective)
    outcome = engine.run(ngspice, run_dir, f"{prefix}effective.cir", f"{prefix}series.dat", f"{prefix}ngspice.log", request.time_limit)
    ok = outcome.status == "ok"
    measured = [measure.measure(spec, outcome.columns, outcome.rows) if ok else {"id": spec["id"], "kind": spec["kind"], "status": "not-evaluated"} for spec in request.measurements]
    by_id = {m["id"]: m for m in measured}
    return {"status": outcome.status, "engine": {"status": outcome.status, "exit": outcome.exit, "seconds": round(outcome.seconds, 3), "problems": outcome.problems},
            "columns": outcome.columns, "rows": outcome.rows, "measurements": measured,
            "criteria": measure.criteria(request.criteria, by_id, ok)}


def _chain_hashes(chain: netlist.Chain) -> list[str]:
    out = []
    for source in chain.files:
        try:
            out.append(hashlib.sha256(source.path.read_bytes()).hexdigest())
        except OSError:
            out.append("")
    return out


SWEEP_BUDGET = 1700.0  # seconds a whole sweep may use, within the rule's 1800 s


def _base_vectors(columns: list[str]) -> list[str]:
    """The vectors of a series: complex columns `<name> re`/`<name> im` count once, as `<name>`."""
    names: list[str] = []
    for column in columns[1:]:
        name = column[:-3] if column.endswith((" re", " im")) else column
        if name not in names:
            names.append(name)
    return names


def _not_applicable(request: Request, simulated: dict[str, Any]) -> bool:
    """A noise analysis whose output noise is zero everywhere: the circuit has no noise generators to analyse."""
    if request.analysis["kind"] != "noise" or simulated["status"] != "ok":
        return False
    columns = [c.lower() for c in simulated["columns"]]
    if "onoise_spectrum" not in columns:
        return True
    index = columns.index("onoise_spectrum")
    return all(row[index] == 0 for row in simulated["rows"])


def main(argv: list[str]) -> int:
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8", errors="backslashreplace", newline="\n")  # type: ignore[union-attr]
    args = _parser().parse_args(argv)
    started = datetime.now(timezone.utc)
    operation: str = args.operation
    run_id: str = getattr(args, "run_id", None) or f"{started.strftime('%Y%m%dT%H%M%SZ')}-{secrets.token_hex(4)}"
    spelled = workspace.entered_directory()
    cwd = Path(os.path.realpath(spelled))
    request_info: dict[str, Any] | None = None
    try:
        if operation == "validate":
            chain = netlist.load(cwd, spelled, args.netlist)
            _emit({**report.header("validate", run_id, _stamp(started), "ok", None), "title": chain.title, "inputs": chain.inputs(),
                   "subckts": {k: v for k, v in list(chain.subckts.items())[:200]}, "models": sorted(chain.models)[:500],
                   "droppedCards": chain.dropped, "options": chain.options, "warnings": chain.warnings})
            return 0
        document: dict[str, Any] = {}
        if operation in ("run", "sweep", "measure"):
            if args.input is not None:
                data, relative = _read_input(cwd, args.input, spelled)
                request_info = {"origin": "file", "path": relative, "sha256": hashlib.sha256(data).hexdigest()}
            else:
                data = os.fsencode(args.json)
                request_info = {"origin": "inline", "sha256": hashlib.sha256(data).hexdigest()}
            try:
                document = load_json(data.decode("utf-8").removeprefix("﻿"))
            except UnicodeDecodeError as error:
                raise Refused([Problem("json", "", "The request is not UTF-8 text.")]) from error
        if operation in ("measure", "compare", "report"):
            try:
                return _post(operation, args, cwd, spelled, run_id, started, request_info, document)
            except (KeyError, TypeError, ValueError, IndexError) as error:
                raise Refused([Problem("run", "", f"A run folder's result.json or series is not usable: {type(error).__name__}.")]) from error
        request = read(document, sweep=operation == "sweep")
        chain = netlist.load(cwd, spelled, request.netlist)
        ngspice = engine.locate()
        run_dir = _run_folder(cwd, spelled, args, run_id)
    except Refused as error:
        _emit({**report.header(operation, run_id, _stamp(started), "error", request_info), "errors": [p.json() for p in error.problems[:40]]})
        return 2
    except OSError as error:
        _emit({**report.header(operation, run_id, _stamp(started), "error", request_info),
               "errors": [Problem("output", "", f"The run could not be prepared: {error.strerror or error}.").json()]})
        return 3
    # From here on the run folder exists: any failure removes everything the run created.
    try:
        return _simulate_and_write(operation, args, cwd, spelled, run_id, started, request_info, request, chain, ngspice, run_dir)
    except Exception as error:  # noqa: BLE001 - a run never leaves a partial folder behind
        engine.remove(run_dir)
        message = str(error) if isinstance(error, (Refused, OSError)) else f"The run failed: {type(error).__name__}."
        _emit({**report.header(operation, run_id, _stamp(started), "error", request_info),
               "errors": [Problem("output", "", message[:600]).json()]})
        return 3


def _unchanged(cwd: Path, spelled: Path, args: argparse.Namespace, request_info: dict[str, Any] | None, chain: netlist.Chain) -> bool:
    if [f.sha256 for f in chain.files] != _chain_hashes(chain):
        return False
    if args.input is None:
        return True
    try:
        return hashlib.sha256(_read_input(cwd, args.input, spelled)[0]).hexdigest() == (request_info or {}).get("sha256")
    except Refused:
        return False


def _simulate_and_write(operation: str, args: argparse.Namespace, cwd: Path, spelled: Path, run_id: str, started: datetime,
                        request_info: dict[str, Any] | None, request: Request, chain: netlist.Chain, ngspice: engine.Engine,
                        run_dir: Path) -> int:
    engine.copy_inputs(chain, run_dir, netlist.transformed, netlist.copy_target)
    temperature = request.temperature.value if request.temperature else None
    dropped = [f"{d['card']} at {d['file']}:{d['line']} is not run; the request's analysis runs instead." for d in chain.dropped]
    result: dict[str, Any] = {**report.header(operation, run_id, _stamp(started), "ok", request_info),
                              "ngspice": {"executable": ngspice.executable, "version": ngspice.version}, "title": chain.title,
                              "inputs": chain.inputs(), "analysis": engine.analysis_line(request.analysis), "vectors": request.vectors,
                              "temperature": temperature, "parameters": request.parameters, "droppedCards": chain.dropped,
                              "options": chain.options, "warnings": (chain.warnings + dropped)[:20], "limits": report.LIMITS}
    files: dict[str, tuple[str, bytes]] = {}
    if operation == "run":
        simulated = _simulate(run_dir, "", request, chain, ngspice, request.parameters, temperature)
        status = "not-applicable" if _not_applicable(request, simulated) else simulated["status"]
        result.update({"status": status, "engine": simulated["engine"], "measurements": simulated["measurements"], "criteria": simulated["criteria"]})
        if status == "not-applicable":
            result["warnings"].append("The output noise is zero everywhere: the circuit has no noise generators, so noise is not applicable.")
        if simulated["status"] == "ok":
            result["series"] = {"file": "series.csv", "rows": len(simulated["rows"]), "columns": simulated["columns"]}
            files["series.csv"] = ("series-csv", report.series_csv(simulated["columns"], simulated["rows"]).encode("utf-8"))
            files["plot.svg"] = ("plot-svg", report.plot_svg(simulated["columns"], simulated["rows"], request.analysis["kind"] in ("ac", "noise"), result["analysis"]).encode("utf-8"))
    else:
        assert request.sweep is not None
        result["sweep"] = request.sweep
        outcomes = []
        begun = time.monotonic()
        for index, point in enumerate(sweep.points(request.sweep, request.parameters, temperature), 1):
            remaining = SWEEP_BUDGET - (time.monotonic() - begun)
            if remaining < 1:
                outcomes.append({"index": index, "inputs": point["inputs"], "status": "not-run", "measurements": [], "criteria": []})
                continue
            limited = Request(**{**request.__dict__, "time_limit": min(request.time_limit, remaining)})
            simulated = _simulate(run_dir, f"points/{index}/", limited, chain, ngspice, point["parameters"], point["temperature"])
            outcomes.append({"index": index, "inputs": point["inputs"], "status": simulated["status"], "engine": simulated["engine"],
                             "measurements": simulated["measurements"], "criteria": simulated["criteria"]})
        result["points"] = outcomes
        result["summary"] = sweep.summary(outcomes)
        result["criteriaPassed"] = {c["measurement"]: sum(1 for p in outcomes for d in p["criteria"] if d["measurement"] == c["measurement"] and d["status"] == "pass") for c in request.criteria}
        if any(p["status"] == "not-run" for p in outcomes):
            result["status"] = "timeout"
            result["warnings"].append(f"The sweep used its {SWEEP_BUDGET:.0f} s budget; the remaining points did not run.")
        elif any(p["status"] != "ok" for p in outcomes):
            result["status"] = "failed"
    if not _unchanged(cwd, spelled, args, request_info, chain):
        raise Refused([Problem("output", "", "An input file changed while the simulation ran; the run was discarded.")])
    result["finishedAt"] = _stamp(datetime.now(timezone.utc))
    markdown = report.markdown(result)
    artifacts = report.write_files(cwd, run_dir, {**files, "report.md": ("report-markdown", markdown.encode("utf-8"))})
    result["artifacts"] = artifacts
    (run_dir / "result.json").write_bytes(report.json_bytes(result))
    summary = {k: result[k] for k in ("format", "kind", "tool", "operation", "runId", "startedAt", "status") if k in result}
    summary.update({"request": request_info, "folder": workspace.relative(cwd, run_dir), "artifacts": artifacts,
                    "engine": result.get("engine"), "measurements": result.get("measurements"), "criteria": result.get("criteria"),
                    "summary": result.get("summary"), "warnings": result["warnings"]})
    _emit({k: v for k, v in summary.items() if v is not None})
    return 0 if result["status"] in ("ok", "not-applicable") else 3


def _post(operation: str, args: argparse.Namespace, cwd: Path, spelled: Path, run_id: str, started: datetime,
          request_info: dict[str, Any] | None, document: dict[str, Any]) -> int:
    runs = []
    for raw in args.runs:
        try:
            folder = workspace.confined(cwd, raw, "--run", spelled)
        except workspace.PathRefused as error:
            raise Refused([Problem("path", "", str(error))]) from error
        runs.append((folder, compare.load_run(folder, raw)))
    if operation == "compare" and len(runs) != 2:
        raise Refused([Problem("usage", "", "compare takes exactly two --run folders.")])
    if operation == "measure" and len(runs) != 1:
        raise Refused([Problem("usage", "", "measure takes one --run folder.")])
    result = {**report.header(operation, run_id, _stamp(started), "ok", request_info), "limits": report.LIMITS}
    if operation == "measure":
        folder, source = runs[0]
        if not source.get("series"):
            raise Refused([Problem("run", "", "The run folder has no series to measure.")])
        unknown = set(document) - {"measurements", "criteria"}
        if unknown:
            raise Refused([Problem("schema", sorted(unknown)[0], "Unknown field; use measurements, criteria.")])
        columns, rows = _read_csv(folder / "series.csv")
        vectors = _base_vectors(columns)
        request = read({"netlist": "x", "analysis": {"kind": "op"}, "vectors": vectors, **document}, known=vectors)
        measured = [measure.measure(spec, columns, rows) for spec in request.measurements]
        result.update({"source": source["runId"], "measurements": measured,
                       "criteria": measure.criteria(request.criteria, {m["id"]: m for m in measured}, True)})
    elif operation == "compare":
        (_, a), (_, b) = runs
        result.update({"runs": [a["runId"], b["runId"]], "differences": compare.differences(a, b), "deltas": compare.deltas(a, b)})
    else:
        result.update({"title": args.title or "Simulation report",
                       "runs": [{"runId": r["runId"], "operation": r["operation"], "status": r["status"],
                                 "measurements": r.get("measurements", []), "criteria": r.get("criteria", []),
                                 "summary": r.get("summary")} for _, r in runs]})
    run_dir = _run_folder(cwd, spelled, args, run_id)
    try:
        markdown = report.markdown(result)
        if operation == "report":
            lines = ["## Runs", ""]
            for r in result["runs"]:
                values = ", ".join(f"{m['id']} = {m['value']:.6g}" if m.get("status") == "ok" else f"{m['id']} {m.get('status')}" for m in r["measurements"])
                checks = ", ".join(f"{c['measurement']} {c['status']}" for c in r["criteria"])
                lines.append(f"- {r['runId']} ({r['operation']}): {r['status']}; measurements {values or 'none'}; criteria {checks or 'none'}")
            markdown += "\n".join(lines) + "\n"
        artifacts = report.write_files(cwd, run_dir, {"report.md": ("report-markdown", markdown.encode("utf-8"))})
        result["artifacts"] = artifacts
        (run_dir / ("report.json" if operation == "report" else "result.json")).write_bytes(report.json_bytes(result))
    except Exception:
        engine.remove(run_dir)
        raise
    _emit({**{k: v for k, v in result.items() if k != "runs"}, "folder": workspace.relative(cwd, run_dir)})
    return 0


def _read_csv(path: Path) -> tuple[list[str], list[list[float]]]:
    import csv

    with open(path, encoding="utf-8", newline="") as handle:
        reader = csv.reader(handle)
        columns = next(reader)
        rows = [[float(v) for v in row] for row in reader if len(row) == len(columns)]
    return columns, rows
