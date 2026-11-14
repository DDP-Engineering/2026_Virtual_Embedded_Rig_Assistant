"""Meter profiles `profiles/<id>.json` (spec REQ-DATA-dd3e4fe1 section 3): validated data, never code."""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .errors import Refused

FOLDER = Path(__file__).resolve().parents[2] / "profiles"
ID = re.compile(r"[a-z0-9][a-z0-9-]{0,63}")
FIELDS = {"format", "id", "status", "model", "description", "rates", "maxSamples", "maxDuration", "currentRanges",
          "voltageRanges", "markers", "burden", "signConvention"}


@dataclass(frozen=True)
class Range:
    label: str
    limit: float


@dataclass(frozen=True)
class Profile:
    id: str
    status: str
    model: str
    rates: tuple[int, ...]
    max_samples: int
    max_duration: float
    current_ranges: tuple[Range, ...]
    voltage_ranges: tuple[Range, ...]
    markers: tuple[int, ...]
    burden: str
    sign_convention: str

    def current_range(self, label: str) -> Range | None:
        return next((item for item in self.current_ranges if same_label(item.label, label)), None)

    def voltage_range(self, label: str) -> Range | None:
        return next((item for item in self.voltage_ranges if same_label(item.label, label)), None)

    def current_limit(self, code: int | None) -> float:
        """The limit of a sample's range code (an index into currentRanges); the largest for an unknown code."""
        if code is not None and 0 <= code < len(self.current_ranges):
            return self.current_ranges[code].limit
        return max(item.limit for item in self.current_ranges)


def same_label(left: str, right: str) -> bool:
    return normal(left) == normal(right)


def normal(text: str) -> str:
    """A range or option name compared without spaces or case, micro spelled u."""
    return "".join(text.split()).replace("µ", "u").replace("μ", "u").casefold()


def load(profile_id: str) -> Profile:
    if not ID.fullmatch(profile_id):
        raise Refused("request", f"The profile name {profile_id[:40]!r} is not valid.")
    path = FOLDER / f"{profile_id}.json"
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise Refused("request", f"The plugin has no meter profile {profile_id}.") from error
    except (OSError, UnicodeDecodeError, ValueError) as error:
        raise Refused("request", f"The meter profile {profile_id} cannot be read: {error}.") from error
    return parse(document, profile_id)


def parse(document: Any, profile_id: str) -> Profile:
    def bad(message: str) -> Refused:
        return Refused("request", f"The meter profile {profile_id} is invalid: {message}.")

    if not isinstance(document, dict) or set(document) != FIELDS:
        raise bad(f"it needs exactly the fields {', '.join(sorted(FIELDS))}")
    if document["format"] != 1 or document["id"] != profile_id or document["status"] not in ("unverified", "verified"):
        raise bad("format 1, its own id and status unverified or verified are required")
    rates = document["rates"]
    if (not isinstance(rates, list) or not rates or not all(isinstance(r, int) and not isinstance(r, bool) and r > 0 for r in rates)
            or rates != sorted(rates, reverse=True) or len(set(rates)) != len(rates)):
        raise bad("rates must be distinct positive integers in descending order")
    for key in ("maxSamples", "maxDuration"):
        value = document[key]
        if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value) or value <= 0:
            raise bad(f"{key} must be a positive number")

    def ranges(key: str) -> tuple[Range, ...]:
        items = document[key]
        if not isinstance(items, list) or not items:
            raise bad(f"{key} must list ranges")
        out: list[Range] = []
        for item in items:
            if (not isinstance(item, dict) or set(item) != {"label", "limit"} or not isinstance(item["label"], str)
                    or not 1 <= len(item["label"]) <= 16 or not isinstance(item["limit"], (int, float))
                    or isinstance(item["limit"], bool) or not math.isfinite(item["limit"]) or item["limit"] <= 0):
                raise bad(f"each of {key} is {{label, limit > 0}}")
            out.append(Range(item["label"], float(item["limit"])))
        if len({normal(item.label) for item in out}) != len(out):
            raise bad(f"{key} repeats a label")
        return tuple(out)

    markers = document["markers"]
    if not isinstance(markers, list) or not all(isinstance(m, int) and not isinstance(m, bool) and 0 <= m <= 3 for m in markers):
        raise bad("markers are general-purpose input numbers 0 to 3")
    for key in ("model", "description", "burden", "signConvention"):
        if not isinstance(document[key], str) or not document[key]:
            raise bad(f"{key} must be text")
    return Profile(profile_id, document["status"], document["model"], tuple(rates), int(document["maxSamples"]),
                   float(document["maxDuration"]), ranges("currentRanges"), ranges("voltageRanges"), tuple(markers),
                   document["burden"], document["signConvention"])
