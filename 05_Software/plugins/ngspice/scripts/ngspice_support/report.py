"""Run-folder artefacts (spec REQ-DATA-29b9a988 §6): series.csv, plot.svg, result.json and report.md."""

from __future__ import annotations

import csv
import hashlib
import io
import json
import math
from pathlib import Path
from typing import Any

from . import FORMAT, TOOL, VERSION, workspace

LIMITS = [
    "Results hold for the netlist, models and analysis given; they are not a measurement of hardware.",
    "ngspice-tool sets no solver option; a run that does not converge is reported, never retried with other settings.",
    "A lumped RC thermal network couples heat to current only if the device model itself takes the temperature node.",
]


def series_csv(columns: list[str], rows: list[list[float]]) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(columns)
    for row in rows:
        writer.writerow([repr(value) for value in row])
    return buffer.getvalue()


def plot_svg(columns: list[str], rows: list[list[float]], log_x: bool, title: str) -> str:
    """One panel per vector, linear axes (logarithmic x for frequency sweeps), at most 2 000 points per panel."""
    width, panel, margin = 720, 160, 50
    vectors = columns[1:]
    height = margin + panel * max(len(vectors), 1) + 20
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" font-family="sans-serif" font-size="11">',
           f'<text x="10" y="18" font-size="13">{_xml(title)}</text>']
    if not rows:
        return "\n".join(out + ["</svg>"]) + "\n"
    step = max(1, len(rows) // 2000)
    sample = rows[::step]
    xs = [row[0] for row in sample]
    if log_x:
        xs = [math.log10(x) if x > 0 else float("nan") for x in xs]
    x_lo, x_hi = min(xs), max(xs)
    for index, name in enumerate(vectors):
        top = margin + index * panel
        ys = [row[index + 1] for row in sample]
        finite = [y for y in ys if math.isfinite(y)]
        if not finite:
            out.append(f'<text x="60" y="{top + 30}">{_xml(name)}: no finite values to plot</text>')
            continue
        y_lo, y_hi = min(finite), max(finite)
        if not y_hi - y_lo > max(abs(y_lo), abs(y_hi)) * 1e-12:
            pad = max(abs(y_hi) * 0.1, 1.0)
            y_lo, y_hi = y_lo - pad, y_hi + pad
        points = []
        for x, y in zip(xs, ys):
            if not (math.isfinite(x) and math.isfinite(y)):
                continue
            px = 60 + (x - x_lo) / ((x_hi - x_lo) or 1) * (width - 80)
            py = top + panel - 25 - (y - y_lo) / (y_hi - y_lo) * (panel - 40)
            points.append(f"{px:.1f},{py:.1f}")
        out += [f'<rect x="60" y="{top + 15}" width="{width - 80}" height="{panel - 40}" fill="none" stroke="#999"/>',
                f'<text x="60" y="{top + 10}">{_xml(name)}  [{y_lo:.4g} .. {y_hi:.4g}]</text>',
                f'<polyline fill="none" stroke="#1f77b4" stroke-width="1" points="{" ".join(points)}"/>']
    scale = columns[0] + (" (log)" if log_x else "")
    out.append(f'<text x="60" y="{height - 5}">{_xml(scale)}: {rows[0][0]:.4g} .. {rows[-1][0]:.4g}</text>')
    return "\n".join(out + ["</svg>"]) + "\n"


def _xml(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def header(operation: str, run_id: str, started: str, status: str, request: dict[str, Any] | None) -> dict[str, Any]:
    return {"format": FORMAT, "kind": "ngspice-tool-result", "tool": {"name": TOOL, "version": VERSION},
            "operation": operation, "runId": run_id, "startedAt": started, "status": status,
            **({"request": request} if request else {})}


def markdown(result: dict[str, Any]) -> str:
    lines = [f"# ngspice-tool {result['operation']} - {result['status']}", "",
             f"Run `{result['runId']}`, {result['startedAt']}."]
    engine = result.get("ngspice")
    if engine:
        lines.append(f"Engine: ngspice-{engine['version']} ({engine['executable']}).")
    lines.append("")
    if result.get("analysis"):
        lines += [f"Analysis: `{result['analysis']}`" + (f", temperature {result['temperature']} °C" if result.get("temperature") is not None else ""), ""]
    if result.get("parameters"):
        lines += ["Parameters: " + ", ".join(f"{k} = {v:g}" for k, v in result["parameters"].items()), ""]
    if result.get("inputs"):
        lines += ["## Inputs", "", "| File | Role | Bytes | SHA-256 |", "|---|---|---|---|"]
        lines += [f"| {i['path']} | {i['role']} | {i['bytes']} | {i['sha256'][:16]}... |" for i in result["inputs"]] + [""]
    if result.get("options"):
        lines += ["Netlist options (as written): " + "; ".join(f"`{o}`" for o in result["options"]), ""]
    if result.get("droppedCards"):
        lines += ["Cards not run (the request's analysis runs instead): " + ", ".join(f"{d['card']} ({d['file']}:{d['line']})" for d in result["droppedCards"]), ""]
    engine_out = result.get("engine")
    if engine_out:
        lines += [f"## Engine: {engine_out.get('status', result['status'])}", ""]
        lines += [f"- {p['kind']}: {p['line']}" for p in engine_out.get("problems", [])] + [""]
    if result.get("measurements"):
        lines += ["## Measurements", "", "| Id | Kind | Value | Unit | Window / reason |", "|---|---|---|---|---|"]
        for m in result["measurements"]:
            if m["status"] == "ok":
                lines.append(f"| {m['id']} | {m['kind']} | {m['value']:.6g} | {m['unit']} | {m.get('window', m.get('at', ''))} |")
            else:
                lines.append(f"| {m['id']} | {m['kind']} | unknown | | {m.get('reason', '')} |")
        lines.append("")
        convention = next((m["convention"] for m in result["measurements"] if m.get("convention")), None)
        if convention:
            lines += [f"Power sign convention: {convention}", ""]
    if result.get("criteria"):
        lines += ["## Criteria", "", "| Measurement | Requirement | Status |", "|---|---|---|"]
        lines += [f"| {c['measurement']} | {c['op']} {c['given']} | {c['status']} |" for c in result["criteria"]] + [""]
    if result.get("points"):
        lines += ["## Points", "", "| # | Inputs | Status | Measurements |", "|---|---|---|---|"]
        for p in result["points"]:
            values = ", ".join(f"{m['id']}={m['value']:.4g}" if m["status"] == "ok" else f"{m['id']}=unknown" for m in p["measurements"])
            lines.append(f"| {p['index']} | {json.dumps(p['inputs'])} | {p['status']} | {values} |")
        lines.append("")
    if result.get("summary"):
        lines += ["## Summary", ""] + [f"- {k}: min {v['min']:.6g}, max {v['max']:.6g}, mean {v['mean']:.6g} ({v['count']} values)" for k, v in result["summary"].items()] + [""]
    if result.get("differences") is not None:
        lines += ["## Differences", ""] + ([f"- {d['field']}: {d['a']} -> {d['b']}" for d in result["differences"]] or ["- none"]) + [""]
    if result.get("warnings"):
        lines += ["## Warnings", ""] + [f"- {w}" for w in result["warnings"]] + [""]
    lines += ["## Limits", ""] + [f"- {limit}" for limit in LIMITS] + [""]
    return "\n".join(lines)


def write_files(cwd: Path, run_dir: Path, files: dict[str, tuple[str, bytes]]) -> list[dict[str, Any]]:
    for name, (_, data) in files.items():
        with open(run_dir / name, "xb") as handle:
            handle.write(data)
    return [{"kind": kind, "path": workspace.relative(cwd, run_dir / name), "bytes": len(data),
             "sha256": hashlib.sha256(data).hexdigest()} for name, (kind, data) in files.items()]


def json_bytes(document: dict[str, Any]) -> bytes:
    return (json.dumps(document, indent=2, ensure_ascii=False, allow_nan=False, default=_default) + "\n").encode("utf-8")


def _default(value: Any) -> Any:
    if hasattr(value, "value") and hasattr(value, "given"):
        return {"value": value.value, "unit": value.unit, "given": value.given}
    raise TypeError(f"not serializable: {type(value).__name__}")
