"""The broker profile of mqtt-tool (spec REQ-DATA-96d18686 section 3, REQ-DATA-96d18686).

Validated in full before any connection: an unknown field, a value out of range or a rule broken (QoS 2, a
wildcard publish topic, an unbounded filter, a retained command, a Will on a command topic, a credential over
plaintext to another host) refuses the whole profile with `profile-invalid` naming the field.
"""

from __future__ import annotations

import hashlib
import ipaddress
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from . import PROFILE_KIND, schema, topics, workspace
from .report import Refused, problem

PROFILE_LIMIT = 64 * 1024
HOST = re.compile(r"^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?)*$")
PREFIX = re.compile(r"^[A-Za-z0-9._-]{1,40}$")
REFERENCE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$")
SCHEMA_NAME = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
LOOPBACK = ("localhost",)
FIELDS = {"format", "kind", "name", "broker", "tls", "credential", "client", "connect", "reconnect", "limits", "subscribe", "publish", "will", "schemas"}


def _invalid(field: str, message: str) -> Refused:
    return Refused([problem("profile-invalid", f"Profile field {field}: {message}", field=field)])


def _object(value: Any, field: str, allowed: set[str], required: set[str] = set()) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise _invalid(field, "must be an object.")
    for key in value:
        if key not in allowed:
            raise _invalid(f"{field}.{key}" if field else key, "is not a field of the mqtt-tools profile.")
    for key in required:
        if key not in value:
            raise _invalid(f"{field}.{key}" if field else key, "is required.")
    return value


def _int(value: Any, field: str, low: int, high: int) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or not low <= value <= high:
        raise _invalid(field, f"must be an integer from {low} to {high}.")
    return value


def _bool(value: Any, field: str) -> bool:
    if not isinstance(value, bool):
        raise _invalid(field, "must be true or false.")
    return value


def _qos(value: Any, field: str) -> int:
    if value not in (0, 1) or isinstance(value, bool):
        raise _invalid(field, "must be 0 or 1 (QoS 2 is not supported).")
    return value


def loopback(host: str) -> bool:
    if host.lower() in LOOPBACK:
        return True
    try:
        return ipaddress.ip_address(host.strip("[]")).is_loopback
    except ValueError:
        return False


@dataclass
class Profile:
    data: dict[str, Any]
    path: str
    sha256: str
    folder: Path
    ca: Path | None
    ca_sha256: str | None

    @property
    def name(self) -> str:
        return self.data["name"]

    @property
    def credential(self) -> str | None:
        return self.data.get("credential")

    @property
    def protocol(self) -> str:
        return self.data["client"]["protocol"]

    @property
    def limits(self) -> dict[str, int]:
        return self.data["limits"]

    def publish_entry(self, topic: str) -> dict[str, Any] | None:
        return next((entry for entry in self.data["publish"] if entry["topic"] == topic), None)

    def subscribe_entry(self, filter_: str) -> dict[str, Any] | None:
        return next((entry for entry in self.data["subscribe"] if topics.covers(entry["filter"], filter_)), None)

    def schema_for_topic(self, topic: str) -> dict[str, Any] | None:
        for entry in self.data["subscribe"]:
            if topics.matches(entry["filter"], topic) and entry.get("schema"):
                return self.data["schemas"][entry["schema"]]
        entry = self.publish_entry(topic)
        if entry and entry.get("schema"):
            return self.data["schemas"][entry["schema"]]
        return None

    def summary(self) -> dict[str, Any]:
        return {"path": self.path, "sha256": self.sha256, "name": self.name}

    def effective(self) -> dict[str, Any]:
        """The profile as checked, with the CA's hash; the credential is a reference only."""
        return {**self.data, "tls": {**self.data["tls"], **({"caSha256": self.ca_sha256} if self.ca_sha256 else {})}}


def _schemas(value: Any, max_payload: int) -> dict[str, dict[str, Any]]:
    if not isinstance(value, dict) or len(value) > 32:
        raise _invalid("schemas", "must be an object of at most 32 schemas.")
    for name, item in value.items():
        field = f"schemas.{name}"
        if not SCHEMA_NAME.match(name):
            raise _invalid(field, "has an invalid name.")
        _object(item, field, {"format", "maxBytes", "required", "sequence"}, {"format", "maxBytes"})
        if item["format"] not in ("json", "text", "binary"):
            raise _invalid(f"{field}.format", "must be json, text or binary.")
        _int(item["maxBytes"], f"{field}.maxBytes", 1, max_payload)
        if item["format"] != "json" and ("required" in item or "sequence" in item):
            raise _invalid(field, "required and sequence apply to json schemas only.")
        required = item.get("required", {})
        if not isinstance(required, dict) or len(required) > 64 or any(kind not in schema.TYPES for kind in required.values()):
            raise _invalid(f"{field}.required", f"maps fields to one of {', '.join(schema.TYPES)}.")
        if "sequence" in item and (not isinstance(item["sequence"], str) or not item["sequence"]):
            raise _invalid(f"{field}.sequence", "names an integer field.")
    return value


