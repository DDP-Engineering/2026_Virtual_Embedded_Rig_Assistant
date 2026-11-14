"""Instrument profiles: validated data shipped in the package (spec REQ-DATA-b3e2930f section 2).

A profile gives the command strings of fixed slots; which slots an operation uses, and so what effect it has, is
decided by the helper's code (classes.py), never by the profile. A profile with any issue is not used.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .errors import Blocked, Refused

FOLDER = Path(__file__).resolve().parent.parent.parent / "profiles"
SLOTS = {
    "psu": {
        "setVoltage", "setCurrent", "voltageSetpoint", "currentSetpoint", "outputOn", "outputOff", "outputState",
        "measureVoltage", "measureCurrent",
    },
    "dmm": {"function", "read", "setFunction", "range", "setRange", "autoRange", "setAutoRange"},
    "scope": {
        "waveformSource", "waveformMode", "waveformFormat", "preamble", "data", "timebase", "setTimebase", "scale",
        "setScale", "offset", "setOffset", "probe", "bandwidthLimit", "display", "triggerStatus",
    },
}
PLACEHOLDER = re.compile(r"\{([a-z]+)\}")
ALLOWED_PLACEHOLDERS = {"index", "channel", "value", "function"}
COMMAND = re.compile(r"[\x20-\x7e]{1,128}")
TOP = {"format", "id", "class", "title", "source", "verification", "identity", "transport", "channels", "commands"}
EXTRA = {"psu": {"outputStates"}, "dmm": {"functions", "overload"}, "scope": {"timebase", "scaleMin", "preamble", "samples"}}


@dataclass(frozen=True)
class Profile:
    id: str
    kind: str
    data: dict[str, Any]

    @property
    def commands(self) -> dict[str, str]:
        return self.data["commands"]

    @property
    def channels(self) -> dict[str, dict[str, Any]]:
        return self.data["channels"]

    @property
    def transport(self) -> dict[str, Any]:
        return self.data["transport"]

    def command(self, slot: str, **values: Any) -> str:
        """A slot's SCPI string with its placeholders filled; numbers are written with up to 9 significant digits."""
        text = self.commands[slot]

        def fill(match: re.Match[str]) -> str:
            value = values[match.group(1)]
            return format(value, ".9g") if isinstance(value, float) else str(value)

        return PLACEHOLDER.sub(fill, text)

    def summary(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "class": self.kind,
            "title": self.data["title"],
            "source": self.data["source"],
            "verification": self.data["verification"],
        }


