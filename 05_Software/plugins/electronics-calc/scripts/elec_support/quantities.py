"""Units, SI prefixes and quantities (spec REQ-DATA-3d15fdfc §3). Every model computes in SI."""

from __future__ import annotations

import functools
import math
import re
from dataclasses import dataclass

from .workspace import control_free

PREFIXES = {
    "f": 1e-15,
    "p": 1e-12,
    "n": 1e-9,
    "u": 1e-6,
    "µ": 1e-6,  # micro sign
    "μ": 1e-6,  # Greek small letter mu
    "m": 1e-3,
    "k": 1e3,
    "M": 1e6,
    "G": 1e9,
}
OHM = "Ω"  # Greek capital omega; the ohm sign U+2126 is accepted on input.
DEGREE_C = "°C"

# base spelling -> (dimension, scale to SI, a prefix is allowed, Celsius scale)
BASES: dict[str, tuple[str, float, bool, bool]] = {
    "V": ("voltage", 1.0, True, False),
    "A": ("current", 1.0, True, False),
    OHM: ("resistance", 1.0, True, False),
    "Ω": ("resistance", 1.0, True, False),
    "Ohm": ("resistance", 1.0, True, False),
    "ohm": ("resistance", 1.0, True, False),
    "W": ("power", 1.0, True, False),
    "F": ("capacitance", 1.0, True, False),
    "Hz": ("frequency", 1.0, True, False),
    "s": ("time", 1.0, True, False),
    "J": ("energy", 1.0, True, False),
    "C": ("charge", 1.0, True, False),
    "K": ("temperature", 1.0, True, False),
    DEGREE_C: ("temperature", 1.0, False, True),
    "℃": ("temperature", 1.0, False, True),
    "degC": ("temperature", 1.0, False, True),
    "K/W": ("thermal-resistance", 1.0, True, False),
    DEGREE_C + "/W": ("thermal-resistance", 1.0, False, False),
    "degC/W": ("thermal-resistance", 1.0, False, False),
    "J/K": ("thermal-capacitance", 1.0, True, False),
    "J/" + DEGREE_C: ("thermal-capacitance", 1.0, True, False),
    "J/degC": ("thermal-capacitance", 1.0, True, False),
    "%": ("ratio", 0.01, False, False),
    "1": ("ratio", 1.0, False, False),
    "": ("ratio", 1.0, False, False),
}

