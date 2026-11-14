"""An acquisition plan checked against the meter profile (spec REQ-DATA-dd3e4fe1 sections 2 and 5, REQ-FUNC-3f8d4501).

The same check runs offline (`power-analyze acquisition`, configure-acquisition) and before a capture opens the meter.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

from .errors import Refused
from .profiles import Profile


@dataclass(frozen=True)
class Plan:
    rate: int
    duration: float
    current_range: str  # "auto" or a profile label
    voltage_range: str | None  # a profile label, or None: the meter's voltage range is left as it is
    markers: tuple[int, ...]

    @property
    def samples(self) -> int:
        return int(round(self.rate * self.duration))


def check(profile: Profile, rate: float, duration: float, current_range: str, voltage_range: str | None,
          markers: str | None) -> Plan:
    if not math.isfinite(rate) or rate != int(rate) or int(rate) not in profile.rates:
        raise Refused("request", f"--rate {rate:g} Hz is not a rate of {profile.id}: {', '.join(str(r) for r in profile.rates)}.")
    if not math.isfinite(duration) or not 0.01 <= duration <= profile.max_duration:
        raise Refused("request", f"--duration must lie from 0.01 to {profile.max_duration:g} s.")
    samples = int(round(rate * duration))
    if samples < 2:
        raise Refused("request", "The capture holds fewer than two samples; raise --rate or --duration.")
    if samples > profile.max_samples:
        raise Refused("request", f"--rate x --duration is {samples} samples, more than the {profile.max_samples} a capture "
                      "may hold; lower the rate or the duration.")
    if current_range != "auto":
        found = profile.current_range(current_range)
        if found is None:
            raise Refused("request", f"--current-range {current_range[:20]!r} is not auto or a range of {profile.id}: "
                          f"{', '.join(item.label for item in profile.current_ranges)}.")
        current_range = found.label
    if voltage_range is not None:
        found_v = profile.voltage_range(voltage_range)
        if found_v is None:
            raise Refused("request", f"--voltage-range {voltage_range[:20]!r} is not a range of {profile.id}: "
                          f"{', '.join(item.label for item in profile.voltage_ranges)}.")
        voltage_range = found_v.label
    chosen: list[int] = []
    if markers:
        for part in markers.split(","):
            text = part.strip()
            if not text.isdigit() or int(text) not in profile.markers or int(text) in chosen:
                raise Refused("request", f"--markers lists each of the inputs {', '.join(str(m) for m in profile.markers)} at most once.")
            chosen.append(int(text))
    return Plan(int(rate), float(duration), current_range, voltage_range, tuple(sorted(chosen)))


def describe(profile: Profile, plan: Plan) -> dict[str, Any]:
    """What the capture would set and keep, for configure-acquisition and every capture result."""
    return {
        "profile": profile.id,
        "profileStatus": profile.status,
        "rate": plan.rate,
        "duration": plan.duration,
        "samples": plan.samples,
        "currentRange": plan.current_range,
        "voltageRange": plan.voltage_range or "unchanged",
        "markers": list(plan.markers),
        "signals": ["current", "voltage", "power", "current-range", *(f"gpi{n}" for n in plan.markers)],
        "csvBytesEstimate": plan.samples * (60 + 2 * len(plan.markers)),
        "burden": profile.burden,
        "signConvention": profile.sign_convention,
        "notes": [
            "The capture opens the meter without applying its defaults and never switches its current path: a meter "
            "whose current range mode is off is refused.",
            "Changed settings are restored and read back at the end; the readback proves the meter's state, not that "
            "the DUT was undisturbed.",
            *(["Marker inputs are sampled by the meter on the same clock as the current (resolution 1 / rate)."]
              if plan.markers else []),
        ],
    }
