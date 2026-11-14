"""Capture folders: `result.json` (kind power-result, operation capture or import) and `samples.csv` (spec
REQ-DATA-dd3e4fe1 section 6). Written by capture and import, read back - hash-checked - by every analysis."""

from __future__ import annotations

import csv
import hashlib
import io
import json
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Sequence

from .errors import Refused
from .workspace import PathRefused, confined, relative

RESULT_LIMIT = 4 * 1024 * 1024
CSV_LIMIT = 128 * 1024 * 1024
FLAGS = set("miv")


def number(value: float | int | None, digits: int = 9) -> str:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return ""
    if isinstance(value, int):
        return str(value)
    return format(value, f".{digits}g")


def write_samples(path: Path, times: Iterable[float], columns: Sequence[tuple[str, Sequence[Any]]],
                  flags: Sequence[str]) -> None:
    """samples.csv: `t_s`, the columns in order, `flags`; a missing value (None, NaN or a negative code) is empty."""
    with open(path, "x", encoding="utf-8", newline="\n") as handle:
        handle.write(",".join(["t_s", *(name for name, _ in columns), "flags"]) + "\n")
        buffer: list[str] = []
        for row, t in enumerate(times):
            cells = [number(t, 12)]
            for name, values in columns:
                value = values[row]
                if name in ("range",) or name.startswith("gpi"):
                    cells.append("" if value is None or value < 0 else str(int(value)))
                else:
                    cells.append(number(value))
            cells.append(flags[row])
            buffer.append(",".join(cells))
            if len(buffer) >= 4096:
                handle.write("\n".join(buffer) + "\n")
                buffer.clear()
        if buffer:
            handle.write("\n".join(buffer) + "\n")


@dataclass
class Capture:
    folder: Path
    path: str  # relative to the working directory
    document: dict[str, Any]
    result_sha256: str
    samples_sha256: str
    t: list[float]
    current: list[float | None]
    voltage: list[float | None] | None
    power: list[float | None] | None
    ranges: list[int | None] | None
    gpi: dict[int, list[int | None]] = field(default_factory=dict)
    flags: list[str] = field(default_factory=list)

    @property
    def uniform(self) -> bool:
        return bool((self.document.get("timebase") or {}).get("uniform"))

    @property
    def rate(self) -> float | None:
        rate = (self.document.get("timebase") or {}).get("rate")
        return float(rate) if isinstance(rate, (int, float)) and rate > 0 else None

    def identity(self) -> dict[str, Any]:
        return {"path": self.path, "sha256": self.result_sha256, "samplesSha256": self.samples_sha256,
                "operation": self.document.get("operation"), "status": self.document.get("status")}


def read(cwd: Path, spelled: Path, raw: str, option: str = "--capture") -> Capture:
    try:
        folder = confined(cwd, raw, option, spelled)
    except PathRefused as error:
        raise Refused("path", str(error)) from error
    if not folder.is_dir():
        raise Refused("path", f"{option} '{raw[:120]}' is not a run folder.")
    document, result_sha = read_result(folder, option)
    if document.get("operation") not in ("capture", "import"):
        raise Refused("source", f"{option} names a {str(document.get('operation'))[:20]} run, not a capture or an import.")
    if document.get("status") not in ("pass", "incomplete"):
        raise Refused("source", f"{option} names a capture with status {str(document.get('status'))[:20]}; it holds no samples.")
    data, samples_sha = member(folder, "samples.csv", document, option, CSV_LIMIT)
    capture = parse_samples(data, folder, relative(cwd, folder), document, result_sha, samples_sha)
    return capture


