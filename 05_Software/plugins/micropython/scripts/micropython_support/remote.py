"""Remote (board) paths: absolute, short, no dot segments, no backslash or control characters (REQ-SEC-d31255bc)."""

from __future__ import annotations

import re

from .report import Refused, problem

PART = ".vera-part"
STARTUP = frozenset({"boot.py", "main.py"})
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


def path(value: str, option: str) -> str:
    def refuse(reason: str) -> Refused:
        return Refused([problem("remote-path", f"{option} {reason}.")])

    if not value.startswith("/"):
        raise refuse("must be an absolute board path such as /lib/sensor.py")
    if len(value) > 255:
        raise refuse("must not exceed 255 characters")
    if "\\" in value or _CONTROL.search(value):
        raise refuse("must not hold a backslash or control characters")
    if value == "/":
        return value
    segments = value[1:].split("/")
    if len(segments) > 16:
        raise refuse("must not have more than 16 segments")
    if any(segment in ("", ".", "..") for segment in segments):
        raise refuse("must not hold empty, '.' or '..' segments")
    if value.endswith(PART):
        raise refuse(f"must not name a {PART} file, which VERA uses while it writes")
    return value


def parent(value: str) -> str:
    head = value.rsplit("/", 1)[0]
    return head or "/"


def name(value: str) -> str:
    return value.rsplit("/", 1)[1]


def startup(value: str) -> bool:
    """boot.py or main.py in any letter case: MicroPython's FAT driver matches names case-insensitively."""
    return name(value).casefold() in STARTUP
