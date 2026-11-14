"""The run folder and its files (spec section 8): result.json, report.md, series CSV and comparison plots."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import TOOL, VERSION, units
from .errors import Refused
from .workspace import PathRefused, allowed_output, relative, results_directory, utf16_length

OUTPUT_LIMIT = 11_000
DEFAULT_RESULTS = "embedded-lab-results"
LIMITS = [
    "Not a calibration or metrological certification: the verdict applies the declared criteria, decision rule and "
    "supplied uncertainty to the data given.",
    "Criteria are applied as written and never widened; a verdict the data cannot support is incomplete.",
    "Instrument clocks are never assumed synchronized; signals of different sources are aligned only by the declared method.",
    "No sample is interpolated across a gap or invented for clipped data; every number is computed by lab-validate, "
    "offline, without a language model.",
]


def now() -> str:
    moment = datetime.now(timezone.utc)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


def header(operation: str, run_id: str | None, started: str) -> dict[str, Any]:
    return {"format": 1, "kind": "lab-validation-result", "tool": {"name": TOOL, "version": VERSION}, "operation": operation,
            "runId": run_id, "started": started, "finished": None, "status": "pass"}


def publish(cwd: Path, spelled: Path, results: str | None, run_id: str, files: dict[str, bytes], document: dict[str, Any],
            result_name: str = "result.json") -> Path:
    """Creates `<results>/<run-id>/` exclusively, writes the files, then the document with the artifact list. A
    failure removes what this run created."""
    try:
        base = results_directory(cwd, results or DEFAULT_RESULTS, spelled)
    except PathRefused as error:
        raise Refused("path", str(error)) from error
    base.mkdir(parents=True, exist_ok=True)
    if not allowed_output(cwd, base):
        raise Refused("path", "--results-dir resolves outside the working directory or inside .vera.")
    folder = base / run_id
    try:
        folder.mkdir()
    except FileExistsError as error:
        raise Refused("request", f"the run folder {relative(cwd, folder)} exists already; choose another --run-id.") from error
    try:
        artifacts = []
        for name, data in files.items():
            with open(folder / name, "xb") as handle:
                handle.write(data)
            artifacts.append({"path": relative(cwd, folder / name), "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
        document["artifacts"] = artifacts
        document["finished"] = now()
        with open(folder / result_name, "x", encoding="utf-8", newline="\n") as handle:
            handle.write(json.dumps(document, indent=2, ensure_ascii=False, allow_nan=False) + "\n")
    except (OSError, ValueError):
        shutil.rmtree(folder, ignore_errors=True)
        raise
    return folder


def emit(document: dict[str, Any]) -> None:
    """Prints one JSON document within the runner's output limit; bulky lists shrink first."""
    shown = dict(document)
    text = json.dumps(shown, ensure_ascii=False, allow_nan=False)
    for key in ("measurements", "comparisons", "signals", "criteria", "problems"):
        if utf16_length(text) <= OUTPUT_LIMIT:
            break
        if isinstance(shown.get(key), list):
            shown[key] = f"{len(shown[key])} entries in the result file"
            shown["truncated"] = True
            text = json.dumps(shown, ensure_ascii=False, allow_nan=False)
    if utf16_length(text) > OUTPUT_LIMIT:
        text = json.dumps({key: shown.get(key) for key in ("format", "kind", "operation", "runId", "status", "verdict", "result")
                           if key in shown} | {"truncated": True}, ensure_ascii=False)
    print(text)


# ---- Files ----


def series_csv(name: str, unit: str, t: list[float], v: list[float]) -> bytes:
    lines = [f"time_s,{name}_{unit}"] + [f"{time!r},{value!r}" for time, value in zip(t, v)]
    return ("\n".join(lines) + "\n").encode("utf-8")


def comparison_csv(rows: list[tuple[float, float, float | None, float | None]]) -> bytes:
    lines = ["time_s,measured,reference,difference"]
    for time, measured, reference, difference in rows:
        lines.append(",".join([repr(time), repr(measured), "" if reference is None else repr(reference),
                               "" if difference is None else repr(difference)]))
    return ("\n".join(lines) + "\n").encode("utf-8")


