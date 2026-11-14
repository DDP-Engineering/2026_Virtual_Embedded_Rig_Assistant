"""measure-energy (spec REQ-DATA-dd3e4fe1 section 7, REQ-FUNC-4995f945, REQ-REL-d02aa9e4, REQ-FUNC-02cea0ef)."""

from __future__ import annotations

import dataclasses
from typing import Any

from .errors import Refused
from .series import integrate
from .signals import Signals, integral, span, stats

DEFINITIONS = {
    "energy": "integral of p dt over the window, trapezoid rule; p is the meter's power channel, or v x i per sample "
              "when a sign or offset correction is declared or the capture has no power channel (energySource)",
    "charge": "integral of i dt over the window, trapezoid rule, i = sign x measured current - offset",
    "mean": "(1/T) integral over the window, T the time with data",
    "gaps": "an interval without data is never counted as zero: energy and charge are null and only the covered "
            "values are reported",
}


def window_of(signals: Signals, start: float | None, end: float | None) -> tuple[float, float]:
    t = signals.capture.t
    a = t[0] if start is None else start
    b = t[-1] if end is None else end
    if not (a < b) or a < t[0] - 1e-12 or b > t[-1] + 1e-12:
        raise Refused("request", f"The window [{a:g}, {b:g}] s must lie inside the capture [{t[0]:g}, {t[-1]:g}] s with from < to.")
    return a, b


def measure(signals: Signals, a: float, b: float) -> tuple[dict[str, Any], list[tuple[str, str]]]:
    """The metrics and the problems that make the result incomplete."""
    problems: list[tuple[str, str]] = []
    energy = integral(signals.series_p, a, b)
    charge = integral(signals.series_i, a, b)
    overflow = signals.overflow_in(a, b)
    if overflow["current"] or overflow["voltage"]:
        energy["value"] = None
        charge["value"] = None
        problems.append(("overflow", f"{overflow['current']} current and {overflow['voltage']} voltage samples in the "
                         "window lie beyond their range limit; energy and charge are withheld."))
    if charge["gapSeconds"] > 0 or (signals.series_p is not None and energy["gapSeconds"] > 0):
        problems.append(("gaps", f"{max(charge['gapSeconds'], energy['gapSeconds']):.6g} s of the window have no data; "
                         "energy and charge are withheld, the covered values are reported."))
    if signals.series_p is None:
        problems.append(("no-voltage", "The capture has no voltage or power; energy cannot be computed."))
    metrics: dict[str, Any] = {
        "current": {**(stats(signals.series_i, a, b) or {}), "unit": "A"},
        "voltage": {**(stats(signals.series_v, a, b) or {}), "unit": "V"} if signals.series_v is not None else None,
        "power": {**(stats(signals.series_p, a, b) or {}), "unit": "W"} if signals.series_p is not None else None,
        "energy": {"value": energy["value"], "covered": energy["covered"], "unit": "J"},
        "charge": {"value": charge["value"], "covered": charge["covered"], "unit": "C"},
        "coveredSeconds": charge["coveredSeconds"],
        "gapSeconds": charge["gapSeconds"],
        "overflow": overflow,
        "negative": negative(signals, a, b),
        "ranges": ranges(signals, a, b),
        "energySource": signals.energy_source,
    }
    return metrics, problems


def negative(signals: Signals, a: float, b: float) -> dict[str, Any]:
    """Reverse current is reported as it is, never clamped."""
    win = span(signals.series_i, a, b)
    samples = sum(1 for time, value in zip(signals.capture.t, signals.current)
                  if value is not None and value < 0 and a <= time <= b)
    if win is None:
        return {"samples": samples, "charge": None}
    below = dataclasses.replace(win, v=[min(value, 0.0) for value in win.v])
    area, _covered = integrate(below)
    return {"samples": samples, "charge": area}


def ranges(signals: Signals, a: float, b: float) -> dict[str, Any] | None:
    """Time per current range code (by the interval's left sample) and the switches between codes in the window."""
    codes = signals.capture.ranges
    if codes is None:
        return None
    t = signals.capture.t
    seconds: dict[str, float] = {}
    switches = 0
    last: int | None = None
    for k in range(len(t) - 1):
        if not (a <= t[k] and t[k + 1] <= b):
            continue
        code = codes[k]
        if code is None:
            continue
        seconds[str(code)] = seconds.get(str(code), 0.0) + (t[k + 1] - t[k])
        if last is not None and code != last:
            switches += 1
        last = code
    return {"seconds": seconds, "switches": switches}
