"""Comparisons (spec section 6): the reference shifted by a declared alignment, e(t) = m(t) - r(t - L).

The lag L is itself a value (`<comparison>.lag`) that criteria judge, so an alignment never hides a delay that a
requirement limits. Instrument clocks are never assumed synchronized: `none` keeps each source's own time zero.
"""

from __future__ import annotations

import bisect
import math
import operator
from dataclasses import dataclass, field
from typing import Any

from . import metrics
from .errors import Refused
from .series import Series, crossing, value_at

WORK_LIMIT = 10_000_000


@dataclass
class Comparison:
    spec: dict[str, Any]
    lag: float | None = None
    status: str = "ok"
    reason: str | None = None
    alignment: dict[str, Any] = field(default_factory=dict)
    statistics: dict[str, float | None] = field(default_factory=dict)
    coverage: float | None = None
    diagnostics: list[str] = field(default_factory=list)  # limiting
    notes: list[str] = field(default_factory=list)
    excluded: float = 0.0
    rows: list[tuple[float, float, float | None, float | None]] = field(default_factory=list)


def marker_time(series: Series, marker: dict[str, Any]) -> tuple[float | None, float | None]:
    """The first crossing of the marker's level in its direction after `after`, over the whole signal."""
    level = marker["levelValue"]
    if marker["levelPercent"]:
        found = metrics.derive(series.v)
        if found is None:
            return None, None
        level = found["low"] + marker["levelValue"] / 100 * (found["high"] - found["low"])
    after = marker.get("afterValue", -math.inf)
    rising = marker.get("edge", "rising") == "rising"
    t, v = series.t, series.v
    for k in range(len(t) - 1):
        if t[k + 1] < after or k in series.gap_after:
            continue
        hit = v[k] < level <= v[k + 1] if rising else v[k] > level >= v[k + 1]
        if hit:
            at = crossing(t[k], v[k], t[k + 1], v[k + 1], level)
            if at >= after:
                return at, level
    return None, level


def _xcorr(measured: Series, reference: Series, a: float, b: float, max_lag: float, where: str) -> dict[str, Any] | None:
    step = measured.step
    assert step is not None
    lo, hi = bisect.bisect_left(measured.t, a), bisect.bisect_right(measured.t, b)
    times, xs = measured.t[lo:hi], measured.v[lo:hi]
    count = len(times)
    if count < 3:
        return None
    k_max = math.floor(max_lag / step + 1e-9)
    if count * (2 * k_max + 1) > WORK_LIMIT:
        raise Refused("limit", f"{where}: {count} samples x {2 * k_max + 1} lags exceed {WORK_LIMIT}; shorten the window or maxLag, or resample.")
    origin = times[0]
    slots = [round((time - origin) / step) for time in times]
    # Lag k needs the reference at grid index slot + (k_max - k), i.e. within [slot, slot + 2 k_max]: evaluate only
    # those indices (merged intervals), at most count x (2 k_max + 1), however long the gaps between samples are.
    needed: dict[int, float | None] = {}
    start, end = slots[0], slots[0] + 2 * k_max
    intervals = []
    for slot in slots[1:]:
        if slot <= end + 1:
            end = slot + 2 * k_max
        else:
            intervals.append((start, end))
            start, end = slot, slot + 2 * k_max
    intervals.append((start, end))
    for first, last in intervals:
        for j in range(first, last + 1):
            item = value_at(reference, origin + (j - k_max) * step)
            needed[j] = None if item is None else item[0]
    mean_x = math.fsum(xs) / count
    centred = [x - mean_x for x in xs]
    sxx = sum(map(operator.mul, centred, centred))
    contiguous = slots[-1] == count - 1
    ref = [needed[j] for j in range(count + 2 * k_max)] if contiguous else []
    scores: list[float | None] = []
    for k in range(-k_max, k_max + 1):
        offset = k_max - k
        ys = ref[offset : offset + count] if contiguous else [needed[slot + offset] for slot in slots]
        if None in ys:
            pairs = [(x, y) for x, y in zip(xs, ys) if y is not None]
            if len(pairs) < count / 2:
                scores.append(None)
                continue
            px = [x for x, _ in pairs]
            py = [y for _, y in pairs]
            scores.append(_pearson(px, py))
            continue
        mean_y = math.fsum(ys) / count  # type: ignore[arg-type]
        dy = [y - mean_y for y in ys]  # type: ignore[operator]
        syy = sum(map(operator.mul, dy, dy))
        sxy = sum(map(operator.mul, centred, dy))
        scores.append(max(-1.0, min(1.0, sxy / math.sqrt(sxx * syy))) if sxx > 0 and syy > 0 else None)
    valid = [(score, index) for index, score in enumerate(scores) if score is not None]
    if not valid:
        return None
    best_score = max(score for score, _ in valid)
    best = min((abs(index - k_max), index) for score, index in valid if score == best_score)[1]
    delta = 0.0
    if 0 < best < len(scores) - 1 and scores[best - 1] is not None and scores[best + 1] is not None:
        left, centre, right = scores[best - 1], scores[best], scores[best + 1]
        curvature = left - 2 * centre + right  # type: ignore[operator]
        if curvature < 0:
            delta = max(-0.5, min(0.5, 0.5 * (left - right) / curvature))  # type: ignore[operator]
    k = best - k_max
    return {"lag": (k + delta) * step, "correlation": best_score, "atLimit": abs(k) == k_max, "lags": 2 * k_max + 1,
            "grid": step}


