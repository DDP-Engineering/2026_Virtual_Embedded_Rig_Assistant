"""Debug probes of the workbench registry `lab/resources.json` (as in gdb-debug and zephyr; spec REQ-DATA-865c8fbd section 8).

VERA validates the whole document and reserves the probe before the helper starts; the helper reads the same file
(from $PLATFORMIO_UPLOAD_REGISTRY), checks it is the approved one ($VERA_REGISTRY_SHA256) and takes the probe entry it was
given. Entries of other kinds belong to other plugins and are not interpreted here.
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
# The serial reaches OpenOCD as `adapter serial <serial>` inside one -c argument: no space, quote or separator.
PROBE = re.compile(r"([0-9A-Fa-f]{4}):([0-9A-Fa-f]{4}):([A-Za-z0-9._-]{1,64})")


@dataclass(frozen=True)
class Probe:
    alias: str
    resource: str
    vid: str
    pid: str
    serial: str
    profile: str


def read(alias: str) -> tuple[Probe, str]:
    """The probe entry `alias` and the registry's SHA-256."""
    if not ALIAS.fullmatch(alias):
        raise Refused("request", f"--probe {alias[:40]!r} is not a registry alias.")
    location = os.environ.get("PLATFORMIO_UPLOAD_REGISTRY")
    if not location:
        raise Refused("request", "PLATFORMIO_UPLOAD_REGISTRY does not name lab/resources.json; run platformio-upload through VERA.")
    path = Path(location)
    try:
        data = path.read_bytes()[: LIMIT_BYTES + 1]
    except FileNotFoundError as error:
        raise Refused("request", "lab/resources.json is missing; declare the probe there first.") from error
    except OSError as error:
        raise Refused("request", f"lab/resources.json cannot be read: {error.strerror or error}.") from error
    if len(data) > LIMIT_BYTES:
        raise Refused("request", "lab/resources.json is larger than 256 KiB.")
    digest = hashlib.sha256(data).hexdigest()
    approved = os.environ.get("VERA_REGISTRY_SHA256")
    if approved and approved != digest:
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
            return _probe(entry), digest
    raise Refused("request", f"The alias {alias} is not declared in lab/resources.json.")


def _probe(entry: dict[str, object]) -> Probe:
    alias = str(entry.get("alias"))
    if entry.get("kind") != "probe":
        raise Refused("request", f"The alias {alias} is a {entry.get('kind')} resource, not a debug probe.")
    if not set(entry) <= {"alias", "kind", "resource", "profile", "note"}:
        raise Refused("request", f"lab/resources.json entry {alias} has unknown fields.")
    resource, profile = entry.get("resource"), entry.get("profile")
    found = PROBE.fullmatch(resource) if isinstance(resource, str) else None
    if not found:
        raise Refused("request", f"lab/resources.json entry {alias} needs a resource VID:PID:SERIAL with the probe's serial.")
    if not isinstance(profile, str):
        raise Refused("request", f"lab/resources.json entry {alias} names no profile.")
    return Probe(alias, str(resource), found.group(1).lower(), found.group(2).lower(), found.group(3), profile)
