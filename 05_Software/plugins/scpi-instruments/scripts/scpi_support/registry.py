"""The workbench registry `lab/resources.json` (spec REQ-DATA-f2cbfc23 section 1), read from $SCPI_REGISTRY.

VERA validates the same document before it reserves a resource; the helper validates it again because it also
reads the plugin fields (profile, backend, bench limits) and runs without VERA in tests.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
from dataclasses import dataclass, field
from pathlib import Path

from .errors import Blocked, Refused

LIMIT_BYTES = 256 * 1024
ALIAS = re.compile(r"[a-z][a-z0-9-]{0,31}")
PROFILE = re.compile(r"[a-z0-9][a-z0-9-]{0,63}")
CHANNEL = re.compile(r"[A-Za-z0-9_-]{1,16}")
QUANTITY = re.compile(r"[a-z][a-z0-9-]{0,31}")
PRINTABLE = re.compile(r"[\x20-\x7e]+")
VISA = re.compile(
    r"(?i:ASRL(?:\d{1,3}|COM\d{1,3}|/dev/[\x21-\x7e]+?)::INSTR"
    r"|USB\d*::(?:0x[0-9a-f]{1,4}|\d{1,5})::(?:0x[0-9a-f]{1,4}|\d{1,5})::[\x21-\x39\x3b-\x7e]{1,64}(?:::\d{1,3})?::(?:INSTR|RAW)"
    r"|TCPIP\d*::(?:[a-z0-9][a-z0-9.-]{0,252}|\[[0-9a-f:.]{2,45}\])(?:::[a-z0-9,_.-]{1,64})?::INSTR"
    r"|TCPIP\d*::(?:[a-z0-9][a-z0-9.-]{0,252}|\[[0-9a-f:.]{2,45}\])::\d{1,5}::SOCKET"
    r"|GPIB\d*::\d{1,2}(?:::\d{1,3})?::INSTR)"
)
KEYS = {"alias", "kind", "resource", "serial", "profile", "backend", "limits", "note"}


@dataclass(frozen=True)
class Entry:
    alias: str
    resource: str
    profile: str
    serial: str | None = None
    backend: str = "py"
    limits: dict[str, dict[str, float]] = field(default_factory=dict)
    note: str = ""


@dataclass(frozen=True)
class Registry:
    path: Path
    sha256: str
    entries: tuple[Entry, ...]

    def entry(self, alias: str) -> Entry:
        for entry in self.entries:
            if entry.alias == alias:
                return entry
        raise Refused("request", f"The alias {alias} is not declared in lab/resources.json.")


def _printable(value: object, limit: int) -> bool:
    return isinstance(value, str) and 0 < len(value) <= limit and PRINTABLE.fullmatch(value) is not None


def _entry(raw: object, index: int) -> Entry:
    where = f"resources[{index}]"
    if not isinstance(raw, dict) or not set(raw) <= KEYS:
        raise Refused("request", f"lab/resources.json {where} has unknown or missing fields.")
    alias, kind, resource, profile = raw.get("alias"), raw.get("kind"), raw.get("resource"), raw.get("profile")
    if not isinstance(alias, str) or not ALIAS.fullmatch(alias):
        raise Refused("request", f"lab/resources.json {where}.alias must match [a-z][a-z0-9-]{{0,31}}.")
    if kind != "visa":
        raise Refused("request", f"lab/resources.json {where}.kind must be visa.")
    if not _printable(resource, 256) or not VISA.fullmatch(str(resource)):
        raise Refused("request", f"lab/resources.json {where}.resource is not a supported VISA resource name.")
    if not isinstance(profile, str) or not PROFILE.fullmatch(profile):
        raise Refused("request", f"lab/resources.json {where}.profile is not a profile id.")
    serial = raw.get("serial")
    if serial is not None and not _printable(serial, 64):
        raise Refused("request", f"lab/resources.json {where}.serial must be printable ASCII.")
    backend = raw.get("backend", "py")
    if backend not in ("py", "ivi"):
        raise Refused("request", f"lab/resources.json {where}.backend must be py or ivi.")
    note = raw.get("note", "")
    if not isinstance(note, str) or len(note) > 256:
        raise Refused("request", f"lab/resources.json {where}.note must be text of at most 256 characters.")
    limits_raw = raw.get("limits", {})
    limits: dict[str, dict[str, float]] = {}
    if not isinstance(limits_raw, dict) or len(limits_raw) > 16:
        raise Refused("request", f"lab/resources.json {where}.limits must map at most 16 channels.")
    for channel, quantities in limits_raw.items():
        if not CHANNEL.fullmatch(channel) or not isinstance(quantities, dict) or len(quantities) > 8:
            raise Refused("request", f"lab/resources.json {where}.limits.{channel} is not valid.")
        limits[channel] = {}
        for name, value in quantities.items():
            valid = isinstance(value, (int, float)) and not isinstance(value, bool)
            if not QUANTITY.fullmatch(name) or not valid or not math.isfinite(value) or value <= 0:
                raise Refused("request", f"lab/resources.json {where}.limits.{channel}.{name} must be a positive number.")
            limits[channel][name] = float(value)
    return Entry(alias, str(resource), profile, serial, backend, limits, note)


def load() -> Registry:
    """The registry $SCPI_REGISTRY names; Refused when it is missing, too large or invalid."""
    raw_path = os.environ.get("SCPI_REGISTRY", "")
    if not raw_path:
        raise Blocked("request", "SCPI_REGISTRY is not set; VERA sets it to <workbench>/lab/resources.json.")
    path = Path(raw_path)
    try:
        if not path.is_file():
            raise Refused("request", "lab/resources.json is missing; declare the bench resources there first.")
        if path.stat().st_size > LIMIT_BYTES:
            raise Refused("request", "lab/resources.json is larger than 256 KiB.")
        data = path.read_bytes()
    except OSError as error:
        raise Refused("request", f"lab/resources.json cannot be read: {error.strerror or error}.") from error
    approved = os.environ.get("VERA_REGISTRY_SHA256")
    digest = hashlib.sha256(data).hexdigest()
    if approved and approved.lower() != digest:
        raise Blocked(
            "registry-changed",
            "lab/resources.json changed after VERA approved this run; nothing was opened. Request the run again.",
        )
    try:
        document = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise Refused("request", "lab/resources.json is not valid UTF-8 JSON.") from error
    if not isinstance(document, dict) or set(document) != {"format", "resources"} or document.get("format") != 1:
        raise Refused("request", "lab/resources.json must be {format: 1, resources: [...]}.")
    resources = document["resources"]
    if not isinstance(resources, list) or not 1 <= len(resources) <= 64:
        raise Refused("request", "lab/resources.json declares 1 to 64 resources.")
    entries = tuple(_entry(raw, index) for index, raw in enumerate(resources))
    aliases = [entry.alias for entry in entries]
    if len(set(aliases)) != len(aliases):
        raise Refused("request", "lab/resources.json uses an alias twice.")
    return Registry(path, digest, entries)
