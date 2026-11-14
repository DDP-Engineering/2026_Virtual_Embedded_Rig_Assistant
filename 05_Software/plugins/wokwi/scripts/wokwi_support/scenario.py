"""Scenario YAML: the subset of wokwi-cli 0.29.1's scenario commands wokwi-tool supports (spec REQ-DATA-d985bb3d
section 3; REQ-FUNC-c9e7ad20).

Structural faults end scenario-invalid; a command wokwi-cli has but this tool does not support, or any other key,
ends unsupported-input. Both come before any run folder exists.
"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path
from typing import Any

import yaml

from . import workspace
from .report import refused

SCENARIO_LIMIT = 256 * 1024
STEP_LIMIT = 1000
TEXT_LIMIT = 1024
SUPPORTED = ("delay", "wait-serial", "write-serial", "set-control", "expect-pin")
UNSUPPORTED = ("take-screenshot", "expect-chip-output", "touch", "touch-press", "touch-release", "touch-move")
# wokwi-cli 0.29.1 utils/parseTime.ts
TIME = re.compile(r"^(\d+(\.\d*)?)\s*(ns|us|ms|s)$|^0(\.?0*)$", re.IGNORECASE)
UNIT = {"ns": 1, "us": 1_000, "ms": 1_000_000, "s": 1_000_000_000}


def _invalid(message: str) -> Exception:
    return refused("scenario-invalid", message)


def _number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _text(value: Any, label: str) -> None:
    if not isinstance(value, str) or not 1 <= len(value) <= TEXT_LIMIT:
        raise _invalid(f"{label} needs a text of 1-{TEXT_LIMIT} characters.")


def _part(params: dict[str, Any], label: str, parts: set[str]) -> None:
    part = params.get("part-id")
    if not isinstance(part, str) or part not in parts:
        raise _invalid(f"{label} names part-id {str(part)[:80]}, which is not a part of the diagram.")


def _keys(params: Any, label: str, allowed: set[str]) -> dict[str, Any]:
    if not isinstance(params, dict):
        raise _invalid(f"{label} takes a mapping.")
    extra = sorted(set(params) - allowed)
    if extra:
        raise _invalid(f"{label} has the unknown parameter {str(extra[0])[:40]}.")
    return params


def _delay_ns(value: Any, label: str) -> int:
    if _number(value):
        raise _invalid(f"{label} {value} needs units (for example {value}ms).")
    if not isinstance(value, str):
        raise _invalid(f"{label} must be a text such as 500ms.")
    match = TIME.match(value.strip())
    if not match:
        raise _invalid(f"{label} {value[:40]} is not a time such as 500ms.")
    return 0 if match.group(1) is None else int(float(match.group(1)) * UNIT[match.group(3).lower()])


def _step(index: int, step: Any, parts: set[str]) -> tuple[str, int]:
    label = f"Step {index + 1}"
    if not isinstance(step, dict):
        raise _invalid(f"{label} must be a mapping.")
    if "name" in step and not isinstance(step["name"], str):
        raise _invalid(f"{label} name must be a text.")
    commands = [key for key in step if key != "name"]
    if len(commands) != 1:
        raise _invalid(f"{label} needs exactly one command, not {len(commands)}.")
    command = commands[0]
    params = step[command]
    if command not in SUPPORTED:
        known = "a wokwi-cli command this tool does not support" if command in UNSUPPORTED else "not a supported command"
        raise refused("unsupported-input", f"{label}: {str(command)[:40]} is {known}; supported: {', '.join(SUPPORTED)}.", input=str(command)[:40])
    label = f"{label} ({command})"
    if command == "delay":
        return command, _delay_ns(params, label)
    if command == "wait-serial":
        _text(params, label)
    elif command == "write-serial":
        if isinstance(params, list):
            if not 1 <= len(params) <= TEXT_LIMIT or not all(isinstance(byte, int) and not isinstance(byte, bool) and 0 <= byte <= 255 for byte in params):
                raise _invalid(f"{label} takes a text or a list of 1-{TEXT_LIMIT} bytes.")
        else:
            _text(params, label)
    elif command == "set-control":
        params = _keys(params, label, {"part-id", "control", "name", "value"})
        _part(params, label, parts)
        if not isinstance(params.get("control", params.get("name")), str):
            raise _invalid(f"{label} needs control.")
        if not _number(params.get("value")):
            raise _invalid(f"{label} needs a numeric value.")
    elif command == "expect-pin":
        params = _keys(params, label, {"part-id", "pin", "name", "value"})
        _part(params, label, parts)
        if not isinstance(params.get("pin", params.get("name")), str):
            raise _invalid(f"{label} needs pin.")
        if params.get("value") not in (0, 1) or isinstance(params.get("value"), bool):
            raise _invalid(f"{label} expects value 0 or 1.")
    return command, 0


def load(cwd: Path, spelled: Path, raw: str, parts: set[str]) -> dict[str, Any]:
    try:
        path = workspace.regular_file(cwd, raw, "--scenario", spelled)
    except workspace.PathRefused as error:
        raise refused("path", str(error)) from error
    if path.stat().st_size > SCENARIO_LIMIT:
        raise _invalid("The scenario is larger than 256 KiB.")
    try:
        data = path.read_bytes()
        document = yaml.safe_load(data.decode("utf-8"))
    except (OSError, UnicodeDecodeError, yaml.YAMLError) as error:
        raise _invalid(f"The scenario is not valid YAML: {str(error)[:200]}") from error
    if not isinstance(document, dict):
        raise _invalid("The scenario must be a mapping.")
    extra = sorted(str(key) for key in set(document) - {"name", "version", "author", "steps"})
    if extra:
        raise _invalid(f"The scenario has the unknown key {extra[0][:40]}.")
    if not isinstance(document.get("name"), str) or not document["name"]:
        raise _invalid("The scenario needs a name.")
    if document.get("version") != 1 or isinstance(document.get("version"), bool):
        raise _invalid("The scenario needs version 1.")
    if "author" in document and not isinstance(document["author"], str):
        raise _invalid("The scenario author must be a text.")
    steps = document.get("steps")
    if not isinstance(steps, list) or not 1 <= len(steps) <= STEP_LIMIT:
        raise _invalid(f"The scenario needs 1-{STEP_LIMIT} steps.")
    counts: dict[str, int] = {}
    delay = 0
    for index, step in enumerate(steps):
        command, ns = _step(index, step, parts)
        counts[command] = counts.get(command, 0) + 1
        delay += ns
    return {"path": path, "sha256": hashlib.sha256(data).hexdigest(), "name": document["name"][:200], "steps": len(steps), "commands": counts, "delayNs": delay}
