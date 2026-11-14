"""Metrics, a registry (spec section 4). Every measurement runs over its declared window on the signal's own time axis.

A metric declares its unit, whether it is an amplitude statistic or an event metric (edges, levels), its request
fields and the definition printed in --help and in every result. Later plans add metrics with `register`.
"""

from __future__ import annotations

import math
import statistics
from dataclasses import dataclass, field
from typing import Any, Callable

from .series import Series, Window, crossing, integrate, window

LEVELS = "derived: the medians of the window's samples below and at or above its midpoint (min + max) / 2"


@dataclass
class Job:
    series: Series
    win: Window
    params: dict[str, Any]  # bound values: levels (low, high), percent, band, final, from, edge, reference...
    bandwidth: float | None  # Hz of the signal's source; math.inf = unlimited; None = unknown
    filter_rise: float  # 10-90 % time of the signal's own filtering, s
    reference: Series | None = None
    reference_win: Window | None = None


@dataclass
class Outcome:
    value: float | None
    status: str = "ok"  # ok | bound | unknown
    reason: str | None = None
    levels: dict[str, Any] | None = None
    details: dict[str, Any] = field(default_factory=dict)
    diagnostics: list[str] = field(default_factory=list)  # limiting codes found by the metric itself


@dataclass(frozen=True)
class Metric:
    name: str
    unit: Callable[[str], str]
    kind: str  # amplitude | event
    fields: dict[str, str]
    required: frozenset[str]
    definition: str
    compute: Callable[[Job], Outcome]


REGISTRY: dict[str, Metric] = {}


def register(name: str, unit: Callable[[str], str], kind: str, definition: str, fields: dict[str, str] | None = None,
             required: tuple[str, ...] = ()) -> Callable[[Callable[[Job], Outcome]], Callable[[Job], Outcome]]:
    def wrap(function: Callable[[Job], Outcome]) -> Callable[[Job], Outcome]:
        REGISTRY[name] = Metric(name, unit, kind, dict(fields or {}), frozenset(required), definition, function)
        return function

    return wrap


SAME = lambda unit: unit  # noqa: E731 - the signal's own unit
SECONDS = lambda _unit: "s"  # noqa: E731
HERTZ = lambda _unit: "Hz"  # noqa: E731
PERCENT = lambda _unit: "%"  # noqa: E731
LEVEL_FIELDS = {"levels": "levels"}


# ---- Levels and edges ----


def levels(job: Job, values: list[float] | None = None, declared: tuple[float, float] | None = None,
           own: bool = True) -> dict[str, Any] | None:
    """Declared levels, else derived from `values` (default: the window). `own=False` is another signal (a delay's
    reference): it never takes the measured signal's declared levels."""
    if declared is None and own:
        declared = job.params.get("levels")
    if declared is not None:
        return {"low": declared[0], "high": declared[1], "source": "declared"}
    return derive(values if values is not None else job.win.v)


def derive(values: list[float]) -> dict[str, Any] | None:
    if not values:
        return None
    lo, hi = min(values), max(values)
    if not hi > lo:
        return None
    mid = (lo + hi) / 2
    below = [v for v in values if v < mid]
    above = [v for v in values if v >= mid]
    if not below or not above:
        return None
    low, high = statistics.median(below), statistics.median(above)
    if not high > low:
        return None
    return {"low": low, "high": high, "source": LEVELS}


