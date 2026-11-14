"""IEEE 488.2 definite-length blocks, waveform preambles and sample decoding (spec REQ-DATA-b3e2930f section 4).

Pure functions: the capture writes the raw block and the preamble so `decode` recomputes identical series.
"""

from __future__ import annotations

import math
import struct
from dataclasses import dataclass
from typing import Any

MAX_BLOCK = 64 * 1024 * 1024


class BlockError(Exception):
    pass


def parse_header(header: bytes) -> int:
    """The data length of a definite-length block header `#<n><n digits>`."""
    if len(header) < 2 or header[:1] != b"#":
        raise BlockError("the reply is not an IEEE 488.2 block (no leading #)")
    digits = chr(header[1])
    if not digits.isdigit() or digits == "0":
        raise BlockError("indefinite-length (#0) or malformed blocks are not supported")
    count = int(digits)
    text = header[2 : 2 + count]
    if len(text) != count or not text.isdigit():
        raise BlockError("the block header is cut short")
    length = int(text)
    if length > MAX_BLOCK:
        raise BlockError(f"the block announces {length} bytes, more than {MAX_BLOCK}")
    return length


@dataclass(frozen=True)
class SampleFormat:
    width: int
    signed: bool
    endian: str
    clip_low: int | None = None
    clip_high: int | None = None

    @staticmethod
    def of(data: dict[str, Any]) -> SampleFormat:
        width, endian = data.get("width"), data.get("endian")
        if width not in (1, 2, 4) or endian not in ("little", "big"):
            raise BlockError("sample width must be 1, 2 or 4 bytes and endian little or big")
        return SampleFormat(width, bool(data.get("signed")), endian, data.get("clipLow"), data.get("clipHigh"))

    def describe(self) -> dict[str, Any]:
        return {
            "width": self.width,
            "signed": self.signed,
            "endian": self.endian,
            "clipLow": self.clip_low,
            "clipHigh": self.clip_high,
        }


def samples(data: bytes, form: SampleFormat) -> list[int]:
    if len(data) % form.width:
        raise BlockError(f"{len(data)} bytes are not a whole number of {form.width}-byte samples")
    code = {1: "b", 2: "h", 4: "i"}[form.width]
    code = code if form.signed else code.upper()
    prefix = "<" if form.endian == "little" else ">"
    return list(struct.unpack(f"{prefix}{len(data) // form.width}{code}", data))


def parse_preamble(reply: str, fields: list[str]) -> dict[str, float]:
    parts = [part.strip() for part in reply.strip().split(",")]
    if len(parts) != len(fields):
        raise BlockError(f"the preamble has {len(parts)} fields, the profile declares {len(fields)}")
    values: dict[str, float] = {}
    for name, text in zip(fields, parts, strict=True):
        try:
            value = float(text)
        except ValueError as error:
            raise BlockError(f"preamble field {name} is {text!r}, not a number") from error
        if not math.isfinite(value):
            raise BlockError(f"preamble field {name} is not finite")
        values[name] = value
    for name in ("xincrement", "yincrement"):
        if values.get(name, 0.0) <= 0:
            raise BlockError(f"preamble field {name} must be positive")
    return values


def series(raw: list[int], preamble: dict[str, float]) -> list[tuple[float, float]]:
    """Time and voltage per sample: t = (i - xreference) * xincrement + xorigin, v = (raw - yorigin - yreference) * yincrement."""
    xinc, xorg, xref = preamble["xincrement"], preamble["xorigin"], preamble["xreference"]
    yinc, yorg, yref = preamble["yincrement"], preamble["yorigin"], preamble["yreference"]
    return [((index - xref) * xinc + xorg, (value - yorg - yref) * yinc) for index, value in enumerate(raw)]


def clipped(raw: list[int], form: SampleFormat) -> int:
    return sum(1 for value in raw if value == form.clip_low or value == form.clip_high)


def csv_text(points: list[tuple[float, float]]) -> str:
    lines = ["time_s,volts"]
    lines.extend(f"{time:.9g},{volts:.9g}" for time, volts in points)
    return "\n".join(lines) + "\n"
