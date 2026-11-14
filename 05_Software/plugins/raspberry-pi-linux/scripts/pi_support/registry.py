"""The Linux boards of the workbench registry `lab/resources.json` (spec REQ-DATA-f2cbfc23 section 1, kind
linux-board), read from $PI_REGISTRY.

VERA validates the whole document before it reserves the board; pi-tool validates its own entries again (it runs
without VERA in tests) and ignores entries of other kinds. A registry whose bytes differ from the approved hash
($VERA_REGISTRY_SHA256) is refused before any connection.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .report import refused

LIMIT_BYTES = 256 * 1024
ALIAS = re.compile(r"[a-z][a-z0-9-]{0,31}")
HOST = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9.-]{0,252})|[0-9A-Fa-f:.]{2,45}")
USER = re.compile(r"[a-z_][a-z0-9_-]{0,31}")
FINGERPRINT = re.compile(r"SHA256:[A-Za-z0-9+/]{43}")
SEGMENT = re.compile(r"[A-Za-z0-9._-]+")
SERIAL = re.compile(r"[0-9A-Fa-f]{8,32}")
MACHINE_ID = re.compile(r"[0-9a-f]{32}")
MODEL = re.compile(r"[\x20-\x7e]{1,128}")
KEYS = {"alias", "kind", "host", "port", "user", "hostKeys", "agentKey", "identity", "root", "note"}


@dataclass(frozen=True)
class Board:
    alias: str
    host: str
    port: int
    user: str
    host_keys: tuple[str, ...]
    agent_key: str | None
    identity: dict[str, str]
    root: str
    note: str

    def summary(self, host_key: str | None = None) -> dict[str, Any]:
        return {"alias": self.alias, "host": self.host, "port": self.port, "user": self.user, "root": self.root, "hostKey": host_key}

    def expect(self) -> dict[str, str]:
        return {"user": self.user, **self.identity}


@dataclass(frozen=True)
class Registry:
    path: Path
    sha256: str
    boards: dict[str, Board]
    others: dict[str, str]

    def board(self, alias: str) -> Board:
        if alias in self.boards:
            return self.boards[alias]
        if alias in self.others:
            raise refused("board-unknown", f"The alias {alias} is a {self.others[alias]} resource, not a Linux board.")
        raise refused("board-unknown", f"The alias {alias} is not declared in lab/resources.json.")


def valid_root(root: object) -> bool:
    if not isinstance(root, str) or len(root) > 256 or not root.startswith("/"):
        return False
    segments = root.split("/")[1:]
    return 2 <= len(segments) <= 16 and all(SEGMENT.fullmatch(part) and part not in (".", "..") for part in segments)


def _board(raw: dict, where: str) -> Board:
    def bad(field: str, rule: str) -> Exception:
        return refused("registry", f"lab/resources.json {where}.{field} {rule}.")

    if not set(raw) <= KEYS:
        raise refused("registry", f"lab/resources.json {where} has unknown fields {', '.join(sorted(set(raw) - KEYS))}.")
    host, port, user = raw.get("host"), raw.get("port"), raw.get("user")
    if not isinstance(host, str) or not HOST.fullmatch(host):
        raise bad("host", "must be a host name, an IPv4 address or an IPv6 address without brackets")
    if not isinstance(port, int) or isinstance(port, bool) or not 1 <= port <= 65535:
        raise bad("port", "must be 1 to 65535")
    if not isinstance(user, str) or not USER.fullmatch(user) or user == "root":
        raise bad("user", "must be a lower-case login name other than root")
    keys = raw.get("hostKeys")
    if not isinstance(keys, list) or len(keys) > 4 or not all(isinstance(key, str) and FINGERPRINT.fullmatch(key) for key in keys):
        raise bad("hostKeys", "must list 0 to 4 SHA256:<43 base64> fingerprints")
    agent = raw.get("agentKey")
    if agent is not None and (not isinstance(agent, str) or not FINGERPRINT.fullmatch(agent)):
        raise bad("agentKey", "must be one SHA256:<43 base64> fingerprint")
    identity = raw.get("identity")
    if not isinstance(identity, dict) or not set(identity) <= {"serial", "machineId", "model"}:
        raise bad("identity", "must be {serial?, machineId?, model?}")
    rules = {"serial": SERIAL, "machineId": MACHINE_ID, "model": MODEL}
    for key, value in identity.items():
        if not isinstance(value, str) or not rules[key].fullmatch(value):
            raise bad(f"identity.{key}", "is malformed")
    if "serial" not in identity and "machineId" not in identity:
        raise bad("identity", "must declare the board's serial or machine id")
    root = raw.get("root")
    if not valid_root(root):
        raise bad("root", "must be an absolute path of 2 to 16 segments [A-Za-z0-9._-] without . or ..")
    note = raw.get("note", "")
    if not isinstance(note, str) or len(note) > 256:
        raise bad("note", "must be text of at most 256 characters")
    return Board(str(raw["alias"]), host, port, user, tuple(keys), agent, dict(identity), str(root), note)


def load() -> Registry:
    raw_path = os.environ.get("PI_REGISTRY", "")
    if not raw_path:
        raise refused("registry", "PI_REGISTRY is not set; VERA sets it to <workbench>/lab/resources.json.")
    path = Path(raw_path)
    try:
        if not path.is_file():
            raise refused("registry", "lab/resources.json is missing; declare the board there first.")
        if path.stat().st_size > LIMIT_BYTES:
            raise refused("registry", "lab/resources.json is larger than 256 KiB.")
        data = path.read_bytes()
    except OSError as error:
        raise refused("registry", f"lab/resources.json cannot be read: {error.strerror or error}.") from error
    digest = hashlib.sha256(data).hexdigest()
    approved = os.environ.get("VERA_REGISTRY_SHA256")
    if approved and approved.lower() != digest:
        raise refused("registry-changed", "lab/resources.json changed after VERA approved this run; nothing was contacted. Request the run again.")
    try:
        document = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise refused("registry", "lab/resources.json is not valid UTF-8 JSON.") from error
    if not isinstance(document, dict) or set(document) != {"format", "resources"} or document.get("format") != 1:
        raise refused("registry", "lab/resources.json must be {format: 1, resources: [...]}.")
    resources = document["resources"]
    if not isinstance(resources, list) or not 1 <= len(resources) <= 64:
        raise refused("registry", "lab/resources.json declares 1 to 64 resources.")
    boards: dict[str, Board] = {}
    others: dict[str, str] = {}
    for index, raw in enumerate(resources):
        where = f"resources[{index}]"
        alias = raw.get("alias") if isinstance(raw, dict) else None
        if not isinstance(alias, str) or not ALIAS.fullmatch(alias):
            raise refused("registry", f"lab/resources.json {where}.alias must match [a-z][a-z0-9-]{{0,31}}.")
        if alias in boards or alias in others:
            raise refused("registry", "lab/resources.json uses an alias twice.")
        if raw.get("kind") == "linux-board":
            boards[alias] = _board(raw, where)
        else:
            others[alias] = str(raw.get("kind"))[:32]
    return Registry(path, digest, boards, others)