def edges(win: Window, low: float, high: float) -> list[tuple[float, str]]:
    """Edges by a state machine with hysteresis: high at 75 %, low at 25 % of (high - low) above low; the edge time
    is the last 50 % crossing before the switch, interpolated linearly, never across a gap."""
    amplitude = high - low
    upper, lower, mid = low + 0.75 * amplitude, low + 0.25 * amplitude, low + 0.5 * amplitude
    state: str | None = None
    last_up: float | None = None
    last_down: float | None = None
    found: list[tuple[float, str]] = []
    t, v = win.t, win.v
    for k in range(len(t)):
        if k > 0:
            if (k - 1) in win.breaks:
                last_up = last_down = None
            else:
                if v[k - 1] < mid <= v[k]:
                    last_up = crossing(t[k - 1], v[k - 1], t[k], v[k], mid)
                if v[k - 1] > mid >= v[k]:
                    last_down = crossing(t[k - 1], v[k - 1], t[k], v[k], mid)
        if v[k] >= upper:
            if state == "low" and last_up is not None:
                found.append((last_up, "rise"))
            state = "high"
        elif v[k] <= lower:
            if state == "high" and last_down is not None:
                found.append((last_down, "fall"))
            state = "low"
    return found


def _no_levels() -> Outcome:
    return Outcome(None, "unknown", "the window holds no two distinct states (declare levels {low, high})")


def _aliasing(job: Job, frequency: float, outcome: Outcome) -> None:
    rate = job.series.rate
    if rate and rate / frequency < 4:
        outcome.diagnostics.append("aliasing-suspect")
        outcome.details["samplesPerPeriod"] = rate / frequency


# ---- Amplitude statistics ----


@register("min", SAME, "amplitude", "the smallest value in the window (samples and the edges interpolated linearly)")
def _min(job: Job) -> Outcome:
    return Outcome(min(job.win.v))


@register("max", SAME, "amplitude", "the largest value in the window (samples and the edges interpolated linearly)")
def _max(job: Job) -> Outcome:
    return Outcome(max(job.win.v))


@register("mean", SAME, "amplitude", "(1/T) integral of v dt over the window, trapezoid rule, T the time with data")
def _mean(job: Job) -> Outcome:
    area, covered = integrate(job.win)
    if covered <= 0:
        return Outcome(None, "unknown", "the window holds no interval with data")
    return Outcome(area / covered)


@register("rms", SAME, "amplitude", "sqrt((1/T) integral of v^2 dt) over the window, trapezoid rule on v^2, T the time with data")
def _rms(job: Job) -> Outcome:
    area, covered = integrate(job.win, square=True)
    if covered <= 0:
        return Outcome(None, "unknown", "the window holds no interval with data")
    return Outcome(math.sqrt(area / covered))


@register("peak-to-peak", SAME, "amplitude", "max - min over the window")
def _p2p(job: Job) -> Outcome:
    return Outcome(max(job.win.v) - min(job.win.v))


@register("ripple", SAME, "amplitude", "max - min over the window, which the request declares as steady state (no detrending)")
def _ripple(job: Job) -> Outcome:
    return Outcome(max(job.win.v) - min(job.win.v), details={"steadyState": "the declared window"})


# ---- Event metrics ----


@register("frequency", HERTZ, "event", "(n - 1) / (t_n - t_1) over the n >= 2 rising edges in the window; edges at the 50 % level "
          "with hysteresis at 25 % and 75 % of the levels", LEVEL_FIELDS)
def _frequency(job: Job) -> Outcome:
    found = levels(job)
    if found is None:
        return _no_levels()
    rises = [t for t, kind in edges(job.win, found["low"], found["high"]) if kind == "rise"]
    if len(rises) < 2:
        return Outcome(None, "unknown", "fewer than two rising edges in the window", found)
    value = (len(rises) - 1) / (rises[-1] - rises[0])
    outcome = Outcome(value, levels=found, details={"edges": len(rises)})
    _aliasing(job, value, outcome)
    return outcome


@register("duty-cycle", PERCENT, "event", "mean over the full periods in the window of (falling edge - rising edge) / period x 100",
          LEVEL_FIELDS)
