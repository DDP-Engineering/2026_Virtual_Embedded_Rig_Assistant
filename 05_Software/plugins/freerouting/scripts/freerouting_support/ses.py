"""Specctra DSN/SES text (spec REQ-FUNC-2a80da7f §4): protect existing wiring, read the routes Freerouting added."""

from __future__ import annotations

import re
from typing import Any

MAX_POINTS = 64  # kicad-layout's points per track operation
_TOKEN = re.compile(r'\s*(?:(\()|(\))|"((?:[^"]|"")*)"|([^\s()"]+))')
_VIA = re.compile(r"_(\d+):(\d+)_um$")


class SesError(ValueError):
    """The SES is not what Freerouting writes."""


def parse(text: str) -> list[Any]:
    """S-expressions with `"` as string quote (KiCad's DSN header and Freerouting's SES both use it)."""
    stack: list[list[Any]] = [[]]
    position = 0
    while position < len(text):
        match = _TOKEN.match(text, position)
        if not match:
            if text[position:].strip():
                raise SesError(f"unexpected text at offset {position}")
            break
        position = match.end()
        if match.group(1):
            stack.append([])
        elif match.group(2):
            if len(stack) < 2:
                raise SesError("unbalanced ')'")
            done = stack.pop()
            stack[-1].append(done)
        elif match.group(3) is not None:
            stack[-1].append(match.group(3))
        elif match.group(4):
            stack[-1].append(match.group(4))
    if len(stack) != 1 or len(stack[0]) != 1 or not isinstance(stack[0][0], list):
        raise SesError("not one complete S-expression")
    return stack[0][0]


def protect_wiring(dsn: str) -> tuple[str, int]:
    """Every existing wire and via of the DSN's wiring section becomes `(type protect)`: Freerouting keeps it."""
    start = dsn.find("(wiring")
    if start < 0:
        return dsn, 0
    head, wiring = dsn[:start], dsn[start:]
    wiring, count = re.subn(r"\(type (?:route|normal)\)", "(type protect)", wiring)
    return head + wiring, count


def _child(node: list[Any], name: str) -> list[Any] | None:
    return next((c for c in node if isinstance(c, list) and c and c[0] == name), None)


def _kept(node: list[Any]) -> bool:
    kind = _child(node, "type")
    return kind is not None and len(kind) > 1 and kind[1] in ("protect", "fix")


def routes(ses_text: str, nets: set[str] | None) -> tuple[list[dict[str, Any]], list[str]]:
    """kicad-layout track and via operations (mm, KiCad's Y axis) for the wires and vias Freerouting added."""
    try:
        session = parse(ses_text)
        if session[0] != "session":
            raise SesError("the file is not a Specctra session")
        routes_node = _child(session, "routes")
        if routes_node is None:
            raise SesError("the session has no routes")
        resolution = _child(routes_node, "resolution")
        if not resolution or resolution[1] != "um":
            raise SesError("the session's resolution is not in um")
        per_mm = 1000.0 * float(resolution[2])
        network = _child(routes_node, "network_out") or ["network_out"]
        operations: list[dict[str, Any]] = []
        routed: list[str] = []
        for net in (c for c in network[1:] if isinstance(c, list) and c and c[0] == "net"):
            name = str(net[1])
            if nets is not None and name not in nets:
                continue
            added = 0
            for item in net[2:]:
                if not isinstance(item, list) or _kept(item):
                    continue
                if item[0] == "wire":
                    path = _child(item, "path")
                    if path is None:
                        continue
                    layer, width = str(path[1]), float(path[2]) / per_mm
                    numbers = [float(v) for v in path[3:]]
                    points = [[round(numbers[i] / per_mm, 6), round(-numbers[i + 1] / per_mm, 6)] for i in range(0, len(numbers) - 1, 2)]
                    # A long path becomes several tracks that share their end points.
                    for first in range(0, max(len(points) - 1, 1), MAX_POINTS - 1):
                        chunk = points[first:first + MAX_POINTS]
                        if len(chunk) >= 2:
                            operations.append({"op": "track", "net": name, "layer": layer, "width": round(width, 6), "points": chunk})
                            added += 1
                elif item[0] == "via":
                    found = _VIA.search(str(item[1]))
                    if not found:
                        raise SesError(f"via padstack {item[1]!r} does not name its diameter and drill")
                    x, y = float(item[2]) / per_mm, -float(item[3]) / per_mm
                    operations.append({"op": "via", "net": name, "at": [round(x, 6), round(y, 6)],
                                       "diameter": int(found.group(1)) / 1000.0, "drill": int(found.group(2)) / 1000.0})
                    added += 1
            if added:
                routed.append(name)
        return operations, routed
    except (IndexError, TypeError, ValueError) as error:
        raise SesError(str(error)[:200]) from error
