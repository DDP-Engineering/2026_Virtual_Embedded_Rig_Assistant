"""Sweep points (spec REQ-DATA-29b9a988 §6): parameter or temperature values, or seeded Monte Carlo draws.

Monte Carlo: uniform draws nominal x (1 + u x percent/100) with u in [-1, 1]; gaussian draws nominal x (1 + g) with g
normal of standard deviation percent/300 (three sigma at the tolerance), clipped to the tolerance. The seed and every
drawn value are recorded, so the same seed reproduces the same points."""

from __future__ import annotations

import random
from typing import Any


def points(sweep: dict[str, Any], base_parameters: dict[str, float], base_temperature: float | None) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    if sweep["kind"] == "values":
        for value in sweep["values"]:
            if sweep["parameter"] == "temperature":
                out.append({"parameters": dict(base_parameters), "temperature": value, "inputs": {"temperature": value}})
            else:
                out.append({"parameters": {**base_parameters, sweep["parameter"]: value}, "temperature": base_temperature,
                            "inputs": {sweep["parameter"]: value}})
        return out
    generator = random.Random(sweep["seed"])
    for _ in range(sweep["runs"]):
        drawn: dict[str, float] = {}
        for name, spec in sweep["tolerances"].items():
            span = spec["percent"] / 100
            if spec["distribution"] == "uniform":
                factor = 1 + generator.uniform(-1.0, 1.0) * span
            else:
                factor = 1 + max(-span, min(span, generator.gauss(0.0, span / 3)))
            drawn[name] = spec["nominal"] * factor
        out.append({"parameters": {**base_parameters, **drawn}, "temperature": base_temperature, "inputs": dict(drawn)})
    return out


def summary(results: list[dict[str, Any]]) -> dict[str, dict[str, float]]:
    values: dict[str, list[float]] = {}
    for point in results:
        for m in point["measurements"]:
            if m.get("status") == "ok":
                values.setdefault(m["id"], []).append(m["value"])
    return {key: {"min": min(v), "max": max(v), "mean": sum(v) / len(v), "count": len(v)} for key, v in values.items()}
