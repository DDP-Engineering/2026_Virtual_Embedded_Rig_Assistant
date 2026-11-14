"""Command line of ltspice-tool (spec REQ-DATA-0f9e36a3 §2): validate, convert, run, sweep, measure, compare, report."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import secrets
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import TOOL, VERSION, compare, engine, measure, netlist, report, schematic, sweep, workspace
from .request import PROFILES, Problem, Refused, Request, load_json, read

INPUT_LIMIT = 1024 * 1024
OUTPUT_LIMIT = 11000
DEFAULT_RESULTS = "electronics-results"
NOISE_COLUMNS = 64  # the data limit's column count for a noise raw file (one column per noise source)
REQUEST_HELP = """
request (the same as ngspice-tool's): {"netlist": FILE (.cir/.net/... or an .asc schematic), "analysis": {"kind": op |
  dc {source, start, stop, step} | ac {sweep: dec|oct|lin, points, start, stop} | tran {step, stop, start?, maxStep?} |
  noise {output, source, sweep, points, start, stop}}, "vectors": [v(n) | v(n,m) | i(Xname) | vdb(n) | vm(n) | vp(n) |
  vr(n) | vi(n)], "temperature"?: "27 °C", "parameters"?: {NAME: value}, "measurements"?: [{"id", "kind": min|max|
  average|rms|peak-to-peak|ripple|overshoot|settling {band}|value-at {at}|final|ripple (window required), "vector",
  "window"?: {"from", "to"}} | {"id", "kind": "average-power", "voltage": v(a,b), "current": i(Vsense), "window"?}],
  "criteria"?: [{"measurement", "op": <=|>=|==, "value", "tolerance"?}], "profile"?: standard|long, "timeLimit"?: "120 s"}
sweep adds exactly one of "sweep": {"parameter": NAME|temperature, "values": [2..100 distinct]} and "monteCarlo":
  {"seed", "runs" (2..200), "tolerances": {NAME: {"nominal", "percent", "distribution": uniform|gaussian}}}; every point
  runs in one LTspice .step run.
measure takes {"measurements", "criteria"?} for an existing --run folder.
Quantities: a number with an optional prefix (p n u µ m k M G) and unit (s Hz V A °C K Ω W %).
Before LTspice runs, the netlist and its includes are checked: no .wave, .savebias, .loadbias, .savestate, .loadstate
cards; outside include cards no text containing file, scopedata, tbl, .inc, include, .lib, loadbias, savebias, loadstate,
savestate or fastaccess (LTspice matches them by prefix); no quoted strings outside include, library and model cards,
no @/& elements, no unknown cards; UTF-8 only, without U+0085/U+2028/U+2029 or invisible formatting characters; include
names without '%', in NFC; netlists, includes and schematics at workbench paths in NFC; includes inside the working
directory or LTspice's library. A library section needs a quoted
file name: .lib "file" SECTION.
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
    parser = argparse.ArgumentParser(prog=TOOL, description="Reproducible circuit simulation with your own LTspice (Windows).",
                                     allow_abbrev=False, formatter_class=formatter)
    parser.add_argument("--version", action="version", version=f"{TOOL} {VERSION}")
    commands = parser.add_subparsers(dest="operation", metavar="operation", required=True)
    helps = {"validate": "check a netlist and its includes without running LTspice",
             "convert": "convert an .asc schematic to a netlist on a copy and check it",
             "run": "run one analysis and write a new run folder", "sweep": "run a parameter, temperature or Monte Carlo sweep",
             "measure": "apply measurements to an existing run folder", "compare": "compare two run folders",
             "report": "summarize run folders in one report"}
    for name, text in helps.items():
        command = commands.add_parser(name, help=text, description=text, epilog=REQUEST_HELP, allow_abbrev=False, formatter_class=formatter)
        if name == "validate":
            command.add_argument("--netlist", action=_Once, required=True, metavar="FILE")
            continue
        if name == "convert":
            command.add_argument("--schematic", action=_Once, required=True, metavar="FILE")
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


def _errors(problems: list[Problem]) -> list[dict[str, str]]:
    """Problems as printed: absolute paths (a refused include as written, for instance) shown by file name (spec §9)."""
    return [{**p.json(), "path": netlist.scrub(p.json()["path"]), "message": netlist.scrub(p.json()["message"])} for p in problems[:40]]


def _base_vectors(columns: list[str], axis: bool) -> list[str]:
    """The vectors of a series: complex columns `<name> re`/`<name> im` count once, as `<name>`."""
    names: list[str] = []
    for column in columns[1 if axis else 0:]:
        name = column[:-3] if column.endswith((" re", " im")) else column
        if name not in names:
            names.append(name)
    return names


