"""Operation `tolerance`: worst-case corners and seeded Monte Carlo over a target model (spec REQ-DATA-3d15fdfc §5.6).

The statistics never replace the corners: both are computed whenever a Monte Carlo section is present.
"""

from __future__ import annotations

import copy
import math
import platform
import random
from dataclasses import dataclass
from typing import Any, Callable, Sequence

from .contract import CalcError, Reader, Result, refuse
from .quantities import (
    DEGREE_C,
    RESULT_UNITS,
    ZERO_CELSIUS,
    Quantity,
    QuantityError,
    parse_quantity,
    quantity_json,
)

MAX_PARAMETERS = 12
MAX_OUTPUTS = 6  # Thirteen results per output must still fit the output limit of a document.
SAMPLES = (100, 100_000)
MAX_SEED = 2**63 - 1
# Result unit -> the dimension and temperature role a limit of that output is read with.
LIMIT_KINDS: dict[str, tuple[str, str]] = {
    unit: (dimension, "plain") for dimension, unit in RESULT_UNITS.items() if dimension not in ("temperature", "temperature-difference", "angle", "decibel")
}
LIMIT_KINDS[DEGREE_C] = ("temperature", "absolute")
LIMIT_KINDS["K"] = ("temperature", "difference")

Evaluate = Callable[[str, dict[str, Any], bool], Result]


@dataclass
class Parameter:
    """One varied quantity: where it lives in the target input and its range in working units."""

    name: str
    container: Any
    key: Any
    nominal: float
    low: float
    high: float
    unit: str  # the unit written back with each varied value
    metadata: dict[str, str]
    distribution: str | None = None
    sigmas: float | None = None

    def write(self, value: float) -> None:
        self.container[self.key] = {"value": value, "unit": self.unit, **self.metadata}


def _locate(document: Any, path: str) -> tuple[Any, Any] | None:
    """The container and key of a dot path (list items by index), or None when it does not exist."""
    node = document
    parts = path.split(".")
    for position, part in enumerate(parts):
        key: Any = part
        if isinstance(node, list):
            # A list index is canonical ASCII digits: "1", never "01" or the digit of another script.
            # At most nine digits: a longer one names no item and may exceed what `int` reads.
            canonical = part.isascii() and part.isdigit() and len(part) <= 9 and part == str(int(part))
            if not canonical or int(part) >= len(node):
                return None
            key = int(part)
        elif not isinstance(node, dict) or part not in node:
            return None
        if position == len(parts) - 1:
            return node, key
        node = node[key]
    return None


def _working(quantity: Quantity) -> tuple[float, str]:
    """A temperature varies on the scale it was given in; every other quantity in its SI unit."""
    if quantity.dimension == "temperature":
        return quantity.scaled, DEGREE_C if quantity.celsius else "K"
    return quantity.scaled, RESULT_UNITS[quantity.dimension]