def comparison_svg(title: str, unit: str, rows: list[tuple[float, float, float | None, float | None]]) -> bytes:
    """Two panels: measured and aligned reference overlaid, and their difference; at most 2 000 points per trace."""
    width, panel = 760, 200
    height = 40 + 2 * panel + 30
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" '
           'font-family="sans-serif" font-size="11">', f'<text x="10" y="18" font-size="13">{_xml(title)}</text>']
    step = max(1, len(rows) // 2000)
    sample = rows[::step]
    if not sample:
        return ("\n".join(out + ["</svg>"]) + "\n").encode("utf-8")
    x_lo, x_hi = sample[0][0], sample[-1][0]

    def trace(index: int, top: int, colour: str, values: list[float | None], lo: float, hi: float) -> str:
        points = []
        for row, value in zip(sample, values):
            if value is None:
                continue
            px = 60 + (row[0] - x_lo) / ((x_hi - x_lo) or 1) * (width - 80)
            py = top + panel - 20 - (value - lo) / ((hi - lo) or 1) * (panel - 40)
            points.append(f"{px:.1f},{py:.1f}")
        return f'<polyline fill="none" stroke="{colour}" stroke-width="1" points="{" ".join(points)}"/>' if index >= 0 else ""

    measured = [row[1] for row in sample]
    reference = [row[2] for row in sample]
    difference = [row[3] for row in sample]
    both = [v for v in measured + reference if v is not None]
    lo, hi = min(both), max(both)
    out += [f'<rect x="60" y="40" width="{width - 80}" height="{panel - 40}" fill="none" stroke="#999"/>',
            f'<text x="60" y="34">measured (blue) and aligned reference (orange) [{units.show(lo, unit)} .. {units.show(hi, unit)}]</text>',
            trace(0, 20, "#1f77b4", measured, lo, hi), trace(1, 20, "#ff7f0e", reference, lo, hi)]
    diffs = [v for v in difference if v is not None]
    if diffs:
        d_lo, d_hi = min(diffs), max(diffs)
        if d_hi == d_lo:
            d_lo, d_hi = d_lo - 1e-12, d_hi + 1e-12
        top = 20 + panel
        out += [f'<rect x="60" y="{top + 20}" width="{width - 80}" height="{panel - 40}" fill="none" stroke="#999"/>',
                f'<text x="60" y="{top + 14}">difference measured - reference [{units.show(d_lo, unit)} .. {units.show(d_hi, unit)}]</text>',
                trace(2, top, "#d62728", difference, d_lo, d_hi)]
    out.append(f'<text x="60" y="{height - 8}">time: {units.show(x_lo, "s")} .. {units.show(x_hi, "s")}</text>')
    return ("\n".join(out + ["</svg>"]) + "\n").encode("utf-8")


def _xml(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _cell(text: Any) -> str:
    return str(text).replace("|", "\\|").replace("\n", " ")


def markdown(document: dict[str, Any], folder_from_cwd: str, definitions: dict[str, str]) -> str:
    """report.md; links are relative to the run folder."""

    def link(path: str) -> str:
        target = Path(os.path.relpath(path, folder_from_cwd)).as_posix()
        return f"[{_cell(path)}]({target})"

    request = document["request"]
    status = document.get("verdict") or document["status"]
    lines = [f"# {_cell(request['title'])} - {status}", "",
             f"lab-validate {document['operation']}, run `{document['runId']}`, {document['started']}.",
             f"Request {link(request['path'])} (SHA-256 `{request['sha256'][:16]}...`), decision rule `{request['decisionRule']}`, "
             f"missing data `{request['missingData']}`."]
    if request.get("requirement"):
        lines.append(f"Requirement: {_cell(request['requirement'])}.")
    lines.append("")
    if document.get("criteria"):
        lines += ["## Criteria", "", "| Criterion | Value | Requirement | Measured | Uncertainty | Rule | Status | Reasons |",
                  "|---|---|---|---|---|---|---|---|"]
        for c in document["criteria"]:
            requirement = f"{c['op']} {c['limit']}" + (f" +- {c['tolerance']}" if c.get("tolerance") else "")
            measured = units.show(c["measured"], c["unit"]) + (" (lower bound)" if c["valueStatus"] == "bound" else "")
            lines.append(f"| {c['id']} | {_cell(c['value'])} | {_cell(requirement)} | {measured} | {_cell(c.get('uncertainty', '-'))} | "
                         f"{c['rule']} | **{c['status']}** | {_cell('; '.join(c['reasons']) or '-')} |")
        lines.append("")
    if document.get("measurements"):
        lines += ["## Measurements", "", "| Id | Signal | Metric | Window | Value | Status | Levels | Diagnostics |",
                  "|---|---|---|---|---|---|---|---|"]
        for m in document["measurements"]:
            levels = m.get("levels")
            shown_levels = "-" if not levels else f"{units.show(levels['low'], m['signalUnit'])} / {units.show(levels['high'], m['signalUnit'])} ({levels['source']})"
            value = units.show(m["value"], m["unit"]) + (f" ({m['reason']})" if m.get("reason") else "")
            lines.append(f"| {m['id']} | {m['signal']} | {m['metric']} | {_cell(m['window']['from'])} .. {_cell(m['window']['to'])} | "
                         f"{_cell(value)} | {m['status']} | {_cell(shown_levels)} | {', '.join(m['diagnostics'] + m['notes']) or '-'} |")
        lines.append("")
        used = sorted({m["metric"] for m in document["measurements"]})
        lines += ["Definitions:", ""] + [f"- `{name}`: {definitions[name]}" for name in used] + [""]
    if document.get("comparisons"):
        lines += ["## Comparisons", "", "| Id | Signal - reference | Window | Alignment | Lag | max-abs | rms | mean | Coverage | Diagnostics |",
                  "|---|---|---|---|---|---|---|---|---|---|"]
        for c in document["comparisons"]:
            stats = c["statistics"]
            alignment = c["alignment"]
            how = alignment["method"]
            if how == "cross-correlation":
                how += f" (maxLag {alignment.get('maxLag')}, correlation {stats.get('correlation') or 0:.6f})"
            elif how == "marker":
                how += "".join(f"; {side} {alignment[side]['signal']} {alignment[side]['edge']} at {alignment[side]['level']}"
                               for side in ("measured", "reference") if side in alignment)
            elif how == "none":
                how += f" ({alignment.get('note')})"
            elif how == "offset":
                how += f" {alignment.get('offset')}"
            coverage = "-" if c.get("coverage") is None else "%.1f %%" % (c["coverage"] * 100)
            lines.append(f"| {c['id']} | {c['signal']} - {c['reference']} | {_cell(c['window']['from'])} .. {_cell(c['window']['to'])} | "
                         f"{_cell(how)} | {units.show(c.get('lag'), 's')} | {units.show(stats.get('max-abs'), c['unit'])} | "
                         f"{units.show(stats.get('rms'), c['unit'])} | {units.show(stats.get('mean'), c['unit'])} | "
                         f"{coverage} | {', '.join(c['diagnostics'] + c['notes']) or '-'} |")
        lines.append("")
        lines += ["Each comparison has `compare-<id>.csv` and an overlay and difference plot `compare-<id>.svg` in this folder.", ""]
    conditions = request.get("conditions") or {}
    if conditions:
        lines += ["## Conditions", "", "| Condition | Required | " + " | ".join(s["id"] for s in document["sources"]) + " |",
                  "|---|---|" + "---|" * len(document["sources"])]
        for name, value in conditions.items():
            lines.append(f"| {_cell(name)} | {_cell(value)} | " + " | ".join(_cell(s["conditions"].get(name, "not stated")) for s in document["sources"]) + " |")
        lines.append("")
    lines += ["## Signals and preprocessing", "", "| Signal | Source / channel | Mapping | Sign, scale | Points | Rate | Gaps | Clipped | Steps |",
              "|---|---|---|---|---|---|---|---|---|"]
    for s in document["signals"]:
        steps = "; ".join(_step(step) for step in s["preprocessing"]) or "none"
        mapping = ", ".join(f"{k} {v}" for k, v in s["mapping"].items())
        lines.append(f"| {s['id']} | {s['source']} / {_cell(s['channel'])} | {_cell(mapping)} | sign {s['sign']}, scale {s['scale']:g} | "
                     f"{s['points']} | {units.show(s['rate'], 'Hz')} | {len(s['gaps'])} | {s['clipped']} | {_cell(steps)} |")
    lines.append("")
    lines += ["## Sources", "", "| Source | Importer | Files | SHA-256 | Bandwidth | Time zero |", "|---|---|---|---|---|---|"]
    for s in document["sources"]:
        bandwidth = s["bandwidth"] if isinstance(s["bandwidth"], str) else units.show(s["bandwidth"], "Hz")
        lines.append(f"| {s['id']} | {s['importer']} | {link(s['path'])} | `{s['sha256'][:16]}...` | {bandwidth} | {_cell(s['timeZero'])} |")
    for s in document["sources"]:
        if s.get("captured") or s.get("identity") or s.get("probe"):
            lines.append("")
            lines.append(f"Source {s['id']}: " + "; ".join(
                part for part in (
                    f"probe {s['probe']}" if s.get("probe") else "",
                    "captured " + ", ".join(f"{k} {v}" for k, v in (s.get("captured") or {}).items()) if s.get("captured") else "",
                    "instrument " + ", ".join(f"{k} {v}" for k, v in (s.get("identity") or {}).items() if v is not None) if s.get("identity") else "",
                ) if part))
    lines.append("")
    if document.get("diagnostics"):
        lines += ["## Diagnostics", ""]
        for d in document["diagnostics"]:
            where = ", ".join(f"{k} {d[k]}" for k in ("value", "signal") if k in d)
            lines.append(f"- `{d['code']}` ({'limits the verdict' if d['limits'] else 'note'}{', ' + where if where else ''}): {d['message']}")
        lines.append("")
    if document.get("problems"):
        lines += ["## Problems", ""] + [f"- {p['code']}: {p['message']}" for p in document["problems"]] + [""]
    lines += ["## Limits", ""] + [f"- {limit}" for limit in document["limits"]] + [""]
    return "\n".join(lines)


def _step(step: dict[str, Any]) -> str:
    if step["step"] == "resample":
        return f"resample linear at {units.show(step['rate'], 'Hz')} (from {units.show(step['fromRate'], 'Hz')}), {step['points']} points"
    return (f"moving-average {units.show(step['width'], 's')} ({step['samples']} samples; first null {units.show(step['firstNull'], 'Hz')}, "
            f"-3 dB {units.show(step['cutoff3dB'], 'Hz')}, 10-90 % {units.show(step['riseTime1090'], 's')})")
