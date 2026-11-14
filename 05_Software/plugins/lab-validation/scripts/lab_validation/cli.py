"""Command line of `lab-validate` (spec REQ-DATA-53797d16 section 1).

Exit codes: 0 pass, 1 fail, 2 refused before anything was written, 3 incomplete or error.
"""

from __future__ import annotations

import json
import os
import secrets
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import VERSION, aggregate, align, decide, importers, metrics, report, request, signals
from .diagnostics import entry, merge
from .errors import Refused
from .importers import Context
from .series import window
from .workspace import entered_directory, relative, valid_run_id

OPERATIONS = {
    "inspect": "describe a path (--path) or a request's sources and signals (--request); writes nothing",
    "normalize": "import, normalize and preprocess the request's signals; writes series-<signal>.csv",
    "measure": "compute the request's measurements",
    "align": "align the request's comparisons and compute their differences; writes compare-<id>.csv/.svg",
    "compare": "measurements, comparisons and criteria: the verdict pass, fail or incomplete",
    "report": "summarize lab-validation run folders (--run DIR, 1-20 times) in report.json and report.md",
}
OPTIONS = {
    "inspect": {"--path", "--request"},
    "normalize": {"--request", "--results-dir", "--run-id"},
    "measure": {"--request", "--results-dir", "--run-id"},
    "align": {"--request", "--results-dir", "--run-id"},
    "compare": {"--request", "--results-dir", "--run-id"},
    "report": {"--run", "--title", "--results-dir", "--run-id"},
}


def usage() -> str:
    lines = ["usage: lab-validate <operation> [options]", "",
             "Offline, reproducible validation of measurements against requirements and simulations. Every number is",
             "computed here; nothing is sent anywhere. Exit codes: 0 pass, 1 fail, 2 refused (nothing written),",
             "3 incomplete or error.", "", "Operations:"]
    lines += [f"  {name:<10} {text}" for name, text in OPERATIONS.items()]
    lines += ["", "Options: --request FILE, --path PATH, --run DIR (report), --title TEXT (report),",
              "         --results-dir DIR (default embedded-lab-results), --run-id ID", "",
              "The request is format 1 JSON: title, decisionRule (simple|guarded), missingData (incomplete|exclude),",
              "conditions, sources, signals, measurements, comparisons, criteria. Quantities are text such as '50 mV',",
              "'2 us', '1 kHz', '5 %'. See the validation-planning skill.", "", "Importers:"]
    lines += [f"  {name:<13} {item.description}" for name, item in importers.REGISTRY.items()]
    lines += ["", "Metrics (each over its declared window):"]
    lines += [f"  {name:<14} {item.definition}" for name, item in metrics.REGISTRY.items()]
    lines += ["", "Comparison values for criteria: <id>.max-abs, <id>.rms, <id>.mean, <id>.lag, <id>.correlation.",
              "Alignment: none | offset {offset} | marker {measured, reference} | cross-correlation {maxLag}."]
    return "\n".join(lines)


def parse(args: list[str]) -> tuple[str, dict[str, Any]]:
    operation = args[0]
    if operation not in OPERATIONS:
        raise Refused("request", f"unknown operation '{operation[:40]}'; use one of {', '.join(OPERATIONS)}.")
    options: dict[str, Any] = {"--run": []}
    rest = args[1:]
    index = 0
    while index < len(rest):
        name = rest[index]
        if name not in OPTIONS[operation]:
            raise Refused("request", f"{operation} takes {', '.join(sorted(OPTIONS[operation]))}; not '{name[:40]}'.")
        if index + 1 >= len(rest):
            raise Refused("request", f"{name} needs a value.")
        value = rest[index + 1]
        if name == "--run":
            options["--run"].append(value)
        elif name in options:
            raise Refused("request", f"{name} is given twice.")
        else:
            options[name] = value
        index += 2
    if operation == "inspect" and ("--path" in options) == ("--request" in options):
        raise Refused("request", "inspect takes either --path or --request.")
    if operation in ("normalize", "measure", "align", "compare") and "--request" not in options:
        raise Refused("request", f"{operation} needs --request FILE.")
    if operation == "report" and not 1 <= len(options["--run"]) <= 20:
        raise Refused("request", "report takes --run DIR 1-20 times.")
    if "--title" in options and (not options["--title"].strip() or len(options["--title"]) > 200
                                 or any(ord(c) < 32 or ord(c) == 127 for c in options["--title"])):
        raise Refused("request", "--title takes 1-200 characters without control characters.")
    run_id = options.get("--run-id")
    if run_id is not None and not valid_run_id(run_id):
        raise Refused("request", "--run-id takes 1-64 letters, digits, '.', '_' or '-' (not a device name).")
    return operation, options


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    except (AttributeError, ValueError):
        pass
    if not args or args[0] in ("-h", "--help"):
        print(usage())
        return 0
    if args[0] == "--version":
        print(f"lab-validate {VERSION}")
        return 0
    operation = args[0]
    started = report.now()
    try:
        operation, options = parse(args)
        ctx = Context(Path(os.path.realpath(os.getcwd())), entered_directory())
        if operation == "report":
            return _report(ctx, options, started)
        return _validate(ctx, operation, options, started)
    except Refused as error:
        report.emit({**report.header(operation if operation in OPERATIONS else "unknown", None, started), "status": "blocked",
                     "problems": [{"code": error.code, "message": error.message}]})
        return 2
    except Exception as error:  # noqa: BLE001 - every defect ends in a document, never a bare traceback.
        traceback.print_exc(file=sys.stderr)
        report.emit({**report.header(operation if operation in OPERATIONS else "unknown", None, started), "status": "error",
                     "problems": [{"code": "internal", "message": f"{type(error).__name__}: {str(error)[:300]}"}]})
        return 3


