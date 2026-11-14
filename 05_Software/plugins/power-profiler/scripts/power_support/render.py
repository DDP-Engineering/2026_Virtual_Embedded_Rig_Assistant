"""report: Markdown and HTML over power-profiler runs (spec REQ-DATA-dd3e4fe1 section 7, REQ-FUNC-93ac5faa)."""

from __future__ import annotations

import html
import math
from pathlib import Path
from typing import Any

from . import capfile

COLUMNS = 1000


def svg(capture: capfile.Capture, title: str) -> str:
    """Current versus time as a min/max envelope over at most 1000 columns; gaps stay empty."""
    t, current = capture.t, capture.current
    t0, t1 = t[0], t[-1]
    width, height, pad = 800, 240, 30
    bins: list[tuple[float, float] | None] = [None] * COLUMNS
    for time, value in zip(t, current):
        if value is None:
            continue
        index = min(COLUMNS - 1, int((time - t0) / (t1 - t0) * COLUMNS)) if t1 > t0 else 0
        low_high = bins[index]
        bins[index] = (value, value) if low_high is None else (min(low_high[0], value), max(low_high[1], value))
    values = [v for pair in bins if pair for v in pair]
    lo, hi = (min(values), max(values)) if values else (0.0, 1.0)
    if not hi > lo:
        hi = lo + (abs(lo) or 1.0)

    def y(value: float) -> float:
        return pad + (hi - value) / (hi - lo) * (height - 2 * pad)

    lines = []
    for index, pair in enumerate(bins):
        if pair is None:
            continue
        x = pad + index / COLUMNS * (width - 2 * pad)
        lines.append(f'<line x1="{x:.1f}" y1="{y(pair[1]):.1f}" x2="{x:.1f}" y2="{max(y(pair[0]), y(pair[1]) + 0.5):.1f}"/>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}">'
            f'<title>{html.escape(title)}</title><rect width="100%" height="100%" fill="white"/>'
            f'<g stroke="#0f6e56" stroke-width="0.8">{"".join(lines)}</g>'
            f'<g font-family="sans-serif" font-size="11" fill="#333">'
            f'<text x="{pad}" y="16">{html.escape(title)}</text>'
            f'<text x="{pad}" y="{height - 8}">{t0:.6g} s</text><text x="{width - pad - 60}" y="{height - 8}">{t1:.6g} s</text>'
            f'<text x="2" y="{pad + 4}">{hi:.4g} A</text><text x="2" y="{height - pad}">{lo:.4g} A</text></g></svg>\n')


def value(entry: Any, unit: str) -> str:
    if isinstance(entry, dict):
        entry = entry.get("value", entry.get("mean"))
    if entry is None:
        return "withheld" if unit in ("J", "C") else "unknown"
    if isinstance(entry, float) and math.isfinite(entry):
        return f"{entry:.6g} {unit}"
    return f"{entry} {unit}"


def summary_lines(document: dict[str, Any]) -> list[str]:
    operation = document.get("operation")
    lines = [f"- operation `{operation}`, status **{document.get('status')}**"]
    meter = document.get("meter") or {}
    if meter:
        lines.append(f"- meter {meter.get('model')} {meter.get('serial')} ({meter.get('source')}), profile "
                     f"{meter.get('profile')} ({meter.get('profileStatus')})")
    if document.get("firmware"):
        firmware = document["firmware"]
        lines.append(f"- firmware {firmware.get('path')} sha256 {str(firmware.get('sha256'))[:16]}..., build id {firmware.get('buildId')}")
    timebase = document.get("timebase") or {}
    if timebase:
        lines.append(f"- timebase {timebase.get('clock')} clock, {timebase.get('rate')} Hz, {timebase.get('samples')} samples, "
                     f"uniform {timebase.get('uniform')}; gaps {len(document.get('gaps') or [])}, overflow {document.get('overflow')}")
    metrics = document.get("metrics") or {}
    if metrics:
        lines.append(f"- current mean {value(metrics.get('current'), 'A')}, energy {value(metrics.get('energy'), 'J')}, "
                     f"charge {value(metrics.get('charge'), 'C')} ({metrics.get('energySource')})")
    statistics = document.get("statistics") or {}
    if statistics:
        energy = statistics.get("energy") or {}
        lines.append(f"- {statistics.get('complete')} of {statistics.get('events')} events complete; energy per event mean "
                     f"{value(energy.get('mean'), 'J')}; sync {(document.get('sync') or {}).get('method')}")
    if document.get("comparison"):
        comparison = document["comparison"]
        lines.append(f"- classification **{comparison.get('classification')}**, attribution: {comparison.get('attribution')}")
    if document.get("estimate"):
        life = document["estimate"]["life"]
        lines.append(f"- battery life {life['minDays']:g} to {life['maxDays']:g} days ({life['precision']})")
    for problem in document.get("problems") or []:
        lines.append(f"- problem `{problem.get('code')}`: {problem.get('message')}")
    return lines


def markdown(title: str, runs: list[tuple[str, dict[str, Any], str | None]]) -> str:
    out = [f"# {title}", ""]
    for path, document, image in runs:
        out += [f"## [{path}]({path}/result.json)", "", *summary_lines(document)]
        if image:
            out += ["", f"![current]({image})"]
        out.append("")
    return "\n".join(out)


def page(title: str, runs: list[tuple[str, dict[str, Any], str | None]]) -> str:
    body = [f"<h1>{html.escape(title)}</h1>"]
    for path, document, image in runs:
        items = "".join(f"<li>{html.escape(line[2:])}</li>" for line in summary_lines(document))
        body.append(f'<h2><a href="{html.escape(path)}/result.json">{html.escape(path)}</a></h2><ul>{items}</ul>')
        if image:
            body.append(f'<img src="{html.escape(image)}" alt="current versus time">')
    return ("<!doctype html><html><head><meta charset=\"utf-8\"><title>" + html.escape(title) + "</title></head><body>"
            + "".join(body) + "</body></html>\n")


def runs_of(folders: list[tuple[Path, str]]) -> list[tuple[Path, str, dict[str, Any]]]:
    """Each run's result.json with every artifact checked against its recorded SHA-256."""
    out = []
    for folder, shown in folders:
        document, _ = capfile.read_result(folder, f"--run {shown}")
        for item in document.get("artifacts") or []:
            if isinstance(item, dict) and isinstance(item.get("path"), str):
                capfile.member(folder, item["path"], document, f"--run {shown}", capfile.CSV_LIMIT)
        out.append((folder, shown, document))
    return out