def read_result(folder: Path, option: str) -> tuple[dict[str, Any], str]:
    path = folder / "result.json"
    try:
        if path.stat().st_size > RESULT_LIMIT:
            raise Refused("limit", f"{option}: result.json is larger than 4 MiB.")
        data = path.read_bytes()
    except FileNotFoundError as error:
        raise Refused("source", f"{option} holds no result.json.") from error
    except OSError as error:
        raise Refused("source", f"{option}: result.json cannot be read: {error.strerror or error}.") from error
    try:
        document = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as error:
        raise Refused("source", f"{option}: result.json is not JSON.") from error
    if not (isinstance(document, dict) and document.get("format") == 1 and document.get("kind") == "power-result"):
        raise Refused("source", f"{option}: result.json is not a format 1 power-result.")
    return document, hashlib.sha256(data).hexdigest()


def member(folder: Path, name: str, document: dict[str, Any], option: str, limit: int) -> tuple[bytes, str]:
    """An artifact of a run folder, checked against the SHA-256 its result.json records."""
    recorded = next((item.get("sha256") for item in document.get("artifacts") or []
                     if isinstance(item, dict) and item.get("path") == name), None)
    if not isinstance(recorded, str):
        raise Refused("source", f"{option}: result.json lists no SHA-256 for {name}.")
    path = folder / name
    try:
        if path.stat().st_size > limit:
            raise Refused("limit", f"{option}: {name} is larger than {limit // (1024 * 1024)} MiB.")
        data = path.read_bytes()
    except FileNotFoundError as error:
        raise Refused("source", f"{option}: {name} is missing.") from error
    except OSError as error:
        raise Refused("source", f"{option}: {name} cannot be read: {error.strerror or error}.") from error
    digest = hashlib.sha256(data).hexdigest()
    if digest != recorded:
        raise Refused("source-changed", f"{option}: {name} differs from the SHA-256 its result.json records.")
    return data, digest


def _float(cell: str, line: int, column: str) -> float | None:
    text = cell.strip()
    if not text:
        return None
    try:
        value = float(text)
    except ValueError as error:
        raise Refused("source", f"samples.csv row {line}, column {column}: '{text[:30]}' is not a number.") from error
    if not math.isfinite(value):
        raise Refused("source", f"samples.csv row {line}, column {column}: '{text[:30]}' is not finite.")
    return value


def parse_samples(data: bytes, folder: Path, path: str, document: dict[str, Any], result_sha: str,
                  samples_sha: str) -> Capture:
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as error:
        raise Refused("source", "samples.csv is not UTF-8 text.") from error
    reader = csv.reader(io.StringIO(text))
    header = next(reader, None)
    if not header or header[0] != "t_s" or header[-1] != "flags" or "current_A" not in header:
        raise Refused("source", "samples.csv does not have the header t_s,current_A,...,flags.")
    index = {name: position for position, name in enumerate(header)}
    t: list[float] = []
    columns: dict[str, list[Any]] = {name: [] for name in header[1:-1]}
    flags: list[str] = []
    previous = -math.inf
    for line, row in enumerate(reader, start=2):
        if not row:
            continue
        if len(row) != len(header):
            raise Refused("source", f"samples.csv row {line} does not hold {len(header)} cells.")
        time = _float(row[0], line, "t_s")
        if time is None or not time > previous:
            raise Refused("source", f"samples.csv row {line}: the time is missing or does not increase.")
        previous = time
        t.append(time)
        for name in columns:
            value = _float(row[index[name]], line, name)
            if name == "range" or name.startswith("gpi"):
                columns[name].append(None if value is None else int(value))
            else:
                columns[name].append(value)
        flag = row[-1].strip()
        if not set(flag) <= FLAGS:
            raise Refused("source", f"samples.csv row {line}: unknown flags '{flag[:10]}'.")
        flags.append(flag)
    if len(t) < 2:
        raise Refused("source", "samples.csv holds fewer than two samples.")
    gpi = {int(name[3:]): values for name, values in columns.items() if name.startswith("gpi") and name[3:].isdigit()}
    return Capture(folder, path, document, result_sha, samples_sha, t, columns["current_A"], columns.get("voltage_V"),
                   columns.get("power_W"), columns.get("range"), gpi, flags)
