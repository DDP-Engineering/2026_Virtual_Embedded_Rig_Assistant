"""Waveform amplitudes and the current descriptor (spec REQ-DATA-3d15fdfc §3 and §5.3).

Peak, RMS and average are different numbers; every function here names which one it takes and returns.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from .contract import Reader

SYMMETRIC = ("sine", "triangle", "square")
SHAPES = (*SYMMETRIC, "pulse", "dc")


@dataclass(frozen=True)
class Factors:
    """Amplitudes of a shape for a peak of 1."""

    rms: float
    average: float
    rectified: float
    peak_to_peak: float


def factors(shape: str, duty: float | None = None) -> Factors:
    if shape == "sine":
        return Factors(1 / math.sqrt(2), 0.0, 2 / math.pi, 2.0)
    if shape == "triangle":
        return Factors(1 / math.sqrt(3), 0.0, 0.5, 2.0)
    if shape == "square":
        return Factors(1.0, 0.0, 1.0, 2.0)
    if shape == "pulse":
        if duty is None:
            raise ValueError("A pulse needs its duty cycle.")
        # At duty 1 the pulse train is a constant level, like dc.
        return Factors(math.sqrt(duty), duty, duty, 1.0 if duty < 1 else 0.0)
    if shape == "dc":
        return Factors(1.0, 1.0, 1.0, 0.0)
    raise ValueError(shape)


@dataclass(frozen=True)
class Current:
    """A current over one whole period. `average` is None when the request did not give one."""

    rms: float
    average: float | None
    form: str  # rms, dc, pulse, sine, triangle or square


RMS_NOTE = (
    "A duty cycle applies to an on-state peak current. An RMS or DC value already covers the whole period, so the "
    "duty must not be applied to it again; give {\"shape\": \"pulse\", \"peak\": ..., \"duty\": ...} instead."
)


def current(reader: Reader, key: str, *, required: bool = True) -> Current | None:
    """Reads a current descriptor: `{rms, average?}`, `{dc}` or `{shape, peak, duty?}`."""
    node = reader.obj(key, required=required)
    if node is None:
        return None
    forms = [name for name, present in (("rms", node.has("rms")), ("dc", node.has("dc")), ("shape", node.has("shape") or node.has("peak"))) if present]
    node.mark("rms", "average", "dc", "shape", "peak", "duty")
    if "duty" in node.data and ("rms" in forms or "dc" in forms):
        reader.fail("contradiction", key, RMS_NOTE)
        return None
    if len(forms) > 1:
        reader.fail("contradiction", key, "Give one form only: rms (with an optional average), dc, or shape with peak.")
        return None
    if not forms:
        reader.fail("schema", key, "Give rms (with an optional average), dc, or shape with peak.")
        return None
    if forms[0] == "rms":
        rms = node.value("rms", "current")
        average = node.value("average", "current", required=False)
        if rms is None or ("average" in node.data and average is None):
            return None
        if average is not None and average > rms * (1 + 1e-12):
            reader.fail("contradiction", key, "The average of a current cannot exceed its RMS value.")
            return None
        return Current(rms, average, "rms")
    if forms[0] == "dc":
        if "average" in node.data:
            reader.fail("contradiction", key, "A dc current is its own average.")
            return None
        value = node.value("dc", "current")
        return None if value is None else Current(value, value, "dc")
    if "average" in node.data:
        reader.fail("contradiction", key, "A shaped current derives its average from the peak; do not give one.")
        return None
    shape = node.choice("shape", (*SYMMETRIC, "pulse"))
    peak = node.value("peak", "current")
    duty = None
    if shape == "pulse":
        if not node.has("duty"):
            node.fail("insufficient", "duty", "A pulse needs its duty cycle (0 < duty <= 1).")
        else:
            duty = node.ratio("duty", low_open=True)
    elif shape is not None and "duty" in node.data:
        reader.fail("contradiction", key, f"A {shape} current has no duty cycle; use shape pulse.")
        return None
    if shape is None or peak is None or (shape == "pulse" and duty is None):
        return None
    unit = factors(shape, duty)
    return Current(peak * unit.rms, peak * unit.average, shape)


def report_current(result, found: Current) -> None:
    """Adds the RMS and, when known, the average of a descriptor to the results."""
    result.add("currentRms", found.rms, "current")
    if found.average is not None:
        result.add("currentAverage", found.average, "current")
