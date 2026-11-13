"""The command line of `scpi` and the checks of its values against the profile and the bench limits.

The operation is the first argument and nothing else (VERA's rules classify it there). Every value is checked here,
before any instrument is opened (spec REQ-DATA-b3e2930f sections 1-2).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

from .errors import Refused
from .profiles import Profile
from .registry import Entry
from .workspace import valid_run_id

INSTRUMENT_OPERATIONS = ("identify", "read", "capture", "status", "configure", "close", "output")
OPERATIONS = ("capabilities", "discover-configured", "decode", *INSTRUMENT_OPERATIONS)
VALUE_OPTIONS = {
    "capabilities": {"--profile", "--alias"},
    "discover-configured": set(),
    "decode": {"--capture", "--results-dir", "--run-id"},
    "identify": {"--instrument", "--results-dir", "--run-id"},
    "read": {"--instrument", "--channel", "--results-dir", "--run-id"},
    "capture": {"--instrument", "--channel", "--results-dir", "--run-id"},
    "status": {"--instrument", "--results-dir", "--run-id"},
    "configure": {"--instrument", "--set", "--results-dir", "--run-id"},
    "close": {"--instrument", "--results-dir", "--run-id"},
    "output": {"--instrument", "--channel", "--voltage", "--current", "--hold", "--results-dir", "--run-id"},
}
FLAGS = {"discover-configured": {"--list-local"}}
REQUIRED = {
    "decode": {"--capture"},
    "identify": {"--instrument"},
    "read": {"--instrument"},
    "capture": {"--instrument", "--channel"},
    "status": {"--instrument"},
    "configure": {"--instrument", "--set"},
    "close": {"--instrument"},
    "output": {"--instrument", "--channel", "--voltage", "--current", "--hold"},
}
CLASSES = {
    "read": ("psu", "dmm"),
    "capture": ("scope",),
    "output": ("psu",),
}
MAX_SETTINGS = 16
MAX_HOLD = 3500


@dataclass
class Request:
    operation: str
    options: dict[str, str] = field(default_factory=dict)
    settings: list[tuple[str, str]] = field(default_factory=list)
    flags: set[str] = field(default_factory=set)

    def get(self, name: str) -> str | None:
        return self.options.get(name)


def parse(argv: list[str]) -> Request:
    if not argv or argv[0] not in OPERATIONS:
        raise Refused("request", f"The first argument must be an operation: {', '.join(OPERATIONS)}.")
    request = Request(argv[0])
    allowed = VALUE_OPTIONS[request.operation]
    flags = FLAGS.get(request.operation, set())
    index = 1
    while index < len(argv):
        arg = argv[index]
        name, equals, inline = arg.partition("=")
        if arg in flags:
            request.flags.add(arg)
            index += 1
            continue
        if name not in allowed:
            raise Refused("request", f"{request.operation} does not take {name[:64]!r}.")
        if equals:
            value = inline
            index += 1
        else:
            if index + 1 >= len(argv):
                raise Refused("request", f"{name} needs a value.")
            value = argv[index + 1]
            index += 2
        if name == "--set":
            request.settings.append(_setting(value))
        elif name in request.options:
            raise Refused("request", f"{name} may be given once.")
        else:
            request.options[name] = value
    missing = sorted(REQUIRED.get(request.operation, set()) - set(request.options) - ({"--set"} if request.settings else set()))
    if missing:
        raise Refused("request", f"{request.operation} needs {', '.join(missing)}.")
    if request.operation == "capabilities" and len(request.options) != 1:
        raise Refused("request", "capabilities takes exactly one of --profile or --alias.")
    if len(request.settings) > MAX_SETTINGS:
        raise Refused("request", f"configure takes at most {MAX_SETTINGS} settings.")
    run_id = request.get("--run-id")
    if run_id is not None and not valid_run_id(run_id):
        raise Refused("request", "--run-id must be 1-64 letters, digits, '.', '_' or '-', not a device name.")
    return request


def _setting(text: str) -> tuple[str, str]:
    name, equals, value = text.partition("=")
    if not equals or not name or not value or len(text) > 128:
        raise Refused("request", f"--set takes NAME=VALUE, not {text[:64]!r}.")
    return name, value


def number(text: str, name: str) -> float:
    try:
        value = float(text)
    except ValueError as error:
        raise Refused("limit", f"{name} must be a number, not {text[:32]!r}.") from error
    if not math.isfinite(value):
        raise Refused("limit", f"{name} must be a finite number.")
    return value


def channel(profile: Profile, name: str | None) -> str:
    if name not in profile.channels:
        raise Refused("limit", f"Channel {str(name)[:16]!r} is not one of {', '.join(profile.channels)} of profile {profile.id}.")
    return str(name)


def limit(profile: Profile, entry: Entry, channel_name: str, quantity: str) -> float | None:
    """The lower of the profile's limit and the bench limit the registry entry declares, or None."""
    values = [profile.channels[channel_name]["limits"].get(quantity), entry.limits.get(channel_name, {}).get(quantity)]
    present = [float(value) for value in values if value is not None]
    return min(present) if present else None


