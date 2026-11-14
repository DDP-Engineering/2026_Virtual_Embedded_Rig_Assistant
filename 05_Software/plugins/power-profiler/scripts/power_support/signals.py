"""Corrected current, voltage and power of a capture as series of the lab-validation engine (spec REQ-DATA-dd3e4fe1
section 7). `series.py` is a byte-identical copy of lab_validation/series.py: one numeric core, never a second one.

Missing samples are removed and kept as gaps (`series.build`), never interpolated across and never zero.
"""

from __future__ import annotations

import bisect
import math
import statistics
from dataclasses import dataclass
from typing import Any

from .capfile import Capture
from .errors import Refused
from .series import Series, Window, build, integrate, window

RELATIVE = 1e-9


@dataclass
class Signals:
    capture: Capture
    sign: int
    offset: float
    current: list[float | None]  # corrected, per row
    power: list[float | None]
    energy_source: str
    series_i: Series
    series_p: Series | None
    series_v: Series | None
    over_i: list[bool]
    over_v: list[bool]
    gap_rows: set[int]  # row k: the interval (t[k], t[k+1]) has no data for current
    _prefix: tuple[list[int], list[int]] | None = None

    def rows(self, a: float, b: float) -> tuple[int, int]:
        """Row indexes [i0, i1) with a <= t <= b (bisect: per-event lookups never rescan the capture)."""
        return bisect.bisect_left(self.capture.t, a), bisect.bisect_right(self.capture.t, b)

    def overflow_in(self, a: float, b: float) -> dict[str, int]:
        if self._prefix is None:
            pi, pv = [0], [0]
            for i, v in zip(self.over_i, self.over_v):
                pi.append(pi[-1] + i)
                pv.append(pv[-1] + v)
            self._prefix = (pi, pv)
        i0, i1 = self.rows(a, b)
        pi, pv = self._prefix
        return {"current": pi[i1] - pi[i0], "voltage": pv[i1] - pv[i0]}

    def peak(self, a: float, b: float) -> float | None:
        i0, i1 = self.rows(a, b)
        return max((value for value in self.current[i0:i1] if value is not None), default=None)


def _series(t: list[float], values: list[float | None], clipped: list[bool], unit: str, uniform: bool) -> Series | None:
    kept_t: list[float] = []
    kept_v: list[float] = []
    kept_c: list[bool] = []
    missing: set[int] = set()
    for time, value, clip in zip(t, values, clipped):
        if value is None:
            if kept_t:
                missing.add(len(kept_t) - 1)
            continue
        kept_t.append(time)
        kept_v.append(value)
        kept_c.append(clip)
    if len(kept_t) < 2:
        return None
    return build(kept_t, kept_v, kept_c, unit, uniform, missing)


def prepare(capture: Capture, sign: int, offset: float) -> Signals:
    if sign not in (1, -1):
        raise Refused("request", "--sign is 1 or -1.")
    if not math.isfinite(offset) or abs(offset) > 10:
        raise Refused("request", "--current-offset is a finite current in A (at most 10 A).")
    over_i = ["i" in flag for flag in capture.flags]
    over_v = ["v" in flag for flag in capture.flags]
    current = [None if value is None else sign * value - offset for value in capture.current]
    corrected = sign != 1 or offset != 0
    if capture.power is not None and not corrected:
        power, source = list(capture.power), "meter-power"
    elif capture.voltage is not None:
        power = [None if i is None or v is None else v * i for i, v in zip(current, capture.voltage)]
        source = "v*i"
    else:
        power, source = [None] * len(current), "none"
    series_i = _series(capture.t, current, over_i, "A", capture.uniform)
    if series_i is None:
        raise Refused("source", "The capture holds fewer than two current samples.")
    clipped_p = [a or b for a, b in zip(over_i, over_v)]
    series_p = _series(capture.t, power, clipped_p, "W", capture.uniform) if source != "none" else None
    series_v = _series(capture.t, capture.voltage, over_v, "V", capture.uniform) if capture.voltage is not None else None
    gap_rows = gaps(capture.t, current, capture.uniform)
    return Signals(capture, sign, offset, current, power, source, series_i, series_p, series_v, over_i, over_v, gap_rows)


def gaps(t: list[float], values: list[float | None], uniform: bool) -> set[int]:
    """Row intervals without data, by the series rule: a missing end sample, or on a uniform capture a step longer
    than 1.5 x the median step."""
    steps = [t[k + 1] - t[k] for k in range(len(t) - 1)]
    median = statistics.median(steps) if steps else 0.0
    found: set[int] = set()
    for k, step in enumerate(steps):
        if values[k] is None or values[k + 1] is None or (uniform and step > 1.5 * median):
            found.add(k)
    return found


def span(series: Series, a: float, b: float) -> Window | None:
    """The series window over [a, b] clamped to the series' own first and last sample."""
    lo, hi = max(a, series.t[0]), min(b, series.t[-1])
    if not hi > lo:
        return None
    return window(series, lo, hi)


def integral(series: Series | None, a: float, b: float) -> dict[str, Any]:
    """The trapezoid integral over [a, b] and how much of the window it covers. `value` is null when any part of the
    window has no data: a gap is never counted as zero (REQ-REL-d02aa9e4)."""
    length = b - a
    win = span(series, a, b) if series is not None else None
    if win is None:
        return {"value": None, "covered": None, "coveredSeconds": 0.0, "gapSeconds": length}
    area, covered = integrate(win)
    gap = max(0.0, length - covered)
    complete = not win.breaks and gap <= RELATIVE * max(length, 1e-300) + series.tolerance()
    return {"value": area if complete else None, "covered": area, "coveredSeconds": covered,
            "gapSeconds": 0.0 if complete else gap}


def stats(series: Series | None, a: float, b: float) -> dict[str, Any] | None:
    win = span(series, a, b) if series is not None else None
    if win is None:
        return None
    area, covered = integrate(win)
    return {"mean": area / covered if covered > 0 else None, "min": min(win.v), "max": max(win.v),
            "bound": any(win.clipped)}
