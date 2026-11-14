"""The BLE devices of the workbench registry `lab/resources.json` (spec REQ-DATA-f2cbfc23 section 1, kind ble-device),
read from $BLE_REGISTRY.

VERA validates the whole document before it reserves the device; ble-tool validates its own entries again (it runs
without VERA in tests) and ignores entries of other kinds. A registry whose bytes differ from the approved hash
($VERA_REGISTRY_SHA256) is refused before the radio is used (REQ-SEC-ad7b56a7).
"""

from __future__ import annotations

import hashlib
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path

from .report import refused

LIMIT_BYTES = 256 * 1024
ALIAS = re.compile(r"[a-z][a-z0-9-]{0,31}")
ADDRESS = re.compile(r"[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5}")
PROFILE_ID = re.compile(r"[a-z0-9][a-z0-9-]{0,63}")
SERIAL = re.compile(r"[\x20-\x7e]{1,64}")
ADAPTER = re.compile(r"hci(?:[0-9]|[1-9][0-9])")
KEYS = {"alias", "kind", "address", "addressType", "profile", "serial", "adapter", "note"}


@dataclass(frozen=True)
class Device:
    alias: str
    address: str
    address_type: str
    profile: str
    serial: str | None
    adapter: str | None
    note: str

    def summary(self) -> dict[str, object]:
        return {"alias": self.alias, "address": self.address, "addressType": self.address_type, "profile": self.profile}


@dataclass(frozen=True)
class Registry:
    path: Path
    sha256: str
    devices: dict[str, Device]
    others: dict[str, str]

    def device(self, alias: str) -> Device:
        if alias in self.devices:
            return self.devices[alias]
        if alias in self.others:
            raise refused("device-unknown", f"The alias {alias} is a {self.others[alias]} resource, not a BLE device.")
        raise refused("device-unknown", f"The alias {alias} is not declared in lab/resources.json.")


def _device(raw: dict, where: str) -> Device:
    def bad(field: str, rule: str) -> Exception:
        return refused("registry", f"lab/resources.json {where}.{field} {rule}.")

    if not set(raw) <= KEYS:
        raise refused("registry", f"lab/resources.json {where} has unknown fields {', '.join(sorted(set(raw) - KEYS))}.")
    address, kind = raw.get("address"), raw.get("addressType")
    if not isinstance(address, str) or not ADDRESS.fullmatch(address):
        raise bad("address", "must be six colon-separated hex octets")
    if kind not in ("public", "random"):
        raise bad("addressType", "must be public or random")
    if kind == "random" and int(address[:2], 16) & 0xC0 != 0xC0:
        raise bad("address", "must be a static random address; private addresses change")
    profile = raw.get("profile")
    if not isinstance(profile, str) or not PROFILE_ID.fullmatch(profile):
        raise bad("profile", "must match [a-z0-9][a-z0-9-]{0,63}")
    serial, adapter, note = raw.get("serial"), raw.get("adapter"), raw.get("note", "")
    if serial is not None and (not isinstance(serial, str) or not SERIAL.fullmatch(serial)):
        raise bad("serial", "must be 1 to 64 printable ASCII characters")
    if adapter is not None and (not isinstance(adapter, str) or not ADAPTER.fullmatch(adapter)):
        raise bad("adapter", "must be hci0 to hci99")
    if not isinstance(note, str) or len(note) > 256:
        raise bad("note", "must be text of at most 256 characters")
    return Device(str(raw["alias"]), address.upper(), kind, profile, serial, adapter, note)


def load() -> Registry:
    raw_path = os.environ.get("BLE_REGISTRY", "")
    if not raw_path:
        raise refused("registry", "BLE_REGISTRY is not set; VERA sets it to <workbench>/lab/resources.json.")
    path = Path(raw_path)
    try:
        if not path.is_file():
            raise refused("registry", "lab/resources.json is missing; declare the BLE device there first.")
        if path.stat().st_size > LIMIT_BYTES:
            raise refused("registry", "lab/resources.json is larger than 256 KiB.")
        data = path.read_bytes()
    except OSError as error:
        raise refused("registry", f"lab/resources.json cannot be read: {error.strerror or error}.") from error
    digest = hashlib.sha256(data).hexdigest()
    approved = os.environ.get("VERA_REGISTRY_SHA256")
    if approved and approved.lower() != digest:
        raise refused("registry-changed", "lab/resources.json changed after VERA approved this run; the radio was not used. Request the run again.")
    try:
        document = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise refused("registry", "lab/resources.json is not valid UTF-8 JSON.") from error
    if not isinstance(document, dict) or set(document) != {"format", "resources"} or document.get("format") != 1:
        raise refused("registry", "lab/resources.json must be {format: 1, resources: [...]}.")
    resources = document["resources"]
    if not isinstance(resources, list) or not 1 <= len(resources) <= 64:
        raise refused("registry", "lab/resources.json declares 1 to 64 resources.")
    devices: dict[str, Device] = {}
    others: dict[str, str] = {}
    for index, raw in enumerate(resources):
        where = f"resources[{index}]"
        alias = raw.get("alias") if isinstance(raw, dict) else None
        if not isinstance(alias, str) or not ALIAS.fullmatch(alias):
            raise refused("registry", f"lab/resources.json {where}.alias must match [a-z][a-z0-9-]{{0,31}}.")
        if alias in devices or alias in others:
            raise refused("registry", "lab/resources.json uses an alias twice.")
        if raw.get("kind") == "ble-device":
            devices[alias] = _device(raw, where)
        else:
            others[alias] = str(raw.get("kind"))[:32]
    return Registry(path, digest, devices, others)
