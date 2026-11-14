"""A CMake listfile tokenizer for the preflight (spec REQ-DATA-d8ecee6a section 4, REQ-SEC-8c4432cd).

Follows the CMake language grammar closely enough that no command can hide from it: a leading byte-order mark, line
comments, bracket comments `#[=*[ ... ]=*]`, quoted arguments with escapes, bracket arguments `[=*[ ... ]=*]` and
nested parentheses in unquoted arguments. Yields every command invocation with its arguments; anything the grammar
does not allow raises CMakeSyntax, which the preflight reports as a refusing finding.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

IDENT = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
BRACKET_OPEN = re.compile(r"\[(=*)\[")


class CMakeSyntax(Exception):
    """Text the tokenizer cannot read as CMake commands."""


@dataclass(frozen=True)
class Command:
    name: str
    args: tuple[str, ...]
    line: int


def _bracket(text: str, start: int) -> tuple[str, int] | None:
    """A bracket construct `[=*[ ... ]=*]` at `start`: its content and the index after it."""
    match = BRACKET_OPEN.match(text, start)
    if not match:
        return None
    close = "]" + match.group(1) + "]"
    end = text.find(close, match.end())
    if end < 0:
        raise CMakeSyntax("an unterminated bracket argument or comment")
    return text[match.end():end], end + len(close)


def _skip_comment(text: str, index: int) -> int:
    """Index after a comment starting at `index` (a '#')."""
    bracket = _bracket(text, index + 1)
    if bracket is not None:
        return bracket[1]
    end = text.find("\n", index)
    return len(text) if end < 0 else end


def commands(source: str) -> list[Command]:
    text = source[1:] if source.startswith("﻿") else source
    found: list[Command] = []
    index, length = 0, len(text)
    while index < length:
        char = text[index]
        if char in " \t\r\n":
            index += 1
            continue
        if char == "#":
            index = _skip_comment(text, index)
            continue
        match = IDENT.match(text, index)
        if not match:
            raise CMakeSyntax(f"unexpected {char!r} at line {text.count(chr(10), 0, index) + 1}")
        name, line = match.group(0), text.count("\n", 0, index) + 1
        index = match.end()
        while index < length and text[index] in " \t":
            index += 1
        if index >= length or text[index] != "(":
            raise CMakeSyntax(f"{name} at line {line} is not followed by '('")
        index += 1
        depth, args, current = 1, [], ""
        while True:
            if index >= length:
                raise CMakeSyntax(f"the arguments of {name} at line {line} are not closed")
            char = text[index]
            if char == "\\" and index + 1 < length:
                current += text[index:index + 2]
                index += 2
            elif char == '"':
                end = index + 1
                while end < length and text[end] != '"':
                    end += 2 if text[end] == "\\" else 1
                if end >= length:
                    raise CMakeSyntax(f"an unterminated quoted argument of {name} at line {line}")
                current += text[index + 1:end]
                index = end + 1
            elif char == "[" and BRACKET_OPEN.match(text, index) and not current:
                content, index = _bracket(text, index) or ("", index + 1)
                current += content
            elif char == "#":
                if current:
                    args.append(current)
                    current = ""
                index = _skip_comment(text, index)
            elif char in " \t\r\n":
                if current:
                    args.append(current)
                    current = ""
                index += 1
            elif char == "(":
                depth += 1
                current += char
                index += 1
            elif char == ")":
                depth -= 1
                if depth == 0:
                    if current:
                        args.append(current)
                    index += 1
                    break
                current += char
                index += 1
            else:
                current += char
                index += 1
        found.append(Command(name.lower(), tuple(args), line))
    return found
