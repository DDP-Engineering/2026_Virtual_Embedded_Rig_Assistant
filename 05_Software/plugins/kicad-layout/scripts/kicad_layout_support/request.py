"""Problems, and the static checks of an edit request (spec REQ-DATA-891d5b5d §6, §7): everything that needs no
board. Units are millimetres and degrees."""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from typing import Any

MAX_OPERATIONS = 1024  # a routed request (freerouting) holds one track per wire path
MAX_POINTS = 64
MAX_LAYERS = 32
COORDINATE = 1000.0
WIDTH = (0.05, 10.0)
DRILL = (0.1, 6.35)
DIAMETER_MAX = 10.0
FORBID = ("tracks", "vias", "pads", "footprints", "zones")
REQUEST_LIMIT = 1024 * 1024
_UUID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
_SHA = re.compile(r"^[0-9a-f]{64}$")
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")
KEYS = {
    "place": ({"op", "footprint"}, {"uuid", "at", "orientation"}),
    "align": ({"op", "footprints"}, {"x", "y", "pitch"}),
    "keepout": ({"op", "layers", "polygon", "forbid"}, set()),
    "track": ({"op", "net", "layer", "width", "points"}, set()),
    "via": ({"op", "net", "at", "diameter", "drill"}, set()),
}


@dataclass(frozen=True)
class Problem:
    kind: str
    where: str
    message: str

    def to_json(self) -> dict[str, str]:
        return {"kind": self.kind, "where": self.where, "message": self.message}


class Refused(Exception):
    """Nothing changed (exit 2)."""

    def __init__(self, problems: list[Problem]):
        super().__init__("; ".join(problem.message for problem in problems))
        self.problems = problems


class Failed(Exception):
    """Nothing saved (exit 3)."""

    def __init__(self, problems: list[Problem]):
        super().__init__("; ".join(problem.message for problem in problems))
        self.problems = problems


def refuse(kind: str, where: str, message: str) -> Refused:
    return Refused([Problem(kind, where, message)])


def fail(kind: str, where: str, message: str) -> Failed:
    return Failed([Problem(kind, where, message)])


def _number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _name(value: Any, limit: int = 255) -> bool:
    return isinstance(value, str) and 0 < len(value) <= limit and not _CONTROL.search(value)


class _Checker:
    def __init__(self) -> None:
        self.problems: list[Problem] = []

    def bad(self, where: str, message: str) -> None:
        self.problems.append(Problem("request", where, message))

    def point(self, value: Any, where: str) -> list[float] | None:
        if not (isinstance(value, list) and len(value) == 2 and all(_number(v) for v in value)):
            self.bad(where, f"{where} must be [x, y] in mm, two numbers.")
            return None
        if any(abs(v) > COORDINATE for v in value):
            self.bad(where, f"{where} lies beyond {COORDINATE:g} mm.")
            return None
        return [float(value[0]), float(value[1])]

    def points(self, value: Any, where: str, least: int) -> list[list[float]] | None:
        if not (isinstance(value, list) and least <= len(value) <= MAX_POINTS):
            self.bad(where, f"{where} must list {least} to {MAX_POINTS} points.")
            return None
        out = [self.point(item, f"{where}[{index}]") for index, item in enumerate(value)]
        return None if any(p is None for p in out) else out  # type: ignore[return-value]

    def size(self, value: Any, where: str, low: float, high: float) -> float | None:
        if not _number(value) or not low <= value <= high:
            self.bad(where, f"{where} must be a number from {low:g} to {high:g} mm.")
            return None
        return float(value)

    def operation(self, index: int, raw: Any) -> dict[str, Any] | None:
        where = f"operations[{index}]"
        if not isinstance(raw, dict) or raw.get("op") not in KEYS:
            self.bad(where, f"{where} must be an object whose op is one of {', '.join(KEYS)}.")
            return None
        op = raw["op"]
        required, optional = KEYS[op]
        missing = sorted(required - raw.keys())
        unknown = sorted(raw.keys() - required - optional)
        if missing or unknown:
            self.bad(where, f"{where} ({op}): " + "; ".join(
                ([f"missing {', '.join(missing)}"] if missing else []) + ([f"unknown {', '.join(unknown)}"] if unknown else [])))
            return None
        before = len(self.problems)
        out: dict[str, Any] = {"op": op, "index": index}
        if op == "place":
            if not _name(raw["footprint"], 64):
                self.bad(where, f"{where}.footprint must be a reference designator.")
            out["footprint"] = raw["footprint"]
            if "uuid" in raw:
                if not (isinstance(raw["uuid"], str) and _UUID.match(raw["uuid"])):
                    self.bad(where, f"{where}.uuid must be a UUID.")
                out["uuid"] = str(raw["uuid"]).lower()
            if "at" not in raw and "orientation" not in raw:
                self.bad(where, f"{where} needs at or orientation.")
            if "at" in raw:
                out["at"] = self.point(raw["at"], f"{where}.at")
            if "orientation" in raw:
                if not _number(raw["orientation"]) or abs(raw["orientation"]) > 3600:
                    self.bad(where, f"{where}.orientation must be a number of degrees.")
                else:
                    out["orientation"] = float(raw["orientation"]) % 360.0
        elif op == "align":
            refs = raw["footprints"]
            if not (isinstance(refs, list) and 2 <= len(refs) <= MAX_OPERATIONS and all(_name(r, 64) for r in refs)):
                self.bad(where, f"{where}.footprints must list 2 to {MAX_OPERATIONS} references.")
            elif len(set(refs)) != len(refs):
                self.bad(where, f"{where}.footprints names a reference twice.")
            out["footprints"] = refs
            axes = [axis for axis in ("x", "y") if axis in raw]
            if len(axes) != 1:
                self.bad(where, f"{where} needs exactly one of x or y.")
            else:
                axis = axes[0]
                if not _number(raw[axis]) or abs(raw[axis]) > COORDINATE:
                    self.bad(where, f"{where}.{axis} must be a coordinate in mm.")
                out["axis"], out["value"] = axis, float(raw[axis]) if _number(raw[axis]) else 0.0
            if "pitch" in raw:
                out["pitch"] = self.size(raw["pitch"], f"{where}.pitch", 0.001, COORDINATE)
        elif op == "keepout":
            layers = raw["layers"]
            if not (isinstance(layers, list) and 1 <= len(layers) <= MAX_LAYERS and all(_name(l, 32) for l in layers)
                    and len(set(layers)) == len(layers)):
                self.bad(where, f"{where}.layers must list 1 to {MAX_LAYERS} distinct layer names.")
            out["layers"] = layers
            out["polygon"] = self.points(raw["polygon"], f"{where}.polygon", 3)
            forbid = raw["forbid"]
            if not (isinstance(forbid, list) and forbid and all(f in FORBID for f in forbid) and len(set(forbid)) == len(forbid)):
                self.bad(where, f"{where}.forbid must list some of {', '.join(FORBID)}.")
            out["forbid"] = forbid
        elif op == "track":
            if not _name(raw["net"]):
                self.bad(where, f"{where}.net must be a net name.")
            if not _name(raw["layer"], 32):
                self.bad(where, f"{where}.layer must be a layer name.")
            out["net"], out["layer"] = raw["net"], raw["layer"]
            out["width"] = self.size(raw["width"], f"{where}.width", *WIDTH)
            out["points"] = self.points(raw["points"], f"{where}.points", 2)
        elif op == "via":
            if not _name(raw["net"]):
                self.bad(where, f"{where}.net must be a net name.")
            out["net"] = raw["net"]
            out["at"] = self.point(raw["at"], f"{where}.at")
            drill = self.size(raw["drill"], f"{where}.drill", *DRILL)
            diameter = self.size(raw["diameter"], f"{where}.diameter", 0.0, DIAMETER_MAX)
            if drill is not None and diameter is not None and diameter <= drill:
                self.bad(where, f"{where}.diameter must be greater than its drill.")
            out["drill"], out["diameter"] = drill, diameter
        return out if len(self.problems) == before else None


