"""Quantities of a comparison request: a number and a unit, compared only within one base unit (spec §2).

A known unit is an SI prefix and a base; any other unit text is kept as written and compares only with the same
text, so an unknown unit never meets a known one by accident.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass

PREFIXES = {"p": 1e-12, "n": 1e-9, "u": 1e-6, "µ": 1e-6, "μ": 1e-6, "m": 1e-3, "k": 1e3, "M": 1e6, "G": 1e9}
# spelling -> (base, scale); bases in NO_PREFIX take no prefix.
BASES: dict[str, tuple[str, float]] = {
    "V": ("V", 1.0),
    "A": ("A", 1.0),
    "Ω": ("Ω", 1.0),  # Greek capital omega
    "Ω": ("Ω", 1.0),  # the ohm sign
    "ohm": ("Ω", 1.0),
    "Ohm": ("Ω", 1.0),
    "W": ("W", 1.0),
    "F": ("F", 1.0),
    "H": ("H", 1.0),
    "Hz": ("Hz", 1.0),
    "s": ("s", 1.0),
    "C": ("C", 1.0),  # charge (gate charge in nC); a temperature is written °C
    "°C": ("°C", 1.0),
    "degC": ("°C", 1.0),
    "K": ("K", 1.0),
    "K/W": ("K/W", 1.0),
    "°C/W": ("K/W", 1.0),
    "%": ("%", 1.0),
    "dB": ("dB", 1.0),
    "V/s": ("V/s", 1.0),
    "V/us": ("V/s", 1e6),
    "V/µs": ("V/s", 1e6),
    "V/μs": ("V/s", 1e6),
}
NO_PREFIX = frozenset({"°C", "degC", "K/W", "°C/W", "%", "dB", "V/us", "V/µs", "V/μs"})
_TEXT = re.compile(r"\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*(.*?)\s*")


class UnitError(ValueError):
    """A quantity that cannot be read; the message is meant for the user."""


@dataclass(frozen=True)
class Quantity:
    """`si` is the value in the base unit; `base` is a known base or `?<unit text>` for any other unit."""

    si: float
    base: str
    given: str

    def json(self) -> dict[str, object]:
        unit = self.base[1:] if self.base.startswith("?") else self.base
        return {"value": self.si, "unit": unit, "given": self.given}


def resolve(unit: str) -> tuple[str, float]:
    unit = unit.strip()
    if unit in BASES:
        return BASES[unit]
    if len(unit) > 1 and unit[0] in PREFIXES and unit[1:] in BASES and unit[1:] not in NO_PREFIX:
        base, scale = BASES[unit[1:]]
        return base, PREFIXES[unit[0]] * scale
    return f"?{unit}", 1.0


def quantity(raw: object) -> Quantity:
    """Reads "40 mΩ" or {"value": 40, "unit": "mΩ"}; a bare number is a quantity without unit."""
    if isinstance(raw, bool):
        raise UnitError("Give a number with a unit, such as '40 mΩ'; true and false are not quantities.")
    if isinstance(raw, (int, float)):
        number, unit, given = float(raw), "", repr(raw)
    elif isinstance(raw, str):
        if len(raw) > 100:
            raise UnitError("A quantity is at most 100 characters, such as '40 mΩ'.")
        match = _TEXT.fullmatch(raw)
        if not match:
            raise UnitError(f"'{raw[:60]}' does not start with a number such as 40, 3.3 or 4.7e-6.")
        number, unit, given = float(match.group(1)), match.group(2), raw.strip()
    elif isinstance(raw, dict) and set(raw) == {"value", "unit"}:
        value, unit = raw["value"], raw["unit"]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not isinstance(unit, str) or len(unit) > 40:
            raise UnitError("A quantity object is {\"value\": number, \"unit\": text}.")
        number, given = float(value), f"{value} {unit}".strip()
    else:
        raise UnitError("Give a quantity as text such as '40 mΩ' or as {\"value\": 40, \"unit\": \"mΩ\"}.")
    base, scale = resolve(unit)
    si = number * scale
    if not math.isfinite(si):
        raise UnitError(f"'{given[:60]}' is not a finite number.")
    return Quantity(si, base, given)


def same(a: float, b: float) -> bool:
    return math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-15)


def meets(value: Quantity, op: str, bound: Quantity) -> bool | None:
    """Whether `value op bound` holds; None when the units cannot be compared."""
    if value.base != bound.base:
        return None
    if op == "<=":
        return value.si < bound.si or same(value.si, bound.si)
    if op == ">=":
        return value.si > bound.si or same(value.si, bound.si)
    return same(value.si, bound.si)


def unit_name(item: Quantity) -> str:
    return item.base[1:] or "(no unit)" if item.base.startswith("?") else item.base
