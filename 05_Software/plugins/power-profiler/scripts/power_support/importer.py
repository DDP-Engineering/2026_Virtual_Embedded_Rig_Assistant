"""import: a power export file as a normalized capture folder (spec REQ-DATA-dd3e4fe1 sections 2 and 6,
REQ-FUNC-f22a86bb). The samples keep their own time axis (uniform or not); an empty cell stays a missing sample; the
meter identity is recorded as declared, never as measured."""

from __future__ import annotations

import csv
import hashlib
import io
import math
import statistics
from pathlib import Path
from typing import Any

from . import capfile
from .errors import Refused
from .workspace import PathRefused, regular_file, relative

CSV_LIMIT = 64 * 1024 * 1024
ROW_LIMIT = 1_000_000
TIME_UNITS = {"s": 1.0, "ms": 1e-3, "us": 1e-6, "ns": 1e-9}
CURRENT_UNITS = {"A": 1.0, "mA": 1e-3, "uA": 1e-6, "nA": 1e-9}
VOLTAGE_UNITS = {"V": 1.0, "mV": 1e-3}
POWER_UNITS = {"W": 1.0, "mW": 1e-3, "uW": 1e-6}
DELIMITERS = {",": ",", ";": ";", "tab": "\t"}


def _unit(value: str | None, units: dict[str, float], option: str) -> float:
    if value not in units:
        raise Refused("request", f"{option} is one of {', '.join(units)}.")
    return units[value]


def _cell(text: str, line: int, column: str, factor: float) -> float | None:
    cell = text.strip()
    if cell == "" or cell.lower() in ("nan", "-nan", "+nan"):
        return None
    try:
        value = float(cell)
    except ValueError as error:
        raise Refused("source", f"row {line}, column {column}: '{cell[:30]}' is not a number.") from error
    if not math.isfinite(value) or abs(value) > 1e30:
        raise Refused("source", f"row {line}, column {column}: '{cell[:30]}' is not a finite number.")
    return value * factor