def validate(data: Any, cwd: Path, spelled: Path) -> tuple[dict[str, Any], Path | None]:
    """The checked profile and its CA file; Refused (profile-invalid or path) otherwise."""
    _object(data, "", FIELDS, {"format", "kind", "name", "broker", "tls", "client", "limits", "subscribe", "publish"})
    if data["format"] != 1 or data["kind"] != PROFILE_KIND:
        raise _invalid("kind", f"must be format 1 and kind {PROFILE_KIND}.")
    if not isinstance(data["name"], str) or not 1 <= len(data["name"]) <= 80:
        raise _invalid("name", "must be 1-80 characters.")
    broker = _object(data["broker"], "broker", {"host", "port"}, {"host", "port"})
    host = broker["host"]
    if not isinstance(host, str) or not (HOST.match(host) or _ip(host)):
        raise _invalid("broker.host", "must be a host name or an IP address.")
    _int(broker["port"], "broker.port", 1, 65535)
    tls = _object(data["tls"], "tls", {"enabled", "ca", "system"}, {"enabled"})
    ca: Path | None = None
    if _bool(tls["enabled"], "tls.enabled"):
        if ("ca" in tls) == bool(tls.get("system")):
            raise _invalid("tls", "names exactly one trust source: ca (a PEM file in the workbench) or system true.")
        if "system" in tls and tls["system"] is not True:
            raise _invalid("tls.system", "must be true when present.")
        if "ca" in tls:
            if not isinstance(tls["ca"], str):
                raise _invalid("tls.ca", "must be a path.")
            try:
                ca = workspace.regular_file(cwd, tls["ca"], "tls.ca", spelled)
            except workspace.PathRefused as error:
                raise Refused([problem("path", str(error), field="tls.ca")]) from error
    elif "ca" in tls or "system" in tls:
        raise _invalid("tls", "ca and system apply only with enabled true.")
    if "credential" in data:
        if not isinstance(data["credential"], str) or not REFERENCE.match(data["credential"]):
            raise _invalid("credential", "must be a reference of 1-64 lowercase letters, digits and dashes.")
        if not tls["enabled"] and not loopback(host):
            raise Refused([problem("plaintext-credential", f"The profile sends credential {data['credential']} without TLS to {host}; enable TLS or use a loopback broker.", field="tls.enabled")])
    client = _object(data["client"], "client", {"idPrefix", "protocol", "keepaliveS"}, {"idPrefix", "protocol"})
    if not isinstance(client["idPrefix"], str) or not PREFIX.match(client["idPrefix"]):
        raise _invalid("client.idPrefix", "must be 1-40 of letters, digits, '.', '_' or '-'.")
    if client["protocol"] not in ("5", "3.1.1"):
        raise _invalid("client.protocol", 'must be "5" or "3.1.1".')
    client.setdefault("keepaliveS", 30)
    _int(client["keepaliveS"], "client.keepaliveS", 5, 600)
    connect = _object(data.setdefault("connect", {"timeoutMs": 5000}), "connect", {"timeoutMs"}, {"timeoutMs"})
    _int(connect["timeoutMs"], "connect.timeoutMs", 100, 60000)
    reconnect = _object(data.setdefault("reconnect", {"attempts": 0, "delayMs": 1000}), "reconnect", {"attempts", "delayMs"}, {"attempts", "delayMs"})
    _int(reconnect["attempts"], "reconnect.attempts", 0, 5)
    _int(reconnect["delayMs"], "reconnect.delayMs", 100, 60000)
    limits = _object(data["limits"], "limits", {"maxDurationS", "maxMessages", "maxBytes", "maxPayloadBytes"}, {"maxDurationS", "maxMessages", "maxBytes", "maxPayloadBytes"})
    _int(limits["maxDurationS"], "limits.maxDurationS", 1, 3600)
    _int(limits["maxMessages"], "limits.maxMessages", 1, 100000)
    _int(limits["maxBytes"], "limits.maxBytes", 1, 64 * 1024 * 1024)
    _int(limits["maxPayloadBytes"], "limits.maxPayloadBytes", 1, 1024 * 1024)
    schemas = _schemas(data.setdefault("schemas", {}), limits["maxPayloadBytes"])

    def schema_ref(item: dict[str, Any], field: str) -> None:
        if "schema" in item and item["schema"] not in schemas:
            raise _invalid(f"{field}.schema", "names no schema of the profile.")

    if not isinstance(data["subscribe"], list) or len(data["subscribe"]) > 32:
        raise _invalid("subscribe", "must be a list of at most 32 filters.")
    for index, item in enumerate(data["subscribe"]):
        field = f"subscribe.{index}"
        _object(item, field, {"filter", "qos", "schema"}, {"filter", "qos"})
        if not isinstance(item["filter"], str) or not topics.bounded_filter(item["filter"]):
            raise _invalid(f"{field}.filter", "must be a valid filter whose first level is a literal not starting with $.")
        _qos(item["qos"], f"{field}.qos")
        schema_ref(item, field)
    if not isinstance(data["publish"], list) or len(data["publish"]) > 32:
        raise _invalid("publish", "must be a list of at most 32 topics.")
    seen: set[str] = set()
    for index, item in enumerate(data["publish"]):
        field = f"publish.{index}"
        _object(item, field, {"topic", "kind", "qos", "retain", "schema", "response"}, {"topic", "kind", "qos"})
        if not isinstance(item["topic"], str) or not topics.literal_topic(item["topic"]) or item["topic"] in seen:
            raise _invalid(f"{field}.topic", "must be a literal topic (no +, # or leading $), declared once.")
        seen.add(item["topic"])
        if item["kind"] not in ("command", "data", "status"):
            raise _invalid(f"{field}.kind", "must be command, data or status.")
        _qos(item["qos"], f"{field}.qos")
        if _bool(item.setdefault("retain", False), f"{field}.retain") and item["kind"] == "command":
            raise _invalid(f"{field}.retain", "a command topic is never retained.")
        schema_ref(item, field)
        if "response" in item:
            response = _object(item["response"], f"{field}.response", {"topic", "timeoutMs", "correlationField"}, {"topic", "timeoutMs"})
            if not isinstance(response["topic"], str) or not topics.literal_topic(response["topic"]):
                raise _invalid(f"{field}.response.topic", "must be a literal topic.")
            _int(response["timeoutMs"], f"{field}.response.timeoutMs", 100, 60000)
            if client["protocol"] == "3.1.1":
                correlation = response.get("correlationField")
                if not isinstance(correlation, str) or not correlation or schemas.get(item.get("schema", ""), {}).get("format") != "json":
                    raise _invalid(f"{field}.response.correlationField", "MQTT 3.1.1 requests need a JSON schema and the correlation field.")
    if "will" in data:
        will = _object(data["will"], "will", {"topic", "payload", "qos", "retain"}, {"topic", "payload", "qos", "retain"})
        entry = next((item for item in data["publish"] if item["topic"] == will["topic"]), None)
        if entry is None or entry["kind"] != "status":
            raise _invalid("will.topic", "must be a declared status topic; no command or data Will is ever set.")
        _qos(will["qos"], "will.qos")
        if _bool(will["retain"], "will.retain") and not entry["retain"]:
            raise _invalid("will.retain", "the Will's topic does not allow retain.")
        if not isinstance(will["payload"], str) or len(will["payload"].encode("utf-8")) > limits["maxPayloadBytes"]:
            raise _invalid("will.payload", "must be text within limits.maxPayloadBytes.")
    return data, ca


def _ip(text: str) -> bool:
    try:
        ipaddress.ip_address(text)
        return True
    except ValueError:
        return False


def load(cwd: Path, spelled: Path, raw: str) -> Profile:
    try:
        file = workspace.regular_file(cwd, raw, "--profile", spelled)
    except workspace.PathRefused as error:
        raise Refused([problem("path", str(error))]) from error
    content = file.read_bytes()
    if len(content) > PROFILE_LIMIT:
        raise _invalid("", f"the profile file is larger than {PROFILE_LIMIT} bytes.")
    try:
        data = json.loads(content.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as error:
        raise _invalid("", f"the profile is not UTF-8 JSON ({type(error).__name__}).") from None
    data, ca = validate(data, cwd, spelled)
    ca_sha = hashlib.sha256(ca.read_bytes()).hexdigest() if ca else None
    return Profile(data, workspace.relative(cwd, file), hashlib.sha256(content).hexdigest(), cwd, ca, ca_sha)