def parse(text: str) -> tuple[str, list[dict[str, Any]]]:
    """The request's candidate hash and its checked operations; Refused with every problem otherwise."""
    if len(text.encode("utf-8", "surrogatepass")) > REQUEST_LIMIT:
        raise refuse("request", "request", f"The request is larger than {REQUEST_LIMIT} bytes.")
    try:
        document = json.loads(text, parse_constant=lambda name: (_ for _ in ()).throw(ValueError(name)))
    except (ValueError, RecursionError) as error:
        raise refuse("request", "request", f"The request is not valid JSON: {str(error)[:200]}") from error
    checker = _Checker()
    if not isinstance(document, dict):
        raise refuse("request", "request", "The request must be a JSON object.")
    unknown = sorted(document.keys() - {"format", "candidate", "units", "operations"})
    missing = sorted({"format", "candidate", "units", "operations"} - document.keys())
    if unknown or missing:
        raise refuse("request", "request", "The request " + "; ".join(
            ([f"lacks {', '.join(missing)}"] if missing else []) + ([f"has unknown keys {', '.join(unknown)}"] if unknown else [])) + ".")
    if document["format"] != 1 or isinstance(document["format"], bool):
        checker.bad("format", "The request format must be 1.")
    if not (isinstance(document["candidate"], str) and _SHA.match(document["candidate"])):
        checker.bad("candidate", "candidate must be the candidate's SHA-256 from state.json.")
    if document["units"] != "mm":
        checker.bad("units", "units must be \"mm\" (coordinates and sizes in millimetres, angles in degrees).")
    operations = document["operations"]
    checked: list[dict[str, Any]] = []
    if not (isinstance(operations, list) and 1 <= len(operations) <= MAX_OPERATIONS):
        checker.bad("operations", f"operations must list 1 to {MAX_OPERATIONS} operations.")
    else:
        for index, raw in enumerate(operations):
            op = checker.operation(index, raw)
            if op is not None:
                checked.append(op)
        # KiCad's API duplicates a footprint updated twice in one commit: one operation per footprint.
        placed: dict[str, int] = {}
        for op in checked:
            for ref in [op["footprint"]] if op["op"] == "place" else op["footprints"] if op["op"] == "align" else []:
                where = f"operations[{op['index']}]"
                if ref in placed:
                    checker.bad(where, f"{where} names footprint {ref}, which operations[{placed[ref]}] already moves; "
                                       "move a footprint once per request (one place sets at and orientation together).")
                else:
                    placed[ref] = op["index"]
    if checker.problems:
        raise Refused(checker.problems)
    return document["candidate"], checked
