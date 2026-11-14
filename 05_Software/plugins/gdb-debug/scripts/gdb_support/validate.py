"""The syntax gdb-debug accepts for values that reach GDB (spec REQ-DATA-d7da2a71 section 2, REQ-SEC-a7bab79f).

Only a whitelist passes: a variable path of identifiers, `.member` and constant `[index]`; a location that is a
function name, `file:line` or a flash `*0x...` address. No operator, call, assignment, dereference, convenience
variable, register or debugger command can be written in it, so no value a request carries can make GDB run code,
change memory or execute a command.
"""

from __future__ import annotations

import re

from .errors import Refused

IDENT = r"[A-Za-z_][A-Za-z0-9_]{0,63}"
VARIABLE = re.compile(rf"{IDENT}(?:\.{IDENT}|\[[0-9]{{1,6}}\])*")
FUNCTION = re.compile(rf"{IDENT}(?:::{IDENT}){{0,4}}")
FILE_LINE = re.compile(r"([A-Za-z0-9_][A-Za-z0-9_.-]{0,63}\.[A-Za-z0-9]{1,8}):([1-9][0-9]{0,5})")
ADDRESS = re.compile(r"\*0x([0-9A-Fa-f]{1,8})")


def variable(text: str) -> str:
    if len(text) > 128 or not VARIABLE.fullmatch(text):
        raise Refused(
            "request",
            f"--read {text[:60]!r} is not a variable path (identifiers, .member and [index] only; no operators, calls, "
            "assignments, dereferences, registers or $ variables).",
        )
    return text


def location(text: str, flash: list[tuple[int, int]]) -> str:
    """A breakpoint location: function, file:line, or a flash address."""
    if FUNCTION.fullmatch(text) or FILE_LINE.fullmatch(text):
        return text
    found = ADDRESS.fullmatch(text)
    if found:
        address = int(found.group(1), 16)
        if any(start <= address < start + size for start, size in flash):
            return f"*0x{address:08x}"
        raise Refused("request", f"--at {text!r} lies outside the profile's flash regions.")
    raise Refused(
        "request",
        f"--at {text[:60]!r} is not a function name, file:line or *0x<flash address>.",
    )
