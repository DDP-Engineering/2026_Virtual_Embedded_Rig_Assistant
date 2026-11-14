"""The Wokwi token VERA writes on stdin (spec REQ-DATA-96d18686 section 1, REQ-SEC-fa87b102).

The line is read once, only by run-scenario after the job checks, and the token stays in memory: it is never printed,
written to a file or put in an error message; wokwi-tool gives it only to the wokwi-cli child it starts.
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field

from .report import refused

LINE_LIMIT = 64 * 1024


@dataclass(frozen=True)
class Token:
    ref: str
    value: str = field(repr=False)


def read(expected_ref: str) -> Token:
    """The stdin line for `expected_ref`; credential-missing when there is none or it is not VERA's wokwi line."""
    missing = refused("credential-missing", f"No Wokwi token arrived for {expected_ref}: VERA hands it over only to an approved run of the enabled wokwi plugin, from Settings > Wokwi tokens or VERA_WOKWI_TOKEN_<REF> for the CLI.")
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
    if not isinstance(value, dict) or value.get("format") != 1 or value.get("scope") != "wokwi":
        raise missing
    token = value.get("password")
    if not isinstance(token, str) or not token or any(ord(character) < 32 or ord(character) == 127 for character in token):
        raise missing
    if value.get("ref") != expected_ref:
        raise refused("credential-mismatch", f"The token on stdin is not {expected_ref}.")
    return Token(expected_ref, token)
