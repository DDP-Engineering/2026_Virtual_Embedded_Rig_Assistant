"""LTspice binary raw files (spec REQ-DATA-0f9e36a3 §6), as LTspice 26 writes them.

A UTF-16LE header of `Key: value` lines and a `Variables:` table ends at `Binary:`; the data follows. `real`: per point
the first variable as float64 and the others as float32, or all float64 with the flag `double`; `complex`: float64
pairs for every variable. `stepped`: the steps follow each other and the axis restarts at each step; an operating
point has no axis and one point per step. A file whose data does not fill `points x record` exactly - a run that was
stopped, or a header cut short - is `partial`; one whose header cannot be read or whose axis runs backwards is
`corrupt`."""

from __future__ import annotations

import struct
from array import array
from dataclasses import dataclass, field
from pathlib import Path

MARKER = "Binary:\n".encode("utf-16-le")
HEADER_LIMIT = 1024 * 1024
VARIABLE_LIMIT = 4096


class RawError(Exception):
    def __init__(self, kind: str, message: str) -> None:
        super().__init__(message)
        self.kind = kind  # partial | corrupt


@dataclass
class Raw:
    title: str
    plot: str
    flags: frozenset[str]
    names: list[str]
    types: list[str]
    points: int
    columns: list[array] | list[list[complex]]  # float64 arrays, or complex lists for AC
    steps: list[tuple[int, int]] = field(default_factory=list)  # [start, end) point ranges

    @property
    def has_axis(self) -> bool:
        return not self.plot.lower().startswith("operating point")

    @property
    def is_complex(self) -> bool:
        return "complex" in self.flags


def _header(text: str) -> tuple[dict[str, str], list[tuple[str, str]]]:
    fields: dict[str, str] = {}
    variables: list[tuple[str, str]] = []
    in_table = False
    for line in text.split("\n"):
        line = line.rstrip("\r")
        if in_table and line.startswith("\t"):
            parts = line.strip("\t").split("\t")
            if len(parts) < 3:
                raise RawError("corrupt", "A variable line of the raw header has no name or type.")
            variables.append((parts[1], parts[2]))
            continue
        in_table = False
        if line == "Variables:":
            in_table = True
        elif ":" in line:
            key, value = line.split(":", 1)
            fields[key.strip()] = value.strip()
    return fields, variables


def _count(fields: dict[str, str], key: str, low: int, high: int) -> int:
    value = fields.get(key)
    if value is None:
        raise RawError("corrupt", f"The raw header has no '{key}' line.")
    try:
        number = int(value)
    except ValueError as error:
        raise RawError("corrupt", f"'{key}' of the raw header is not a number.") from error
    if not low <= number <= high:
        raise RawError("corrupt", f"'{key}' of the raw header is out of range ({number}).")
    return number


def read(path: Path) -> Raw:
    data = path.read_bytes()
    at = data.find(MARKER, 0, HEADER_LIMIT)
    if at < 0 or at % 2:
        if not data or data[:12].decode("utf-16-le", errors="replace").startswith("Title:"):
            raise RawError("partial", "The raw file ends inside its header: LTspice stopped before writing data.")
        raise RawError("corrupt", "This is not a binary LTspice raw file (no UTF-16 header ending in 'Binary:').")
    try:
        text = data[:at].decode("utf-16-le")
    except UnicodeDecodeError as error:
        raise RawError("corrupt", "The raw header is not UTF-16 text.") from error
    if not text.startswith("Title:"):
        raise RawError("corrupt", "The raw header does not start with 'Title:'.")
    fields, variables = _header(text)
    flags = frozenset(fields.get("Flags", "").lower().split())
    count = _count(fields, "No. Variables", 0, VARIABLE_LIMIT)
    points = _count(fields, "No. Points", 0, 2**40)
    if len(variables) != count:
        raise RawError("corrupt", f"The raw header declares {count} variables and lists {len(variables)}.")
    if count == 0:  # LTspice saved nothing: every vector .save named is unknown to it
        return Raw(fields.get("Title", ""), fields.get("Plotname", ""), flags, [], [], points, [])
    body = memoryview(data)[at + len(MARKER):]
    if "complex" in flags:
        record = 16 * count
    elif "double" in flags:
        record = 8 * count
    else:
        record = 8 + 4 * (count - 1)
    if len(body) != points * record:
        raise RawError("partial", f"The raw file holds {len(body)} data bytes; its header declares {points} points of {record} bytes - LTspice did not finish it.")
    columns: list[array] | list[list[complex]]
    if "complex" in flags or "double" in flags:
        values = array("d")
        values.frombytes(body)
        if "complex" in flags:
            columns = [[complex(values[2 * (p * count + v)], values[2 * (p * count + v) + 1]) for p in range(points)] for v in range(count)]
        else:
            columns = [values[v::count] for v in range(count)]
    elif points:
        # A record is the float64 axis and count - 1 float32 values: both runs are copied out without per-row tuples.
        axis, values32 = array("d"), array("f")
        axis.frombytes(b"".join(body[p * record: p * record + 8] for p in range(points)))
        values32.frombytes(b"".join(body[p * record + 8: (p + 1) * record] for p in range(points)))
        columns = [axis] + [array("d", values32[v::count - 1]) for v in range(count - 1)]
    else:
        columns = [array("d") for _ in range(count)]
    raw = Raw(fields.get("Title", ""), fields.get("Plotname", ""), flags, [n for n, _ in variables], [t for _, t in variables],
              points, columns)
    raw.steps = _steps(raw)
    return raw


def _steps(raw: Raw) -> list[tuple[int, int]]:
    """Step boundaries: every point of a stepped operating point is a step; an axis that restarts below its previous
    value starts the next step. Outside a stepped file the axis may not run backwards."""
    if raw.points == 0:
        return []
    if not raw.has_axis:
        return [(p, p + 1) for p in range(raw.points)] if "stepped" in raw.flags else [(0, raw.points)]
    axis = [x.real if isinstance(x, complex) else x for x in raw.columns[0]]
    starts = [0]
    for p in range(1, raw.points):
        if axis[p] < axis[p - 1]:
            if "stepped" not in raw.flags:
                raise RawError("corrupt", f"The axis '{raw.names[0]}' runs backwards at point {p + 1} of a file that is not stepped.")
            starts.append(p)
    return [(s, e) for s, e in zip(starts, starts[1:] + [raw.points])]
