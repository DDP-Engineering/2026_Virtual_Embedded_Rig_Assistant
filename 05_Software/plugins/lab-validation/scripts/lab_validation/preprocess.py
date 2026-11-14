"""Declared preprocessing (spec section 5): linear resampling and a moving average, never across a gap."""

from __future__ import annotations

import math
from typing import Any

from .errors import Refused
from .series import Series, build

POINT_LIMIT = 5_000_000


def resample(series: Series, rate: float, filtered_width: float, where: str) -> tuple[Series, dict[str, Any], list[str], list[str]]:
    """A uniform grid at `rate` from the first to the last sample; no point inside a gap; a point next to a clipped
    sample is clipped. Returns the series, its report, limiting diagnostics and notes."""
    t, v, c = series.t, series.v, series.clipped
    count = math.floor((t[-1] - t[0]) * rate + 1e-9) + 1
    if count > POINT_LIMIT:
        raise Refused("limit", f"{where}: {count} points exceed {POINT_LIMIT}; choose a lower rate.")
    new_t: list[float] = []
    new_v: list[float] = []
    new_c: list[bool] = []
    missing: set[int] = set()
    j = 0
    for k in range(count):
        at = t[0] + k / rate
        while j < len(t) - 2 and t[j + 1] <= at:
            j += 1
        if at <= t[j]:
            value, clip = v[j], c[j]
        elif at >= t[j + 1]:
            value, clip = v[j + 1], c[j + 1]
        elif j in series.gap_after:
            if new_t:
                missing.add(len(new_t) - 1)
            continue
        else:
            fraction = (at - t[j]) / (t[j + 1] - t[j])
            value, clip = v[j] + (v[j + 1] - v[j]) * fraction, c[j] or c[j + 1]
        new_t.append(at)
        new_v.append(value)
        new_c.append(clip)
    diagnostics: list[str] = []
    notes: list[str] = []
    original = series.rate or rate
    if rate < original * (1 - 1e-9) and filtered_width < 1 / rate * (1 - 1e-9):
        diagnostics.append("aliasing-risk")
    elif rate > original * (1 + 1e-9):
        notes.append("resampled-up")
    report = {"step": "resample", "method": "linear", "rate": rate, "fromRate": series.rate, "points": len(new_t),
              "note": "values interpolated linearly within gap-free intervals only"}
    return build(new_t, new_v, new_c, series.unit, True, missing), report, diagnostics, notes


def moving_average(series: Series, width: float, where: str) -> tuple[Series, dict[str, Any]]:
    """A centred moving average of the odd sample count nearest width x rate; outputs whose window is incomplete or
    holds a gap are dropped; a window holding a clipped sample makes its output clipped."""
    if not series.uniform or not series.rate:
        raise Refused("request", f"{where}: a moving-average needs uniform sampling; resample the signal first.")
    exact = width * series.rate
    n = 2 * math.floor((exact - 1) / 2 + 0.5) + 1  # the odd count nearest width x rate, ties upwards
    if n < 3:
        raise Refused("request", f"{where}: the width spans {exact:.3g} samples; a moving-average needs at least 3.")
    half = (n - 1) // 2
    size = len(series.t)
    gaps_before = [0] * (size + 1)  # gaps_before[m]: gap intervals among (0, 1) ... (m - 2, m - 1)
    clips_before = [0] * (size + 1)
    for i in range(size):
        gaps_before[i + 1] = gaps_before[i] + (1 if (i - 1) in series.gap_after else 0)
        clips_before[i + 1] = clips_before[i] + (1 if series.clipped[i] else 0)
    new_t: list[float] = []
    new_v: list[float] = []
    new_c: list[bool] = []
    missing: set[int] = set()
    running = None
    since = 0
    for i in range(half, size - half):
        lo, hi = i - half, i + half
        # The intervals inside [lo, hi] are (lo, lo+1) ... (hi-1, hi): gap_after indices lo .. hi-1.
        if gaps_before[hi + 1] - gaps_before[lo + 1] > 0:
            running = None
            if new_t:
                missing.add(len(new_t) - 1)
            continue
        if running is None or since >= 1024:
            running = math.fsum(series.v[lo : hi + 1])
            since = 0
        else:
            running += series.v[hi] - series.v[lo - 1]
            since += 1
        new_t.append(series.t[i])
        new_v.append(running / n)
        new_c.append(clips_before[hi + 1] - clips_before[lo] > 0)
    if len(new_t) < 2:
        raise Refused("request", f"{where}: the moving-average leaves fewer than two samples.")
    effective = n / series.rate
    report = {"step": "filter", "kind": "moving-average", "width": width, "samples": n, "effectiveWidth": effective,
              "firstNull": 1 / effective, "cutoff3dB": 0.443 / effective, "riseTime1090": 0.8 * effective,
              "note": f"centred mean of {n} samples; {half} samples dropped at each end and around gaps"}
    return build(new_t, new_v, new_c, series.unit, True, missing), report