# Result unit of each dimension, and of the two result-only kinds.
RESULT_UNITS = {
    "voltage": "V",
    "current": "A",
    "resistance": OHM,
    "power": "W",
    "capacitance": "F",
    "frequency": "Hz",
    "time": "s",
    "energy": "J",
    "charge": "C",
    "temperature": DEGREE_C,
    "temperature-difference": "K",
    "thermal-resistance": "K/W",
    "thermal-capacitance": "J/K",
    "ratio": "1",
    "angle": "deg",
    "decibel": "dB",
}
NAMES = {
    "voltage": "a voltage (V)",
    "current": "a current (A)",
    "resistance": "a resistance (Ω or Ohm)",
    "power": "a power (W)",
    "capacitance": "a capacitance (F)",
    "frequency": "a frequency (Hz)",
    "time": "a time (s)",
    "energy": "an energy (J)",
    "charge": "a charge (C)",
    "temperature": "a temperature (°C or K)",
    "thermal-resistance": "a thermal resistance (K/W)",
    "thermal-capacitance": "a thermal capacitance (J/K)",
    "ratio": "a ratio (a number, or a value in %)",
}
ZERO_CELSIUS = 273.15
TEXT_LIMIT = 500
QUANTITY_LIMIT = 100  # Characters of a quantity written as text; it is echoed in inputs and messages.
_NUMBER = re.compile(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?")
_NUMERIC_CHARS = frozenset("0123456789+-.,eE")
_NONZERO_DIGIT = re.compile(r"[1-9]")
_NO_PREFIX_TEXT = frozenset({DEGREE_C, "deg", "dB", "1"})
_ENGINEERING = {-15: "f", -12: "p", -9: "n", -6: "µ", -3: "m", 0: "", 3: "k", 6: "M", 9: "G"}


class QuantityError(Exception):
    """A quantity that cannot be read: `code` is `unit`, `number` or `schema`; `sub` extends the field path."""

    def __init__(self, code: str, message: str, sub: str = "") -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.sub = sub


@dataclass(frozen=True)
class Quantity:
    """A parsed quantity. `scaled` is the value in the SI base unit, without the Celsius offset."""

    scaled: float
    dimension: str
    given: str
    celsius: bool = False
    bare: bool = False
    source: str | None = None
    conditions: str | None = None
    note: str | None = None
    si: float = 0.0  # Set by the reader: SI value for the field's role (kelvin for absolute temperatures).

    def metadata(self) -> dict[str, str]:
        pairs = (("source", self.source), ("conditions", self.conditions), ("note", self.note))
        return {key: value for key, value in pairs if value is not None}


def nonzero_literal(literal: str) -> bool:
    """Whether a number literal names a value other than zero (its mantissa has a non-zero digit)."""
    return _NONZERO_DIGIT.search(re.split("[eE]", literal)[0]) is not None


def valid_text(value: object) -> bool:
    """Free text of the contracts: 1..500 characters on one line, without control characters."""
    return isinstance(value, str) and 1 <= len(value) <= TEXT_LIMIT and control_free(value)


TEXT_RULE = f"Use a text of 1..{TEXT_LIMIT} characters on one line, without control characters."


def parse_unit(unit: str) -> tuple[str, float, bool]:
    """Returns (dimension, scale to SI, Celsius scale) of a unit spelling."""
    exact = BASES.get(unit)
    if exact is not None:
        return exact[0], exact[1], exact[3]
    if len(unit) > 1 and unit[0] in PREFIXES:
        base = BASES.get(unit[1:])
        if base is not None and base[2]:
            return base[0], PREFIXES[unit[0]] * base[1], base[3]
    raise QuantityError(
        "unit",
        f"Unknown unit '{unit[:40]}'. Use an SI base unit (V, A, Ω or Ohm, W, F, Hz, s, J, C, K, °C, K/W, J/K, %) "
        "with an optional prefix f, p, n, u, m, k, M or G; prefixes are case-sensitive.",
    )


def _scaled(value: object, shown: str, scale: float, nonzero: bool) -> float:
    """The SI value: finite after scaling, and not rounded to zero from a non-zero number."""
    try:
        number = float(value)  # type: ignore[arg-type]
        scaled = number * scale
    except (OverflowError, ValueError, TypeError) as error:
        raise QuantityError("number", f"'{shown}' is not a finite number.") from error
    if not math.isfinite(scaled):
        raise QuantityError("number", f"'{shown}' is not a finite number in SI units.")
    if scaled == 0 and (nonzero or number != 0):
        raise QuantityError("number", f"'{shown}' is too small to represent; it would be computed as zero.")
    return scaled


@functools.lru_cache(maxsize=4096)
def _parse_text(raw: str) -> Quantity:
    text = raw.strip()
    end = 0
    while end < len(text) and text[end] in _NUMERIC_CHARS:
        end += 1
    number, unit = text[:end], text[end:].strip()
    if not _NUMBER.fullmatch(number):
        raise QuantityError(
            "number",
            f"'{raw[:60]}' does not start with a number such as 12, 3.3 or 4.7e-6 (decimal point, no thousands "
            "separator).",
        )
    dimension, scale, celsius = parse_unit(unit)
    return Quantity(_scaled(number, number, scale, nonzero_literal(number)), dimension, text, celsius=celsius)


def parse_quantity(raw: object) -> Quantity:
    """Reads a quantity given as `"<number> <unit>"`, as `{value, unit, ...}` or as a bare ratio number."""
    if isinstance(raw, bool):
        raise QuantityError("number", "Give a number with a unit, such as '12 V'; true and false are not numbers.")
    if isinstance(raw, (int, float)):
        return Quantity(_scaled(raw, repr(raw)[:60], 1.0, False), "ratio", repr(raw), bare=True)
    if isinstance(raw, str):
        if len(raw) > QUANTITY_LIMIT:
            raise QuantityError("number", f"A quantity is at most {QUANTITY_LIMIT} characters, such as '12 V'.")
        return _parse_text(raw)
    if isinstance(raw, dict):
        unknown = [key for key in raw if key not in ("value", "unit", "source", "conditions", "note")]
        if unknown:
            raise QuantityError(
                "schema", "Unknown field of a quantity; use value, unit, source, conditions, note.", unknown[0]
            )
        if "value" not in raw or "unit" not in raw:
            raise QuantityError(
                "schema", "A quantity object needs value and unit.", "value" if "value" not in raw else "unit"
            )
        value, unit = raw["value"], raw["unit"]
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise QuantityError("number", "The value of a quantity is a JSON number.")
        if not isinstance(unit, str) or len(unit) > QUANTITY_LIMIT:
            raise QuantityError("unit", "The unit of a quantity is a short text such as 'mA'.")
        dimension, scale, celsius = parse_unit(unit.strip())
        for key in ("source", "conditions", "note"):
            if key in raw and not valid_text(raw[key]):
                raise QuantityError("schema", TEXT_RULE, key)
        shown = repr(value)[:60]
        return Quantity(
            _scaled(value, shown, scale, False),
            dimension,
            f"{shown} {unit.strip()}".strip(),
            celsius=celsius,
            source=raw.get("source"),
            conditions=raw.get("conditions"),
            note=raw.get("note"),
        )
    raise QuantityError("schema", "Give a quantity as text such as '12 V' or as {\"value\": 12, \"unit\": \"V\"}.")


def round_significant(value: float, digits: int = 12) -> float:
    """Rounds away floating-point noise; -0.0 becomes 0.0."""
    rounded = float(f"{value:.{digits}g}")
    return 0.0 if rounded == 0 else rounded


def _four(value: float) -> str:
    """Four significant digits: fixed notation from 1e-4 up to 1e6, scientific outside."""
    rounded = float(f"{value:.4g}")
    if rounded == 0:
        return "0"
    exponent = math.floor(math.log10(abs(rounded)))
    if not -4 <= exponent < 6:
        return f"{rounded:.3e}"
    return f"{rounded:.{max(0, 3 - exponent)}f}"


def engineering_text(value: float, unit: str) -> str:
    """`2.610 W`, `1.000 ms`, `90.00 °C`: four significant digits with an SI prefix where the unit takes one."""
    suffix = "" if unit == "1" else f" {unit}"
    rounded = float(f"{value:.4g}")
    if rounded == 0:
        return f"0{suffix}"
    if not math.isfinite(rounded):  # A value next to the largest float rounds up past it.
        return f"{value:.3e}{suffix}"
    if unit in _NO_PREFIX_TEXT:
        return f"{_four(rounded)}{suffix}"
    exponent = 3 * math.floor(math.log10(abs(rounded)) / 3)
    mantissa = rounded / 10.0**exponent if exponent in _ENGINEERING else 0.0
    # The logarithm of a value next to a power of 1000 may land one step off.
    if abs(mantissa) >= 1000:
        exponent += 3
    elif exponent in _ENGINEERING and abs(mantissa) < 1:
        exponent -= 3
    if exponent not in _ENGINEERING:
        return f"{rounded:.3e}{suffix}"
    return f"{_four(rounded / 10.0**exponent)} {_ENGINEERING[exponent]}{unit}"


def display(si: float, kind: str) -> tuple[float, str]:
    """The value and unit a result or input shows for an SI value of `kind` (absolute temperatures in °C)."""
    unit = RESULT_UNITS[kind]
    return (si - ZERO_CELSIUS if kind == "temperature" else si), unit


def quantity_json(value: float, unit: str) -> dict[str, object]:
    return {"value": round_significant(value), "unit": unit, "text": engineering_text(value, unit)}
