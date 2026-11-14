"""Approved test sets of renode-sim (spec REQ-DATA-8a943977 section 6, REQ-FUNC-d89b80fd).

A test set is data: cases of fixed step kinds that read UART lines, count them, apply stimuli the profile declares and
read observables the profile declares. Nothing in it is executed; parameters are checked by their own expression and
inserted regex-escaped.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .errors import Refused
from .profiles import ID, NAME, Profile

TESTSET_BYTES = 64 * 1024
PATTERN_CHARS = 256
CASE_ID = re.compile(r"[a-z][a-z0-9-]{0,31}")
REQUIREMENT = re.compile(r"[A-Za-z0-9._-]{1,64}")
HIL_STEP = re.compile(r"[a-z][a-z0-9-]{0,31}")
PARAM = re.compile(r"\$\{([a-z][a-z0-9_-]{0,31})\}")
STEP_KEYS = {
    "run": ({"do", "for"}, set()),
    "uart": ({"do", "pattern", "within"}, {"fail"}),
    "count": ({"do", "pattern", "over", "min", "max"}, set()),
    "stimulus": ({"do", "name"}, {"action", "text"}),
    "observe": ({"do", "name", "equals", "within"}, set()),
}


@dataclass
class TestSet:
    id: str
    origin: str
    data: dict[str, Any]
    sha256: str
    params: dict[str, str]
    cases: list[dict[str, Any]]
    raw: bytes


def _refuse(sid: str, message: str) -> Refused:
    return Refused("testset", f"Test set {sid}: {message}")


def _seconds(value: Any, low: float, high: float) -> bool:
    return not isinstance(value, bool) and isinstance(value, (int, float)) and low <= value <= high


def _printable(text: str) -> bool:
    return not any(ord(c) < 32 and c not in "\r\n" or ord(c) == 127 for c in text)


def _substitute(sid: str, text: str, params: dict[str, str], escape: bool) -> str:
    def replace(match: re.Match[str]) -> str:
        name = match.group(1)
        if name not in params:
            raise _refuse(sid, f"${{{name}}} names no parameter.")
        return re.escape(params[name]) if escape else params[name]

    return PARAM.sub(replace, text)


def _pattern(sid: str, where: str, value: Any, params: dict[str, str]) -> re.Pattern[str]:
    if not isinstance(value, str) or not 0 < len(value) <= PATTERN_CHARS:
        raise _refuse(sid, f"{where} must be a pattern of 1-{PATTERN_CHARS} characters.")
    text = _substitute(sid, value, params, escape=True)
    try:
        return re.compile(text)
    except re.error as error:
        raise _refuse(sid, f"{where} is not a valid regular expression: {error}.") from error


def _count(sid: str, where: str, value: Any, params: dict[str, str]) -> int:
    if isinstance(value, str):
        value = _substitute(sid, value, params, escape=False)
        if not re.fullmatch(r"[0-9]{1,5}", value):
            raise _refuse(sid, f"{where} must be a whole number.")
        value = int(value)
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 100000:
        raise _refuse(sid, f"{where} must be a whole number of 0-100000.")
    return value


def _step(sid: str, where: str, step: Any, profile: Profile, params: dict[str, str]) -> dict[str, Any]:
    if not isinstance(step, dict) or step.get("do") not in STEP_KEYS:
        raise _refuse(sid, f"{where} must be an object whose do is one of {', '.join(STEP_KEYS)}.")
    kind = step["do"]
    required, optional = STEP_KEYS[kind]
    if not required <= set(step) or not set(step) <= required | optional:
        raise _refuse(sid, f"{where} ({kind}) takes {', '.join(sorted(required))} and optionally {', '.join(sorted(optional)) or 'nothing else'}.")
    out: dict[str, Any] = {"do": kind}
    if kind == "run":
        if not _seconds(step["for"], 0.001, 600):
            raise _refuse(sid, f"{where}: for must be 0.001-600 virtual seconds.")
        out["for"] = float(step["for"])
    elif kind == "uart":
        out["pattern"] = _pattern(sid, f"{where} pattern", step["pattern"], params)
        out["fail"] = _pattern(sid, f"{where} fail", step["fail"], params) if "fail" in step else None
        if not _seconds(step["within"], 0.001, 600):
            raise _refuse(sid, f"{where}: within must be 0.001-600 virtual seconds.")
        out["within"] = float(step["within"])
    elif kind == "count":
        out["pattern"] = _pattern(sid, f"{where} pattern", step["pattern"], params)
        if not _seconds(step["over"], 0.001, 600):
            raise _refuse(sid, f"{where}: over must be 0.001-600 virtual seconds.")
        out["over"] = float(step["over"])
        out["min"] = _count(sid, f"{where} min", step["min"], params)
        out["max"] = _count(sid, f"{where} max", step["max"], params)
        if out["min"] > out["max"]:
            raise _refuse(sid, f"{where}: min is larger than max.")
    elif kind == "stimulus":
        name = step["name"]
        declared = profile.data["stimuli"].get(name) if isinstance(name, str) else None
        if declared is None:
            raise _refuse(sid, f"{where}: stimulus {str(name)[:32]!r} is not declared by profile {profile.id}.")
        out["name"] = name
        out["kind"] = declared["kind"]
        if declared["kind"] == "button":
            if set(step) != {"do", "name", "action"} or step["action"] not in ("press", "release"):
                raise _refuse(sid, f"{where}: a button stimulus takes action press or release.")
            out["action"] = step["action"]
            out["target"] = declared["target"]
        else:
            text = step.get("text")
            if set(step) != {"do", "name", "text"} or not isinstance(text, str):
                raise _refuse(sid, f"{where}: a UART stimulus takes text.")
            # Checked after the parameters are inserted: what is sent must be 1-64 printable ASCII characters.
            text = _substitute(sid, text, params, escape=False)
            if not 0 < len(text) <= 64 or not _printable(text) or not text.isascii():
                raise _refuse(sid, f"{where}: a UART stimulus takes text of 1-64 printable ASCII characters (CR and LF allowed).")
            out["text"] = text
            out["uart"] = declared["uart"]
            out["target"] = profile.data["uarts"][declared["uart"]]
    elif kind == "observe":
        name = step["name"]
        declared = profile.data["observables"].get(name) if isinstance(name, str) else None
        if declared is None:
            raise _refuse(sid, f"{where}: observable {str(name)[:32]!r} is not declared by profile {profile.id}.")
        if not isinstance(step["equals"], bool):
            raise _refuse(sid, f"{where}: a led observable equals true or false.")
        if not _seconds(step["within"], 0.001, 600):
            raise _refuse(sid, f"{where}: within must be 0.001-600 virtual seconds.")
        out.update(name=name, target=declared["target"], equals=step["equals"], within=float(step["within"]))
    return out


def load(path: Path, origin: str, profile: Profile, given: dict[str, str]) -> TestSet:
    sid = path.parent.name
    try:
        raw = path.read_bytes()
        if len(raw) > TESTSET_BYTES:
            raise _refuse(sid, "testset.json is larger than 64 KiB.")
        data = json.loads(raw.decode("utf-8"))
    except (OSError, UnicodeDecodeError, ValueError, RecursionError) as error:
        raise _refuse(sid, f"testset.json cannot be read: {str(error)[:200]}.") from error
    try:
        return _load(sid, raw, data, origin, profile, given)
    except Refused:
        raise
    except (TypeError, KeyError, AttributeError, ValueError) as error:
        raise _refuse(sid, "testset.json has a value of the wrong type.") from error


def _load(sid: str, raw: bytes, data: Any, origin: str, profile: Profile, given: dict[str, str]) -> TestSet:
    keys = {"format", "id", "title", "profiles", "params", "cases"}
    if not isinstance(data, dict) or set(data) != keys or type(data["format"]) is not int or data["format"] != 1 or data["id"] != sid:
        raise _refuse(sid, "testset.json must be {format: 1, id (its folder name), title, profiles, params, cases}.")
    if not isinstance(data["profiles"], list) or profile.id not in data["profiles"]:
        raise _refuse(sid, f"the test set is not approved for profile {profile.id}.")
    params_spec = data["params"]
    if not isinstance(params_spec, dict) or len(params_spec) > 16:
        raise _refuse(sid, "params must map at most 16 names.")
    params: dict[str, str] = {}
    for name, spec in params_spec.items():
        if not re.fullmatch(r"[a-z][a-z0-9_-]{0,31}", name) or not isinstance(spec, dict) or set(spec) != {"default", "regex"}:
            raise _refuse(sid, f"parameter {name[:32]!r} must be {{default, regex}}.")
        try:
            check = re.compile(spec["regex"])
        except (re.error, TypeError) as error:
            raise _refuse(sid, f"parameter {name} has an invalid regex.") from error
        value = given.get(name, spec["default"])
        if not isinstance(value, str) or len(value) > 120 or not check.fullmatch(value):
            raise Refused("param", f"--param {name}={str(value)[:60]!r} does not match {spec['regex']}.")
        params[name] = value
    unknown = set(given) - set(params)
    if unknown:
        raise Refused("param", f"Test set {sid} has no parameter {', '.join(sorted(unknown))}.")
    cases = data["cases"]
    if not isinstance(cases, list) or not 1 <= len(cases) <= 32:
        raise _refuse(sid, "cases must list 1-32 cases.")
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, case in enumerate(cases):
        where = f"case {index + 1}"
        if not isinstance(case, dict) or set(case) != {"id", "requirement", "hil", "budget", "steps"}:
            raise _refuse(sid, f"{where} must be {{id, requirement, hil, budget, steps}}.")
        if not isinstance(case["id"], str) or not CASE_ID.fullmatch(case["id"]) or case["id"] in seen:
            raise _refuse(sid, f"{where}: the id must be unique and match {CASE_ID.pattern}.")
        seen.add(case["id"])
        if not isinstance(case["requirement"], str) or not REQUIREMENT.fullmatch(case["requirement"]):
            raise _refuse(sid, f"{where}: requirement must match {REQUIREMENT.pattern}.")
        hil = case["hil"]
        if not isinstance(hil, list) or len(hil) > 8 or not all(isinstance(h, str) and HIL_STEP.fullmatch(h) for h in hil):
            raise _refuse(sid, f"{where}: hil must list at most 8 HIL step ids.")
        if not _seconds(case["budget"], 0.001, 600):
            raise _refuse(sid, f"{where}: budget must be 0.001-600 virtual seconds.")
        steps = case["steps"]
        if not isinstance(steps, list) or not 1 <= len(steps) <= 64:
            raise _refuse(sid, f"{where}: steps must list 1-64 steps.")
        out.append({
            "id": case["id"],
            "requirement": case["requirement"],
            "hil": list(hil),
            "budget": float(case["budget"]),
            "steps": [_step(sid, f"{where} step {n + 1}", step, profile, params) for n, step in enumerate(steps)],
        })
    if not isinstance(data["title"], str) or not 0 < len(data["title"]) <= 200:
        raise _refuse(sid, "title must be 1-200 characters.")
    return TestSet(sid, origin, data, hashlib.sha256(raw).hexdigest(), params, out, raw)


def find(plugin: Path, cwd: Path, sid: str, profile: Profile, given: dict[str, str]) -> TestSet:
    if not ID.fullmatch(sid):
        raise Refused("testset", f"--test-set {sid[:48]!r} is not a test set id.")
    plugin_path = plugin / "testsets" / sid / "testset.json"
    workbench_path = cwd / "renode" / "tests" / sid / "testset.json"
    found = [(origin, path) for origin, path in (("plugin", plugin_path), ("workbench", workbench_path)) if path.is_file()]
    if not found:
        raise Refused("testset", f"No test set {sid} in the plugin or in renode/tests/ of the workbench.")
    if len(found) > 1:
        raise Refused("testset", f"Test set {sid} is defined by the plugin and the workbench; rename the workbench one.")
    origin, path = found[0]
    return load(path, origin, profile, given)


def parse_params(values: list[str]) -> dict[str, str]:
    if len(values) > 16:
        raise Refused("param", "At most 16 --param values.")
    params: dict[str, str] = {}
    for value in values:
        name, sep, text = value.partition("=")
        if not sep or not NAME.fullmatch(name.replace("_", "-")) or name in params:
            raise Refused("param", f"--param {value[:60]!r} must be a unique name=value.")
        params[name] = text
    return params