def _parameter(reader: Reader, name: str, target_input: dict[str, Any], sampling: bool) -> Parameter | None:
    spec = reader.obj(name)
    if spec is None:
        return None
    place = _locate(target_input, name)
    nominal = None
    if place is not None:
        try:
            nominal = parse_quantity(place[0][place[1]])
        except QuantityError:
            nominal = None
    if place is None or nominal is None:
        spec.mark(*spec.data)
        reader.fail(
            "schema",
            name,
            "No such field in target.input; use a dot path such as rTop, current.peak or resistances.0."
            if place is None
            else "This field of target.input is not a quantity.",
        )
        return None
    value, unit = _working(nominal)
    temperature = nominal.dimension == "temperature"
    low = high = None
    has_tolerance = spec.has("tolerance")
    has_limits = spec.has("min") or spec.has("max")
    if has_tolerance and has_limits:
        spec.fail("contradiction", "", "Give tolerance, or min and max, not both.")
    elif has_tolerance:
        if temperature:
            spec.fail("domain", "tolerance", "A relative tolerance has no meaning on a temperature scale; give min and max.")
        else:
            tolerance = spec.ratio("tolerance", low_open=True, high=1.0, high_open=True)
            if tolerance is not None:
                low, high = sorted((value * (1 - tolerance), value * (1 + tolerance)))
    elif has_limits:
        ends = []
        for end in ("min", "max"):
            if not spec.has(end):
                spec.fail("insufficient", end, "Give both min and max.")
                continue
            found = spec.quantity(end, nominal.dimension, sign="any", role="difference")
            if found is None:
                continue
            if temperature and found.celsius != nominal.celsius:
                spec.forget_input()
                spec.fail("unit", end, "Give min and max on the same temperature scale (°C or K) as the nominal value.")
                continue
            # A temperature limit is recorded on the scale it varies on, not as a difference.
            spec.inputs[-1]["unit"] = unit
            ends.append(found.scaled)
        if len(ends) == 2:
            low, high = ends
    else:
        spec.fail("insufficient", "", "Give tolerance, or min and max.")
    distribution = spec.choice("distribution", ("uniform", "normal"), required=False)
    sigmas = None
    if spec.has("sigmas"):
        sigmas = spec.ratio("sigmas", low_open=True, high=None)
    if sampling and "distribution" not in spec.data:
        spec.fail("insufficient", "distribution", "A Monte Carlo analysis needs an explicit distribution: uniform or normal.")
    if sampling and distribution == "normal" and "sigmas" not in spec.data:
        spec.fail("insufficient", "sigmas", "A normal distribution needs sigmas: how many standard deviations the half range spans.")
    if low is None or high is None:
        return None
    if not low < high:
        spec.fail("contradiction", "", "The range is empty: min must be below max (a relative tolerance needs a non-zero nominal).")
        return None
    if not low <= value <= high:
        spec.fail("contradiction", "", "The nominal value of target.input lies outside this range.")
        return None
    return Parameter(name, place[0], place[1], value, low, high, unit, nominal.metadata(), distribution, sigmas)


def _values(result: Result, outputs: Sequence[str], where: Callable[[], str]) -> list[float]:
    missing = [name for name in outputs if name not in result.values]
    if missing:
        raise refuse("domain", "outputs", f"{where()}: the target no longer returns {', '.join(missing)}.")
    return [result.values[name][0] for name in outputs]


def _percentile(ordered: Sequence[float], fraction: float) -> float:
    position = (len(ordered) - 1) * fraction
    lower = math.floor(position)
    upper = min(lower + 1, len(ordered) - 1)
    return ordered[lower] + (position - lower) * (ordered[upper] - ordered[lower])


