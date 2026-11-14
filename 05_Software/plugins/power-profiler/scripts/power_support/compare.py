"""compare: firmware A/B on an equivalent setup (spec REQ-DATA-dd3e4fe1 section 7, REQ-FUNC-3ca637cb).

The comparison never decides a criterion itself: it keeps both build identities, separates setup differences from
firmware changes and writes a lab-validate request whose sources carry each capture's setup as conditions, so
lab-validate judges the limits and makes them incomplete when the setups differ.
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any

from . import capfile
from .errors import Refused
from .workspace import PathRefused, confined

SETUP_FIELDS = ("meterModel", "meterSerial", "rate", "currentRange", "voltageRange", "sync", "board", "conditions")


def read_segment(cwd: Path, spelled: Path, raw: str, option: str) -> tuple[dict[str, Any], str, Path]:
    try:
        folder = confined(cwd, raw, option, spelled)
    except PathRefused as error:
        raise Refused("path", str(error)) from error
    if not folder.is_dir():
        raise Refused("path", f"{option} '{raw[:120]}' is not a run folder.")
    document, digest = capfile.read_result(folder, option)
    if document.get("operation") != "segment" or document.get("status") not in ("pass", "incomplete"):
        raise Refused("source", f"{option} is not a segment run with status pass or incomplete.")
    capfile.member(folder, "events.csv", document, option, capfile.RESULT_LIMIT)
    capture = (document.get("inputs") or {}).get("capture") or {}
    try:
        capture_folder = confined(cwd, str(capture.get("path", "")), f"{option} (its capture)", spelled)
    except PathRefused as error:
        raise Refused("path", str(error)) from error
    try:
        _, capture_sha = capfile.read_result(capture_folder, f"{option} (its capture)")
    except Refused as error:
        raise Refused("source", f"{option}: its capture {str(capture.get('path'))[:120]} cannot be read: {error.message}") from error
    if capture_sha != capture.get("sha256"):
        raise Refused("source-changed", f"{option}: its capture's result.json changed after the segment run.")
    return document, digest, folder


def _setup(document: dict[str, Any]) -> dict[str, Any]:
    setup = document.get("setup") or {}
    sync = document.get("sync") or {}
    return {
        "meterModel": setup.get("meterModel"),
        "meterSerial": setup.get("meterSerial"),
        "rate": setup.get("rate"),
        "currentRange": setup.get("currentRange"),
        "voltageRange": setup.get("voltageRange"),
        "sync": {key: sync.get(key) for key in ("method", "channel", "event", "threshold", "minGap", "clock")},
        "board": setup.get("board"),
        "conditions": setup.get("conditions") or {},
    }


def compare(a: dict[str, Any], b: dict[str, Any], tolerance: float) -> dict[str, Any]:
    if not math.isfinite(tolerance) or not 0 <= tolerance <= 50:
        raise Refused("request", "--supply-tolerance is a percentage from 0 to 50.")
    setup_a, setup_b = _setup(a), _setup(b)
    differences = [{"field": name, "a": setup_a[name], "b": setup_b[name]} for name in SETUP_FIELDS if setup_a[name] != setup_b[name]]
    va = ((a.get("metrics") or {}).get("voltage") or {}).get("mean")
    vb = ((b.get("metrics") or {}).get("voltage") or {}).get("mean")
    supply_equal = False
    if isinstance(va, (int, float)) and isinstance(vb, (int, float)) and va != 0:
        supply_equal = abs(vb - va) <= tolerance / 100 * abs(va)
        if not supply_equal:
            differences.append({"field": "supply", "a": va, "b": vb, "tolerance": f"{tolerance:g} %"})
    else:
        differences.append({"field": "supply", "a": va, "b": vb, "reason": "a mean voltage is unknown"})
    fw_a = (a.get("setup") or {}).get("firmware")
    fw_b = (b.get("setup") or {}).get("firmware")
    if not fw_a or not fw_b:
        classification, attribution = "unidentified", "none: a capture names no firmware build"
    elif differences:
        classification, attribution = "setup-difference", "none: the setup differs, so the difference is not attributed to the firmware"
    elif fw_a.get("sha256") == fw_b.get("sha256"):
        classification, attribution = "same-firmware", "none: both captures ran the same build (repeatability)"
    else:
        classification, attribution = "firmware-change", "firmware"
    per_event = _difference(((a.get("statistics") or {}).get("energy")), ((b.get("statistics") or {}).get("energy")))
    per_period = _difference(((a.get("periods") or {}).get("energy")), ((b.get("periods") or {}).get("energy")))
    return {"classification": classification, "attribution": attribution, "setupDifferences": differences,
            "supplyEquivalent": supply_equal, "builds": {"a": fw_a, "b": fw_b},
            "difference": {"perEvent": per_event, "perPeriod": per_period, "unit": "J",
                           "definition": "mean B - mean A; standard error sqrt(sA^2/nA + sB^2/nB); a period runs from an "
                                         "event's start to the next event's start (sleep included)"},
            "setup": {"a": setup_a, "b": setup_b}}


def _difference(ea: dict[str, Any] | None, eb: dict[str, Any] | None) -> dict[str, Any] | None:
    if not ea or not eb or not ea.get("n") or not eb.get("n"):
        return None
    sa, sb = ea.get("stdev") or 0.0, eb.get("stdev") or 0.0
    delta = eb["mean"] - ea["mean"]
    error = math.sqrt(sa * sa / ea["n"] + sb * sb / eb["n"]) if ea["n"] > 1 and eb["n"] > 1 else None
    return {"value": delta, "standardError": error, "relative": delta / ea["mean"] if ea["mean"] else None,
            "nA": ea["n"], "nB": eb["n"]}


def _condition_text(value: Any) -> str:
    return str(value)[:120] if value is not None else "unknown"


def request(a: dict[str, Any], b: dict[str, Any], outcome: dict[str, Any], limit: float | None) -> tuple[dict[str, Any] | None, str | None]:
    """The lab-validate request (power-capture importer, integral metric) or the reason none is written."""
    for side, document in (("A", a), ("B", b)):
        corrections = document.get("corrections") or {}
        if corrections.get("currentOffset"):
            return None, f"segment run {side} used a current offset, which a lab-validate signal cannot carry"
    if not a.get("periods") or not b.get("periods"):
        return None, "a run has no whole period (two events without gaps or overflow between them)"
    n = min(a["periods"]["n"], b["periods"]["n"])
    sources: dict[str, Any] = {}
    signals: dict[str, Any] = {}
    measurements: list[dict[str, Any]] = []
    criteria: list[dict[str, Any]] = []
    va = ((a.get("metrics") or {}).get("voltage") or {}).get("mean")
    for side, document in (("A", a), ("B", b)):
        setup = outcome["setup"][side.lower()]
        conditions = {"meter": f"{setup['meterModel']} {setup['meterSerial']}", "rate": f"{setup['rate']} Hz",
                      "current-range": _condition_text(setup["currentRange"]),
                      "voltage-range": _condition_text(setup["voltageRange"]),
                      "sync": _condition_text(setup["sync"].get("method")), "board": _condition_text(setup["board"])}
        for name, value in (setup["conditions"] or {}).items():
            conditions[f"user-{name}"[:32]] = _condition_text(value)
        mean_v = ((document.get("metrics") or {}).get("voltage") or {}).get("mean")
        supply = va if outcome["supplyEquivalent"] else mean_v
        conditions["supply"] = f"{supply:.4g} V" if isinstance(supply, (int, float)) else "unknown"
        capture = (document.get("inputs") or {}).get("capture") or {}
        sources[side] = {"importer": "power-capture", "path": capture.get("path"), "sha256": capture.get("sha256"),
                         "conditions": conditions}
        sign = (document.get("corrections") or {}).get("sign", 1)
        signals[f"{side}-power"] = {"source": side, "channel": "power", "sign": sign}
        signals[f"{side}-current"] = {"source": side, "channel": "current", "sign": sign}
        starts = [e["from"] for e in document.get("events") or []]
        window = {"from": f"{starts[0]!r} s", "to": f"{starts[n]!r} s"}
        measurements.append({"id": f"{side}-energy", "signal": f"{side}-power", "metric": "integral", "window": window})
        measurements.append({"id": f"{side}-charge", "signal": f"{side}-current", "metric": "integral", "window": window})
        if limit is not None:
            criteria.append({"id": f"C-{side}-energy", "value": f"{side}-energy", "op": "<=", "limit": f"{n * limit!r} J"})
    # Every condition name must be declared at the request level for lab-validate to compare them per criterion.
    names = sorted(set(sources["A"]["conditions"]) | set(sources["B"]["conditions"]))
    document = {"format": 1, "title": f"Firmware A/B energy over {n} periods ({outcome['classification']})",
                "decisionRule": "simple", "missingData": "incomplete",
                "conditions": {name: sources["A"]["conditions"].get(name, "unknown") for name in names},
                "sources": sources, "signals": signals, "measurements": measurements, "criteria": criteria}
    return document, None

