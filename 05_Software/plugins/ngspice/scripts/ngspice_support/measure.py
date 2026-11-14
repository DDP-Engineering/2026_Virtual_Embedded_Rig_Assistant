"""Measurements and criteria on a series (spec REQ-DATA-29b9a988 §6). Pure functions on the parsed columns: a
measurement that cannot be computed is `unknown` with its reason, never a number."""

from __future__ import annotations

import math
from typing import Any

POWER_CONVENTION = (
    "p = v x i averaged over the window; positive means the element absorbs power when the current flows into the "
    "node that the voltage names first (i(Vsense) of a sense source in series, oriented from that node)."
)


def _unit(vector: str) -> str:
    name = vector.lower()
    if name.startswith("i("):
        return "A"
    if name.startswith("vdb("):
        return "dB"
    if name.startswith("vp("):
        return "rad"
    if name.endswith("noise_spectrum"):
        return "V/sqrt(Hz)"
    return "V"


def _column(columns: list[str], rows: list[list[float]], name: str) -> list[float] | None:
    lowered = [c.lower() for c in columns]
    key = name.lower()
    if key in lowered:
        index = lowered.index(key)
        return [row[index] for row in rows]
    if f"{key} re" in lowered:  # a complex vector: its magnitude
        re_i, im_i = lowered.index(f"{key} re"), lowered.index(f"{key} im")
        return [math.hypot(row[re_i], row[im_i]) for row in rows]
    return None


def _window(x: list[float], y: list[float], window: dict[str, Any] | None) -> tuple[list[float], list[float]] | str:
    lo = window["from"].value if window and window.get("from") else x[0]
    hi = window["to"].value if window and window.get("to") else x[-1]
    if hi <= lo and len(x) > 1:
        return "the window ends before it starts"
    if lo < min(x) - abs(min(x)) * 1e-9 or hi > max(x) + abs(max(x)) * 1e-9:
        return f"the window {lo:g}..{hi:g} lies outside the series {min(x):g}..{max(x):g}"
    if len(x) == 1:
        return x, y
    # The samples inside the window, with values interpolated at its edges so averages are not biased by them.
    xs, ys = [], []
    start, end = _interpolate(x, y, lo), _interpolate(x, y, hi)
    if start is not None and (not xs or xs[0] != lo):
        xs.append(lo)
        ys.append(start)
    for a, b in zip(x, y):
        if lo < a < hi:
            xs.append(a)
            ys.append(b)
    if end is not None and hi > lo:
        xs.append(hi)
        ys.append(end)
    if len(xs) < 2:
        return "fewer than 2 points lie in the window"
    return xs, ys


def _integral(x: list[float], y: list[float]) -> float:
    return sum((x[i + 1] - x[i]) * (y[i] + y[i + 1]) / 2 for i in range(len(x) - 1))


def _interpolate(x: list[float], y: list[float], at: float) -> float | None:
    for i in range(len(x) - 1):
        if x[i] <= at <= x[i + 1]:
            span = x[i + 1] - x[i]
            return y[i] if span == 0 else y[i] + (y[i + 1] - y[i]) * (at - x[i]) / span
    return y[0] if len(x) == 1 and x[0] == at else None


