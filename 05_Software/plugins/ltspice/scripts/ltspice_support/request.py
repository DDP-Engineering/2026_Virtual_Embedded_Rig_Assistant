"""Strict reading of ltspice-tool requests (spec REQ-DATA-0f9e36a3 §5, §8): ngspice-tool's request with the sweep
bounds LTspice's `.step` needs (two or more distinct values or runs) and point limits counted over every step. Every
problem found in one pass is reported together."""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, field
from typing import Any

PREFIXES = {"p": 1e-12, "n": 1e-9, "u": 1e-6, "µ": 1e-6, "μ": 1e-6, "m": 1e-3, "k": 1e3, "M": 1e6, "G": 1e9}
UNITS = {"s": "s", "Hz": "Hz", "V": "V", "A": "A", "°C": "°C", "degC": "°C", "K": "K", "Ω": "Ω",
         "Ω": "Ω", "ohm": "Ω", "Ohm": "Ω", "W": "W", "%": "%"}
NO_PREFIX = frozenset({"°C", "degC", "%"})
_QUANTITY = re.compile(r"\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*(\S*)\s*")
_NAME = r"[A-Za-z0-9_.#:+\-]{1,64}"
VECTOR = re.compile(rf"(?:v|vdb|vm|vp|vr|vi)\({_NAME}(?:,{_NAME})?\)|i\({_NAME}\)", re.I)
SOURCE = re.compile(r"[VvIi][A-Za-z0-9_.#:+\-]{0,63}")
PARAM = re.compile(r"[A-Za-z_][A-Za-z0-9_]{0,63}")
IDENT = re.compile(r"[a-z0-9][a-z0-9-]{0,63}")
ANALYSES = ("op", "dc", "ac", "tran", "noise")
MEASURES = ("min", "max", "average", "rms", "peak-to-peak", "ripple", "overshoot", "settling", "value-at", "final",
            "average-power")
PROFILES = {"standard": {"tran": 1_000_000, "sweep": 100_000, "time": 600.0},
            "long": {"tran": 5_000_000, "sweep": 100_000, "time": 1700.0}}
_CONTROL = re.compile(r"[\x00-\x1f\x7f-\x9f  ]")


@dataclass
class Problem:
    code: str
    path: str
    message: str

    def json(self) -> dict[str, str]:
        return {"code": self.code, "path": self.path[:200], "message": self.message[:600]}


class Refused(Exception):
    def __init__(self, problems: list[Problem]) -> None:
        super().__init__(problems[0].message if problems else "refused")
        self.problems = problems


@dataclass(frozen=True)
class Quantity:
    value: float
    unit: str
    given: str


@dataclass
class Request:
    netlist: str
    analysis: dict[str, Any]
    vectors: list[str]
    temperature: Quantity | None = None
    parameters: dict[str, float] = field(default_factory=dict)
    measurements: list[dict[str, Any]] = field(default_factory=list)
    criteria: list[dict[str, Any]] = field(default_factory=list)
    profile: str = "standard"
    time_limit: float = 120.0
    sweep: dict[str, Any] | None = None


