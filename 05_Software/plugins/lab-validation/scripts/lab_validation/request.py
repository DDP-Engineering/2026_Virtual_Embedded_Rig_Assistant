"""The validation request (spec section 2): read, validated and normalized before any source is opened.

`load` checks the structure and every unit that does not depend on a signal; `bind` checks the rest once the signals
are imported and their units known. Every refusal names the field (exit 2, nothing written).
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from dataclasses import dataclass, field
from typing import Any

from . import importers, metrics, units
from .errors import Refused
from .units import QuantityError
from .workspace import PathRefused, regular_file, relative

LIMIT = 1024 * 1024
ID = re.compile(r"[A-Za-z][A-Za-z0-9_-]{0,31}")
HEX = re.compile(r"[0-9a-fA-F]{64}")
COMMON_SOURCE = {"importer", "path", "sha256", "bandwidth", "probe", "conditions"}
STATISTICS = ("max-abs", "rms", "mean", "lag", "correlation")
OPS = ("<=", ">=", "==")
EDGES = ("rising", "falling")


@dataclass
class Request:
    path: str
    sha256: str
    title: str
    requirement: str | None
    rule: str
    missing: str
    conditions: dict[str, str]
    sources: dict[str, dict[str, Any]]
    signals: dict[str, dict[str, Any]]
    measurements: list[dict[str, Any]]
    comparisons: list[dict[str, Any]]
    criteria: list[dict[str, Any]]
    raw: dict[str, Any] = field(default_factory=dict)


def bad(where: str, message: str) -> Refused:
    return Refused("request", f"{where}: {message}")


def _unique(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in pairs:
        if key in out:
            raise ValueError(f"the key '{key[:40]}' appears twice")
        out[key] = value
    return out


def _constant(name: str) -> Any:
    raise ValueError(f"{name} is not a finite number")


def load(ctx: importers.Context, raw: str) -> Request:
    try:
        path = regular_file(ctx.cwd, raw, "--request", ctx.spelled)
    except PathRefused as error:
        raise Refused("path", str(error)) from error
    if path.stat().st_size > LIMIT:
        raise bad("--request", f"the request is larger than {LIMIT} bytes")
    data = path.read_bytes()
    try:
        document = json.loads(data.decode("utf-8-sig"), object_pairs_hook=_unique, parse_constant=_constant)
    except (UnicodeDecodeError, ValueError) as error:
        raise bad("--request", f"not one JSON object with unique keys and finite numbers ({error})") from error
    try:
        return validate(document, relative(ctx.cwd, path), hashlib.sha256(data).hexdigest())
    except (TypeError, AttributeError, KeyError) as error:
        # A value of an unexpected JSON type deep in an object: still a refused request, never an internal error.
        raise bad("--request", f"a field holds a value of the wrong JSON type ({type(error).__name__}: {str(error)[:80]})") from error


def _object(value: Any, where: str, allowed: set[str], required: set[str] = set()) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise bad(where, "must be an object")
    for key in value:
        if key not in allowed:
            raise bad(f"{where}.{key}" if where else key, "is not a field of this object")
    for key in required:
        if key not in value or value[key] is None:
            raise bad(f"{where}.{key}" if where else key, "is required")
    return value


def _text(value: Any, where: str, limit: int) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > limit or any(ord(c) < 32 for c in value):
        raise bad(where, f"must be text of 1-{limit} characters without control characters")
    return value


def _id(value: Any, where: str) -> str:
    if not isinstance(value, str) or not ID.fullmatch(value):
        raise bad(where, "must be an id of a letter then up to 31 letters, digits, _ or -")
    return value


def _quantity(value: Any, unit: str, where: str) -> float:
    try:
        return units.expect(value, unit, where)
    except QuantityError as error:
        raise Refused("request", str(error)) from error


def _list(value: Any, where: str, limit: int, minimum: int = 0) -> list[Any]:
    if value is None:
        value = []
    if not isinstance(value, list) or not minimum <= len(value) <= limit:
        raise bad(where, f"must be a list of {minimum}-{limit} entries")
    return value


def _window(value: Any, where: str) -> tuple[float, float]:
    window = _object(value, where, {"from", "to"}, {"from", "to"})
    a = _quantity(window["from"], "s", f"{where}.from")
    b = _quantity(window["to"], "s", f"{where}.to")
    if not a < b:
        raise bad(where, "from must lie before to")
    return a, b


def validate(document: Any, path: str, sha256: str) -> Request:
    top = _object(document, "", {"format", "title", "requirement", "decisionRule", "missingData", "conditions", "sources",
                                 "signals", "measurements", "comparisons", "criteria"},
                  {"format", "title", "decisionRule", "missingData", "sources", "signals"})
    if top["format"] != 1 or isinstance(top["format"], bool):
        raise bad("format", "must be 1")
    title = _text(top["title"], "title", 200)
    requirement = _text(top["requirement"], "requirement", 200) if top.get("requirement") is not None else None
    if top["decisionRule"] not in ("simple", "guarded"):
        raise bad("decisionRule", "must be simple or guarded")
    if top["missingData"] not in ("incomplete", "exclude"):
        raise bad("missingData", "must be incomplete or exclude")
    conditions = _conditions(top.get("conditions"), "conditions")

    raw_sources = _object(top["sources"], "sources", set(top["sources"]) if isinstance(top["sources"], dict) else set())
    if not 1 <= len(raw_sources) <= 16:
        raise bad("sources", "must hold 1-16 sources")
    sources = {_id(key, f"sources.{key}"): _source(key, value) for key, value in raw_sources.items()}

    raw_signals = _object(top["signals"], "signals", set(top["signals"]) if isinstance(top["signals"], dict) else set())
    if not 1 <= len(raw_signals) <= 32:
        raise bad("signals", "must hold 1-32 signals")
    signals = {_id(key, f"signals.{key}"): _signal(key, value, sources) for key, value in raw_signals.items()}
    folded = [key.casefold() for key in signals]
    if len(set(folded)) != len(folded):
        raise bad("signals", "ids must differ in more than letter case (their files share a name on Windows)")

    ids: set[str] = set()
    measurements = [_measurement(i, value, signals, ids) for i, value in enumerate(_list(top.get("measurements"), "measurements", 64))]
    comparisons = [_comparison(i, value, signals, ids) for i, value in enumerate(_list(top.get("comparisons"), "comparisons", 16))]
    known = {m["id"]: "measurement" for m in measurements} | {c["id"]: "comparison" for c in comparisons}
    methods = {c["id"]: c["alignment"]["method"] for c in comparisons}
    criteria_ids: set[str] = set()
    criteria = [_criterion(i, value, known, methods, conditions, top["decisionRule"], criteria_ids)
                for i, value in enumerate(_list(top.get("criteria"), "criteria", 128))]
    return Request(path, sha256, title, requirement, top["decisionRule"], top["missingData"], conditions, sources, signals,
                   measurements, comparisons, criteria, top)


def _conditions(value: Any, where: str) -> dict[str, str]:
    if value is None:
        return {}
    entries = _object(value, where, set(value) if isinstance(value, dict) else set())
    if len(entries) > 32:
        raise bad(where, "holds more than 32 conditions")
    for key, text in entries.items():
        _text(key, f"{where} name", 64)
        _text(text, f"{where}.{key}", 120)
    return dict(entries)


def _source(key: str, value: Any) -> dict[str, Any]:
    where = f"sources.{key}"
    if not isinstance(value, dict):
        raise bad(where, "must be an object")
    name = value.get("importer")
    if not isinstance(name, str) or name not in importers.REGISTRY:
        raise bad(f"{where}.importer", f"must be one of {', '.join(importers.REGISTRY)}")
    spec = dict(_object(value, where, COMMON_SOURCE | importers.REGISTRY[name].fields, {"importer", "path"}))
    _text(spec["path"], f"{where}.path", 1024)
    if "sha256" in spec and (not isinstance(spec["sha256"], str) or not HEX.fullmatch(spec["sha256"])):
        raise bad(f"{where}.sha256", "must be 64 hexadecimal digits")
    if "bandwidth" in spec:
        spec["bandwidthText"] = spec["bandwidth"]
        spec["bandwidth"] = math.inf if spec["bandwidth"] == "unlimited" else _quantity(spec["bandwidth"], "Hz", f"{where}.bandwidth")
        if not spec["bandwidth"] > 0:
            raise bad(f"{where}.bandwidth", "must be positive")
    if "probe" in spec:
        _text(spec["probe"], f"{where}.probe", 120)
    spec["conditions"] = _conditions(spec.get("conditions"), f"{where}.conditions")
    if name in ("csv", "sigrok-csv"):
        _csv_fields(spec, where)
    return spec


def _csv_fields(spec: dict[str, Any], where: str) -> None:
    if not isinstance(spec.get("delimiter", ","), str) or spec.get("delimiter", ",") not in importers.DELIMITERS:
        raise bad(f"{where}.delimiter", "must be ',', ';', tab or space")
    if "comment" in spec:
        _text(spec["comment"], f"{where}.comment", 4)
    if not isinstance(spec.get("header", True), bool) or not isinstance(spec.get("uniform", True), bool):
        raise bad(where, "header and uniform must be true or false")
    if "time" in spec and "sampleRate" in spec:
        raise bad(where, "give either time or sampleRate")
    if "time" in spec:
        time = dict(_object(spec["time"], f"{where}.time", {"column", "unit"}, {"column", "unit"}))
        try:
            time["factor"] = units.time_unit(time["unit"], f"{where}.time.unit")
        except QuantityError as error:
            raise Refused("request", str(error)) from error
        spec["time"] = time
    if "sampleRate" in spec:
        spec["sampleRate"] = _quantity(spec["sampleRate"], "Hz", f"{where}.sampleRate")
        if not spec["sampleRate"] > 0:
            raise bad(f"{where}.sampleRate", "must be positive")
        spec["start"] = _quantity(spec.get("start", "0 s"), "s", f"{where}.start")
    elif "start" in spec:
        raise bad(f"{where}.start", "goes with sampleRate only")
    columns = _object(spec.get("columns"), f"{where}.columns", set(spec.get("columns") or {}) if isinstance(spec.get("columns"), dict) else set())
    if not 1 <= len(columns) <= 32:
        raise bad(f"{where}.columns", "must map 1-32 channels")
    normalized = {}
    for name, column in columns.items():
        cwhere = f"{where}.columns.{name}"
        _text(name, f"{where}.columns name", 64)
        column = dict(_object(column, cwhere, {"column", "unit", "clip"}, {"column", "unit"}))
        try:
            column["factor"], column["base"] = units.scaled_unit(column["unit"], f"{cwhere}.unit")
        except QuantityError as error:
            raise Refused("request", str(error)) from error
        if "clip" in column:
            clip = _object(column["clip"], f"{cwhere}.clip", {"low", "high"})
            if "low" in clip:
                column["clipLow"] = _quantity(clip["low"], column["base"], f"{cwhere}.clip.low")
            if "high" in clip:
                column["clipHigh"] = _quantity(clip["high"], column["base"], f"{cwhere}.clip.high")
        normalized[name] = column
    spec["columns"] = normalized


def _signal(key: str, value: Any, sources: dict[str, dict[str, Any]]) -> dict[str, Any]:
    where = f"signals.{key}"
    spec = dict(_object(value, where, {"source", "channel", "sign", "scale", "unit", "preprocess"}, {"source", "channel"}))
    if not isinstance(spec["source"], str) or spec["source"] not in sources:
        raise bad(f"{where}.source", f"names no source of the request ({spec['source']!s:.40})")
    _text(spec["channel"], f"{where}.channel", 64)
    spec.setdefault("sign", 1)
    if spec["sign"] not in (1, -1) or isinstance(spec["sign"], bool):
        raise bad(f"{where}.sign", "must be 1 or -1")
    spec.setdefault("scale", 1)
    scale = spec["scale"]
    if isinstance(scale, bool) or not isinstance(scale, (int, float)) or not scale > 0:
        raise bad(f"{where}.scale", "must be a positive number")
    if "unit" in spec and spec["unit"] not in units.SIGNAL_UNITS:
        raise bad(f"{where}.unit", "must be V, A or W")
    steps = []
    for index, step in enumerate(_list(spec.get("preprocess"), f"{where}.preprocess", 4)):
        swhere = f"{where}.preprocess[{index}]"
        if not isinstance(step, dict) or len(step) != 1 or next(iter(step)) not in ("resample", "filter"):
            raise bad(swhere, "must be {\"resample\": {...}} or {\"filter\": {...}}")
        if "resample" in step:
            body = _object(step["resample"], f"{swhere}.resample", {"method", "rate"}, {"method", "rate"})
            if body["method"] != "linear":
                raise bad(f"{swhere}.resample.method", "must be linear")
            rate = _quantity(body["rate"], "Hz", f"{swhere}.resample.rate")
            if not rate > 0:
                raise bad(f"{swhere}.resample.rate", "must be positive")
            steps.append({"step": "resample", "method": "linear", "rate": rate, "where": swhere})
        else:
            body = _object(step["filter"], f"{swhere}.filter", {"kind", "width"}, {"kind", "width"})
            if body["kind"] != "moving-average":
                raise bad(f"{swhere}.filter.kind", "must be moving-average")
            width = _quantity(body["width"], "s", f"{swhere}.filter.width")
            if not width > 0:
                raise bad(f"{swhere}.filter.width", "must be positive")
            steps.append({"step": "filter", "kind": "moving-average", "width": width, "where": swhere})
    spec["preprocess"] = steps
    return spec


def _new_id(value: Any, where: str, ids: set[str]) -> str:
    """Unique also under letter case: comparison ids name files, which Windows does not tell apart by case."""
    identifier = _id(value, where)
    if identifier.casefold() in ids:
        raise bad(where, f"'{identifier}' is used twice (letter case does not count)")
    ids.add(identifier.casefold())
    return identifier


def _measurement(index: int, value: Any, signals: dict[str, Any], ids: set[str]) -> dict[str, Any]:
    where = f"measurements[{index}]"
    if not isinstance(value, dict):
        raise bad(where, "must be an object")
    name = value.get("metric")
    metric = metrics.REGISTRY.get(name) if isinstance(name, str) else None
    if metric is None:
        raise bad(f"{where}.metric", f"must be one of {', '.join(metrics.REGISTRY)}")
    spec = dict(_object(value, where, {"id", "signal", "metric", "window"} | set(metric.fields), {"id", "signal", "metric", "window"} | set(metric.required)))
    spec["id"] = _new_id(spec["id"], f"{where}.id", ids)
    if not isinstance(spec["signal"], str) or spec["signal"] not in signals:
        raise bad(f"{where}.signal", f"names no signal ({spec['signal']!s:.40})")
    spec["a"], spec["b"] = _window(spec["window"], f"{where}.window")
    for name, kind in metric.fields.items():
        if name not in spec:
            continue
        fwhere = f"{where}.{name}"
        if kind == "levels":
            _object(spec[name], fwhere, {"low", "high"}, {"low", "high"})
        elif kind == "percent":
            if spec[name] not in ([10, 90], [20, 80]):
                raise bad(fwhere, "must be [10, 90] or [20, 80]")
        elif kind == "edge":
            if spec[name] not in EDGES:
                raise bad(fwhere, "must be rising or falling")
        elif kind == "signal":
            if not isinstance(spec[name], str) or spec[name] not in signals or spec[name] == spec["signal"]:
                raise bad(fwhere, "must name another signal of the request")
        elif kind == "time":
            spec[f"{name}Value"] = _quantity(spec[name], "s", fwhere)
        elif kind in ("band", "level"):
            if not isinstance(spec[name], str):
                raise bad(fwhere, "must be a quantity")
    return spec


def _alignment(value: Any, where: str, signals: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise bad(where, "must be an object")
    method = value.get("method")
    if method == "none":
        return dict(_object(value, where, {"method"}))
    if method == "offset":
        spec = dict(_object(value, where, {"method", "offset"}, {"offset"}))
        spec["lag"] = _quantity(spec["offset"], "s", f"{where}.offset")
        return spec
    if method == "cross-correlation":
        spec = dict(_object(value, where, {"method", "maxLag"}, {"maxLag"}))
        spec["maxLagValue"] = _quantity(spec["maxLag"], "s", f"{where}.maxLag")
        if not spec["maxLagValue"] > 0:
            raise bad(f"{where}.maxLag", "must be positive")
        return spec
    if method == "marker":
        spec = dict(_object(value, where, {"method", "measured", "reference"}, {"measured", "reference"}))
        for side in ("measured", "reference"):
            marker = dict(_object(spec[side], f"{where}.{side}", {"signal", "level", "edge", "after"}, {"signal", "level"}))
            if not isinstance(marker["signal"], str) or marker["signal"] not in signals:
                raise bad(f"{where}.{side}.signal", "names no signal")
            if marker.get("edge", "rising") not in EDGES:
                raise bad(f"{where}.{side}.edge", "must be rising or falling")
            if "after" in marker:
                marker["afterValue"] = _quantity(marker["after"], "s", f"{where}.{side}.after")
            if not isinstance(marker["level"], str):
                raise bad(f"{where}.{side}.level", "must be a quantity or a percentage")
            spec[side] = marker
        return spec
    raise bad(f"{where}.method", "must be none, offset, marker or cross-correlation")


def _comparison(index: int, value: Any, signals: dict[str, Any], ids: set[str]) -> dict[str, Any]:
    where = f"comparisons[{index}]"
    spec = dict(_object(value, where, {"id", "signal", "reference", "window", "alignment"}, {"id", "signal", "reference", "window", "alignment"}))
    spec["id"] = _new_id(spec["id"], f"{where}.id", ids)
    for side in ("signal", "reference"):
        if not isinstance(spec[side], str) or spec[side] not in signals:
            raise bad(f"{where}.{side}", f"names no signal ({spec[side]!s:.40})")
    if spec["signal"] == spec["reference"]:
        raise bad(f"{where}.reference", "must differ from signal")
    spec["a"], spec["b"] = _window(spec["window"], f"{where}.window")
    spec["alignment"] = _alignment(spec["alignment"], f"{where}.alignment", signals)
    return spec


def _criterion(index: int, value: Any, known: dict[str, str], methods: dict[str, str], conditions: dict[str, str], rule: str,
               ids: set[str]) -> dict[str, Any]:
    where = f"criteria[{index}]"
    spec = dict(_object(value, where, {"id", "value", "op", "limit", "tolerance", "uncertainty", "rule", "conditions"}, {"id", "value", "op", "limit"}))
    spec["id"] = _new_id(spec["id"], f"{where}.id", ids)
    target = spec["value"]
    if not isinstance(target, str):
        raise bad(f"{where}.value", "must name a measurement or <comparison>.<statistic>")
    if target in known and known[target] == "measurement":
        spec["source"] = ("measurement", target, None)
    elif "." in target and target.rsplit(".", 1)[0] in known and target.rsplit(".", 1)[1] in STATISTICS:
        spec["source"] = ("comparison", target.rsplit(".", 1)[0], target.rsplit(".", 1)[1])
    else:
        raise bad(f"{where}.value", f"'{target[:60]}' is no measurement id and no <comparison>.<{'|'.join(STATISTICS)}>")
    if spec["source"][2] == "correlation" and methods[spec["source"][1]] != "cross-correlation":
        raise bad(f"{where}.value", f"comparison {spec['source'][1]} has no correlation: only cross-correlation computes one")
    if spec["op"] not in OPS:
        raise bad(f"{where}.op", "must be <=, >= or ==")
    for name in ("limit", "tolerance", "uncertainty"):
        if name in spec and not isinstance(spec[name], str):
            raise bad(f"{where}.{name}", "must be a quantity")
    if spec["op"] == "==" and "tolerance" not in spec:
        raise bad(f"{where}.tolerance", "is required with ==")
    if spec["op"] != "==" and "tolerance" in spec:
        raise bad(f"{where}.tolerance", "goes with == only")
    spec["rule"] = spec.get("rule", rule)
    if spec["rule"] not in ("simple", "guarded"):
        raise bad(f"{where}.rule", "must be simple or guarded")
    names = spec.get("conditions", list(conditions))
    if not isinstance(names, list) or any(not isinstance(name, str) or name not in conditions for name in names):
        raise bad(f"{where}.conditions", "must list condition names of the request")
    spec["conditionNames"] = names
    return spec


# ---- bind: the checks that need the imported signals ----


def bind(request: Request, signals: dict[str, Any]) -> None:
    """Units of levels, bands, markers and limits; one clock for delays and markers; one quantity per comparison."""
    measured_units: dict[str, str] = {}
    for index, spec in enumerate(request.measurements):
        where = f"measurements[{index}]"
        signal = signals[spec["signal"]]
        metric = metrics.REGISTRY[spec["metric"]]
        params: dict[str, Any] = {}
        for name, kind in metric.fields.items():
            if name not in spec:
                continue
            fwhere = f"{where}.{name}"
            if kind == "levels":
                unit = signals[spec["reference"]].unit if name == "referenceLevels" else signal.unit
                low = _quantity(spec[name]["low"], unit, f"{fwhere}.low")
                high = _quantity(spec[name]["high"], unit, f"{fwhere}.high")
                if not high > low:
                    raise bad(fwhere, "high must lie above low")
                params[name] = (low, high)
            elif kind == "percent":
                params[name] = tuple(float(x) for x in spec[name])
            elif kind == "band":
                try:
                    amount, percent = units.amount(spec[name], signal.unit, fwhere)
                except QuantityError as error:
                    raise Refused("request", str(error)) from error
                if not amount > 0:
                    raise bad(fwhere, "must be positive")
                params[name] = (amount, percent)
            elif kind == "level":
                params[name] = _quantity(spec[name], signal.unit, fwhere)
            elif kind == "time":
                params[name] = spec[f"{name}Value"]
            elif kind == "edge":
                params[name] = spec[name]
            elif kind == "signal":
                other = signals[spec[name]]
                if other.source.id != signal.source.id:
                    raise Refused("clock", f"{fwhere}: {spec[name]} comes from source {other.source.id}, {spec['signal']} from "
                                  f"{signal.source.id}; a delay needs one clock (compare across sources with a declared marker)")
                params[name] = spec[name]
        spec["params"] = params
        measured_units[spec["id"]] = metric.unit(signal.unit)
    comparison_units: dict[str, str] = {}
    for index, spec in enumerate(request.comparisons):
        where = f"comparisons[{index}]"
        signal, reference = signals[spec["signal"]], signals[spec["reference"]]
        if signal.unit != reference.unit:
            raise Refused("quantity", f"{where}: {spec['signal']} is in {signal.unit}, {spec['reference']} in {reference.unit}; "
                          "only one quantity is compared")
        alignment = spec["alignment"]
        if alignment["method"] == "cross-correlation" and not signal.series.uniform:
            raise bad(f"{where}.alignment", f"cross-correlation needs a uniformly sampled measured signal; resample {spec['signal']} first")
        if alignment["method"] == "marker":
            for side, compared in (("measured", signal), ("reference", reference)):
                marker = alignment[side]
                marked = signals[marker["signal"]]
                if marked.source.id != compared.source.id:
                    raise Refused("clock", f"{where}.alignment.{side}.signal: {marker['signal']} comes from source {marked.source.id}, "
                                  f"not from {compared.source.id}; a marker must share the clock of the signal it aligns")
                try:
                    amount, percent = units.amount(marker["level"], marked.unit, f"{where}.alignment.{side}.level")
                except QuantityError as error:
                    raise Refused("request", str(error)) from error
                marker["levelValue"], marker["levelPercent"] = amount, percent
        comparison_units[spec["id"]] = signal.unit
    for index, spec in enumerate(request.criteria):
        where = f"criteria[{index}]"
        kind, target, statistic = spec["source"]
        if kind == "measurement":
            unit = measured_units[target]
        else:
            unit = "s" if statistic == "lag" else "" if statistic == "correlation" else comparison_units[target]
        spec["unit"] = unit
        spec["limitValue"] = _quantity(spec["limit"], unit, f"{where}.limit")
        for name in ("tolerance", "uncertainty"):
            if name in spec:
                try:
                    amount, percent = units.amount(spec[name], unit, f"{where}.{name}")
                except QuantityError as error:
                    raise Refused("request", str(error)) from error
                if amount < 0:
                    raise bad(f"{where}.{name}", "must not be negative")
                spec[f"{name}Value"], spec[f"{name}Percent"] = amount, percent