def measure(spec: dict[str, Any], columns: list[str], rows: list[list[float]]) -> dict[str, Any]:
    entry: dict[str, Any] = {"id": spec["id"], "kind": spec["kind"]}
    if not rows:
        return {**entry, "status": "unknown", "reason": "the run has no series"}
    x = [row[0] for row in rows]
    kind = spec["kind"]
    if kind == "average-power":
        v = _column(columns, rows, spec["voltage"])
        i = _column(columns, rows, spec["current"])
        if v is None or i is None:
            return {**entry, "status": "unknown", "reason": "the voltage or current is not in the series"}
        p = [a * b for a, b in zip(v, i)]
        cut = _window(x, p, spec.get("window"))
        if isinstance(cut, str):
            return {**entry, "status": "unknown", "reason": cut}
        xs, ps = cut
        span = xs[-1] - xs[0]
        if span <= 0:
            return {**entry, "status": "unknown", "reason": "the window has no length"}
        value = _integral(xs, ps) / span
        return {**entry, "status": "ok", "value": value, "unit": "W", "window": [xs[0], xs[-1]],
                "peakInstantaneous": max(ps, key=abs), "convention": POWER_CONVENTION}
    y = _column(columns, rows, spec["vector"])
    if y is None:
        return {**entry, "status": "unknown", "reason": f"{spec['vector']} is not in the series"}
    unit = _unit(spec["vector"])
    if kind == "value-at":
        value = _interpolate(x, y, spec["at"].value)
        if value is None:
            return {**entry, "status": "unknown", "reason": "the point lies outside the series"}
        return {**entry, "status": "ok", "value": value, "unit": unit, "at": spec["at"].value}
    if kind == "final":
        # An operating point has one row and no sweep variable to name.
        return {**entry, "status": "ok", "value": y[-1], "unit": unit, **({"at": x[-1]} if len(rows) > 1 else {})}
    cut = _window(x, y, spec.get("window"))
    if isinstance(cut, str):
        return {**entry, "status": "unknown", "reason": cut}
    xs, ys = cut
    window = [xs[0], xs[-1]]
    span = xs[-1] - xs[0]
    if kind == "min":
        value = min(ys)
    elif kind == "max":
        value = max(ys)
    elif kind in ("peak-to-peak", "ripple"):
        value = max(ys) - min(ys)
    elif kind == "average":
        if span <= 0:
            return {**entry, "status": "unknown", "reason": "the window has no length"}
        value = _integral(xs, ys) / span
    elif kind == "rms":
        if span <= 0:
            return {**entry, "status": "unknown", "reason": "the window has no length"}
        value = math.sqrt(max(_integral(xs, [v * v for v in ys]) / span, 0.0))
    elif kind == "overshoot":
        step = ys[-1] - ys[0]
        if step == 0:
            return {**entry, "status": "unknown", "reason": "the vector does not step within the window"}
        peak = max(ys) if step > 0 else min(ys)
        value, unit = max((peak - ys[-1]) / step * 100, 0.0), "%"
    elif kind == "settling":
        band = spec["band"]
        final = ys[-1]
        width = abs(final) * band.value / 100 if band.unit == "%" else band.value
        outside = [index for index, b in enumerate(ys) if abs(b - final) > width]
        unit = "s"
        if not outside:
            value = xs[0]
        elif outside[-1] >= len(xs) - 2:
            return {**entry, "status": "unknown", "reason": "the vector does not settle within the band before the window ends"}
        else:
            # The first point after which the vector stays within the band.
            value = xs[outside[-1] + 1]
    else:
        return {**entry, "status": "unknown", "reason": "unknown measurement"}
    return {**entry, "status": "ok", "value": value, "unit": unit, "window": window}


def criteria(specs: list[dict[str, Any]], measured: dict[str, dict[str, Any]], evaluated: bool) -> list[dict[str, Any]]:
    out = []
    for spec in specs:
        entry = {"measurement": spec["measurement"], "op": spec["op"], "value": spec["value"].value,
                 "given": spec["value"].given}
        if not evaluated:
            out.append({**entry, "status": "not-evaluated"})
            continue
        result = measured.get(spec["measurement"], {})
        if result.get("status") != "ok":
            out.append({**entry, "status": "unknown", "reason": result.get("reason", "the measurement is unknown")})
            continue
        got, want = result["value"], spec["value"].value
        tolerance = spec["tolerance"].value if spec.get("tolerance") else abs(want) * 1e-9
        ok = got <= want + tolerance if spec["op"] == "<=" else got >= want - tolerance if spec["op"] == ">=" else abs(got - want) <= tolerance
        out.append({**entry, "status": "pass" if ok else "fail", "measured": got})
    return out