def run(document: dict[str, Any], operations: Sequence[str], evaluate: Evaluate) -> Result:
    reader = Reader(document)
    target = reader.obj("target", required=True)
    operation = None
    target_input: Any = None
    if target is not None:
        operation = target.choice("operation", operations)
        target_input = target.raw("input")
        if not isinstance(target_input, dict):
            target.fail("schema", "input", "This field is required: the JSON object of the target request.")
    reader.check()
    assert operation is not None
    outputs = reader.array("outputs", low=1, high=MAX_OUTPUTS)
    parameters_node = reader.obj("parameters", required=True)
    sampling_node = reader.obj("monteCarlo")
    limits_node = reader.obj("limits")
    if parameters_node is not None and not 1 <= len(parameters_node.data) <= MAX_PARAMETERS:
        reader.fail("limit", "parameters", f"Use 1 to {MAX_PARAMETERS} parameters.")
    reader.check()
    assert outputs is not None and parameters_node is not None

    # The nominal target first: its refusals carry their own paths under target.input.
    try:
        nominal = evaluate(operation, target_input, True)
    except CalcError as error:
        raise CalcError([problem.under("target.input") for problem in error.problems]) from error
    for index, name in enumerate(outputs):
        if not isinstance(name, str) or name not in nominal.values:
            reader.fail("schema", f"outputs.{index}", f"Not a result of the target; use one of {', '.join(nominal.values)}.")
    if len(set(map(str, outputs))) != len(outputs):
        reader.fail("schema", "outputs", "Name each output once.")
    reader.check()

    work = copy.deepcopy(target_input)
    parameters = [
        _parameter(parameters_node, name, work, sampling_node is not None) for name in sorted(parameters_node.data)
    ]
    samples = seed = None
    if sampling_node is not None:
        samples = sampling_node.integer("samples", low=SAMPLES[0], high=SAMPLES[1], missing="insufficient")
        seed = sampling_node.integer("seed", low=0, high=MAX_SEED, missing="insufficient", outside="domain")
    limits: dict[str, tuple[float | None, float | None]] = {}
    if limits_node is not None:
        if sampling_node is None:
            reader.fail("insufficient", "monteCarlo", "Limits are used for the fraction of Monte Carlo samples inside them; add monteCarlo.")
        for name in limits_node.data:
            limit = limits_node.obj(name)
            if name not in outputs:
                limits_node.fail("schema", name, "Not one of the requested outputs.")
                if limit is not None:
                    limit.mark(*limit.data)
                continue
            if limit is None:
                continue
            kind = LIMIT_KINDS.get(nominal.values[name][1])
            if kind is None:
                limits_node.fail("schema", name, "Limits are not supported for this output's unit.")
                limit.mark(*limit.data)
                continue
            bounds: list[float | None] = []
            for end in ("min", "max"):
                found = limit.quantity(end, kind[0], required=False, sign="any", role=kind[1])
                if found is None:
                    bounds.append(None)
                elif kind[1] == "absolute":
                    bounds.append(found.si - ZERO_CELSIUS)
                else:
                    bounds.append(found.si)
            if bounds[0] is None and bounds[1] is None and not limit.problems:
                limits_node.fail("insufficient", name, "Give min, max or both.")
            if bounds[0] is not None and bounds[1] is not None and bounds[0] > bounds[1]:
                limits_node.fail("contradiction", name, "min is above max.")
            limits[name] = (bounds[0], bounds[1])
    reader.done()
    varied: list[Parameter] = [item for item in parameters if item is not None]
    assert len(varied) == len(parameters)

    def attempt(setting: dict[str, float], where: Callable[[], str]) -> list[float]:
        for item in varied:
            item.write(setting[item.name])
        try:
            found = evaluate(operation, work, False)
        except CalcError as error:
            raise CalcError([problem.under("target.input", f"{where()}: ") for problem in error.problems]) from error
        return _values(found, outputs, where)

    result = Result("tolerance", None)
    center = {item.name: item.nominal for item in varied}
    nominal_values = _values(nominal, outputs, lambda: "At the nominal values")
    units = [nominal.values[name][1] for name in outputs]

    # Worst case: every combination of the range ends.
    lowest = [math.inf] * len(outputs)
    highest = [-math.inf] * len(outputs)
    corner_low: list[dict[str, str]] = [{} for _ in outputs]
    corner_high: list[dict[str, str]] = [{} for _ in outputs]
    for mask in range(2 ** len(varied)):
        ends = {item.name: "max" if mask >> bit & 1 else "min" for bit, item in enumerate(varied)}
        setting = {item.name: item.high if ends[item.name] == "max" else item.low for item in varied}
        values = attempt(setting, lambda: f"At corner {ends}")
        for index, value in enumerate(values):
            if value < lowest[index]:
                lowest[index], corner_low[index] = value, ends
            if value > highest[index]:
                highest[index], corner_high[index] = value, ends

    # Three-point monotonicity: each parameter alone at its two ends, the others nominal.
    bends: list[str] = []
    for item in varied:
        at_low = attempt({**center, item.name: item.low}, lambda: f"With {item.name} at its minimum")
        at_high = attempt({**center, item.name: item.high}, lambda: f"With {item.name} at its maximum")
        for index, name in enumerate(outputs):
            first, second = sorted((at_low[index], at_high[index]))
            slack = 1e-12 * max(abs(first), abs(second), abs(nominal_values[index]))
            if not first - slack <= nominal_values[index] <= second + slack:
                bends.append(f"{name} in {item.name}")
    if bends:
        listed = "; ".join(bends[:8]) + (f"; and {len(bends) - 8} more" if len(bends) > 8 else "")
        result.check("monotonic", "fail", f"Not monotonic over the range: {listed}.")
        result.warn(
            f"These outputs are not monotonic over a parameter range ({listed}): the true extremes can lie "
            "inside the range and beyond the corner results."
        )
    else:
        result.check("monotonic", "pass", "Each output's nominal value lies between its values at the two ends of every parameter range.")

    for index, name in enumerate(outputs):
        result.put(f"{name}.nominal", nominal_values[index], units[index])
        result.put(f"{name}.min", lowest[index], units[index])
        result.put(f"{name}.max", highest[index], units[index])
    result.details["corners"] = 2 ** len(varied)
    result.details["parameters"] = {
        item.name: {
            "nominal": quantity_json(item.nominal, item.unit),
            "min": quantity_json(item.low, item.unit),
            "max": quantity_json(item.high, item.unit),
            **({} if item.distribution is None or samples is None else {"distribution": item.distribution}),
            **({} if item.sigmas is None or samples is None or item.distribution != "normal" else {"sigmas": item.sigmas}),
        }
        for item in varied
    }
    result.details["worstCase"] = {
        name: {"min": corner_low[index], "max": corner_high[index]} for index, name in enumerate(outputs)
    }

    if samples is not None and seed is not None:
        generator = random.Random(seed)
        columns: list[list[float]] = [[] for _ in outputs]
        for sample in range(samples):
            setting = {}
            for item in varied:
                if item.distribution == "normal":
                    assert item.sigmas is not None
                    first, second = generator.random(), generator.random()
                    deviate = math.sqrt(-2.0 * math.log(1.0 - first)) * math.cos(2.0 * math.pi * second)
                    setting[item.name] = (item.low + item.high) / 2 + deviate * (item.high - item.low) / (2 * item.sigmas)
                else:
                    setting[item.name] = item.low + (item.high - item.low) * generator.random()
            for column, value in zip(columns, attempt(setting, lambda: f"At Monte Carlo sample {sample} {setting}")):
                column.append(value)
        for index, name in enumerate(outputs):
            ordered = sorted(columns[index])
            mean = math.fsum(ordered) / samples
            spread = math.sqrt(math.fsum((value - mean) ** 2 for value in ordered) / (samples - 1))
            unit = units[index]
            result.put(f"{name}.mean", mean, unit)
            # A standard deviation of an absolute temperature is a difference.
            result.put(f"{name}.stdDev", spread, "K" if unit == DEGREE_C else unit)
            result.put(f"{name}.sampleMin", ordered[0], unit)
            result.put(f"{name}.sampleMax", ordered[-1], unit)
            for label, fraction in (("p01", 0.01), ("p05", 0.05), ("p50", 0.5), ("p95", 0.95), ("p99", 0.99)):
                result.put(f"{name}.{label}", _percentile(ordered, fraction), unit)
            if name in limits:
                low, high = limits[name]
                inside = sum(1 for value in ordered if (low is None or value >= low) and (high is None or value <= high))
                result.put(f"{name}.fractionWithin", inside / samples, "1")
        result.details["monteCarlo"] = {
            "generator": "CPython random.Random (MT19937): uniform by min + (max - min) * u, normal by Box-Muller",
            "seed": seed,
            "samples": samples,
            "python": platform.python_version(),
        }
        result.formulas += [
            "uniform sample = min + (max - min) * u",
            "normal sample = (min + max) / 2 + (max - min) / (2 * sigmas) * sqrt(-2 * ln(1 - u1)) * cos(2 * pi * u2)",
            "stdDev = sqrt(sum((x - mean)^2) / (n - 1)); percentiles by linear interpolation",
        ]
        result.assumptions.append("Monte Carlo parameters are statistically independent.")
        if any(item.distribution == "normal" for item in varied):
            result.assumptions.append("Normal distributions are not truncated: samples may fall outside the declared range.")
        result.warn("Monte Carlo statistics do not replace the worst-case corner results; check both.")
        result.limits.append(
            "The same request and seed repeat exactly on one Python runtime; other runtimes may differ in the last digits."
        )

    if samples is None and any(item.distribution is not None for item in varied):
        result.warn("A distribution was given without monteCarlo and is not used; only the corners were evaluated.")
    result.inputs = [{**entry, "name": f"target.input.{entry['name']}"} for entry in nominal.inputs] + reader.inputs
    result.formulas = [
        "worst case: the target evaluated at every combination of parameter minimum and maximum (2^n corners)",
        *nominal.formulas,
        *result.formulas,
    ]
    result.assumptions = [
        f"Target: operation {operation}" + (f", model {nominal.model}." if nominal.model else "."),
        "Each parameter varies inside its declared range, independently of the others; all other inputs stay nominal.",
        *nominal.assumptions,
        *result.assumptions,
    ]
    for warning in nominal.warnings:
        result.warn(warning)
    result.limits = [
        "Corner analysis finds the true extremes only where each output is monotonic in every parameter over its "
        "range; interior extremes are not searched (see the monotonic check).",
        *nominal.limits,
        *result.limits,
    ]
    return result