def _check(data: Any, name: str) -> Profile:
    def bad(reason: str) -> Refused:
        return Refused("profile-unknown", f"Profile {name} is not valid: {reason}.")

    if not isinstance(data, dict) or data.get("format") != 1 or data.get("id") != name:
        raise bad("format 1 and an id equal to the file name are required")
    kind = data.get("class")
    if kind not in SLOTS:
        raise bad("class must be psu, dmm or scope")
    if not set(data) <= TOP | EXTRA[kind] or not TOP <= set(data):
        raise bad("unknown or missing fields")
    identity = data["identity"]
    if (
        not isinstance(identity, dict)
        or not identity.get("manufacturers")
        or not identity.get("models")
        or not isinstance(identity.get("firmware"), str)
    ):
        raise bad("identity needs manufacturers, models and a firmware pattern")
    try:
        re.compile(identity["firmware"])
    except re.error as error:
        raise bad("the firmware pattern is not a regular expression") from error
    transport = data["transport"]
    timeout = transport.get("timeoutMs") if isinstance(transport, dict) else None
    if not isinstance(timeout, int) or not 100 <= timeout <= 60000:
        raise bad("transport.timeoutMs must be 100..60000")
    for key in ("readTermination", "writeTermination"):
        if transport.get(key) not in ("\n", "\r\n", "\r"):
            raise bad(f"transport.{key} must be a line ending")
    commands = data["commands"]
    if not isinstance(commands, dict) or set(commands) != SLOTS[kind]:
        raise bad(f"commands must name exactly the {kind} slots")
    for slot, text in commands.items():
        if not isinstance(text, str) or not COMMAND.fullmatch(text):
            raise bad(f"command {slot} must be one printable line")
        if not set(PLACEHOLDER.findall(text)) <= ALLOWED_PLACEHOLDERS:
            raise bad(f"command {slot} uses an unknown placeholder")
    channels = data["channels"]
    if not isinstance(channels, dict) or not channels:
        raise bad("channels are required")
    for channel, spec in channels.items():
        if not isinstance(spec, dict) or not isinstance(spec.get("index"), int) or not isinstance(spec.get("limits"), dict):
            raise bad(f"channel {channel} needs an index and limits")
        for value in spec["limits"].values():
            if not isinstance(value, (int, float)) or value <= 0:
                raise bad(f"channel {channel} has a limit that is not a positive number")
    if data["verification"].get("status") not in ("unverified", "verified"):
        raise bad("verification.status must be unverified or verified")
    if not isinstance(data["verification"].get("instruments"), list):
        raise bad("verification.instruments must be a list")
    required = {"psu": {"voltage", "current"}, "scope": {"scale", "offset"}, "dmm": set()}[kind]
    for channel, spec in channels.items():
        if not required <= set(spec["limits"]):
            raise bad(f"channel {channel} needs the limits {sorted(required)}")
    if not set(data) >= EXTRA[kind] - {"overload"}:
        raise bad(f"a {kind} profile needs {sorted(EXTRA[kind] - {'overload'})}")
    if kind == "dmm":
        for key, spec in data["functions"].items():
            ranges = spec.get("ranges") if isinstance(spec, dict) else None
            if not isinstance(spec, dict) or not spec.get("name") or not spec.get("unit") or not isinstance(ranges, list):
                raise bad(f"function {key} needs name, unit and ranges")
            if any(not isinstance(value, (int, float)) or value <= 0 for value in ranges):
                raise bad(f"function {key} has a range that is not a positive number")
    if kind == "scope":
        preamble, sample = data["preamble"], data["samples"]
        needed = {"points", "xincrement", "xorigin", "xreference", "yincrement", "yorigin", "yreference"}
        if not isinstance(preamble, list) or not needed <= set(preamble):
            raise bad(f"the preamble fields must include {sorted(needed)}")
        if not isinstance(sample, dict) or sample.get("width") not in (1, 2, 4) or sample.get("endian") not in ("little", "big"):
            raise bad("samples needs width 1, 2 or 4 and endian little or big")
        if not isinstance(sample.get("maxPoints"), int) or not 1 <= sample["maxPoints"] <= 10_000_000:
            raise bad("samples.maxPoints must be 1..10000000")
    if kind == "psu" and not {"on", "off"} <= set(data["outputStates"]):
        raise bad("outputStates needs on and off")
    return Profile(name, kind, data)


def load(name: str) -> Profile:
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", name):
        raise Refused("profile-unknown", f"{name[:64]} is not a profile id.")
    path = FOLDER / f"{name}.json"
    if not path.is_file():
        raise Blocked("profile-unknown", f"No profile {name} ships with scpi-instruments.")
    return _check(json.loads(path.read_text(encoding="utf-8")), name)


def all_profiles() -> list[Profile]:
    return [load(path.stem) for path in sorted(FOLDER.glob("*.json"))]


@dataclass(frozen=True)
class Identity:
    manufacturer: str
    model: str
    serial: str
    firmware: str
    raw: str


def parse_identity(reply: str) -> Identity:
    """`*IDN?` reply: manufacturer, model, serial number, firmware (IEEE 488.2)."""
    parts = [part.strip() for part in reply.strip().split(",")]
    if len(parts) < 4:
        raise Blocked("identity-mismatch", f"The *IDN? reply is not manufacturer,model,serial,firmware: {reply[:120]!r}.")
    return Identity(parts[0], parts[1], parts[2], ",".join(parts[3:]), reply.strip()[:256])


def matches(profile: Profile, identity: Identity) -> str | None:
    """None when the identity fits the profile, else the reason."""
    expected = profile.data["identity"]
    if identity.manufacturer.casefold() not in {name.casefold() for name in expected["manufacturers"]}:
        return f"manufacturer {identity.manufacturer!r} is not one of {expected['manufacturers']}"
    if identity.model.casefold() not in {name.casefold() for name in expected["models"]}:
        return f"model {identity.model!r} is not one of {expected['models']}"
    if not re.match(expected["firmware"], identity.firmware):
        return f"firmware {identity.firmware!r} does not match {expected['firmware']!r}"
    return None


def profile_for(identity: Identity) -> str | None:
    for profile in all_profiles():
        if matches(profile, identity) is None:
            return profile.id
    return None
