"""Signals: a source channel normalized to SI with its declared sign and scale, then preprocessed in declared order."""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

from . import preprocess
from .errors import Refused
from .importers import Source
from .series import Series, build


@dataclass
class Signal:
    id: str
    source: Source
    channel: str
    unit: str
    sign: int
    scale: float
    series: Series
    original: dict[str, Any]
    mapping: dict[str, Any]
    preprocessing: list[dict[str, Any]] = field(default_factory=list)
    diagnostics: list[str] = field(default_factory=list)  # limiting, apply to every value of the signal
    notes: list[str] = field(default_factory=list)
    filter_rise: float = 0.0

    def describe(self) -> dict[str, Any]:
        s = self.series
        return {"id": self.id, "source": self.source.id, "channel": self.channel, "unit": self.unit, "sign": self.sign,
                "scale": self.scale, "mapping": self.mapping, "points": len(s.t), "start": s.t[0], "end": s.t[-1],
                "rate": s.rate, "uniform": s.uniform, "gaps": [list(gap) for gap in s.gaps], "clipped": sum(s.clipped),
                "original": self.original, "preprocessing": self.preprocessing, "diagnostics": self.diagnostics,
                "notes": self.notes}


def make(signal_id: str, spec: dict[str, Any], source: Source) -> Signal:
    where = f"signals.{signal_id}"
    channel = source.channels.get(spec["channel"])
    if channel is None:
        held = ", ".join(list(source.channels)[:20])
        raise Refused("request", f"{where}.channel: source {source.id} has no channel '{spec['channel'][:60]}'; it holds {held}.")
    unit = channel.unit
    if unit is None:
        unit = spec.get("unit")
        if unit is None:
            raise Refused("request", f"{where}.unit: the unit of '{spec['channel'][:60]}' is unknown; declare unit V, A or W.")
    elif spec.get("unit") not in (None, unit):
        raise Refused("request", f"{where}.unit: '{spec['channel'][:60]}' is in {unit}, not {spec['unit']}.")
    if len(channel.t) < 2:
        raise Refused("source", f"{where}: '{spec['channel'][:60]}' holds fewer than two samples.")
    factor = spec["sign"] * spec["scale"]
    values = [value * factor for value in channel.v]
    series = build(list(channel.t), values, list(channel.clipped), unit, channel.uniform, set(channel.missing_after))
    signal = Signal(signal_id, source, spec["channel"], unit, spec["sign"], spec["scale"], series,
                    {"points": len(series.t), "rate": series.rate}, channel.mapping)
    signal.diagnostics.extend(source.diagnostics)
    filtered = 0.0
    for step in spec["preprocess"]:
        if step["step"] == "resample":
            signal.series, report, diagnostics, notes = preprocess.resample(signal.series, step["rate"], filtered, step["where"])
            signal.diagnostics.extend(code for code in diagnostics if code not in signal.diagnostics)
            signal.notes.extend(notes)
        else:
            signal.series, report = preprocess.moving_average(signal.series, step["width"], step["where"])
            filtered = max(filtered, report["effectiveWidth"])
            signal.filter_rise = math.sqrt(signal.filter_rise**2 + report["riseTime1090"] ** 2)
        signal.preprocessing.append(report)
    return signal
