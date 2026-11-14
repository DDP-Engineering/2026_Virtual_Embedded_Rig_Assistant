"""Device profiles of ble-tool (spec REQ-DATA-e8502710 section 3): validated completely before the radio is used
(REQ-SEC-1c16a89f). A profile describes a device type; the registry entry names the unit.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from . import PROFILE_KIND
from .report import Refused, problem

LIMIT_BYTES = 64 * 1024
BASE = "-0000-1000-8000-00805f9b34fb"
UUID16 = re.compile(r"[0-9a-f]{4}")
UUID32 = re.compile(r"[0-9a-f]{8}")
UUID128 = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
NAME = re.compile(r"[a-z][a-z0-9-]{0,31}")
PROFILE_ID = re.compile(r"[a-z0-9][a-z0-9-]{0,63}")
HEX = re.compile(r"(?:[0-9a-fA-F]{2})+")
PROPERTIES = ("read", "write", "write-without-response", "notify", "indicate")
OPERATIONS = ("read", "notify", "write")
UNITS = (
    "none", "count", "percent", "degC", "K", "V", "mV", "A", "mA", "W", "Hz", "rpm", "Pa", "hPa", "m", "mm", "s", "ms",
    "lx", "ppm", "dBm", "bpm", "percentRH",
)  # fmt: skip
CLASSES = ("configure", "actuate", "persistent")
LIMITS = {
    "connectTimeoutS": (1, 60),
    "operationTimeoutS": (1, 60),
    "maxNotificationsPerSecond": (1, 500),
    "maxNotifications": (1, 100000),
    "maxBytes": (1, 16 * 1024 * 1024),
}


def normalize_uuid(text: Any) -> str | None:
    """The 128-bit lower-case form of a 16-, 32- or 128-bit UUID, or None."""
    if not isinstance(text, str):
        return None
    value = text.lower()
    if UUID16.fullmatch(value):
        return f"0000{value}{BASE}"
    if UUID32.fullmatch(value):
        return f"{value}{BASE}"
    return value if UUID128.fullmatch(value) else None


@dataclass(frozen=True)
class Payload:
    type: str
    size: int | None
    byte_order: str
    scale: float
    offset: float
    unit: str
    minimum: float | None
    maximum: float | None
    min_length: int
    max_length: int

    def summary(self) -> dict[str, Any]:
        out: dict[str, Any] = {"type": self.type, "unit": self.unit}
        if self.type in ("int", "uint", "float"):
            out.update(size=self.size, byteOrder=self.byte_order, scale=self.scale, offset=self.offset, min=self.minimum, max=self.maximum)
        else:
            out.update(minLength=self.min_length, maxLength=self.max_length)
        return out


@dataclass(frozen=True)
class Write:
    name: str
    klass: str
    value: str
    data: bytes
    response: bool
    read_back: bool


@dataclass(frozen=True)
class Characteristic:
    name: str
    uuid: str
    service: str
    properties: tuple[str, ...]
    operations: tuple[str, ...]
    side_effects: str
    payload: Payload
    writes: dict[str, Write]
    identity: bool


@dataclass
class Profile:
    path: str
    id: str
    name: str
    pairing: str
    advertisement: dict[str, Any]
    limits: dict[str, int]
    services: list[str]
    characteristics: dict[str, Characteristic] = field(default_factory=dict)

    @property
    def identity(self) -> Characteristic | None:
        return next((char for char in self.characteristics.values() if char.identity), None)

    def summary(self) -> dict[str, Any]:
        return {
            "path": self.path,
            "id": self.id,
            "name": self.name,
            "pairing": self.pairing,
            "advertisement": self.advertisement,
            "limits": self.limits,
            "services": self.services,
            "characteristics": [
                {
                    "name": char.name,
                    "uuid": char.uuid,
                    "service": char.service,
                    "properties": list(char.properties),
                    "operations": list(char.operations),
                    "sideEffects": char.side_effects,
                    "payload": char.payload.summary(),
                    "writes": [{"name": w.name, "class": w.klass, "value": w.value, "response": w.response, "readBack": w.read_back} for w in char.writes.values()],
                    "identity": char.identity,
                }
                for char in self.characteristics.values()
            ],
        }


def _bad(field_: str, message: str) -> Refused:
    return Refused([problem("profile", f"profile {field_}: {message}")])


def _object(value: Any, field_: str, allowed: set[str], required: set[str] = set()) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise _bad(field_, "must be an object")
    unknown = sorted(set(value) - allowed)
    if unknown:
        raise _bad(field_, f"has unknown fields {', '.join(unknown)}")
    missing = sorted(required - set(value))
    if missing:
        raise _bad(field_, f"lacks {', '.join(missing)}")
    return value


def _int(value: Any, field_: str, low: int, high: int) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or not low <= value <= high:
        raise _bad(field_, f"must be an integer from {low} to {high}")
    return value


def _number(value: Any, field_: str) -> float:
    if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
        raise _bad(field_, "must be a finite number")
    return float(value)


def _uuid(value: Any, field_: str) -> str:
    uuid = normalize_uuid(value)
    if uuid is None:
        raise _bad(field_, "must be a 16-bit (4 hex), 32-bit (8 hex) or 128-bit UUID")
    return uuid


def _payload(raw: Any, where: str) -> Payload:
    data = _object(raw, where, {"type", "size", "byteOrder", "scale", "offset", "unit", "min", "max", "minLength", "maxLength"}, {"type", "unit"})
    kind = data["type"]
    if kind not in ("int", "uint", "float", "utf8", "bytes"):
        raise _bad(f"{where}.type", "must be int, uint, float, utf8 or bytes")
    if data["unit"] not in UNITS:
        raise _bad(f"{where}.unit", f"'{str(data['unit'])[:32]}' is not a known unit ({', '.join(UNITS)})")
    if kind in ("int", "uint", "float"):
        for key in ("minLength", "maxLength"):
            if key in data:
                raise _bad(f"{where}.{key}", "applies to utf8 and bytes only")
        size = data.get("size")
        if size not in ((1, 2, 4, 8) if kind != "float" else (4, 8)):
            raise _bad(f"{where}.size", "must be 1, 2, 4 or 8 bytes (float: 4 or 8)")
        order = data.get("byteOrder")
        if order not in ("little", "big"):
            raise _bad(f"{where}.byteOrder", "must be little or big")
        scale = _number(data.get("scale", 1), f"{where}.scale")
        if scale == 0:
            raise _bad(f"{where}.scale", "must not be zero")
        offset = _number(data.get("offset", 0), f"{where}.offset")
        minimum = _number(data["min"], f"{where}.min") if "min" in data else None
        maximum = _number(data["max"], f"{where}.max") if "max" in data else None
        if minimum is not None and maximum is not None and minimum > maximum:
            raise _bad(f"{where}.min", "must not exceed max")
        return Payload(kind, int(size), order, scale, offset, data["unit"], minimum, maximum, 0, 0)
    for key in ("size", "byteOrder", "scale", "offset", "min", "max"):
        if key in data:
            raise _bad(f"{where}.{key}", "applies to numbers only")
    low = _int(data.get("minLength", 0), f"{where}.minLength", 0, 512)
    high = _int(data.get("maxLength", 512), f"{where}.maxLength", 1, 512)
    if low > high:
        raise _bad(f"{where}.minLength", "must not exceed maxLength")
    return Payload(kind, None, "little", 1.0, 0.0, data["unit"], None, None, low, high)


def _writes(raw: Any, where: str, properties: tuple[str, ...], operations: tuple[str, ...], payload: Payload) -> dict[str, Write]:
    if raw is None:
        return {}
    if "write" not in operations:
        raise _bad(where, "needs the write operation")
    if not isinstance(raw, list) or not 1 <= len(raw) <= 16:
        raise _bad(where, "must list 1 to 16 named write operations")
    writes: dict[str, Write] = {}
    for index, item in enumerate(raw):
        at = f"{where}[{index}]"
        data = _object(item, at, {"name", "class", "value", "data", "response", "readBack"}, {"name", "class", "value", "response"})
        name = data["name"]
        if not isinstance(name, str) or not NAME.fullmatch(name) or name in writes:
            raise _bad(f"{at}.name", "must match [a-z][a-z0-9-]{0,31} and be unique")
        if data["class"] not in CLASSES:
            raise _bad(f"{at}.class", "must be configure, actuate or persistent")
        response = data["response"]
        if not isinstance(response, bool):
            raise _bad(f"{at}.response", "must be true or false")
        needed = "write" if response else "write-without-response"
        if needed not in properties:
            raise _bad(f"{at}.response", f"needs the characteristic property {needed}")
        read_back = data.get("readBack", False)
        if not isinstance(read_back, bool) or (read_back and "read" not in operations):
            raise _bad(f"{at}.readBack", "must be a boolean and needs the read operation")
        if data["value"] == "fixed":
            hex_text = data.get("data")
            if not isinstance(hex_text, str) or not HEX.fullmatch(hex_text) or len(hex_text) > 1024:
                raise _bad(f"{at}.data", "must be 1 to 512 bytes of hex")
            blob = bytes.fromhex(hex_text)
        elif data["value"] == "typed":
            if "data" in data:
                raise _bad(f"{at}.data", "applies to fixed writes only")
            if payload.type not in ("int", "uint", "float"):
                raise _bad(f"{at}.value", "typed writes need a numeric payload")
            blob = b""
        else:
            raise _bad(f"{at}.value", "must be fixed or typed")
        writes[name] = Write(name, data["class"], data["value"], blob, response, read_back)
    return writes


def validate(document: Any, path: str) -> Profile:
    data = _object(document, "document", {"format", "kind", "id", "name", "pairing", "advertisement", "limits", "services"}, {"format", "kind", "id", "pairing", "limits", "services"})
    if data["format"] != 1 or data["kind"] != PROFILE_KIND:
        raise _bad("format", f"must be format 1 and kind {PROFILE_KIND}")
    if not isinstance(data["id"], str) or not PROFILE_ID.fullmatch(data["id"]):
        raise _bad("id", "must match [a-z0-9][a-z0-9-]{0,63}")
    name = data.get("name", data["id"])
    if not isinstance(name, str) or not 1 <= len(name) <= 120:
        raise _bad("name", "must be 1 to 120 characters")
    if data["pairing"] not in ("none", "required"):
        raise _bad("pairing", "must be none or required")
    advertisement: dict[str, Any] = {}
    if "advertisement" in data:
        ad = _object(data["advertisement"], "advertisement", {"serviceUuids", "localName", "manufacturerId"})
        if "serviceUuids" in ad:
            if not isinstance(ad["serviceUuids"], list) or not 1 <= len(ad["serviceUuids"]) <= 8:
                raise _bad("advertisement.serviceUuids", "must list 1 to 8 UUIDs")
            advertisement["serviceUuids"] = [_uuid(value, "advertisement.serviceUuids") for value in ad["serviceUuids"]]
        if "localName" in ad:
            if not isinstance(ad["localName"], str) or not 1 <= len(ad["localName"]) <= 64:
                raise _bad("advertisement.localName", "must be 1 to 64 characters")
            advertisement["localName"] = ad["localName"]
        if "manufacturerId" in ad:
            advertisement["manufacturerId"] = _int(ad["manufacturerId"], "advertisement.manufacturerId", 0, 65535)
    limits_raw = _object(data["limits"], "limits", set(LIMITS), set(LIMITS))
    limits = {key: _int(limits_raw[key], f"limits.{key}", *LIMITS[key]) for key in LIMITS}
    services = data["services"]
    if not isinstance(services, list) or not 1 <= len(services) <= 16:
        raise _bad("services", "must list 1 to 16 services")
    profile = Profile(path, data["id"], name, data["pairing"], advertisement, limits, [])
    for s_index, service in enumerate(services):
        at = f"services[{s_index}]"
        svc = _object(service, at, {"uuid", "characteristics"}, {"uuid", "characteristics"})
        uuid = _uuid(svc["uuid"], f"{at}.uuid")
        if uuid in profile.services:
            raise _bad(f"{at}.uuid", "is declared twice")
        profile.services.append(uuid)
        chars = svc["characteristics"]
        if not isinstance(chars, list) or not 1 <= len(chars) <= 32:
            raise _bad(f"{at}.characteristics", "must list 1 to 32 characteristics")
        for c_index, raw in enumerate(chars):
            where = f"{at}.characteristics[{c_index}]"
            char = _object(raw, where, {"name", "uuid", "properties", "operations", "sideEffects", "payload", "writes", "identity"}, {"name", "uuid", "properties", "operations", "sideEffects", "payload"})
            cname = char["name"]
            if not isinstance(cname, str) or not NAME.fullmatch(cname) or cname in profile.characteristics:
                raise _bad(f"{where}.name", "must match [a-z][a-z0-9-]{0,31} and be unique in the profile")
            props = char["properties"]
            if not isinstance(props, list) or not props or any(p not in PROPERTIES for p in props) or len(set(props)) != len(props):
                raise _bad(f"{where}.properties", f"must list distinct properties of {', '.join(PROPERTIES)}")
            ops = char["operations"]
            if not isinstance(ops, list) or not ops or any(o not in OPERATIONS for o in ops) or len(set(ops)) != len(ops):
                raise _bad(f"{where}.operations", "must list distinct operations of read, notify, write")
            backing = {"read": ("read",), "notify": ("notify", "indicate"), "write": ("write", "write-without-response")}
            for op in ops:
                if not any(p in props for p in backing[op]):
                    raise _bad(f"{where}.operations", f"{op} needs the property {' or '.join(backing[op])}")
            if char["sideEffects"] not in ("none", "changes-state"):
                raise _bad(f"{where}.sideEffects", "must be none or changes-state; the profile author decides it")
            payload = _payload(char["payload"], f"{where}.payload")
            writes = _writes(char.get("writes"), f"{where}.writes", tuple(props), tuple(ops), payload)
            if "write" in ops and not writes:
                raise _bad(f"{where}.writes", "the write operation needs named write operations")
            identity = char.get("identity", False)
            if not isinstance(identity, bool):
                raise _bad(f"{where}.identity", "must be true or false")
            if identity and (payload.type not in ("utf8", "bytes") or "read" not in ops or char["sideEffects"] != "none" or profile.identity):
                raise _bad(f"{where}.identity", "only one readable utf8 or bytes characteristic without side effects identifies the unit")
            profile.characteristics[cname] = Characteristic(cname, _uuid(char["uuid"], f"{where}.uuid"), uuid, tuple(props), tuple(ops), char["sideEffects"], payload, writes, identity)
    return profile


def load(file: Path, shown: str) -> Profile:
    try:
        if file.stat().st_size > LIMIT_BYTES:
            raise _bad("document", "is larger than 64 KiB")
        document = json.loads(file.read_bytes().decode("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise _bad("document", f"{shown} is not readable UTF-8 JSON") from error
    return validate(document, shown)