def load_json(text: str) -> dict[str, Any]:
    def pairs(items: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in items:
            if key in result:
                raise Refused([Problem("json", "", f"The key '{key[:60]}' appears twice in one object.")])
            result[key] = value
        return result

    def constant(name: str) -> Any:
        raise Refused([Problem("json", "", f"{name} is not a finite number.")])

    try:
        data = json.loads(text, object_pairs_hook=pairs, parse_constant=constant)
        json.dumps(data, ensure_ascii=False).encode("utf-8")
    except json.JSONDecodeError as error:
        raise Refused([Problem("json", "", f"The request is not valid JSON: {error.msg} at line {error.lineno}, column {error.colno}.")]) from error
    except (RecursionError, UnicodeEncodeError, ValueError) as error:
        raise Refused([Problem("json", "", "The request cannot be read as JSON text.")]) from error
    if not isinstance(data, dict):
        raise Refused([Problem("json", "", "The request must be one JSON object.")])
    return data


def quantity(raw: object) -> Quantity:
    """A bare number, or a number with an optional SI prefix and unit ("1 ms", "4.7k", "27 °C")."""
    if isinstance(raw, bool):
        raise ValueError("true and false are not quantities")
    if isinstance(raw, (int, float)):
        if not math.isfinite(raw):
            raise ValueError("not a finite number")
        return Quantity(float(raw), "", repr(raw))
    if not isinstance(raw, str) or len(raw) > 60:
        raise ValueError("give a number or a text such as '1 ms'")
    match = _QUANTITY.fullmatch(raw)
    if not match:
        raise ValueError(f"'{raw[:40]}' does not start with a number")
    number, unit = float(match.group(1)), match.group(2)
    scale = 1.0
    if unit and unit not in UNITS:
        if len(unit) > 0 and unit[0] in PREFIXES and (unit[1:] in UNITS or unit[1:] == "") and unit[1:] not in NO_PREFIX:
            scale, unit = PREFIXES[unit[0]], unit[1:]
        else:
            raise ValueError(f"unknown unit '{unit[:20]}'; use s, Hz, V, A, °C, K, Ω, W or % with a prefix p n u µ m k M G")
    value = number * scale
    if not math.isfinite(value):
        raise ValueError("not a finite number")
    return Quantity(value, UNITS.get(unit, unit), raw.strip())


class _Reader:
    def __init__(self) -> None:
        self.problems: list[Problem] = []

    def fail(self, code: str, path: str, message: str) -> None:
        self.problems.append(Problem(code, path, message))

    def keys(self, node: Any, path: str, required: tuple[str, ...], optional: tuple[str, ...] = ()) -> bool:
        if not isinstance(node, dict):
            self.fail("schema", path, "This must be a JSON object.")
            return False
        for key in node:
            if key not in required + optional:
                self.fail("schema", f"{path}.{key}".lstrip("."), f"Unknown field; use {', '.join(required + optional)}.")
        for key in required:
            if key not in node:
                self.fail("schema", f"{path}.{key}".lstrip("."), "This field is required.")
        return True

    def text(self, value: Any, path: str, limit: int = 500) -> str | None:
        if not isinstance(value, str) or not value.strip() or len(value) > limit or _CONTROL.search(value):
            self.fail("schema", path, f"Use a text of 1..{limit} characters on one line.")
            return None
        return value.strip()

    def quantity(self, value: Any, path: str, units: tuple[str, ...], positive: bool = False) -> Quantity | None:
        try:
            q = quantity(value)
        except ValueError as error:
            self.fail("unit", path, f"{str(error)[:200]}.")
            return None
        if q.unit and q.unit not in units:
            self.fail("unit", path, f"Use {' or '.join(units)} here, not {q.unit}.")
            return None
        if positive and q.value <= 0:
            self.fail("limit", path, "Use a value above zero.")
            return None
        return q

    def integer(self, value: Any, path: str, low: int, high: int) -> int | None:
        if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
            self.fail("schema", path, f"Use a whole number from {low} to {high}.")
            return None
        return value


def _analysis(r: _Reader, node: Any) -> dict[str, Any] | None:
    if not isinstance(node, dict) or node.get("kind") not in ANALYSES:
        r.fail("schema", "analysis.kind", f"Use one of {', '.join(ANALYSES)}.")
        return None
    kind = node["kind"]
    if kind == "op":
        r.keys(node, "analysis", ("kind",))
        return {"kind": "op"}
    if kind == "dc":
        if not r.keys(node, "analysis", ("kind", "source", "start", "stop", "step")):
            return None
        source = node.get("source")
        if not isinstance(source, str) or not SOURCE.fullmatch(source):
            r.fail("schema", "analysis.source", "Name an independent V or I source of the netlist.")
        start, stop = (r.quantity(node.get(k), f"analysis.{k}", ("V", "A")) for k in ("start", "stop"))
        step = r.quantity(node.get("step"), "analysis.step", ("V", "A"), positive=True)
        if None in (start, stop, step) or not isinstance(source, str) or not SOURCE.fullmatch(source):
            return None
        if stop.value <= start.value:
            r.fail("schema", "analysis.stop", "The stop value must lie above the start value; the sweep runs upward.")
            return None
        return {"kind": "dc", "source": source, "start": start, "stop": stop, "step": step,
                "points": int(abs(stop.value - start.value) / step.value) + 1}
    if kind in ("ac", "noise"):
        required = ("kind", "sweep", "points", "start", "stop") + (("output", "source") if kind == "noise" else ())
        if not r.keys(node, "analysis", required):
            return None
        sweep = node.get("sweep")
        if sweep not in ("dec", "oct", "lin"):
            r.fail("schema", "analysis.sweep", "Use dec, oct or lin.")
        points = r.integer(node.get("points"), "analysis.points", 1, 100_000)
        start = r.quantity(node.get("start"), "analysis.start", ("Hz",), positive=True)
        stop = r.quantity(node.get("stop"), "analysis.stop", ("Hz",), positive=True)
        extra: dict[str, Any] = {}
        if kind == "noise":
            output, source = node.get("output"), node.get("source")
            if not isinstance(output, str) or not re.fullmatch(r"v\([A-Za-z0-9_.#:+\-]{1,64}(?:,[A-Za-z0-9_.#:+\-]{1,64})?\)", output, re.I):
                r.fail("schema", "analysis.output", "Use an output voltage such as v(out) or v(out,ref).")
            if not isinstance(source, str) or not SOURCE.fullmatch(source):
                r.fail("schema", "analysis.source", "Name the input source of the netlist.")
            extra = {"output": output, "source": source}
        if None in (points, start, stop) or sweep not in ("dec", "oct", "lin") or (kind == "noise" and len(r.problems)):
            return None
        assert start and stop and points
        if stop.value < start.value:
            r.fail("schema", "analysis.stop", "The stop frequency must not be below the start.")
            return None
        if sweep == "lin":
            total = points
        else:
            base = 10 if sweep == "dec" else 2
            total = int(math.ceil(math.log(stop.value / start.value, base) * points)) + 1 if stop.value > start.value else 1
        return {"kind": kind, "sweep": sweep, "points": points, "start": start, "stop": stop, "total": total, **extra}
    if not r.keys(node, "analysis", ("kind", "step", "stop"), ("start", "maxStep")):
        return None
    step = r.quantity(node.get("step"), "analysis.step", ("s",), positive=True)
    stop = r.quantity(node.get("stop"), "analysis.stop", ("s",), positive=True)
    start = r.quantity(node["start"], "analysis.start", ("s",)) if "start" in node else Quantity(0.0, "s", "0")
    max_step = r.quantity(node["maxStep"], "analysis.maxStep", ("s",), positive=True) if "maxStep" in node else None
    if None in (step, stop, start) or ("maxStep" in node and max_step is None):
        return None
    assert step and stop and start
    if not 0 <= start.value < stop.value:
        r.fail("schema", "analysis.start", "Use a start time from 0 up to below the stop time.")
        return None
    return {"kind": "tran", "step": step, "stop": stop, "start": start, "maxStep": max_step,
            "points": int(stop.value / step.value) + 1}


def _measurements(r: _Reader, raw: Any, vectors: list[str]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    if not isinstance(raw, list) or len(raw) > 64:
        r.fail("schema", "measurements", "Use a list of at most 64 measurements.")
        return result
    for index, node in enumerate(raw):
        path = f"measurements.{index}"
        if not isinstance(node, dict):
            r.fail("schema", path, "This must be a JSON object.")
            continue
        kind = node.get("kind")
        needs = {"average-power": ("id", "kind", "voltage", "current"), "value-at": ("id", "kind", "vector", "at"),
                 "settling": ("id", "kind", "vector", "band"),
                 # Ripple is the swing after the circuit has settled: the window that says where that starts is required.
                 "ripple": ("id", "kind", "vector", "window")}.get(kind, ("id", "kind", "vector"))
        if not r.keys(node, path, needs, () if kind == "ripple" else ("window",)):
            continue
        ident = node.get("id")
        if not isinstance(ident, str) or not IDENT.fullmatch(ident) or ident in seen:
            r.fail("schema", f"{path}.id", "Use a unique id of lower-case letters, digits and hyphens.")
            continue
        seen.add(ident)
        if kind not in MEASURES:
            r.fail("schema", f"{path}.kind", f"Use one of {', '.join(MEASURES)}.")
            continue
        entry: dict[str, Any] = {"id": ident, "kind": kind}
        for key in ("vector", "voltage", "current"):
            if key in node:
                value = node[key]
                if not isinstance(value, str) or value.lower() not in [v.lower() for v in vectors]:
                    r.fail("schema", f"{path}.{key}", "Name one of the request's vectors.")
                else:
                    entry[key] = value
        if kind == "average-power":
            if "voltage" in entry and not entry["voltage"].lower().startswith("v("):
                r.fail("schema", f"{path}.voltage", "Use a voltage vector v(a) or v(a,b).")
            if "current" in entry and not entry["current"].lower().startswith("i("):
                r.fail("schema", f"{path}.current", "Use a current vector i(Vname).")
        if "at" in node:
            entry["at"] = r.quantity(node["at"], f"{path}.at", ("s", "Hz", "V", "A"))
        if "band" in node:
            entry["band"] = r.quantity(node["band"], f"{path}.band", ("V", "A", "%"), positive=True)
        if "window" in node:
            window = node["window"]
            if r.keys(window, f"{path}.window", (), ("from", "to")):
                entry["window"] = {k: r.quantity(window[k], f"{path}.window.{k}", ("s", "Hz", "V", "A")) for k in ("from", "to") if k in window}
        result.append(entry)
    return result


def _criteria(r: _Reader, raw: Any, measures: set[str]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    if not isinstance(raw, list) or len(raw) > 64:
        r.fail("schema", "criteria", "Use a list of at most 64 criteria.")
        return result
    for index, node in enumerate(raw):
        path = f"criteria.{index}"
        if not r.keys(node, path, ("measurement", "op", "value"), ("tolerance",)):
            continue
        if node.get("measurement") not in measures:
            r.fail("schema", f"{path}.measurement", "Name a measurement id of this request.")
            continue
        if node.get("op") not in ("<=", ">=", "=="):
            r.fail("schema", f"{path}.op", "Use <=, >= or ==.")
            continue
        value = r.quantity(node.get("value"), f"{path}.value", ("s", "Hz", "V", "A", "W", "°C", "K", "Ω", "%"))
        tolerance = r.quantity(node["tolerance"], f"{path}.tolerance", ("s", "Hz", "V", "A", "W", "°C", "K", "Ω", "%")) if "tolerance" in node else None
        if value is not None:
            result.append({"measurement": node["measurement"], "op": node["op"], "value": value, "tolerance": tolerance})
    return result


def read(document: dict[str, Any], sweep: bool = False, known: list[str] | None = None) -> Request:
    """`known`: the vectors of an existing run (measure); then the vector syntax check gives way to that list."""
    r = _Reader()
    optional = ("temperature", "parameters", "measurements", "criteria", "profile", "timeLimit") + (("sweep", "monteCarlo") if sweep else ())
    r.keys(document, "", ("netlist", "analysis", "vectors"), optional)
    netlist = r.text(document.get("netlist"), "netlist", 1024)
    analysis = _analysis(r, document.get("analysis"))
    vectors_raw = document.get("vectors")
    vectors: list[str] = []
    if not isinstance(vectors_raw, list) or not 1 <= len(vectors_raw) <= 32:
        r.fail("limit", "vectors", "Name 1 to 32 vectors.")
    else:
        for index, vector in enumerate(vectors_raw):
            if known is not None:
                if vector not in known:
                    r.fail("schema", f"vectors.{index}", "Name a vector of the run's series.")
                else:
                    vectors.append(vector)
            elif not isinstance(vector, str) or not VECTOR.fullmatch(vector):
                r.fail("schema", f"vectors.{index}", "Use v(n), v(n,m), i(Vname), vdb(n), vm(n), vp(n), vr(n) or vi(n).")
            elif vector.lower() in [v.lower() for v in vectors]:
                r.fail("schema", f"vectors.{index}", "This vector is listed twice.")
            else:
                vectors.append(vector)
    temperature = r.quantity(document["temperature"], "temperature", ("°C",)) if "temperature" in document else None
    parameters: dict[str, float] = {}
    raw_parameters = document.get("parameters", {})
    if not isinstance(raw_parameters, dict) or len(raw_parameters) > 64:
        r.fail("schema", "parameters", "Use an object of at most 64 parameters, name -> value.")
    else:
        for name, value in raw_parameters.items():
            if not PARAM.fullmatch(name):
                r.fail("schema", f"parameters.{name}", "A parameter name is a letter or _ followed by letters, digits or _.")
                continue
            q = r.quantity(value, f"parameters.{name}", tuple(set(UNITS.values())))
            if q is not None:
                parameters[name] = q.value
    measurements = _measurements(r, document.get("measurements", []), vectors)
    criteria = _criteria(r, document.get("criteria", []), {m["id"] for m in measurements})
    profile = document.get("profile", "standard")
    if profile not in PROFILES:
        r.fail("schema", "profile", "Use standard or long.")
        profile = "standard"
    limits = PROFILES[profile]
    time_limit = 120.0
    if "timeLimit" in document:
        q = r.quantity(document["timeLimit"], "timeLimit", ("s",), positive=True)
        if q is not None:
            if q.value > limits["time"]:
                r.fail("limit", "timeLimit", f"The {profile} profile allows at most {limits['time']:.0f} s.")
            time_limit = q.value
    if analysis:
        points = analysis.get("total", analysis.get("points", 1))
        cap = limits["tran"] if analysis["kind"] == "tran" else limits["sweep"]
        if points > cap:
            r.fail("limit", "analysis", f"The analysis asks for {points} points; the {profile} profile allows {cap}.")
    sweep_spec: dict[str, Any] | None = None
    if sweep:
        sweep_spec = _sweep(r, document, parameters)
        if sweep_spec and analysis:
            count = len(sweep_spec["values"]) if sweep_spec["kind"] == "values" else sweep_spec["runs"]
            points = analysis.get("total", analysis.get("points", 1)) * count
            cap = limits["tran"] if analysis["kind"] == "tran" else limits["sweep"]
            if points > cap:
                r.fail("limit", "sweep", f"The sweep asks for {points} points over all steps; the {profile} profile allows {cap}.")
    if r.problems:
        raise Refused(r.problems)
    assert netlist and analysis
    return Request(netlist, analysis, vectors, temperature, parameters, measurements, criteria, profile, time_limit, sweep_spec)


def _sweep(r: _Reader, document: dict[str, Any], parameters: dict[str, float]) -> dict[str, Any] | None:
    has_sweep, has_mc = "sweep" in document, "monteCarlo" in document
    if has_sweep == has_mc:
        r.fail("schema", "sweep", "Give exactly one of sweep and monteCarlo.")
        return None
    if has_sweep:
        node = document["sweep"]
        if not r.keys(node, "sweep", ("parameter", "values")):
            return None
        parameter = node.get("parameter")
        if parameter != "temperature" and (not isinstance(parameter, str) or not PARAM.fullmatch(parameter)):
            r.fail("schema", "sweep.parameter", "Name a .param of the netlist or temperature.")
            return None
        values = node.get("values")
        if not isinstance(values, list) or not 2 <= len(values) <= 100:
            r.fail("limit", "sweep.values", "Give 2 to 100 values (LTspice's .step refuses a single step).")
            return None
        units = ("°C",) if parameter == "temperature" else tuple(set(UNITS.values()))
        read_values = [r.quantity(v, f"sweep.values.{i}", units) for i, v in enumerate(values)]
        if None in read_values:
            return None
        numbers = [q.value for q in read_values if q]
        if len(set(numbers)) != len(numbers):
            r.fail("schema", "sweep.values", "Give distinct values (LTspice's .step refuses repeated values).")
            return None
        return {"kind": "values", "parameter": parameter, "values": numbers}
    node = document["monteCarlo"]
    if not r.keys(node, "monteCarlo", ("seed", "runs", "tolerances")):
        return None
    seed = r.integer(node.get("seed"), "monteCarlo.seed", 0, 2**31 - 1)
    runs = r.integer(node.get("runs"), "monteCarlo.runs", 2, 200)
    tolerances: dict[str, dict[str, Any]] = {}
    raw = node.get("tolerances")
    if not isinstance(raw, dict) or not 1 <= len(raw) <= 32:
        r.fail("schema", "monteCarlo.tolerances", "Give 1 to 32 parameters, name -> {nominal, percent, distribution}.")
        return None
    for name, spec in raw.items():
        path = f"monteCarlo.tolerances.{name}"
        if not PARAM.fullmatch(name) or not r.keys(spec, path, ("nominal", "percent", "distribution")):
            continue
        nominal = r.quantity(spec.get("nominal"), f"{path}.nominal", tuple(set(UNITS.values())))
        percent = spec.get("percent")
        if isinstance(percent, bool) or not isinstance(percent, (int, float)) or not 0 < percent <= 50:
            r.fail("schema", f"{path}.percent", "Use a tolerance above 0 and at most 50 percent.")
            continue
        if spec.get("distribution") not in ("uniform", "gaussian"):
            r.fail("schema", f"{path}.distribution", "Use uniform or gaussian.")
            continue
        if nominal is not None:
            tolerances[name] = {"nominal": nominal.value, "percent": float(percent), "distribution": spec["distribution"]}
    if seed is None or runs is None or not tolerances:
        return None
    return {"kind": "monte-carlo", "seed": seed, "runs": runs, "tolerances": tolerances}
