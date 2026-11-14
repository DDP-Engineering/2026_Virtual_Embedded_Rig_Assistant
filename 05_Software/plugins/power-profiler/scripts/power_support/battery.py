"""battery: a battery-life interval from a measured usage profile (spec REQ-DATA-dd3e4fe1 section 7,
REQ-FUNC-9d7b62ea, REQ-REL-a2fa28e4).

Charge (mAh) and energy (Wh) are never mixed: `direct` and `linear` conversions work in charge (input current = rail
current + quiescent current), `switching` works in energy (input power = rail power / efficiency + battery voltage x
quiescent current); a conversion between the two needs the battery's own voltage. Every uncertain input is a range;
the life is an interval, rounded outwards, never a single number.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

from .errors import Refused
from .workspace import PathRefused, regular_file

MONTH_SECONDS = 30.44 * 86400
CAPACITY_UNITS = {"mAh": 3.6, "Ah": 3600.0}  # -> C
ENERGY_UNITS = {"Wh": 3600.0, "mWh": 3.6, "J": 1.0}  # -> J
FIELDS = {"format", "capacity", "energy", "voltage", "usable", "conversion", "selfDischarge", "note"}


def refuse(message: str) -> Refused:
    return Refused("battery", message)


def _range(document: dict[str, Any], key: str, units: dict[str, float] | None, required: bool,
           low: float = 0.0, high: float = math.inf, low_open: bool = True, scaled: bool = False,
           where: str = "") -> tuple[float, float, str] | None:
    """{min, max[, unit]} -> (min, max) in base units; the bounds apply after the unit scaling when `scaled`."""
    item = document.get(key)
    if item is None:
        if required:
            raise refuse(f"The battery file needs {where}{key}; it is not assumed.")
        return None
    allowed = {"min", "max", "unit"} if units is not None else {"min", "max"}
    if not isinstance(item, dict) or not {"min", "max"} <= set(item) <= allowed:
        raise refuse(f"{key} is {{min, max{', unit' if units else ''}}}.")
    lo, hi = item["min"], item["max"]
    if not all(isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) for x in (lo, hi)):
        raise refuse(f"{key}.min and {key}.max are numbers.")
    if lo > hi:
        raise refuse(f"{key}: min is larger than max.")
    factor, unit = 1.0, ""
    if units is not None:
        unit = item.get("unit")
        if unit not in units:
            raise refuse(f"{key}.unit is one of {', '.join(units)}.")
        factor = units[unit]
    check_lo, check_hi = (lo * factor, hi * factor) if scaled else (lo, hi)
    if (check_lo <= low if low_open else check_lo < low) or check_hi > high:
        raise refuse(f"{key} must lie in {'(' if low_open else '['}{low:g}, {high:g}]{' (base unit)' if scaled else ''}.")
    return lo * factor, hi * factor, unit


def read(cwd: Path, spelled: Path, raw: str) -> tuple[dict[str, Any], dict[str, Any]]:
    try:
        path = regular_file(cwd, raw, "--battery", spelled)
    except PathRefused as error:
        raise Refused("path", str(error)) from error
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, ValueError) as error:
        raise refuse(f"--battery is not a JSON file: {error}") from error
    if not isinstance(document, dict) or not set(document) <= FIELDS or document.get("format") != 1:
        raise refuse(f"The battery file is a format 1 object with the fields {', '.join(sorted(FIELDS))}.")
    return document, {"path": raw}


def estimate(profile: dict[str, Any], battery: dict[str, Any]) -> dict[str, Any]:
    if profile.get("status") != "pass":
        raise refuse("The usage profile is not a pass segment run (gaps, overflow or incomplete events); an estimate "
                     "from it would rest on missing data.")
    events = ((profile.get("statistics") or {}).get("complete")) or 0
    periods = profile.get("periods")
    if events < 3 or not periods or periods.get("n", 0) < 2:
        raise refuse(f"The usage profile holds {events} complete events; at least three (two whole periods) are needed.")
    if ("capacity" in battery) == ("energy" in battery):
        raise refuse("Declare exactly one of capacity (mAh, Ah) and energy (Wh, mWh, J).")
    capacity = _range(battery, "capacity", CAPACITY_UNITS, False)
    energy = _range(battery, "energy", ENERGY_UNITS, False)
    voltage = _range(battery, "voltage", {"V": 1.0}, False)
    usable = _range(battery, "usable", None, True, 0.0, 1.0)
    sd = _range(battery, "selfDischarge", {"%/month": 0.01 / MONTH_SECONDS}, False, 0.0, 100.0, low_open=False)
    conversion = battery.get("conversion")
    if not isinstance(conversion, dict) or not set(conversion) <= {"kind", "efficiency", "quiescent"}:
        raise refuse("conversion is {kind: direct|linear|switching, efficiency?, quiescent?}.")
    kind = conversion.get("kind")
    if kind not in ("direct", "linear", "switching"):
        raise refuse("conversion.kind is direct, linear or switching.")
    efficiency = _range(conversion, "efficiency", None, kind == "switching", 0.0, 1.0, where="conversion.")
    if kind != "switching" and efficiency is not None:
        raise refuse("An efficiency applies to a switching converter only; a linear regulator passes its current through.")
    quiescent = _range(conversion, "quiescent", {"A": 1.0, "mA": 1e-3, "uA": 1e-6}, False, 0.0, 1.0, low_open=False,
                       scaled=True)
    assert usable is not None
    power = periods["power"]
    current = periods["current"]
    rail = ((profile.get("metrics") or {}).get("voltage") or {}).get("mean")
    q_lo, q_hi = (quiescent[0], quiescent[1]) if quiescent else (0.0, 0.0)
    sd_lo, sd_hi = (sd[0], sd[1]) if sd else (0.0, 0.0)  # fraction of the full battery lost per second
    assumptions = [
        f"the measured usage profile repeats unchanged for the whole life ({periods['n']} periods measured)",
        f"usable fraction of the battery {usable[0]:g}...{usable[1]:g} (cut-off voltage and temperature derating)",
        "the load does not change with the battery voltage during discharge",
    ]
    if quiescent is None:
        assumptions.append("no quiescent current of the conversion was declared: taken as 0")
    if sd is None:
        assumptions.append("no self-discharge was declared: taken as 0")
    if kind in ("direct", "linear"):
        # Charge domain: input current = rail current + quiescent current.
        if capacity is not None:
            q_lo_c, q_hi_c = capacity[0], capacity[1]
        else:
            assert energy is not None
            if voltage is None:
                raise refuse("An energy battery with a direct or linear conversion needs the battery voltage to become charge; "
                             "it is not assumed.")
            q_lo_c, q_hi_c = energy[0] / voltage[1], energy[1] / voltage[0]
            assumptions.append(f"energy converted to charge at the battery voltage {voltage[0]:g}...{voltage[1]:g} V")
        load_hi = current["max"] + q_hi
        load_lo = current["min"] + q_lo
        if load_lo <= 0:
            raise refuse("A measured period draws no current or reverse current; no battery life follows from it.")
        low = usable[0] * q_lo_c / (load_hi + q_lo_c * sd_hi)
        high = usable[1] * q_hi_c / (load_lo + q_hi_c * sd_lo)
        domain = "charge"
        assumptions.append(f"the {kind} conversion passes the rail current through (input current = rail current + quiescent)")
    else:
        if efficiency is None:
            raise refuse("A switching converter needs its efficiency range; it is not assumed.")
        if voltage is None and (capacity is not None or quiescent is not None):
            raise refuse("A switching converter with a capacity in mAh/Ah or a quiescent current needs the battery voltage; "
                         "charge at the rail voltage is never mixed with the battery's.")
        if capacity is not None:
            assert voltage is not None
            e_lo, e_hi = capacity[0] * voltage[0], capacity[1] * voltage[1]
            assumptions.append(f"capacity converted to energy at the battery voltage {voltage[0]:g}...{voltage[1]:g} V")
        else:
            assert energy is not None
            e_lo, e_hi = energy[0], energy[1]
        v_lo, v_hi = (voltage[0], voltage[1]) if voltage else (0.0, 0.0)
        load_hi = power["max"] / efficiency[0] + v_hi * q_hi
        load_lo = power["min"] / efficiency[1] + v_lo * q_lo
        if load_lo <= 0:
            raise refuse("A measured period draws no power or reverse power; no battery life follows from it.")
        low = usable[0] * e_lo / (load_hi + e_lo * sd_hi)
        high = usable[1] * e_hi / (load_lo + e_hi * sd_lo)
        domain = "energy"
        assumptions.append(f"converter efficiency {efficiency[0]:g}...{efficiency[1]:g} over the whole load profile")
    if not (math.isfinite(low) and math.isfinite(high)) or low <= 0:
        raise refuse("The measured load is zero or negative; no battery life follows from it.")
    ratio = high / low
    digits = 1 if ratio > 10 else 2
    life = {"min": round_down(low, digits), "max": round_up(high, digits), "unit": "s",
            "minHours": round_down(low / 3600, digits), "maxHours": round_up(high / 3600, digits),
            "minDays": round_down(low / 86400, digits), "maxDays": round_up(high / 86400, digits),
            "precision": "order-of-magnitude" if digits == 1 else "two significant figures"}
    return {"domain": domain, "conversion": kind, "life": life, "assumptions": assumptions,
            "inputs": {"railVoltage": rail, "power": power, "current": current, "capacity": capacity, "energy": energy,
                       "voltage": voltage, "usable": usable, "efficiency": efficiency, "quiescent": quiescent,
                       "selfDischarge": battery.get("selfDischarge")}}


def round_down(value: float, digits: int) -> float:
    if value <= 0:
        return 0.0
    scale = 10 ** (math.floor(math.log10(value)) - digits + 1)
    return float(f"{math.floor(value / scale * (1 + 1e-12)) * scale:.{digits + 1}g}")


def round_up(value: float, digits: int) -> float:
    if value <= 0:
        return 0.0
    scale = 10 ** (math.floor(math.log10(value)) - digits + 1)
    return float(f"{math.ceil(value / scale * (1 - 1e-12)) * scale:.{digits + 1}g}")