def _duty(job: Job) -> Outcome:
    found = levels(job)
    if found is None:
        return _no_levels()
    all_edges = edges(job.win, found["low"], found["high"])
    rises = [t for t, kind in all_edges if kind == "rise"]
    falls = [t for t, kind in all_edges if kind == "fall"]
    duties = []
    for start, end in zip(rises, rises[1:]):
        fall = next((t for t in falls if start < t < end), None)
        if fall is not None:
            duties.append((fall - start) / (end - start))
    if not duties:
        return Outcome(None, "unknown", "no full period with a falling edge in the window", found)
    value = 100 * math.fsum(duties) / len(duties)
    outcome = Outcome(value, levels=found, details={"periods": len(duties)})
    _aliasing(job, (len(rises) - 1) / (rises[-1] - rises[0]), outcome)
    return outcome


def _transition(job: Job, falling: bool) -> Outcome:
    found = levels(job)
    if found is None:
        return _no_levels()
    low, high = found["low"], found["high"]
    values = job.win.v
    if falling:
        values = [-v for v in values]
        low, high = -high, -low
    lower, upper = job.params.get("percent", (10.0, 90.0))
    p_lo, p_hi = low + lower / 100 * (high - low), low + upper / 100 * (high - low)
    t = job.win.t
    t_lo: float | None = None
    for k in range(len(t) - 1):
        if k in job.win.breaks:
            t_lo = None
            continue
        v0, v1 = values[k], values[k + 1]
        if v0 < p_lo <= v1:
            t_lo = crossing(t[k], v0, t[k + 1], v1, p_lo)
        elif v1 < p_lo:
            t_lo = None
        if t_lo is not None and v0 < p_hi <= v1:
            t_hi = crossing(t[k], v0, t[k + 1], v1, p_hi)
            value = t_hi - t_lo
            outcome = Outcome(value, levels=found, details={"from": t_lo, "to": t_hi, "percent": [lower, upper]})
            inside = sum(1 for time in t if t_lo < time < t_hi)
            outcome.details["samplesInside"] = inside
            if inside < 3:
                outcome.diagnostics.append("under-sampled")
            if job.bandwidth is None:
                outcome.diagnostics.append("bandwidth-unknown")
            else:
                bandwidth_rise = 0.0 if math.isinf(job.bandwidth) else 0.35 / job.bandwidth
                system = math.sqrt(bandwidth_rise**2 + job.filter_rise**2)
                outcome.details["systemRiseTime"] = system
                if value < 3 * system:
                    outcome.diagnostics.append("bandwidth-limited")
            return outcome
    kind = "falling" if falling else "rising"
    return Outcome(None, "unknown", f"no {kind} transition from {lower:g} % to {upper:g} % in the window", found)


TRANSITION_FIELDS = {"levels": "levels", "percent": "percent"}


@register("rise-time", SECONDS, "event", "the first transition in the window from the lower to the upper percent level of (high - low) "
          "(default 10 % to 90 %, or 20 % to 80 %), crossings interpolated linearly", TRANSITION_FIELDS)
def _rise(job: Job) -> Outcome:
    return _transition(job, falling=False)


@register("fall-time", SECONDS, "event", "the first transition in the window from the upper to the lower percent level of (high - low) "
          "(default 90 % to 10 %, or 80 % to 20 %), crossings interpolated linearly", TRANSITION_FIELDS)
def _fall(job: Job) -> Outcome:
    return _transition(job, falling=True)


@register("overshoot", PERCENT, "event", "(max after the first rising edge - high) / (high - low) x 100; negative when the signal "
          "stays below high", LEVEL_FIELDS)
def _overshoot(job: Job) -> Outcome:
    found = levels(job)
    if found is None:
        return _no_levels()
    rises = [t for t, kind in edges(job.win, found["low"], found["high"]) if kind == "rise"]
    if not rises:
        return Outcome(None, "unknown", "no rising edge in the window", found)
    peak = max(v for t, v in zip(job.win.t, job.win.v) if t >= rises[0])
    value = (peak - found["high"]) / (found["high"] - found["low"]) * 100
    return Outcome(value, levels=found, details={"edge": rises[0], "peak": peak})


@register("settling-time", SECONDS, "event", "from the first edge's 50 % crossing (or `from`) to the last return into final +- band; "
          "`bound` (a lower bound) when the signal is still outside the band at the window end",
          {"levels": "levels", "band": "band", "final": "level", "from": "time"}, ("band",))
