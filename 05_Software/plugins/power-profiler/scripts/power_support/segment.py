"""segment (spec REQ-DATA-dd3e4fe1 section 7, REQ-FUNC-b22a6d3f, REQ-SEC-cf1a9ecb).

Events come from the meter's own clock only: its marker inputs, a timestamp file on the capture's clock, or the
measured current. A PC-side arrival time (a UART line received by the host) is refused as a synchronisation source.
"""

from __future__ import annotations

import json
import math
import re
import statistics
from pathlib import Path
from typing import Any

from .errors import Refused
from .signals import Signals, integral
from .workspace import PathRefused, regular_file

NAME = re.compile(r"[a-z][a-z0-9_-]{0,31}")
TIMESTAMP_LIMIT = 1024 * 1024


# ---- event sources ----


def by_markers(signals: Signals, channel: int, event: str, a: float, b: float) -> tuple[list[tuple[float, float]], int, dict[str, Any]]:
    levels = signals.capture.gpi.get(channel)
    if levels is None:
        raise Refused("request", f"The capture has no marker gpi{channel}; capture it with --markers {channel}.")
    t = signals.capture.t
    edges: list[tuple[float, str]] = []
    last: int | None = None
    for k, level in enumerate(levels):
        if not a <= t[k] <= b:
            last = None
            continue
        if level is None:
            if last is not None:
                edges.append((t[k], "hidden"))  # a missing marker sample hides any edge next to it
            last = None
            continue
        if last is not None and level != last:
            edges.append((t[k], "rise" if level else "fall"))
        last = level
    begin, end = {"high": ("rise", "fall"), "low": ("fall", "rise"), "cycle": ("rise", "rise")}[event]
    events: list[tuple[float, float]] = []
    partial = 0
    start: float | None = None
    for time, kind in edges:
        if kind == "hidden":
            if start is not None:
                partial += 1  # the event's end may lie in the hidden stretch
            start = None
            continue
        if start is not None and kind == end:
            events.append((start, time))
            start = None
        if kind == begin:
            start = time
    if start is not None:
        partial += 1
    if edges and edges[0][1] == end and event != "cycle":
        partial += 1
    rate = signals.capture.rate
    sync = {"method": "marker", "channel": f"gpi{channel}", "event": event,
            "resolution": 1 / rate if rate else None,
            "clock": "the meter samples the marker input on the same clock as the current"}
    return events, partial, sync


def by_threshold(signals: Signals, threshold: float, min_gap: float, a: float, b: float) -> tuple[list[tuple[float, float]], int, dict[str, Any]]:
    if not math.isfinite(threshold):
        raise Refused("request", "--threshold is a finite current in A.")
    if not math.isfinite(min_gap) or min_gap < 0:
        raise Refused("request", "--min-gap is a time >= 0 s.")
    t, current = signals.capture.t, signals.current
    runs: list[tuple[float, float]] = []
    partial = 0
    start: float | None = None
    cut = False  # the open run touched the window edge or a missing sample
    inside = [k for k, time in enumerate(t) if a <= time <= b]
    for position, k in enumerate(inside):
        value = current[k]
        first = position == 0
        if value is None:
            if start is not None:
                partial += 1
            start, cut = None, False
            continue
        if value >= threshold:
            if start is None:
                start, cut = t[k], first or (k > 0 and current[k - 1] is None)
        elif start is not None:
            if cut:
                partial += 1
            else:
                runs.append((start, t[k]))
            start = None
    if start is not None:
        partial += 1
    merged: list[tuple[float, float]] = []
    for run in runs:
        if merged and run[0] - merged[-1][1] < min_gap:
            merged[-1] = (merged[-1][0], run[1])
        else:
            merged.append(run)
    sync = {"method": "threshold", "threshold": threshold, "minGap": min_gap,
            "clock": "events measured in the current itself on the meter clock"}
    return merged, partial, sync