def check_bench_limits(profile: Profile, entry: Entry) -> None:
    for name, quantities in entry.limits.items():
        if name not in profile.channels:
            raise Refused("limit", f"The bench limits name channel {name}, which profile {profile.id} does not have.")
        for quantity in quantities:
            if quantity not in profile.channels[name]["limits"]:
                raise Refused("limit", f"The bench limit {name}.{quantity} is not a quantity of profile {profile.id}.")


def within(value: float, low: float, high: float | None, name: str) -> float:
    if value < low or (high is not None and value > high):
        bound = f"{low:g}..{high:g}" if high is not None else f">= {low:g}"
        raise Refused("limit", f"{name} = {value:g} is outside {bound} (profile and bench limits).")
    return value


def validate(request: Request, profile: Profile, entry: Entry) -> dict[str, Any]:
    """The checked values of an instrument operation; Refused before anything is opened."""
    check_bench_limits(profile, entry)
    op = request.operation
    if op in CLASSES and profile.kind not in CLASSES[op]:
        raise Refused("request", f"{op} is not an operation of a {profile.kind} (profile {profile.id}).")
    checked: dict[str, Any] = {}
    if op in ("read", "capture") and request.get("--channel") is not None:
        checked["channel"] = channel(profile, request.get("--channel"))
    if op == "output":
        name = channel(profile, request.get("--channel"))
        voltage = number(str(request.get("--voltage")), "--voltage")
        current = number(str(request.get("--current")), "--current")
        hold = number(str(request.get("--hold")), "--hold")
        if hold != int(hold) or not 1 <= hold <= MAX_HOLD:
            raise Refused("limit", f"--hold must be a whole number of seconds from 1 to {MAX_HOLD}.")
        checked.update(
            channel=name,
            voltage=within(voltage, 0.0, limit(profile, entry, name, "voltage"), f"{name} voltage"),
            current=within(current, 1e-6, limit(profile, entry, name, "current"), f"{name} current"),
            hold=int(hold),
        )
    if op == "configure":
        checked["settings"] = [_configure(profile, entry, name, value) for name, value in request.settings]
        names = [setting["name"] for setting in checked["settings"]]
        if len(set(names)) != len(names):
            raise Refused("request", "Each setting may be given once.")
        chosen = {setting["name"]: setting for setting in checked["settings"]}
        if profile.kind == "dmm" and "function" in chosen and isinstance(chosen.get("range", {}).get("value"), float):
            ranges = profile.data["functions"][chosen["function"]["scpi"]].get("ranges") or []
            if chosen["range"]["value"] not in ranges:
                raise Refused("limit", f"range = {chosen['range']['value']:g} is not a range of {chosen['function']['value']}.")
    return checked


def _configure(profile: Profile, entry: Entry, name: str, value: str) -> dict[str, Any]:
    kind = profile.kind
    if kind == "psu":
        base, _, quantity = name.partition(".")
        if quantity not in ("voltage", "current"):
            raise Refused("request", f"{name} is not a setting of a power supply (use <channel>.voltage or <channel>.current).")
        ch = channel(profile, base)
        low = 0.0 if quantity == "voltage" else 1e-6
        return {"name": name, "channel": ch, "quantity": quantity, "value": within(number(value, name), low, limit(profile, entry, ch, quantity), name)}
    if kind == "dmm":
        functions = profile.data["functions"]
        if name == "function":
            matches = [key for key, spec in functions.items() if spec["name"] == value]
            if not matches:
                names = ", ".join(spec["name"] for spec in functions.values())
                raise Refused("request", f"function must be one of {names}.")
            return {"name": name, "value": value, "scpi": matches[0]}
        if name == "range":
            if value == "auto":
                return {"name": name, "value": "auto"}
            known = sorted({float(r) for spec in functions.values() for r in spec.get("ranges") or []})
            requested = number(value, name)
            if requested not in known:
                raise Refused("limit", f"range = {requested:g} is not a range of profile {profile.id}.")
            return {"name": name, "value": requested}
        raise Refused("request", f"{name} is not a setting of a multimeter (function, range).")
    if name == "timebase":
        bounds = profile.data["timebase"]
        return {"name": name, "value": within(number(value, name), bounds["min"], bounds["max"], name)}
    base, _, quantity = name.partition(".")
    if quantity == "scale":
        ch = channel(profile, base)
        return {"name": name, "channel": ch, "quantity": quantity, "value": within(number(value, name), profile.data["scaleMin"], limit(profile, entry, ch, "scale"), name)}
    if quantity == "offset":
        ch = channel(profile, base)
        bound = limit(profile, entry, ch, "offset")
        return {"name": name, "channel": ch, "quantity": quantity, "value": within(number(value, name), -(bound or 0.0), bound, name)}
    raise Refused("request", f"{name} is not a setting of an oscilloscope (timebase, <channel>.scale, <channel>.offset).")