def _settling(job: Job) -> Outcome:
    params = job.params
    band_value, band_percent = params["band"]
    needs_levels = band_percent or "final" not in params or "from" not in params
    found = levels(job) if needs_levels else None
    if needs_levels and found is None:
        return _no_levels()
    start = params.get("from")
    final = params.get("final")
    if start is None or final is None:
        assert found is not None
        all_edges = edges(job.win, found["low"], found["high"])
        if not all_edges:
            return Outcome(None, "unknown", "no edge in the window to start from (declare from)", found)
        if start is None:
            start = all_edges[0][0]
        if final is None:
            final = found["high"] if all_edges[0][1] == "rise" else found["low"]
    band = band_value / 100 * abs(found["high"] - found["low"]) if band_percent and found else band_value
    t, v = job.win.t, job.win.v
    indices = [k for k in range(len(t)) if t[k] >= start]
    details = {"from": start, "final": final, "band": band}
    if not indices:
        return Outcome(None, "unknown", "the start lies after the window", found, details)
    last_out = None
    for k in indices:
        if abs(v[k] - final) > band:
            last_out = k
    if last_out is None:
        return Outcome(0.0, levels=found, details=details)
    if last_out == len(t) - 1:
        return Outcome(job.win.b - start, "bound", "the signal is still outside the band at the window end; the value is a lower bound",
                       found, details)
    v0, v1 = v[last_out], v[last_out + 1]
    target = final + band if v0 > final else final - band
    entered = crossing(t[last_out], v0, t[last_out + 1], v1, target)
    return Outcome(entered - start, levels=found, details=details)


@register("delay", SECONDS, "event", "the signal's first `edge` time minus the `reference` signal's first `referenceEdge` time, each "
          "at its own 50 % level (signals of one source, one clock)",
          {"reference": "signal", "levels": "levels", "referenceLevels": "levels", "edge": "edge", "referenceEdge": "edge"}, ("reference",))
def _delay(job: Job) -> Outcome:
    if job.reference_win is None:
        return Outcome(None, "unknown", "the window lies outside the reference signal")
    own = levels(job)
    other = levels(job, job.reference_win.v, job.params.get("referenceLevels"), own=False)
    if own is None or other is None:
        return _no_levels()
    kind = "rise" if job.params.get("edge", "rising") == "rising" else "fall"
    other_kind = "rise" if job.params.get("referenceEdge", "rising") == "rising" else "fall"
    mine = next((t for t, k in edges(job.win, own["low"], own["high"]) if k == kind), None)
    theirs = next((t for t, k in edges(job.reference_win, other["low"], other["high"]) if k == other_kind), None)
    if mine is None or theirs is None:
        return Outcome(None, "unknown", "an edge is missing in the window", own)
    return Outcome(mine - theirs, levels=own, details={"edge": mine, "referenceEdge": theirs, "referenceLevels": other})


def measure(metric: Metric, series: Series, a: float, b: float, params: dict[str, Any], bandwidth: float | None,
            filter_rise: float, reference: Series | None = None) -> tuple[Outcome, Window | None]:
    win = window(series, a, b)
    if win is None and series.t and series.t[0] - series.tolerance() <= a and b <= series.t[-1] + series.tolerance():
        return Outcome(None, "unknown", f"the window [{a:.6g} s, {b:.6g} s] holds fewer than two samples: it lies in a gap",
                       diagnostics=["gap"]), None
    if win is None:
        return Outcome(None, "unknown", f"the window [{a:.6g} s, {b:.6g} s] lies outside the series "
                       f"[{series.t[0]:.6g} s, {series.t[-1]:.6g} s]" if series.t else "the series is empty"), None
    reference_win = window(reference, a, b) if reference is not None else None
    job = Job(series, win, params, bandwidth, filter_rise, reference, reference_win)
    return metric.compute(job), win
