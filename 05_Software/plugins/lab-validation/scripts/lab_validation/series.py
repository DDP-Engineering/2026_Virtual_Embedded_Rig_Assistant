"""A normalized series: time in seconds, values in V, A or W, clipped samples and gaps (spec sections 3 and 4).

A gap is an interval between two kept samples with no data: a missing sample, or on a uniform series a step longer
than 1.5 x the median step. Nothing is ever interpolated across a gap.
"""

from __future__ import annotations

import bisect
import math
import statistics
from dataclasses import dataclass, field


@dataclass
class Series:
    t: list[float]
    v: list[float]
    clipped: list[bool]
    unit: str
    uniform: bool
    gap_after: set[int] = field(default_factory=set)  # i: the interval (t[i], t[i+1]) is a gap
    rate: float | None = None  # 1 / median step

    @property
    def gaps(self) -> list[tuple[float, float]]:
        return [(self.t[i], self.t[i + 1]) for i in sorted(self.gap_after)]

    @property
    def step(self) -> float | None:
        return 1.0 / self.rate if self.rate else None

    def tolerance(self) -> float:
        """How far a window edge may lie outside the first or last sample and still mean that sample."""
        return 1e-6 * (self.step or 0.0) + 1e-15 * max(abs(self.t[0]), abs(self.t[-1]), 1e-300) if self.t else 0.0


def build(t: list[float], v: list[float], clipped: list[bool], unit: str, uniform: bool, missing_after: set[int]) -> Series:
    """A series from kept samples; `missing_after` holds i where samples were removed between i and i + 1."""
    series = Series(t, v, clipped, unit, uniform)
    steps = [t[i + 1] - t[i] for i in range(len(t) - 1)]
    median = statistics.median(steps) if steps else 0.0
    series.rate = 1.0 / median if median > 0 else None
    for i, step in enumerate(steps):
        if i in missing_after or (uniform and step > 1.5 * median):
            series.gap_after.add(i)
    return series


@dataclass
class Window:
    """The points of a series in [a, b]: its samples, plus the edges interpolated from neighbours outside a gap."""

    a: float
    b: float
    t: list[float]
    v: list[float]
    clipped: list[bool]
    breaks: set[int]  # k: the interval between point k and k + 1 is a gap
    gap_time: float  # length of the gaps inside [a, b]
    samples: int  # real samples inside the window

    def segments(self) -> list[tuple[int, int]]:
        """Index ranges [start, end] of the gap-free runs of points."""
        out, start = [], 0
        for k in sorted(self.breaks):
            out.append((start, k))
            start = k + 1
        out.append((start, len(self.t) - 1))
        return [(s, e) for s, e in out if e >= s]


def window(series: Series, a: float, b: float) -> Window | None:
    """The window, or None when it reaches outside the series."""
    t = series.t
    if len(t) < 2:
        return None
    tol = series.tolerance()
    if a < t[0] - tol or b > t[-1] + tol or b <= a:
        return None
    a, b = max(a, t[0]), min(b, t[-1])
    i0 = bisect.bisect_left(t, a)
    i1 = bisect.bisect_right(t, b)  # samples i0 .. i1 - 1 lie in [a, b]
    pts_t: list[float] = []
    pts_v: list[float] = []
    pts_c: list[bool] = []
    breaks: set[int] = set()
    if i0 > 0 and t[i0] > a and (i0 - 1) not in series.gap_after:
        value, clip = _between(series, i0 - 1, a)
        pts_t.append(a)
        pts_v.append(value)
        pts_c.append(clip)
    for i in range(i0, i1):
        if pts_t and i > i0 and (i - 1) in series.gap_after:
            breaks.add(len(pts_t) - 1)
        pts_t.append(t[i])
        pts_v.append(series.v[i])
        pts_c.append(series.clipped[i])
    if i1 < len(t) and t[i1 - 1] < b and (i1 - 1) not in series.gap_after and i1 - 1 >= 0:
        value, clip = _between(series, i1 - 1, b)
        pts_t.append(b)
        pts_v.append(value)
        pts_c.append(clip)
    gap_time = 0.0
    for start, end in series.gaps:
        overlap = min(end, b) - max(start, a)
        if overlap > 0:
            gap_time += overlap
    if len(pts_t) < 2:
        return None
    return Window(a, b, pts_t, pts_v, pts_c, breaks, gap_time, i1 - i0)


def _between(series: Series, i: int, at: float) -> tuple[float, bool]:
    t0, t1 = series.t[i], series.t[i + 1]
    v0, v1 = series.v[i], series.v[i + 1]
    fraction = (at - t0) / (t1 - t0)
    return v0 + (v1 - v0) * fraction, series.clipped[i] or series.clipped[i + 1]


def value_at(series: Series, at: float) -> tuple[float, bool] | None:
    """Linear interpolation at a time; None outside the series or inside a gap."""
    t = series.t
    if not t or at < t[0] - series.tolerance() or at > t[-1] + series.tolerance():
        return None
    i = bisect.bisect_right(t, at) - 1
    if i < 0:
        return series.v[0], series.clipped[0]
    if i >= len(t) - 1:
        return series.v[-1], series.clipped[-1]
    if t[i] == at:
        return series.v[i], series.clipped[i]
    if i in series.gap_after:
        return None
    return _between(series, i, at)


def integrate(win: Window, square: bool = False) -> tuple[float, float]:
    """Trapezoid integral of v (or v^2) over the gap-free intervals, and the time they cover."""
    pieces: list[float] = []
    spans: list[float] = []
    for k in range(len(win.t) - 1):
        if k in win.breaks:
            continue
        dt = win.t[k + 1] - win.t[k]
        left, right = win.v[k], win.v[k + 1]
        if square:
            left, right = left * left, right * right
        pieces.append(0.5 * (left + right) * dt)
        spans.append(dt)
    return math.fsum(pieces), math.fsum(spans)


def crossing(t0: float, v0: float, t1: float, v1: float, level: float) -> float:
    """The time a straight line from (t0, v0) to (t1, v1) reaches `level`."""
    if v1 == v0:
        return t0
    return t0 + (level - v0) * (t1 - t0) / (v1 - v0)
