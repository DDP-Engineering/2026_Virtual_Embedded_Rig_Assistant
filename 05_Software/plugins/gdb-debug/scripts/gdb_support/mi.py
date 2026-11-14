"""A GDB/MI output parser (GDB manual, "GDB/MI Output Syntax"); pure functions, no process.

    output-record = [token] ("^" result-class | "*" exec | "+" status | "=" notify) ("," result)*
                  | "~" c-string | "@" c-string | "&" c-string | "(gdb)"
    result        = variable "=" value;  value = c-string | tuple | list
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

KINDS = {"^": "result", "*": "exec", "+": "status", "=": "notify", "~": "console", "@": "target", "&": "log"}
ESCAPES = {"n": 10, "t": 9, "r": 13, "a": 7, "b": 8, "f": 12, "v": 11, "e": 27, '"': 34, "\\": 92, "'": 39}


class MiSyntax(Exception):
    """A line that is not valid MI output."""


@dataclass
class Record:
    kind: str
    token: int | None = None
    cls: str = ""
    results: dict[str, Any] = field(default_factory=dict)
    text: str = ""
    line: str = ""


class _Cursor:
    def __init__(self, text: str) -> None:
        self.text, self.at = text, 0

    def peek(self) -> str:
        return self.text[self.at] if self.at < len(self.text) else ""

    def expect(self, char: str) -> None:
        if self.peek() != char:
            raise MiSyntax(f"expected {char!r} at {self.at}")
        self.at += 1


def cstring(cursor: _Cursor) -> str:
    cursor.expect('"')
    out = bytearray()
    text = cursor.text
    while True:
        if cursor.at >= len(text):
            raise MiSyntax("unterminated string")
        char = text[cursor.at]
        cursor.at += 1
        if char == '"':
            return out.decode("utf-8", "replace")
        if char != "\\":
            out += char.encode("utf-8")
            continue
        if cursor.at >= len(text):
            raise MiSyntax("unterminated escape")
        char = text[cursor.at]
        cursor.at += 1
        if char in ESCAPES:
            out.append(ESCAPES[char])
        elif char in "01234567":
            digits = char
            while len(digits) < 3 and cursor.peek() in tuple("01234567"):
                digits += text[cursor.at]
                cursor.at += 1
            out.append(int(digits, 8) & 0xFF)
        elif char == "x":
            digits = ""
            while len(digits) < 2 and cursor.peek().lower() in tuple("0123456789abcdef"):
                digits += text[cursor.at]
                cursor.at += 1
            if not digits:
                raise MiSyntax("empty hex escape")
            out.append(int(digits, 16))
        else:
            out += char.encode("utf-8")


def _name(cursor: _Cursor) -> str:
    start = cursor.at
    while cursor.peek() not in ("=", "", ",", "}", "]"):
        cursor.at += 1
    name = cursor.text[start : cursor.at]
    if not name:
        raise MiSyntax(f"empty variable name at {start}")
    return name


def value(cursor: _Cursor) -> Any:
    char = cursor.peek()
    if char == '"':
        return cstring(cursor)
    if char == "{":
        cursor.at += 1
        out: dict[str, Any] = {}
        if cursor.peek() == "}":
            cursor.at += 1
            return out
        while True:
            name = _name(cursor)
            cursor.expect("=")
            out.setdefault(name, value(cursor))
            if cursor.peek() == ",":
                cursor.at += 1
                continue
            cursor.expect("}")
            return out
    if char == "[":
        cursor.at += 1
        items: list[Any] = []
        if cursor.peek() == "]":
            cursor.at += 1
            return items
        while True:
            if cursor.peek() in ('"', "{", "["):
                items.append(value(cursor))
            else:  # a list of results: keep the values, the names repeat ("frame=...")
                _name(cursor)
                cursor.expect("=")
                items.append(value(cursor))
            if cursor.peek() == ",":
                cursor.at += 1
                continue
            cursor.expect("]")
            return items
    raise MiSyntax(f"unexpected {char!r} at {cursor.at}")


def parse(line: str) -> Record:
    """One line of GDB's MI output (without the newline)."""
    stripped = line.rstrip("\r\n")
    if stripped.strip() == "(gdb)":
        return Record("prompt", line=stripped)
    cursor = _Cursor(stripped)
    digits = ""
    while cursor.peek().isdigit():
        digits += cursor.peek()
        cursor.at += 1
    marker = cursor.peek()
    kind = KINDS.get(marker)
    if kind is None:
        raise MiSyntax(f"unknown record type {marker!r}")
    cursor.at += 1
    if kind in ("console", "target", "log"):
        if digits:
            raise MiSyntax("a stream record carries no token")
        text = cstring(cursor)
        if cursor.at != len(stripped):
            raise MiSyntax("text after a stream record")
        return Record(kind, text=text, line=stripped)
    start = cursor.at
    while cursor.peek() not in (",", ""):
        cursor.at += 1
    record = Record(kind, int(digits) if digits else None, stripped[start : cursor.at], line=stripped)
    if not record.cls:
        raise MiSyntax("missing result or async class")
    while cursor.peek() == ",":
        cursor.at += 1
        name = _name(cursor)
        cursor.expect("=")
        record.results.setdefault(name, value(cursor))
    if cursor.at != len(stripped):
        raise MiSyntax(f"unexpected text at {cursor.at}")
    return record


def quote(text: str) -> str:
    """An MI c-string argument."""
    out = ['"']
    for char in text:
        if char in '"\\':
            out.append("\\" + char)
        elif char == "\n" or ord(char) < 0x20:
            raise ValueError("control characters cannot be passed to GDB")
        else:
            out.append(char)
    out.append('"')
    return "".join(out)
