"""Power monitors of the workbench registry `lab/resources.json` (spec REQ-DATA-dd3e4fe1 section 4).

VERA validates the whole document and reserves the meter before the helper starts; the helper reads the same file
(from $POWER_PROFILE_REGISTRY), checks it is the approved one ($VERA_REGISTRY_SHA256) and takes the power-monitor entry
it was given. Entries of other kinds belong to other plugins and are not interpreted here.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path

from .errors import Refused

LIMIT_BYTES = 256 * 1024
ALIAS = re.compile(r"[a-z][a-z0-9-]{0,31}")
RESOURCE = re.compile(r"u/(js220)/([A-Za-z0-9_-]{1,32})")


@dataclass(frozen=True)
class Meter:
    alias: str
    resource: str
    model: str
    serial: str
    profile: str


def read(alias: str) -> tuple[Meter, str]:
    """The power-monitor entry `alias` and the registry's SHA-256."""
    if not ALIAS.fullmatch(alias):
        raise Refused("request", f"--meter {alias[:40]!r} is not a registry alias.")
    location = os.environ.get("POWER_PROFILE_REGISTRY")
    if not location:
        raise Refused("request", "POWER_PROFILE_REGISTRY does not name lab/resources.json; run power-profile through VERA.")
    path = Path(location)
    try:
        data = path.read_bytes()[: LIMIT_BYTES + 1]
    except FileNotFoundError as error:
        raise Refused("request", "lab/resources.json is missing; declare the meter there first.") from error
    except OSError as error:
        raise Refused("request", f"lab/resources.json cannot be read: {error.strerror or error}.") from error
    if len(data) > LIMIT_BYTES:
        raise Refused("request", "lab/resources.json is larger than 256 KiB.")
    digest = hashlib.sha256(data).hexdigest()
    approved = os.environ.get("VERA_REGISTRY_SHA256")
    if approved and approved.lower() != digest:
        raise Refused("request", "lab/resources.json changed after the approval; ask again.")
    try:
        document = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as error:
        raise Refused("request", "lab/resources.json is not valid UTF-8 JSON.") from error
    resources = document.get("resources") if isinstance(document, dict) else None
    if not isinstance(resources, list):
        raise Refused("request", "lab/resources.json has no resources list.")
    for entry in resources:
        if isinstance(entry, dict) and entry.get("alias") == alias:
            return _meter(entry), digest
    raise Refused("request", f"The alias {alias} is not declared in lab/resources.json.")


def _meter(entry: dict[str, object]) -> Meter:
    alias = str(entry.get("alias"))
    if entry.get("kind") != "power-monitor":
        raise Refused("request", f"The alias {alias} is a {str(entry.get('kind'))[:20]} resource, not a power monitor.")
    if not set(entry) <= {"alias", "kind", "resource", "profile", "note"}:
        raise Refused("request", f"lab/resources.json entry {alias} has unknown fields.")
    resource, profile = entry.get("resource"), entry.get("profile")
    found = RESOURCE.fullmatch(resource) if isinstance(resource, str) else None
    if not found:
        raise Refused("request", f"lab/resources.json entry {alias} needs a resource u/js220/<serial>.")
    if not isinstance(profile, str):
        raise Refused("request", f"lab/resources.json entry {alias} names no profile.")
    return Meter(alias, str(resource), found.group(1), found.group(2), profile)
