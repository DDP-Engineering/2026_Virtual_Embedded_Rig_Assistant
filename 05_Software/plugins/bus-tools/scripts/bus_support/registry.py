"""The bus adapters of the workbench registry `lab/resources.json` (spec REQ-DATA-f2cbfc23 section 1), read from
$BUS_REGISTRY.

VERA validates the whole document before it reserves the adapter; bus-tool validates its own entries again (it runs
without VERA in tests) and ignores entries of other kinds. A registry whose bytes differ from the approved hash
($VERA_REGISTRY_SHA256) is refused before any port is opened (REQ-SEC-d8671786).
"""

from __future__ import annotations

import hashlib
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path

from . import BACKEND
from .report import refused

LIMIT_BYTES = 256 * 1024
ALIAS = re.compile(r"[a-z][a-z0-9-]{0,31}")
PORT = re.compile(r"(?:[Cc][Oo][Mm][1-9]\d{0,2}|/dev/[\x21-\x7e]{1,250})")
IDENTITY = re.compile(r"usb:[0-9A-Fa-f]{4}:[0-9A-Fa-f]{4}:[\x21-\x39\x3b-\x7e]{1,64}")
KEYS = {"alias", "kind", "backend", "resource", "terminal", "identity", "power", "note"}


@dataclass(frozen=True)
class Adapter:
    alias: str
    resource: str
    terminal: str
    identity: str
    max_mv: int | None
    max_ma: int | None
    note: str


@dataclass(frozen=True)
class Registry:
    path: Path
    sha256: str
    adapters: dict[str, Adapter]
    others: dict[str, str]

    def adapter(self, alias: str) -> Adapter:
        if alias in self.adapters:
            return self.adapters[alias]
        if alias in self.others:
            raise refused("adapter-unknown", f"The alias {alias} is a {self.others[alias]} resource, not a bus adapter.")
        raise refused("adapter-unknown", f"The alias {alias} is not declared in lab/resources.json.")


def _port_key(port: str) -> str:
    return port.upper() if port[:3].upper() == "COM" else port


def _adapter(raw: dict, where: str) -> Adapter:
    def bad(field: str, rule: str) -> Exception:
        return refused("registry", f"lab/resources.json {where}.{field} {rule}.")

    if not set(raw) <= KEYS:
        raise bad("", "has unknown fields")
    if raw.get("backend") != BACKEND:
        raise bad("backend", f"must be {BACKEND}")
    resource, terminal, identity = raw.get("resource"), raw.get("terminal"), raw.get("identity")
    for name, value in (("resource", resource), ("terminal", terminal)):
        if not isinstance(value, str) or not PORT.fullmatch(value):
            raise bad(name, "must be COM<n> or a /dev/ path")
    if _port_key(str(resource)) == _port_key(str(terminal)):
        raise bad("terminal", "must differ from resource")
    if not isinstance(identity, str) or not IDENTITY.fullmatch(identity):
        raise bad("identity", "must be usb:<vid>:<pid>:<serial>")
    power = raw.get("power")
    max_mv = max_ma = None
    if power is not None:
        valid = isinstance(power, dict) and set(power) == {"maxMv", "maxMa"}
        values = [power.get("maxMv"), power.get("maxMa")] if valid else []
        if not valid or not all(isinstance(value, int) and not isinstance(value, bool) for value in values) or not (800 <= values[0] <= 5000 and 1 <= values[1] <= 500):
            raise bad("power", "must be {maxMv: 800-5000, maxMa: 1-500}")
        max_mv, max_ma = values
    note = raw.get("note", "")
    if not isinstance(note, str) or len(note) > 256:
        raise bad("note", "must be text of at most 256 characters")
    return Adapter(str(raw["alias"]), str(resource), str(terminal), str(identity), max_mv, max_ma, note)


def load() -> Registry:
    raw_path = os.environ.get("BUS_REGISTRY", "")
    if not raw_path:
        raise refused("registry", "BUS_REGISTRY is not set; VERA sets it to <workbench>/lab/resources.json.")
    path = Path(raw_path)
    try:
        if not path.is_file():
            raise refused("registry", "lab/resources.json is missing; declare the bus adapter there first.")
        if path.stat().st_size > LIMIT_BYTES:
            raise refused("registry", "lab/resources.json is larger than 256 KiB.")
        data = path.read_bytes()
    except OSError as error:
        raise refused("registry", f"lab/resources.json cannot be read: {error.strerror or error}.") from error
    digest = hashlib.sha256(data).hexdigest()
    approved = os.environ.get("VERA_REGISTRY_SHA256")
    if approved and approved.lower() != digest:
        raise refused("registry-changed", "lab/resources.json changed after VERA approved this run; nothing was opened. Request the run again.")
    try:
        document = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise refused("registry", "lab/resources.json is not valid UTF-8 JSON.") from error
    if not isinstance(document, dict) or set(document) != {"format", "resources"} or document.get("format") != 1:
        raise refused("registry", "lab/resources.json must be {format: 1, resources: [...]}.")
    resources = document["resources"]
    if not isinstance(resources, list) or not 1 <= len(resources) <= 64:
        raise refused("registry", "lab/resources.json declares 1 to 64 resources.")
    adapters: dict[str, Adapter] = {}
    others: dict[str, str] = {}
    for index, raw in enumerate(resources):
        where = f"resources[{index}]"
        alias = raw.get("alias") if isinstance(raw, dict) else None
        if not isinstance(alias, str) or not ALIAS.fullmatch(alias):
            raise refused("registry", f"lab/resources.json {where}.alias must match [a-z][a-z0-9-]{{0,31}}.")
        if alias in adapters or alias in others:
            raise refused("registry", "lab/resources.json uses an alias twice.")
        if raw.get("kind") == "bus-adapter":
            adapters[alias] = _adapter(raw, where)
        else:
            others[alias] = str(raw.get("kind"))[:32]
    return Registry(path, digest, adapters, others)
