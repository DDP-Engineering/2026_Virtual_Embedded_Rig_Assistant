"""Decoding and encoding of characteristic values by a profile's payload schema (spec REQ-DATA-e8502710 sections 5a
and 6). The raw bytes are always kept; a value that does not fit the schema never becomes a measurement
(REQ-DATA-c1bd7c16).
"""

from __future__ import annotations

import math
import re
import struct
from decimal import Decimal, InvalidOperation
from typing import Any

from .profile import Payload
from .report import refused

NUMBER = re.compile(r"-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?")


def _round(value: float) -> float:
    """Removes binary noise of scale arithmetic (0.01 * 2325 = 23.250000000000004) without inventing precision."""
    return float(f"{value:.12g}")


def decode(payload: Payload, data: bytes) -> dict[str, Any]:
    out: dict[str, Any] = {"raw": data.hex(), "length": len(data), "value": None, "unit": payload.unit, "valid": False, "decodeError": None}
    if payload.type in ("utf8", "bytes"):
        if not payload.min_length <= len(data) <= payload.max_length:
            out["decodeError"] = "length"
            return out
        if payload.type == "bytes":
            out.update(value=data.hex(), valid=True)
            return out
        try:
            out.update(value=data.decode("utf-8"), valid=True)
        except UnicodeDecodeError:
            out["decodeError"] = "utf8"
        return out
    if len(data) != payload.size:
        out["decodeError"] = "length"
        return out
    if payload.type == "float":
        number = struct.unpack(("<" if payload.byte_order == "little" else ">") + ("f" if payload.size == 4 else "d"), data)[0]
        if not math.isfinite(number):
            out["decodeError"] = "not-finite"
            return out
    else:
        number = int.from_bytes(data, payload.byte_order, signed=payload.type == "int")
    value = _round(number * payload.scale + payload.offset)
    out["value"] = value
    if (payload.minimum is not None and value < payload.minimum) or (payload.maximum is not None and value > payload.maximum):
        out["decodeError"] = "out-of-range"
        return out
    out["valid"] = True
    return out


def encode(payload: Payload, text: str | None) -> bytes:
    """The bytes of a typed write's --value; Refused before the radio when it is missing, out of range or not exact."""
    if text is None:
        raise refused("value-required", "This write operation is typed: name the value with --value.")
    if not NUMBER.fullmatch(text):
        raise refused("value-out-of-range", f"--value '{text[:40]}' is not a decimal number.")
    value = Decimal(text)
    if (payload.minimum is not None and value < Decimal(repr(payload.minimum))) or (payload.maximum is not None and value > Decimal(repr(payload.maximum))):
        raise refused("value-out-of-range", f"--value {text} lies outside {payload.minimum} to {payload.maximum} {payload.unit}.")
    try:
        raw = (value - Decimal(repr(payload.offset))) / Decimal(repr(payload.scale))
    except InvalidOperation as error:
        raise refused("value-not-representable", f"--value {text} cannot be encoded.") from error
    size = int(payload.size or 0)
    if payload.type == "float":
        packed = struct.pack(("<" if payload.byte_order == "little" else ">") + ("f" if size == 4 else "d"), float(raw))
        return packed
    if raw != raw.to_integral_value():
        raise refused("value-not-representable", f"--value {text} is not a whole multiple of the scale {payload.scale} {payload.unit} from {payload.offset}.")
    integer = int(raw)
    low, high = (-(1 << (8 * size - 1)), (1 << (8 * size - 1)) - 1) if payload.type == "int" else (0, (1 << (8 * size)) - 1)
    if not low <= integer <= high:
        raise refused("value-not-representable", f"--value {text} does not fit a {size}-byte {payload.type}.")
    return integer.to_bytes(size, payload.byte_order, signed=payload.type == "int")
