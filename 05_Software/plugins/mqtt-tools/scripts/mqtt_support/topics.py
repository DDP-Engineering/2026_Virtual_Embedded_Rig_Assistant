"""MQTT topic and filter rules of mqtt-tool (spec REQ-DATA-96d18686 sections 3-4, REQ-FUNC-3b81d7a2)."""

from __future__ import annotations

MAX_TOPIC_BYTES = 1024


def _clean(text: str) -> bool:
    return bool(text) and "\x00" not in text and len(text.encode("utf-8")) <= MAX_TOPIC_BYTES and not any(ord(c) < 0x20 or ord(c) == 0x7F for c in text)


def literal_topic(text: str) -> bool:
    """A publish or response topic: no wildcard, not a `$` system topic."""
    return _clean(text) and "+" not in text and "#" not in text and not text.startswith("$")


def valid_filter(text: str) -> bool:
    """A syntactically valid MQTT filter: `#` only as the whole last level, `+` only as a whole level."""
    if not _clean(text):
        return False
    levels = text.split("/")
    for index, level in enumerate(levels):
        if "#" in level and (level != "#" or index != len(levels) - 1):
            return False
        if "+" in level and level != "+":
            return False
    return True


def bounded_filter(text: str) -> bool:
    """A profile filter: valid, its first level a literal that does not start with `$` (no `#`, `+/#` or `$SYS`)."""
    if not valid_filter(text):
        return False
    first = text.split("/")[0]
    return first not in ("", "+", "#") and not first.startswith("$")


def covers(allowed: str, requested: str) -> bool:
    """Whether every topic `requested` can match is matched by `allowed`, level by level."""
    a, r = allowed.split("/"), requested.split("/")
    for index, level in enumerate(a):
        if level == "#":
            return True
        if index >= len(r):
            return False
        if r[index] == "#":
            return False
        if level == "+":
            continue
        if r[index] == "+" or r[index] != level:
            return False
    return len(a) == len(r)


def matches(filter_: str, topic: str) -> bool:
    """Whether a received topic matches a filter."""
    f, t = filter_.split("/"), topic.split("/")
    for index, level in enumerate(f):
        if level == "#":
            return True
        if index >= len(t):
            return False
        if level != "+" and level != t[index]:
            return False
    return len(f) == len(t)