def _pearson(xs: list[float], ys: list[float]) -> float | None:
    n = len(xs)
    mx, my = math.fsum(xs) / n, math.fsum(ys) / n
    sxx = math.fsum((x - mx) ** 2 for x in xs)
    syy = math.fsum((y - my) ** 2 for y in ys)
    sxy = math.fsum((x - mx) * (y - my) for x, y in zip(xs, ys))
    return max(-1.0, min(1.0, sxy / math.sqrt(sxx * syy))) if sxx > 0 and syy > 0 else None


def compare(spec: dict[str, Any], measured: Any, reference: Any, missing: str, where: str) -> Comparison:
    """`measured` and `reference` are signals.Signal; the window lies on the measured signal's time axis."""
    out = Comparison(spec)
    m, r = measured.series, reference.series
    a, b = spec["a"], spec["b"]
    alignment = spec["alignment"]
    method = alignment["method"]
    out.alignment = {"method": method}
    if method == "none":
        out.lag = 0.0
        out.alignment["note"] = "each source keeps its own time zero; the clocks are not assumed synchronized"
    elif method == "offset":
        out.lag = alignment["lag"]
        out.alignment["offset"] = alignment["offset"]
    elif method == "marker":
        sides = {}
        for side in ("measured", "reference"):
            marker = alignment[side]
            series = (measured if side == "measured" else reference).series
            # bind() checked that the marker signal shares the source; use that signal's own series.
            series = marker.get("series", series)
            at, level = marker_time(series, marker)
            sides[side] = {"signal": marker["signal"], "level": marker["level"], "levelValue": level,
                           "edge": marker.get("edge", "rising"), "time": at}
        out.alignment.update(sides)
        if sides["measured"]["time"] is None or sides["reference"]["time"] is None:
            out.status, out.reason = "unknown", "a marker was not found"
            return out
        out.lag = sides["measured"]["time"] - sides["reference"]["time"]
    else:
        found = _xcorr(m, r, a, b, alignment["maxLagValue"], where)
        out.alignment["maxLag"] = alignment["maxLag"]
        if found is None:
            out.status, out.reason = "unknown", "the correlation could not be computed (too few overlapping samples)"
            return out
        out.lag = found["lag"]
        out.alignment.update({"correlation": found["correlation"], "lags": found["lags"], "grid": found["grid"]})
        out.statistics["correlation"] = found["correlation"]
        if found["atLimit"]:
            out.diagnostics.append("lag-at-limit")
    out.alignment["lag"] = out.lag
    lag = out.lag
    lo, hi = bisect.bisect_left(m.t, a), bisect.bisect_right(m.t, b)
    if hi - lo < 2:
        out.status, out.reason = "unknown", "fewer than two measured samples in the window"
        return out
    errors: list[tuple[float, float]] = []
    included = 0
    broken: set[int] = set()  # error index k: interval (k, k+1) must not be integrated
    clipped = False
    for i in range(lo, hi):
        time = m.t[i]
        found_ref = value_at(r, time - lag)
        if m.clipped[i]:
            clipped = True
        if found_ref is None:
            out.rows.append((time, m.v[i], None, None))
            if errors:
                broken.add(len(errors) - 1)
            continue
        if found_ref[1]:
            clipped = True
        if errors and (i - 1) in m.gap_after:
            broken.add(len(errors) - 1)
        difference = m.v[i] - found_ref[0]
        errors.append((time, difference))
        included += 1
        out.rows.append((time, m.v[i], found_ref[0], difference))
    out.coverage = included / (hi - lo)
    if not errors:
        out.status, out.reason = "unknown", "the reference does not cover the window after the alignment"
        return out
    if out.coverage < 1:
        out.diagnostics.append("reference-short")
    if clipped:
        out.diagnostics.append("clipped")
    gap_time = sum(max(0.0, min(end, b) - max(start, a)) for start, end in m.gaps)
    gap_time += sum(max(0.0, min(end, b - lag) - max(start, a - lag)) for start, end in r.gaps)
    if gap_time > 0:
        out.excluded = gap_time
        if missing == "exclude":
            out.notes.append("gap")
        else:
            out.diagnostics.append("gap")
    pieces, spans, squares = [], [], []
    for k in range(len(errors) - 1):
        if k in broken:
            continue
        (t0, e0), (t1, e1) = errors[k], errors[k + 1]
        dt = t1 - t0
        pieces.append(0.5 * (e0 + e1) * dt)
        squares.append(0.5 * (e0 * e0 + e1 * e1) * dt)
        spans.append(dt)
    covered = math.fsum(spans)
    out.statistics["max-abs"] = max(abs(e) for _, e in errors)
    out.statistics["mean"] = math.fsum(pieces) / covered if covered > 0 else None
    out.statistics["rms"] = math.sqrt(math.fsum(squares) / covered) if covered > 0 else None
    out.statistics["lag"] = lag
    for code in measured.diagnostics + reference.diagnostics:
        if code not in out.diagnostics:
            out.diagnostics.append(code)
    return out