def _run_id(options: dict[str, Any]) -> str:
    return options.get("--run-id") or f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{secrets.token_hex(4)}"


def _report(ctx: Context, options: dict[str, Any], started: str) -> int:
    runs = [aggregate.read_run(ctx, raw) for raw in options["--run"]]
    run_id = _run_id(options)
    document = aggregate.summarize(runs, options.get("--title"), run_id, started)
    folder_rel = relative(ctx.cwd, ctx.cwd / (options.get("--results-dir") or report.DEFAULT_RESULTS) / run_id)
    files = {"report.md": aggregate.markdown(document, folder_rel).encode("utf-8")}
    folder = report.publish(ctx.cwd, ctx.spelled, options.get("--results-dir"), run_id, files, document, "report.json")
    report.emit({"format": 1, "kind": "lab-validation-report", "operation": "report", "runId": run_id, "status": document["verdict"],
                 "verdict": document["verdict"], "result": relative(ctx.cwd, folder / "report.json"),
                 "runs": [{"path": run["path"], "verdict": run["verdict"]} for run in runs]})
    return {"pass": 0, "fail": 1}.get(document["verdict"], 3)


def _validate(ctx: Context, operation: str, options: dict[str, Any], started: str) -> int:
    if operation == "inspect" and "--path" in options:
        report.emit({"format": 1, "kind": "lab-validation-inspect", "operation": "inspect",
                     "inspected": importers.inspect_path(ctx, options["--path"]), "status": "pass"})
        return 0
    req = request.load(ctx, options["--request"])
    if operation == "compare" and not req.criteria:
        raise Refused("request", "criteria: compare needs at least one criterion (measure or align compute without one).")
    sources: dict[str, importers.Source] = {}
    for source_id, spec in req.sources.items():
        source = importers.read(source_id, spec, ctx)
        source.conditions = spec["conditions"]
        source.probe = spec.get("probe")
        source.bandwidth_text = spec.get("bandwidthText")
        sources[source_id] = source
        total = sum(len(channel.t) for item in sources.values() for channel in item.channels.values())
        if total > importers.POINT_LIMIT:
            raise Refused("limit", f"the sources hold {total} samples, more than {importers.POINT_LIMIT} in one request.")
    sigs = {signal_id: signals.make(signal_id, spec, sources[spec["source"]]) for signal_id, spec in req.signals.items()}
    request.bind(req, sigs)
    for spec in req.comparisons:
        if spec["alignment"]["method"] == "marker":
            for side in ("measured", "reference"):
                spec["alignment"][side]["series"] = sigs[spec["alignment"][side]["signal"]].series

    diagnostics: list[dict[str, Any]] = []
    for sig in sigs.values():
        diagnostics += [entry(code, True, signal=sig.id) for code in sig.diagnostics]
        diagnostics += [entry(code, False, signal=sig.id) for code in sig.notes]
    document = report.header(operation, None, started)
    document["request"] = {"path": req.path, "sha256": req.sha256, "title": req.title, "requirement": req.requirement,
                           "decisionRule": req.rule, "missingData": req.missing, "conditions": req.conditions}
    document["sources"] = [_source(source) for source in sources.values()]
    document["signals"] = [sig.describe() for sig in sigs.values()]
    files: dict[str, bytes] = {}
    measured: dict[str, dict[str, Any]] = {}
    compared: dict[str, align.Comparison] = {}

    if operation == "inspect":
        report.emit({"format": 1, "kind": "lab-validation-inspect", "operation": "inspect", "request": document["request"],
                     "sources": [_brief(s) for s in document["sources"]],
                     "signals": [{k: s[k] for k in ("id", "source", "channel", "unit", "points", "start", "end", "rate", "uniform", "clipped", "diagnostics")}
                                 | {"gaps": len(s["gaps"])} for s in document["signals"]],
                     "diagnostics": diagnostics, "status": "pass"})
        return 0
    if operation == "normalize":
        for sig in sigs.values():
            files[f"series-{sig.id}.csv"] = report.series_csv(sig.id, sig.unit, sig.series.t, sig.series.v)
    if operation in ("measure", "compare"):
        document["definitions"] = {name: metrics.REGISTRY[name].definition for name in sorted({m["metric"] for m in req.measurements})}
        for spec in req.measurements:
            record = _measure(spec, sigs, req.missing)
            measured[spec["id"]] = record
            diagnostics += [entry(code, True, value=spec["id"], signal=spec["signal"]) for code in record["diagnostics"]]
            diagnostics += [entry(code, False, value=spec["id"], signal=spec["signal"]) for code in record["notes"]]
        document["measurements"] = list(measured.values())
    if operation in ("align", "compare"):
        records = []
        for index, spec in enumerate(req.comparisons):
            result = align.compare(spec, sigs[spec["signal"]], sigs[spec["reference"]], req.missing, f"comparisons[{index}]")
            if operation == "compare" and spec["alignment"]["method"] == "cross-correlation" and not any(
                    c["source"] == ("comparison", spec["id"], "lag") for c in req.criteria):
                result.notes.append("lag-unjudged")
            compared[spec["id"]] = result
            records.append(_comparison(spec, result, sigs))
            diagnostics += [entry(code, True, value=spec["id"]) for code in result.diagnostics]
            diagnostics += [entry(code, False, value=spec["id"]) for code in result.notes]
            files[f"compare-{spec['id']}.csv"] = report.comparison_csv(result.rows)
            files[f"compare-{spec['id']}.svg"] = report.comparison_svg(f"{spec['id']}: {spec['signal']} - {spec['reference']}",
                                                                      sigs[spec["signal"]].unit, result.rows)
        document["comparisons"] = records
    if operation == "compare":
        criteria = [_criterion(spec, measured, compared, sigs, req) for spec in req.criteria]
        document["criteria"] = criteria
        document["verdict"] = decide.verdict(criteria)
        document["status"] = document["verdict"]
    else:
        incomplete = any(m["status"] == "unknown" or m["diagnostics"] for m in measured.values()) or any(
            c.status == "unknown" or c.diagnostics for c in compared.values()) or any(s.diagnostics for s in sigs.values())
        document["status"] = "incomplete" if incomplete else "pass"
    document["diagnostics"] = diagnostics
    document["problems"] = []
    document["limits"] = report.LIMITS
    run_id = _run_id(options)
    document["runId"] = run_id
    results = options.get("--results-dir") or report.DEFAULT_RESULTS
    folder_rel = relative(ctx.cwd, ctx.cwd / results / run_id)
    files["report.md"] = report.markdown(document, folder_rel, {name: m.definition for name, m in metrics.REGISTRY.items()}).encode("utf-8")
    folder = report.publish(ctx.cwd, ctx.spelled, options.get("--results-dir"), run_id, files, document)
    summary = {key: document[key] for key in ("format", "kind", "tool", "operation", "runId", "status") if key in document}
    if "verdict" in document:
        summary["verdict"] = document["verdict"]
    summary["result"] = relative(ctx.cwd, folder / "result.json")
    summary["title"] = req.title
    if "criteria" in document:
        summary["criteria"] = [{k: c.get(k) for k in ("id", "status", "measured", "unit", "op", "limit")} for c in document["criteria"]]
    if measured:
        summary["measurements"] = [{k: m.get(k) for k in ("id", "value", "unit", "status", "diagnostics")} for m in measured.values()]
    if compared:
        summary["comparisons"] = [{"id": c["id"], "lag": c.get("lag"), "statistics": c["statistics"], "diagnostics": c["diagnostics"]}
                                  for c in document["comparisons"]]
    summary["diagnostics"] = sorted({d["code"] for d in diagnostics})
    summary["problems"] = []
    report.emit(summary)
    return {"pass": 0, "fail": 1}.get(document["status"], 3)


