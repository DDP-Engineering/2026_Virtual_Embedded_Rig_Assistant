"""The broker credential VERA writes on stdin (spec REQ-DATA-96d18686 section 1, REQ-SEC-7eef441d).

The line is read once, only when --credential is given, and the password stays in memory: it is never printed,
written to a file or put in an error message.
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field

from .report import refused

LINE_LIMIT = 64 * 1024


@dataclass(frozen=True)
class Credential:
    ref: str
    username: str | None
    password: str = field(repr=False)


def read(expected_ref: str) -> Credential:
    """The stdin line for `expected_ref`; credential-missing when there is none or it is not VERA's line."""
    missing = refused("credential-missing", f"No credential arrived for {expected_ref}: VERA hands it over only to an approved run of the enabled mqtt-tools plugin, from Settings > MQTT credentials or VERA_MQTT_PASSWORD_<REF> for the CLI.")
    try:
        raw = sys.stdin.buffer.readline(LINE_LIMIT + 1) if sys.stdin is not None else b""
    except (OSError, ValueError):
        raw = b""
    if not raw or len(raw) > LINE_LIMIT:
        raise missing
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        raise missing from None
    if not isinstance(value, dict) or value.get("format") != 1 or value.get("scope") != "mqtt":
        raise missing
    password, username = value.get("password"), value.get("username")
    if not isinstance(password, str) or not password or (username is not None and not isinstance(username, str)):
        raise missing
    if value.get("ref") != expected_ref:
        raise refused("credential-mismatch", f"The credential on stdin is not {expected_ref}.")
    return Credential(expected_ref, username, password)