def by_timestamps(signals: Signals, cwd: Path, spelled: Path, raw: str, a: float, b: float) -> tuple[list[tuple[float, float]], int, dict[str, Any]]:
    try:
        path = regular_file(cwd, raw, "--timestamps", spelled)
    except PathRefused as error:
        raise Refused("path", str(error)) from error
    if path.stat().st_size > TIMESTAMP_LIMIT:
        raise Refused("limit", "--timestamps is larger than 1 MiB.")
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, ValueError) as error:
        raise Refused("request", f"--timestamps is not a JSON file: {error}") from error
    if not isinstance(document, dict) or not set(document) <= {"format", "clock", "capture", "provenance", "events"} \
            or document.get("format") != 1:
        raise Refused("request", "--timestamps is {format: 1, clock, capture, provenance, events}.")
    own = (signals.capture.document.get("timebase") or {}).get("clock")
    clock = document.get("clock")
    if clock != own:
        raise Refused("sync", f"The timestamps are on the clock {str(clock)[:40]!r}, not the capture's own clock {own!r}. "
                      "Times such as the PC's arrival time of a UART line do not synchronise with the meter; wire a marker "
                      "to a meter input or use --threshold.")
    if document.get("capture") != signals.capture.result_sha256:
        raise Refused("sync", "The timestamps name another capture (capture must be the SHA-256 of this capture's result.json).")
    provenance = document.get("provenance")
    if not isinstance(provenance, str) or not 1 <= len(provenance) <= 200:
        raise Refused("request", "--timestamps needs a provenance text of 1-200 characters.")
    items = document.get("events")
    if not isinstance(items, list) or not 1 <= len(items) <= 10000:
        raise Refused("request", "--timestamps lists 1 to 10000 events.")
    t = signals.capture.t
    events: list[tuple[float, float]] = []
    for index, item in enumerate(items):
        if not isinstance(item, dict) or not set(item) <= {"name", "from", "to"}:
            raise Refused("request", f"--timestamps event {index} is {{name?, from, to}}.")
        start, end = item.get("from"), item.get("to")
        if not all(isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) for x in (start, end)) or not start < end:
            raise Refused("request", f"--timestamps event {index} needs numbers from < to (s).")
        if start < t[0] or end > t[-1]:
            raise Refused("request", f"--timestamps event {index} lies outside the capture [{t[0]:g}, {t[-1]:g}] s.")
        if events and start < events[-1][0]:
            raise Refused("request", "--timestamps events are in increasing order of from.")
        events.append((float(start), float(end)))
    inside = [event for event in events if a <= event[0] and event[1] <= b]
    sync = {"method": "timestamps", "clock": own, "provenance": provenance}
    return inside, len(events) - len(inside), sync


# ---- energy per event, states, periods ----


def _summary(values: list[float]) -> dict[str, Any] | None:
    if not values:
        return None
    return {"n": len(values), "mean": statistics.fmean(values), "stdev": statistics.stdev(values) if len(values) > 1 else None,
            "min": min(values), "max": max(values)}


def per_event(signals: Signals, events: list[tuple[float, float]]) -> list[dict[str, Any]]:
    out = []
    for index, (start, end) in enumerate(events):
        energy = integral(signals.series_p, start, end)
        charge = integral(signals.series_i, start, end)
        overflow = signals.overflow_in(start, end)
        complete = energy["value"] is not None and charge["value"] is not None and not any(overflow.values())
        peak = signals.peak(start, end)
        out.append({"index": index, "from": start, "to": end, "duration": end - start,
                    "charge": charge["value"] if complete else None, "energy": energy["value"] if complete else None,
                    "meanCurrent": charge["value"] / (end - start) if complete else None, "peakCurrent": peak,
                    "status": "ok" if complete else "incomplete",
                    **({} if complete else {"reason": "overflow" if any(overflow.values()) else "gap"})})
    return out