def _source(source: importers.Source) -> dict[str, Any]:
    bandwidth: Any = source.bandwidth
    if bandwidth is None:
        bandwidth = "unknown"
    elif bandwidth == float("inf"):
        bandwidth = "unlimited"
    record = {"id": source.id, "importer": source.importer, "path": source.path, "sha256": source.sha256, "files": source.files,
              "bandwidth": bandwidth, "probe": source.probe, "conditions": source.conditions, "timeZero": source.time_zero,
              "domain": "time", "diagnostics": source.diagnostics, "info": source.info}
    if source.captured is not None:
        record["captured"] = source.captured
    if source.identity is not None:
        record["identity"] = source.identity
    return record


def _brief(source: dict[str, Any]) -> dict[str, Any]:
    return {k: source[k] for k in ("id", "importer", "path", "sha256", "bandwidth", "timeZero", "diagnostics") if k in source} | {
        k: source[k] for k in ("captured", "identity") if k in source}


def _measure(spec: dict[str, Any], sigs: dict[str, signals.Signal], missing: str) -> dict[str, Any]:
    sig = sigs[spec["signal"]]
    metric = metrics.REGISTRY[spec["metric"]]
    params = spec["params"]
    other = sigs[params["reference"]] if "reference" in params else None
    outcome, win = metrics.measure(metric, sig.series, spec["a"], spec["b"], params, sig.source.bandwidth, sig.filter_rise,
                                   other.series if other else None)
    limiting = list(outcome.diagnostics)
    notes: list[str] = []
    excluded = 0.0
    for current in [win] + ([window(other.series, spec["a"], spec["b"])] if other else []):
        if current is None:
            continue
        if any(current.clipped):
            limiting.append("clipped")
        if current.gap_time > 0:
            excluded += current.gap_time
            if missing == "exclude" and metric.kind == "amplitude":
                notes.append("gap")
            else:
                limiting.append("gap")
    limiting += sig.diagnostics + (other.diagnostics if other else [])
    record: dict[str, Any] = {"id": spec["id"], "signal": spec["signal"], "metric": spec["metric"],
                              "window": {"from": spec["window"]["from"], "to": spec["window"]["to"]}, "value": outcome.value,
                              "unit": metric.unit(sig.unit), "signalUnit": sig.unit, "status": outcome.status}
    if outcome.reason:
        record["reason"] = outcome.reason
    if outcome.levels:
        record["levels"] = outcome.levels
    if outcome.details:
        record["details"] = outcome.details
    if excluded:
        record["excluded"] = excluded
    record["diagnostics"] = merge(limiting)
    record["notes"] = merge(notes)
    record["sources"] = [sig.source.id] + ([other.source.id] if other and other.source.id != sig.source.id else [])
    return record