def _not_applicable(request: Request, columns: list[str], rows: list[list[float]]) -> bool:
    """A noise analysis whose output noise is zero everywhere: the circuit has no noise generators to analyse."""
    if request.analysis["kind"] != "noise":
        return False
    index = columns.index("onoise_spectrum")
    return all(row[index] == 0 for row in rows)


class _Plan:
    """The run's overrides and `.step` card, and which raw step belongs to which requested point."""

    def __init__(self, request: Request, temperature: float | None) -> None:
        self.overrides = {name: engine.number(value) for name, value in request.parameters.items()}
        self.step_card = ""
        self.points: list[dict[str, Any]] = []
        self.step_of_point: list[int] = []
        self.temperature = temperature
        if request.sweep is None:
            return
        self.points = sweep.points(request.sweep, request.parameters, temperature)
        if request.sweep["kind"] == "values" and request.sweep["parameter"] == "temperature":
            ordered = sorted(request.sweep["values"])  # LTspice runs the first .step dimension in ascending order
            self.step_card = ".step temp list " + " ".join(engine.number(v) for v in ordered)
            self.step_of_point = [ordered.index(p["temperature"]) for p in self.points]
            self.temperature = None
            return
        names = [request.sweep["parameter"]] if request.sweep["kind"] == "values" else list(request.sweep["tolerances"])
        for name in names:
            table = ",".join(f"{k},{engine.number(p['parameters'][name])}" for k, p in enumerate(self.points, 1))
            self.overrides[name] = f"table(vera_point,{table})"
        self.step_card = ".step param vera_point list " + " ".join(str(k) for k in range(1, len(self.points) + 1))
        self.step_of_point = list(range(len(self.points)))

    @property
    def names(self) -> list[str]:
        return list(self.overrides)


def _effective(chain: netlist.Chain, request: Request, plan: _Plan) -> str:
    lines = [netlist.transformed(chain, 0, plan.overrides).rstrip("\n")]
    if plan.temperature is not None:
        lines.append(f".temp {engine.number(plan.temperature)}")
    if request.analysis["kind"] != "noise":
        lines.append(".save " + " ".join(engine.raw_vectors(request.vectors)))
    lines.append(engine.analysis_card(request.analysis))
    if plan.step_card:
        lines.append(plan.step_card)
    lines.append(".end")
    return "\n".join(lines) + "\n"


def _not_evaluated(request: Request) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    measured = [{"id": spec["id"], "kind": spec["kind"], "status": "not-evaluated"} for spec in request.measurements]
    return measured, measure.criteria(request.criteria, {m["id"]: m for m in measured}, False)


