"""Quantities with SI prefixes (spec REQ-DATA-53797d16 section 2). Values are converted to the base unit once, here."""

from __future__ import annotations

import math
import re

PREFIXES = {"p": 1e-12, "n": 1e-9, "u": 1e-6, "\u00b5": 1e-6, "\u03bc": 1e-6, "m": 1e-3, "": 1.0, "k": 1e3, "M": 1e6, "G": 1e9}
UNITS = {"s": "s", "Hz": "Hz", "V": "V", "A": "A", "W": "W", "ohm": "ohm", "Ω": "ohm", "K": "K"}
SIGNAL_UNITS = ("V", "A", "W")
TIME_UNITS = {"s": 1.0, "ms": 1e-3, "us": 1e-6, "\u00b5s": 1e-6, "\u03bcs": 1e-6, "ns": 1e-9}
_NUMBER = r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?"
_QUANTITY = re.compile(rf"\s*({_NUMBER})\s*(%|°C|[pnu\u00b5\u03bcmkMG]?(?:Hz|ohm|Ω|s|V|A|W|K))?\s*")


class QuantityError(ValueError):
    pass


def number(text: str) -> float:
    value = float(text)
    if not math.isfinite(value):
        raise QuantityError(f"'{text}' is not a finite number")
    return value


def quantity(text: object) -> tuple[float, str]:
    """`<number> [<prefix>]<unit>` -> (value in the base unit, base unit); a bare number has unit ''."""
    if not isinstance(text, str):
        raise QuantityError("a quantity is text such as '50 mV'")
    match = _QUANTITY.fullmatch(text)
    if not match:
        raise QuantityError(f"'{text[:60]}' is not a quantity such as '50 mV', '2 us' or '1 kHz'")
    value = number(match.group(1))
    unit = match.group(2) or ""
    if unit in ("%", "°C"):
        return value, unit
    if not unit:
        return value, ""
    for name in sorted(UNITS, key=len, reverse=True):
        if unit.endswith(name):
            prefix = unit[: -len(name)]
            if prefix in PREFIXES:
                return value * PREFIXES[prefix], UNITS[name]
    raise QuantityError(f"'{text[:60]}' has an unknown unit")


def expect(text: object, unit: str, field: str) -> float:
    """A quantity that must be in `unit` (base unit)."""
    try:
        value, found = quantity(text)
    except QuantityError as error:
        raise QuantityError(f"{field}: {error}") from error
    if found != unit:
        raise QuantityError(f"{field}: '{text}' must be in {unit or 'no unit'}")
    return value


def scaled_unit(text: object, field: str) -> tuple[float, str]:
    """A column unit such as 'mV' or 'uA' -> (factor to the base unit, base unit V, A or W)."""
    if not isinstance(text, str):
        raise QuantityError(f"{field} must be a unit such as V, mV, A or mA")
    for base in SIGNAL_UNITS:
        if text.endswith(base) and text[: -len(base)] in PREFIXES:
            return PREFIXES[text[: -len(base)]], base
    raise QuantityError(f"{field}: '{text[:40]}' is not V, A or W with an optional prefix (p n u µ m k M G)")


def time_unit(text: object, field: str) -> float:
    if not isinstance(text, str) or text not in TIME_UNITS:
        raise QuantityError(f"{field} must be one of {', '.join(TIME_UNITS)}")
    return TIME_UNITS[text]


def amount(text: object, unit: str, field: str) -> tuple[float, bool]:
    """A quantity in `unit` or a percentage: (value, is_percent). With a % unit, '%' is the unit itself."""
    try:
        value, found = quantity(text)
    except QuantityError as error:
        raise QuantityError(f"{field}: {error}") from error
    if found == "%" and unit != "%":
        return value, True
    if found != unit:
        raise QuantityError(f"{field}: '{text}' must be in {unit or 'no unit'} or a percentage")
    return value, False


def same_condition(left: str, right: str) -> bool:
    """Condition texts are equal as quantities of one unit (5 V == 5000 mV) or, otherwise, as words."""
    try:
        a, unit_a = quantity(left)
        b, unit_b = quantity(right)
    except QuantityError:
        return " ".join(left.split()).casefold() == " ".join(right.split()).casefold()
    return unit_a == unit_b and abs(a - b) <= 1e-9 * max(abs(a), abs(b), 1e-300)


def show(value: float | None, unit: str) -> str:
    """A value for reports, with an engineering prefix: 2.19722e-05 s -> '21.9722 us'."""
    if value is None:
        return "unknown"
    if unit not in ("Hz", "V", "A", "W", "s", "ohm"):
        return f"{value:.6g} {unit}".rstrip()
    if value == 0:
        return f"0 {unit}"
    for prefix, factor in (("G", 1e9), ("M", 1e6), ("k", 1e3), ("", 1.0), ("m", 1e-3), ("u", 1e-6), ("n", 1e-9)):
        if abs(value) >= factor * 0.9999995:
            return f"{value / factor:.6g} {prefix}{unit}"
    return f"{value / 1e-12:.6g} p{unit}"