def read(cwd: Path, spelled: Path, args: Any) -> dict[str, Any]:
    try:
        path = regular_file(cwd, args.csv, "--csv", spelled)
    except PathRefused as error:
        raise Refused("path", str(error)) from error
    if path.stat().st_size > CSV_LIMIT:
        raise Refused("limit", "--csv is larger than 64 MiB.")
    data = path.read_bytes()
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise Refused("source", "--csv is not UTF-8 text.") from error
    if args.delimiter not in DELIMITERS:
        raise Refused("request", "--delimiter is ',', ';' or tab.")
    rows: list[list[str]] = []
    for row in csv.reader(io.StringIO(text), delimiter=DELIMITERS[args.delimiter]):
        if row and any(cell.strip() for cell in row):
            rows.append(row)
            # Refused one row past the limit, before the rest of a 64 MiB file becomes a list.
            if len(rows) - 1 > ROW_LIMIT:
                raise Refused("limit", f"--csv holds more than {ROW_LIMIT} rows.")
    if len(rows) < 3:
        raise Refused("source", "--csv needs a header and at least two rows.")
    header = [cell.strip() for cell in rows[0]]

    def column(name: str | None, option: str) -> int | None:
        if name is None:
            return None
        if header.count(name) != 1:
            raise Refused("request", f"{option}: the header has {'no' if name not in header else 'more than one'} column '{name[:40]}'.")
        return header.index(name)

    if (args.time_column is None) == (args.rate is None):
        raise Refused("request", "Give either --time-column with --time-unit or --rate.")
    t_index = column(args.time_column, "--time-column")
    t_factor = _unit(args.time_unit, TIME_UNITS, "--time-unit") if t_index is not None else 1.0
    if args.rate is not None and not (math.isfinite(args.rate) and args.rate > 0):
        raise Refused("request", "--rate is a positive sample rate in Hz.")
    i_index = column(args.current_column, "--current-column")
    i_factor = _unit(args.current_unit, CURRENT_UNITS, "--current-unit")
    v_index = column(args.voltage_column, "--voltage-column")
    v_factor = _unit(args.voltage_unit, VOLTAGE_UNITS, "--voltage-unit")
    p_index = column(args.power_column, "--power-column")
    p_factor = _unit(args.power_unit, POWER_UNITS, "--power-unit") if p_index is not None else 1.0
    markers: dict[int, int] = {}
    for item in args.marker or []:
        number, sep, name = item.partition("=")
        if not sep or not number.isdigit() or not 0 <= int(number) <= 3 or int(number) in markers:
            raise Refused("request", f"--marker {item[:40]!r} is <0..3>=<column>, each input once.")
        index = column(name, "--marker")
        assert index is not None
        markers[int(number)] = index
    t: list[float] = []
    current: list[float | None] = []
    voltage: list[float | None] = []
    power: list[float | None] = []
    gpi: dict[int, list[int | None]] = {n: [] for n in sorted(markers)}
    for line, row in enumerate(rows[1:], start=2):
        if len(row) != len(header):
            raise Refused("source", f"row {line} does not hold {len(header)} cells.")
        if t_index is not None:
            time = _cell(row[t_index], line, header[t_index], t_factor)
            if time is None:
                raise Refused("source", f"row {line} has no time.")
        else:
            time = (line - 2) / args.rate
        if t and not time > t[-1]:
            raise Refused("source", f"row {line}: the time does not increase.")
        t.append(time)
        assert i_index is not None and v_index is not None
        current.append(_cell(row[i_index], line, header[i_index], i_factor))
        voltage.append(_cell(row[v_index], line, header[v_index], v_factor))
        power.append(_cell(row[p_index], line, header[p_index], p_factor) if p_index is not None else None)
        for number, index in markers.items():
            level = _cell(row[index], line, header[index], 1.0)
            if level is not None and level not in (0.0, 1.0):
                raise Refused("source", f"row {line}, column {header[index]}: a marker level is 0 or 1.")
            gpi[number].append(None if level is None else int(level))
    steps = [t[k + 1] - t[k] for k in range(len(t) - 1)]
    rate = 1.0 / statistics.median(steps)
    return {"t": t, "current": current, "voltage": voltage, "power": power if p_index is not None else None, "gpi": gpi,
            "rate": rate, "csv": {"path": relative(cwd, path), "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()},
            "columns": {"time": args.time_column, "timeUnit": args.time_unit, "rate": args.rate,
                        "current": args.current_column, "currentUnit": args.current_unit,
                        "voltage": args.voltage_column, "voltageUnit": args.voltage_unit,
                        "power": args.power_column, "powerUnit": args.power_unit if p_index is not None else None,
                        "markers": {str(n): header[i] for n, i in markers.items()}}}


def write(folder: Path, imported: dict[str, Any]) -> Path:
    n = len(imported["t"])
    columns: list[tuple[str, Any]] = [("current_A", imported["current"]), ("voltage_V", imported["voltage"])]
    if imported["power"] is not None:
        columns.append(("power_W", imported["power"]))
    columns += [(f"gpi{number}", values) for number, values in imported["gpi"].items()]
    flags = ["m" if imported["current"][k] is None or imported["voltage"][k] is None else "" for k in range(n)]
    path = folder / "samples.csv"
    capfile.write_samples(path, imported["t"], columns, flags)
    return path


def gaps(imported: dict[str, Any], uniform: bool) -> list[dict[str, Any]]:
    """Missing current samples, and on a uniform import the steps longer than 1.5 x the median step."""
    t, current = imported["t"], imported["current"]
    found: list[dict[str, Any]] = []
    k = 0
    while k < len(t):
        if current[k] is None:
            start = k
            while k < len(t) and current[k] is None:
                k += 1
            found.append({"from": start, "samples": k - start, "seconds": (t[k] if k < len(t) else t[-1]) - t[max(start - 1, 0)],
                          "cause": "empty"})
            continue
        k += 1
    if uniform:
        steps = [t[k + 1] - t[k] for k in range(len(t) - 1)]
        median = statistics.median(steps)
        for k, step in enumerate(steps):
            if step > 1.5 * median and current[k] is not None and current[k + 1] is not None:
                found.append({"from": k, "samples": 0, "seconds": step, "cause": "step"})
    return found
