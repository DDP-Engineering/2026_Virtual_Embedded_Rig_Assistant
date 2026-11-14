"""Payload schemas of mqtt-tool (spec REQ-DATA-96d18686 sections 3-4, REQ-SEC-5307cbfe).

A payload is untrusted device data: it is measured, decoded and compared with the declared shape, never executed,
followed or treated as an instruction.
"""

from __future__ import annotations

import json
from typing import Any

TYPES = ("string", "number", "integer", "boolean", "object", "array")


def _typed(value: Any, kind: str) -> bool:
    if kind == "string":
        return isinstance(value, str)
    if kind == "boolean":
        return isinstance(value, bool)
    if kind == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if kind == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if kind == "object":
        return isinstance(value, dict)
    return isinstance(value, list)


def check(schema: dict[str, Any] | None, payload: bytes) -> tuple[bool | None, str | None, Any]:
    """(valid, reason, decoded JSON object or None): valid None when no schema applies."""
    if schema is None:
        return None, None, None
    if len(payload) > schema["maxBytes"]:
        return False, f"payload of {len(payload)} bytes exceeds the schema's {schema['maxBytes']}", None
    if schema["format"] == "binary":
        return True, None, None
    try:
        text = payload.decode("utf-8")
    except UnicodeDecodeError:
        return False, "payload is not UTF-8 text", None
    if schema["format"] == "text":
        return True, None, None
    try:
        value = json.loads(text)
    except ValueError:
        return False, "payload is not JSON", None
    if not isinstance(value, dict):
        return False, "payload is not a JSON object", None
    for field, kind in schema.get("required", {}).items():
        if field not in value:
            return False, f"field {field} is missing", value
        if not _typed(value[field], kind):
            return False, f"field {field} is not {kind}", value
    sequence = schema.get("sequence")
    if sequence and not _typed(value.get(sequence), "integer"):
        return False, f"sequence field {sequence} is not an integer", value
    return True, None, value