def _comparison(spec: dict[str, Any], result: align.Comparison, sigs: dict[str, signals.Signal]) -> dict[str, Any]:
    record: dict[str, Any] = {"id": spec["id"], "signal": spec["signal"], "reference": spec["reference"],
                              "window": {"from": spec["window"]["from"], "to": spec["window"]["to"]}, "alignment": result.alignment,
                              "lag": result.lag, "statistics": result.statistics, "unit": sigs[spec["signal"]].unit,
                              "coverage": result.coverage, "status": result.status, "diagnostics": merge(result.diagnostics),
                              "notes": merge(result.notes)}
    if result.reason:
        record["reason"] = result.reason
    if result.excluded:
        record["excluded"] = result.excluded
    return record


def _criterion(spec: dict[str, Any], measured: dict[str, dict[str, Any]], compared: dict[str, align.Comparison],
               sigs: dict[str, signals.Signal], req: request.Request) -> dict[str, Any]:
    kind, target, statistic = spec["source"]
    if kind == "measurement":
        record = measured[target]
        value, status, codes = record["value"], record["status"], list(record["diagnostics"])
        involved = [sigs[record["signal"]].source]
        params = next(m for m in req.measurements if m["id"] == target)["params"]
        if "reference" in params:
            involved.append(sigs[params["reference"]].source)
    else:
        result = compared[target]
        value = result.statistics.get(statistic) if result.status == "ok" else None
        status = result.status if value is not None else "unknown"
        codes = list(result.diagnostics)
        if statistic in ("lag", "correlation"):
            # The lag is found from the samples that overlap; a reference that ends before the window does not make
            # the found lag uncertain (it limits the difference statistics only).
            codes = [code for code in codes if code != "reference-short"]
        comparison = next(c for c in req.comparisons if c["id"] == target)
        involved = [sigs[comparison["signal"]].source, sigs[comparison["reference"]].source]
    unique = []
    for source in involved:
        if source not in unique:
            unique.append(source)
    condition_codes, reasons = decide.conditions_check(spec["conditionNames"], req.conditions, unique)
    return decide.decide(spec, value, status, merge(codes, condition_codes), reasons)
