"""A reader for KiCad's S-expression files (spec REQ-DATA-c32834e3 §4).

A file is one top-level list. Lists become Python lists; a quoted string becomes `str`; any other token becomes
`Atom` (a `str` subclass), so a caller can tell `"10"` from `10`. Errors name the 1-based line and column.

KiCad 10 reads its files in two ways (observed with 10.0.8), and so does this reader, so a path the helper checks is
the path KiCad opens. Both split tokens at space, tab, CR and LF only (schematics also at NUL); an unquoted token
starts with any other character but a quote and runs to the next split or parenthesis, quotes included.
- Schematics, boards and netlists: a line whose first character after blanks (NUL included) is `#` is a comment;
  a quoted string ends on its own line and undoes the escapes backslash, quote, a b f n r t v, `x` with one or two
  hex digits (a lone `x` stays `x`) and one to three octal digits; a backslash before anything else stays.
- Library tables (`raw`): no comments and no escapes; a string runs to the next quote, line breaks included.
Where the two programs might disagree, the reader refuses instead of guessing: a control or Unicode space character
outside a quoted string (KiCad's handling of `\\v`, NBSP and the like differs between its readers), and an escape
of a byte above 0x7F (KiCad decodes such bytes as UTF-8, and never writes them escaped).
"""

from __future__ import annotations

import math
import re
import unicodedata
from typing import Any

MAX_DEPTH = 256
_TOKEN = re.compile(r'([ \t\r\n\x00]+)|(\()|(\))|("(?:[^"\\\n]|\\[^\n])*")|([^ \t\r\n\x00()"][^ \t\r\n\x00()]*)|(")')
_RAW_TOKEN = re.compile(r'([ \t\r\n]+)|(\()|(\))|("[^"]*")|([^ \t\r\n()"][^ \t\r\n()]*)|(")')
_COMMENT = re.compile(r"^[ \t\r\x00]*#[^\n]*", re.M)
_ESCAPE = re.compile(r"\\(?:x([0-9A-Fa-f]{1,2})|([0-7]{1,3})|(.))", re.S)
_ESCAPES = {'"': '"', "\\": "\\", "a": "\a", "b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t", "v": "\v", "x": "x"}
_UNUSUAL = frozenset({"Cc", "Zs", "Zl", "Zp"})


class _HighByte(Exception):
    """An escape of a byte above 0x7F."""


def _unescape(escape: re.Match[str]) -> str:
    hexadecimal, octal, other = escape.groups()
    if hexadecimal is not None or octal is not None:
        byte = int(hexadecimal, 16) if hexadecimal is not None else int(octal, 8) & 0xFF
        if byte > 0x7F:
            raise _HighByte
        return chr(byte)
    return _ESCAPES.get(other, "\\" + other)


class Atom(str):
    """An unquoted token: a keyword, a number or a symbol name."""


class SexprError(Exception):
    """Text that is not one well-formed S-expression; `message` already names the position."""


def _position(text: str, offset: int) -> str:
    line = text.count("\n", 0, offset) + 1
    column = offset - (text.rfind("\n", 0, offset) + 1) + 1
    return f"line {line}, column {column}"


def parse(text: str, raw: bool = False) -> list[Any]:
    """The top-level list of `text`; `raw` reads it as KiCad reads a library table."""
    if not raw:
        text = _COMMENT.sub(lambda comment: " " * len(comment.group(0)), text)  # Keeps every line and column.
    stack: list[tuple[list[Any], int]] = []
    top: list[Any] | None = None
    for match in (_RAW_TOKEN if raw else _TOKEN).finditer(text):
        kind = match.lastindex
        offset = match.start()
        if kind == 1:
            continue
        if top is not None:
            raise SexprError(f"unexpected text after the end of the top-level list at {_position(text, offset)}")
        if kind == 2:
            if len(stack) >= MAX_DEPTH:
                raise SexprError(f"lists nest deeper than {MAX_DEPTH} levels at {_position(text, offset)}")
            stack.append(([], offset))
        elif kind == 3:
            if not stack:
                raise SexprError(f"unexpected ')' at {_position(text, offset)}")
            done, _ = stack.pop()
            if stack:
                stack[-1][0].append(done)
            else:
                top = done
        elif kind == 4:
            try:
                value = match.group(4)[1:-1] if raw else _ESCAPE.sub(_unescape, match.group(4)[1:-1])
            except _HighByte:
                raise SexprError(f"a quoted string escapes a byte above 0x7F at {_position(text, offset)}") from None
            if not stack:
                raise SexprError(f"text outside any list at {_position(text, offset)}")
            stack[-1][0].append(value)
        elif kind == 5:
            if not stack:
                raise SexprError(f"text outside any list at {_position(text, offset)}")
            token = match.group(5)
            for index, character in enumerate(token):
                if unicodedata.category(character) in _UNUSUAL:
                    raise SexprError(
                        f"the character U+{ord(character):04X} outside a quoted string at "
                        f"{_position(text, offset + index)}; KiCad's readers may split there differently"
                    )
            stack[-1][0].append(Atom(token))
        else:
            ending = "never ends" if raw else "never ends on its line"
            raise SexprError(f"a quoted string that {ending} at {_position(text, offset)}")
    if stack:
        raise SexprError(f"a list opened at {_position(text, stack[-1][1])} is never closed")
    if top is None:
        raise SexprError("the file holds no list")
    return top


def head(node: Any) -> str | None:
    return node[0] if isinstance(node, list) and node and isinstance(node[0], Atom) else None


def children(node: list[Any], name: str) -> list[list[Any]]:
    return [child for child in node[1:] if head(child) == name]


def child(node: list[Any], name: str) -> list[Any] | None:
    for item in node[1:]:
        if head(item) == name:
            return item
    return None


def value(node: list[Any] | None, name: str, default: Any = None) -> Any:
    """The first value of the child list `name`, e.g. `value(sym, "lib_id")`."""
    found = child(node, name) if node is not None else None
    return found[1] if found is not None and len(found) > 1 else default


def number(token: Any, default: float | None = None) -> float | None:
    """A finite number token; anything else gives `default`."""
    try:
        found = float(token)
    except (TypeError, ValueError):
        return default
    return found if math.isfinite(found) else default


def integer(token: Any, default: int = 0) -> int:
    """An integer token; anything else (also `inf` or a huge exponent) gives `default`."""
    try:
        return int(float(token))
    except (TypeError, ValueError, OverflowError):
        return default


def prop(node: list[Any], name: str) -> str | None:
    """The value of `(property "name" "value" ...)`."""
    for item in children(node, "property"):
        if len(item) > 2 and item[1] == name:
            return str(item[2])
    return None
