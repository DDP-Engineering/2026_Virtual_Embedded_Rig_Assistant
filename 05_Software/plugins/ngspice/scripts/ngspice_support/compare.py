"""Comparing and summarizing run folders (spec REQ-DATA-29b9a988 §6)."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from .request import Problem, Refused

FIELDS = ("analysis", "temperature", "parameters", "sweep", "vectors")


def load_run(folder: Path, shown: str) -> dict[str, Any]:
    """A run folder's result.json, with every artifact it lists checked against its SHA-256."""
    try:
        result = json.loads((folder / "result.json").read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise Refused([Problem("run", "", f"'{shown[:120]}' holds no readable result.json: {error}.")]) from error
    if not isinstance(result, dict) or result.get("kind") != "ngspice-tool-result":
        raise Refused([Problem("run", "", f"'{shown[:120]}' is not an ngspice-tool run folder.")])
    for artifact in result.get("artifacts", []):
        name = Path(str(artifact.get("path", ""))).name
        try:
            digest = hashlib.sha256((folder / name).read_bytes()).hexdigest()
        except OSError:
            digest = ""
        if digest != artifact.get("sha256"):
            raise Refused([Problem("run", "", f"{name} of '{shown[:120]}' changed after the run; it is not used.")])
    return result


def differences(a: dict[str, Any], b: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    inputs_a = {i["path"]: i["sha256"] for i in a.get("inputs", [])}
    inputs_b = {i["path"]: i["sha256"] for i in b.get("inputs", [])}
    for path in sorted(set(inputs_a) | set(inputs_b)):
        if inputs_a.get(path) != inputs_b.get(path):
            out.append({"field": f"input {path}", "a": (inputs_a.get(path) or "absent")[:16], "b": (inputs_b.get(path) or "absent")[:16]})
    for field in FIELDS:
        va, vb = a.get(field), b.get(field)
        if field == "parameters":
            for name in sorted(set(va or {}) | set(vb or {})):
                if (va or {}).get(name) != (vb or {}).get(name):
                    out.append({"field": f"parameter {name}", "a": (va or {}).get(name), "b": (vb or {}).get(name)})
        elif field == "sweep" and isinstance(va, dict) and isinstance(vb, dict):
            for key in sorted(set(va) | set(vb)):
                if va.get(key) != vb.get(key):
                    out.append({"field": key, "a": va.get(key), "b": vb.get(key)})
        elif va != vb:
            out.append({"field": field, "a": va, "b": vb})
    points_a, points_b = a.get("points", []), b.get("points", [])
    for index in range(max(len(points_a), len(points_b))):
        ia = points_a[index].get("inputs", {}) if index < len(points_a) else {}
        ib = points_b[index].get("inputs", {}) if index < len(points_b) else {}
        for name in sorted(set(ia) | set(ib)):
            if ia.get(name) != ib.get(name):
                out.append({"field": f"point {index + 1} {name}", "a": ia.get(name), "b": ib.get(name)})
    return out


def _values(result: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """A run's measurements by id; a sweep's per-measurement means."""
    if result.get("summary"):
        return {f"{key} (mean)": {"status": "ok", "value": value["mean"]} for key, value in result["summary"].items()}
    return {m["id"]: m for m in result.get("measurements", [])}


def deltas(a: dict[str, Any], b: dict[str, Any]) -> list[dict[str, Any]]:
    ma, mb = _values(a), _values(b)
    out = []
    for key in sorted(set(ma) | set(mb)):
        x, y = ma.get(key, {}), mb.get(key, {})
        entry: dict[str, Any] = {"id": key, "a": x.get("value"), "b": y.get("value")}
        if x.get("status") == "ok" and y.get("status") == "ok":
            entry["delta"] = y["value"] - x["value"]
        out.append(entry)
    return out