def _evaluate(request: Request, columns: list[str], rows: list[list[float]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    measured = [measure.measure(spec, columns, rows) for spec in request.measurements]
    return measured, measure.criteria(request.criteria, {m["id"]: m for m in measured}, True)


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
    sch: schematic.Schematic | None = None
    chain: netlist.Chain | None = None
    request: Request | None = None
    try:
        if operation == "validate":
            if schematic.is_schematic(args.netlist):
                raise Refused([Problem("netlist", "--netlist", "This is an LTspice schematic: convert it with ltspice-tool convert --schematic FILE.")])
            chain = netlist.load(cwd, spelled, args.netlist)
            _emit({**report.header("validate", run_id, _stamp(started), "ok", None), "title": chain.title, "inputs": chain.inputs(),
                   "subckts": dict(list(chain.subckts.items())[:200]), "models": sorted(chain.models)[:500],
                   "droppedCards": chain.dropped, "options": [netlist.scrub(option) for option in chain.options],
                   "warnings": chain.warnings})
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
        if operation == "convert":
            sch = schematic.load(cwd, spelled, args.schematic, "--schematic")
        else:
            request = read(document, sweep=operation == "sweep")
            if schematic.is_schematic(request.netlist):
                sch = schematic.load(cwd, spelled, request.netlist, "netlist")
            else:
                chain = netlist.load(cwd, spelled, request.netlist)
                netlist.check_parameters(chain, _Plan(request, None).names)
        lt = engine.locate()
        run_dir = _run_folder(cwd, spelled, args, run_id)
    except Refused as error:
        _emit({**report.header(operation, run_id, _stamp(started), "error", request_info), "errors": _errors(error.problems)})
        return 2
    except OSError as error:
        _emit({**report.header(operation, run_id, _stamp(started), "error", request_info),
               "errors": [Problem("output", "", f"The run could not be prepared: {error.strerror or error}.").json()]})
        return 3
    # From here on the run folder exists: a refusal or failure removes everything the run created, except an engine
    # failure or timeout, whose folder keeps the log for the user.
    try:
        return _after_folder(operation, args, cwd, spelled, run_id, started, request_info, request, sch, chain, lt, run_dir)
    except Refused as error:
        engine.remove(run_dir)
        _emit({**report.header(operation, run_id, _stamp(started), "error", request_info), "errors": _errors(error.problems)})
        return 2 if error.problems and error.problems[0].code != "output" else 3
    except Exception as error:  # noqa: BLE001 - a run never leaves a partial folder behind
        engine.remove(run_dir)
        message = error.strerror if isinstance(error, OSError) and error.strerror else f"The run failed: {type(error).__name__}."
        _emit({**report.header(operation, run_id, _stamp(started), "error", request_info),
               "errors": [Problem("output", "", str(message)[:600]).json()]})
        return 3


def _unchanged(cwd: Path, spelled: Path, args: argparse.Namespace, request_info: dict[str, Any] | None,
               chain: netlist.Chain | None, sch: schematic.Schematic | None) -> bool:
    if chain is not None:
        for source in chain.files:
            try:
                if hashlib.sha256(source.path.read_bytes()).hexdigest() != source.sha256:
                    return False
            except OSError:
                return False
    if sch is not None and not schematic.hashes_unchanged(sch):
        return False
    if getattr(args, "input", None) is None:
        return True
    try:
        return hashlib.sha256(_read_input(cwd, args.input, spelled)[0]).hexdigest() == (request_info or {}).get("sha256")
    except Refused:
        return False


def _finish(cwd: Path, run_dir: Path, result: dict[str, Any], files: dict[str, tuple[str, bytes]], unchanged: bool) -> int:
    if not unchanged:
        raise Refused([Problem("output", "", "An input file changed while the run went on; the run was discarded.")])
    result["finishedAt"] = _stamp(datetime.now(timezone.utc))
    artifacts = report.write_files(cwd, run_dir, {**files, "report.md": ("report-markdown", report.markdown(result).encode("utf-8"))})
    result["artifacts"] = artifacts
    (run_dir / "result.json").write_bytes(report.json_bytes(result))
    summary = {k: result[k] for k in ("format", "kind", "tool", "operation", "runId", "startedAt", "status") if k in result}
    summary.update({"request": result.get("request"), "folder": workspace.relative(cwd, run_dir), "artifacts": artifacts,
                    "engine": result.get("engine"), "measurements": result.get("measurements"), "criteria": result.get("criteria"),
                    "summary": result.get("summary"), "warnings": result.get("warnings")})
    _emit({k: v for k, v in summary.items() if v is not None})
    return 0 if result["status"] in ("ok", "not-applicable") else 3


def _after_folder(operation: str, args: argparse.Namespace, cwd: Path, spelled: Path, run_id: str, started: datetime,
                  request_info: dict[str, Any] | None, request: Request | None, sch: schematic.Schematic | None,
                  chain: netlist.Chain | None, lt: engine.Engine, run_dir: Path) -> int:
    result: dict[str, Any] = {**report.header(operation, run_id, _stamp(started), "ok", request_info),
                              "ltspice": {"version": lt.version, "install": lt.install}, "limits": report.LIMITS}
    inputs: list[dict[str, Any]] = schematic.inputs(sch) if sch else []
    if sch is not None:
        converted, problems = schematic.convert(lt, sch, run_dir)
        if converted is None:
            result.update({"status": "failed", "inputs": inputs, "engine": {"status": "failed", "problems": problems}, "warnings": []})
            if request is not None:
                result["measurements"], result["criteria"] = _not_evaluated(request)
            return _finish(cwd, run_dir, result, {}, _unchanged(cwd, spelled, args, request_info, None, sch))
        chain = netlist.load(cwd, spelled, sch.netlist_rel, as_if=cwd / sch.netlist_rel, actual=converted)
        chain.shown_title = sch.rel
        if request is not None:
            netlist.check_parameters(chain, _Plan(request, None).names)
    assert chain is not None
    result.update({"title": chain.title, "inputs": inputs + chain.inputs(), "droppedCards": chain.dropped,
                   "options": [netlist.scrub(option) for option in chain.options]})
    if operation == "convert":
        shutil.copyfile(chain.files[0].path, run_dir / Path(sch.netlist_rel).name)  # type: ignore[union-attr]
        result.update({"subckts": dict(list(chain.subckts.items())[:200]), "models": sorted(chain.models)[:500], "warnings": chain.warnings[:20]})
        return _finish(cwd, run_dir, result, {}, _unchanged(cwd, spelled, args, request_info, chain, sch))
    assert request is not None
    temperature = request.temperature.value if request.temperature else None
    plan = _Plan(request, temperature)
    engine.copy_inputs(chain, run_dir, plan.overrides)
    with open(run_dir / "effective.net", "x", encoding="utf-8", newline="\n") as handle:
        handle.write(_effective(chain, request, plan))
    dropped = [f"{d['card']} at {d['file']}:{d['line']} is not run; the request's analysis runs instead." for d in chain.dropped]
    result.update({"analysis": engine.analysis_card(request.analysis), "vectors": request.vectors, "temperature": temperature,
                   "parameters": request.parameters, "warnings": (chain.warnings + dropped)[:20]})
    kind = request.analysis["kind"]
    columns_saved = NOISE_COLUMNS if kind == "noise" else len(engine.raw_vectors(request.vectors))
    points_limit = 2 * PROFILES[request.profile]["tran" if kind == "tran" else "sweep"]
    limit = engine.data_limit(points_limit, columns_saved, kind == "ac")
    expected = len(plan.points) if request.sweep else None
    outcome = engine.run(lt, cwd, run_dir, "effective.net", request.time_limit, limit, expected)
    result["engine"] = {"status": outcome.status, "exit": outcome.exit, "seconds": round(outcome.seconds, 3),
                        "problems": outcome.problems, "loaded": outcome.loaded}
    files: dict[str, tuple[str, bytes]] = {}
    series_by_point: list[tuple[list[str], list[list[float]]]] = []
    if outcome.status == "ok" and outcome.data is not None:
        source = request.analysis.get("source", "")
        try:
            steps = outcome.data.steps or [(0, 0)]  # no data: the vector lookup names what is missing
            wanted = plan.step_of_point if request.sweep else [0]
            series_by_point = [engine.series(outcome.data, steps[k][0], steps[k][1], request.vectors, kind, source) for k in wanted]
        except KeyError as error:
            outcome.status = "failed"
            result["engine"]["status"] = "failed"
            result["engine"]["problems"].append({"kind": "vector", "line": f"The raw file has no {error.args[0]}; check the node or element name."})
    result["status"] = outcome.status
    if operation == "run":
        if series_by_point:
            columns, rows = series_by_point[0]
            result["measurements"], result["criteria"] = _evaluate(request, columns, rows)
            if _not_applicable(request, columns, rows):
                result["status"] = "not-applicable"
                result["warnings"].append("The output noise is zero everywhere: the circuit has no noise generators, so noise is not applicable.")
            result["series"] = {"file": "series.csv", "rows": len(rows), "columns": columns, "steps": 1, "axis": outcome.data.has_axis}  # type: ignore[union-attr]
            files["series.csv"] = ("series-csv", report.series_csv(columns, rows).encode("utf-8"))
            files["plot.svg"] = ("plot-svg", report.plot_svg(columns, rows, kind in ("ac", "noise"), result["analysis"]).encode("utf-8"))
        else:
            result["measurements"], result["criteria"] = _not_evaluated(request)
    else:
        assert request.sweep is not None
        result["sweep"] = request.sweep
        outcomes = []
        for index, point in enumerate(plan.points, 1):
            if series_by_point:
                columns, rows = series_by_point[index - 1]
                measured, checked = _evaluate(request, columns, rows)
                prefix = f"points/{index}/"
                (run_dir / prefix).mkdir(parents=True)
                files[f"{prefix}series.csv"] = ("series-csv", report.series_csv(columns, rows).encode("utf-8"))
                files[f"{prefix}plot.svg"] = ("plot-svg", report.plot_svg(columns, rows, kind in ("ac", "noise"), result["analysis"]).encode("utf-8"))
                status = "ok"
            else:
                measured, checked = _not_evaluated(request)
                status = outcome.status
            outcomes.append({"index": index, "inputs": point["inputs"], "status": status, "measurements": measured, "criteria": checked})
        result["points"] = outcomes
        result["summary"] = sweep.summary(outcomes)
        result["criteriaPassed"] = {c["measurement"]: sum(1 for p in outcomes for d in p["criteria"] if d["measurement"] == c["measurement"] and d["status"] == "pass") for c in request.criteria}
        if series_by_point:
            result["series"] = {"files": "points/<n>/series.csv", "steps": len(series_by_point), "columns": series_by_point[0][0], "axis": outcome.data.has_axis}  # type: ignore[union-attr]
    return _finish(cwd, run_dir, result, files, _unchanged(cwd, spelled, args, request_info, chain, sch))


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
        if not source.get("series") or source["series"].get("file") != "series.csv":
            raise Refused([Problem("run", "", "The run folder has no series to measure.")])
        unknown = set(document) - {"measurements", "criteria"}
        if unknown:
            raise Refused([Problem("schema", sorted(unknown)[0], "Unknown field; use measurements, criteria.")])
        columns, rows = _read_csv(folder / "series.csv")
        vectors = _base_vectors(columns, bool(source["series"].get("axis", True)))
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