def periods(signals: Signals, events: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Start-to-start periods (sleep between bursts included): average power and current per period."""
    if len(events) < 2:
        return None
    power: list[float] = []
    current: list[float] = []
    energies: list[float] = []
    charges: list[float] = []
    for left, right in zip(events, events[1:]):
        start, end = left["from"], right["from"]
        energy = integral(signals.series_p, start, end)["value"]
        charge = integral(signals.series_i, start, end)["value"]
        if energy is None or charge is None or any(signals.overflow_in(start, end).values()):
            return None
        power.append(energy / (end - start))
        current.append(charge / (end - start))
        energies.append(energy)
        charges.append(charge)
    return {"n": len(power), "from": events[0]["from"], "to": events[-1]["from"], "power": _summary(power),
            "current": _summary(current), "energy": _summary(energies), "charge": _summary(charges),
            "duration": _summary([right["from"] - left["from"] for left, right in zip(events, events[1:])])}


def parse_states(text: str) -> list[tuple[str, float]]:
    """`name:upper,...,name` -> [(name, upper limit in A)], the last without a limit (inf)."""
    states: list[tuple[str, float]] = []
    parts = text.split(",")
    for position, part in enumerate(parts):
        name, sep, limit = part.partition(":")
        name = name.strip()
        if not NAME.fullmatch(name) or any(name == known for known, _ in states):
            raise Refused("request", f"--states: {name[:32]!r} is not a new state name ([a-z][a-z0-9_-]).")
        if position == len(parts) - 1:
            if sep:
                raise Refused("request", "--states: the last state has no upper limit.")
            states.append((name, math.inf))
            continue
        try:
            upper = float(limit)
        except ValueError as error:
            raise Refused("request", f"--states: '{limit[:20]}' is not a current in A.") from error
        if not math.isfinite(upper) or (states and upper <= states[-1][1]):
            raise Refused("request", "--states: the upper limits are finite and increasing.")
        states.append((name, upper))
    if len(states) < 2:
        raise Refused("request", "--states names at least two states.")
    return states


def states(signals: Signals, a: float, b: float, thresholds: list[tuple[str, float]] | None, marker: int | None,
           withheld: bool) -> dict[str, Any] | None:
    """Time, charge and energy per state over the sample intervals inside [a, b]; an interval belongs to the state of
    its left sample. Charge and energy are null when the window has gaps or overflow."""
    if thresholds is None and marker is None:
        return None
    t, current, power = signals.capture.t, signals.current, signals.power
    levels = signals.capture.gpi.get(marker) if marker is not None else None
    names = [name for name, _ in thresholds] if thresholds else ["high", "low"]
    found = {name: {"seconds": 0.0, "charge": 0.0, "energy": 0.0} for name in names}
    unknown = 0.0
    for k in range(len(t) - 1):
        if not (a <= t[k] and t[k + 1] <= b):
            continue
        dt = t[k + 1] - t[k]
        if k in signals.gap_rows:
            unknown += dt
            continue
        if thresholds:
            value = current[k]
            assert value is not None
            name = next(name for name, upper in thresholds if value < upper)
        else:
            level = levels[k] if levels is not None else None
            if level is None:
                unknown += dt
                continue
            name = "high" if level else "low"
        entry = found[name]
        entry["seconds"] += dt
        entry["charge"] += 0.5 * (current[k] + current[k + 1]) * dt  # type: ignore[operator]
        if power[k] is not None and power[k + 1] is not None:
            entry["energy"] += 0.5 * (power[k] + power[k + 1]) * dt  # type: ignore[operator]
        else:
            entry["energy"] = math.nan
    out: dict[str, Any] = {"by": "threshold" if thresholds else f"marker gpi{marker}", "unknownSeconds": unknown, "states": {}}
    for name, entry in found.items():
        valid = not withheld and unknown == 0 and math.isfinite(entry["energy"])
        out["states"][name] = {"seconds": entry["seconds"], "charge": entry["charge"] if not withheld and unknown == 0 else None,
                               "energy": entry["energy"] if valid else None,
                               **({"upper": dict(thresholds)[name]} if thresholds and math.isfinite(dict(thresholds)[name]) else {})}
    return out


def statistics_of(events: list[dict[str, Any]]) -> dict[str, Any]:
    ok = [event for event in events if event["status"] == "ok"]
    return {"events": len(events), "complete": len(ok), "energy": _summary([e["energy"] for e in ok]),
            "charge": _summary([e["charge"] for e in ok]), "duration": _summary([e["duration"] for e in ok])}


def events_csv(events: list[dict[str, Any]]) -> str:
    def cell(value: Any) -> str:
        return "" if value is None else format(value, ".9g") if isinstance(value, float) else str(value)

    lines = ["index,from_s,to_s,duration_s,charge_C,energy_J,mean_A,peak_A,status"]
    for e in events:
        lines.append(",".join(cell(e[key]) for key in ("index", "from", "to", "duration", "charge", "energy", "meanCurrent",
                                                         "peakCurrent", "status")))
    return "\n".join(lines) + "\n"
