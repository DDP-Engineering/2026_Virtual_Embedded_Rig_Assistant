"""Importers, a registry (spec section 3): each reads its files once, hashes the bytes it parses and returns a Source.

Later plans add importers with `register`; the engine downstream never depends on where a series came from.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import math
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from . import units
from .errors import Refused
from .workspace import PathRefused, confined, regular_file, relative

RESULT_LIMIT = 4 * 1024 * 1024
CSV_LIMIT = 64 * 1024 * 1024
ROW_LIMIT = 2_000_000
CHANNEL = re.compile(r"[A-Za-z0-9_-]{1,16}")
SAMPLERATE = re.compile(r";\s*[Ss]amplerate:\s*(\d+(?:\.\d+)?)\s*([kKmMgG]?)[Hh][Zz]\s*$")
MISSING = {"", "nan", "-nan", "+nan"}
VALUE_LIMIT = 1e30  # larger magnitudes are refused: their squares must stay finite
POINT_LIMIT = 8_000_000  # samples of one source (rows x channels)


@dataclass
class Channel:
    t: list[float]
    v: list[float]
    clipped: list[bool]
    unit: str | None
    uniform: bool
    missing_after: set[int]
    mapping: dict[str, Any]


@dataclass
class Source:
    id: str
    importer: str
    path: str
    sha256: str
    files: list[dict[str, Any]]
    channels: dict[str, Channel]
    time_zero: str
    bandwidth: float | None = None  # Hz; math.inf = unlimited; None = unknown
    captured: dict[str, Any] | None = None
    identity: dict[str, Any] | None = None
    diagnostics: list[str] = field(default_factory=list)
    info: dict[str, Any] = field(default_factory=dict)
    conditions: dict[str, str] = field(default_factory=dict)  # as the request states them for this source
    probe: str | None = None
    bandwidth_text: str | None = None


@dataclass
class Context:
    cwd: Path
    spelled: Path


@dataclass(frozen=True)
class Importer:
    name: str
    fields: frozenset[str]
    description: str
    read: Callable[[str, dict[str, Any], Context], Source]


REGISTRY: dict[str, Importer] = {}


def register(name: str, fields: set[str], description: str) -> Callable[[Callable[..., Source]], Callable[..., Source]]:
    def wrap(function: Callable[..., Source]) -> Callable[..., Source]:
        REGISTRY[name] = Importer(name, frozenset(fields), description, function)
        return function

    return wrap


# ---- Files ----


def _file(ctx: Context, raw: str, field_name: str, limit: int) -> tuple[Path, bytes, dict[str, Any]]:
    try:
        path = regular_file(ctx.cwd, raw, field_name, ctx.spelled)
    except PathRefused as error:
        raise Refused("path", str(error)) from error
    size = path.stat().st_size
    if size > limit:
        raise Refused("limit", f"{field_name}: {relative(ctx.cwd, path)} has {size} bytes, more than {limit}.")
    data = path.read_bytes()
    return path, data, {"path": relative(ctx.cwd, path), "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def _folder(ctx: Context, raw: str, field_name: str) -> Path:
    try:
        path = confined(ctx.cwd, raw, field_name, ctx.spelled)
    except PathRefused as error:
        raise Refused("path", str(error)) from error
    if not path.is_dir():
        raise Refused("path", f"{field_name} '{raw[:120]}' is not a run folder.")
    return path


def _member(ctx: Context, folder: Path, name: str, field_name: str, limit: int) -> tuple[Path, bytes, dict[str, Any]]:
    return _file(ctx, str(folder / name), f"{field_name} ({name})", limit)


def _json(data: bytes, what: str) -> Any:
    try:
        return json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as error:
        raise Refused("source", f"{what} is not JSON: {error}") from error


def _check_hash(record: dict[str, Any], artifacts: dict[str, dict[str, Any]], name: str, what: str) -> None:
    expected = artifacts.get(name, {}).get("sha256")
    if expected is None:
        raise Refused("source", f"{what} lists no SHA-256 for {name}.")
    if expected != record["sha256"]:
        raise Refused("source-changed", f"{name} of {what} differs from the SHA-256 its result.json records.")


def _artifacts(document: dict[str, Any]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for item in document.get("artifacts") or []:
        if isinstance(item, dict) and isinstance(item.get("path"), str) and isinstance(item.get("sha256"), str):
            out[item["path"].replace("\\", "/").rsplit("/", 1)[-1]] = item
    return out


def _requested_hash(spec: dict[str, Any], record: dict[str, Any], what: str) -> None:
    wanted = spec.get("sha256")
    if wanted is not None and wanted.lower() != record["sha256"]:
        raise Refused("source-changed", f"{what} has SHA-256 {record['sha256'][:16]}..., not the {wanted[:16]}... the request names.")


def _cell(text: str, line: int, column: str) -> float | None:
    cell = text.strip()
    if cell.lower() in MISSING:
        return None
    try:
        value = float(cell)
    except ValueError:
        value = math.nan
    if "_" in cell or not math.isfinite(value):
        raise Refused("source", f"row {line}, column {column}: '{cell[:40]}' is not a number.")
    if abs(value) > VALUE_LIMIT:
        raise Refused("source", f"row {line}, column {column}: '{cell[:40]}' lies beyond +-{VALUE_LIMIT:g}.")
    return value


def _increasing(t: list[float], lines: list[int], what: str) -> None:
    for i in range(len(t) - 1):
        if not t[i + 1] > t[i]:
            raise Refused("source", f"{what}: the time at row {lines[i + 1]} does not increase.")


def _text(data: bytes, what: str) -> str:
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise Refused("source", f"{what} is not UTF-8 text.") from error


# ---- scpi-capture: a LAB-01 run folder (REQ-DATA-b3e2930f) ----


@register("scpi-capture", set(), "a scpi-instruments capture run folder: result.json (kind scpi-result) and waveform-<CH>.csv, hash-checked; clipping from raw-<CH>.bin and preamble-<CH>.json")
def scpi_capture(source_id: str, spec: dict[str, Any], ctx: Context) -> Source:
    field_name = f"sources.{source_id}.path"
    folder = _folder(ctx, spec["path"], field_name)
    _, data, record = _member(ctx, folder, "result.json", field_name, RESULT_LIMIT)
    _requested_hash(spec, record, "result.json")
    document = _json(data, "result.json")
    what = f"the capture folder {relative(ctx.cwd, folder)}"
    if not (isinstance(document, dict) and document.get("format") == 1 and document.get("kind") == "scpi-result"
            and isinstance(document.get("series", []), list)):
        raise Refused("source", f"{what} has no format 1 scpi-result result.json.")
    if document.get("operation") == "decode":
        origin = (document.get("inputs") or {}).get("capture") if isinstance(document.get("inputs"), dict) else None
        raise Refused("source", f"{what} is a decode run, which keeps no raw block or clip limits; import the capture folder "
                      f"{str(origin)[:120] if origin else 'it was decoded from'} instead.")
    if document.get("operation") != "capture":
        raise Refused("source", f"{what} holds a scpi {document.get('operation')!s:.20} result, not a capture.")
    if document.get("status") not in ("pass", "incomplete"):
        raise Refused("source", f"{what} has status {document.get('status')!s:.20}; only pass or incomplete captures hold series.")
    artifacts = _artifacts(document)
    files = [record]
    channels: dict[str, Channel] = {}
    for entry in document.get("series") or []:
        channel = entry.get("channel") if isinstance(entry, dict) else None
        if not isinstance(channel, str) or not CHANNEL.fullmatch(channel):
            raise Refused("source", f"{what} names a series channel that is not 1-16 letters, digits, _ or -.")
        name = f"waveform-{channel}.csv"
        if str(entry.get("file", "")).replace("\\", "/").rsplit("/", 1)[-1] != name:
            raise Refused("source", f"{what}: the series of {channel} is not {name}.")
        _, csv_data, csv_record = _member(ctx, folder, name, field_name, CSV_LIMIT)
        _check_hash(csv_record, artifacts, name, what)
        files.append(csv_record)
        rows, lines = _rows(_text(csv_data, name), ",", None)
        if not rows or [cell.strip() for cell in rows[0]] != ["time_s", "volts"]:
            raise Refused("source", f"{name} does not start with the header time_s,volts.")
        t: list[float] = []
        v: list[float] = []
        kept_lines: list[int] = []
        missing: set[int] = set()
        for row, line in zip(rows[1:], lines[1:]):
            if len(row) != 2:
                raise Refused("source", f"{name} row {line} does not hold two cells.")
            time = _cell(row[0], line, "time_s")
            value = _cell(row[1], line, "volts")
            if time is None:
                raise Refused("source", f"{name} row {line} has no time.")
            if value is None:
                if t:
                    missing.add(len(t) - 1)
                continue
            t.append(time)
            v.append(value)
            kept_lines.append(line)
        _increasing(t, kept_lines, name)
        clipped = _clipped(ctx, folder, field_name, artifacts, channel, what, files)
        if clipped is None:
            raise Refused("source", f"{what} keeps no raw-{channel}.bin and preamble-{channel}.json; clipping cannot be checked.")
        if len(clipped) != len(t):
            raise Refused("source", f"{what}: raw-{channel}.bin holds {len(clipped)} samples, the waveform {len(t)}.")
        channels[channel] = Channel(t, v, clipped, "V", True, missing, {"file": name, "unit": "V", "time": "time_s (s)"})
    if not channels:
        raise Refused("source", f"{what} holds no series.")
    instrument = document.get("instrument") or {}
    identity = instrument.get("identity") if isinstance(instrument, dict) else None
    profile = instrument.get("profile") if isinstance(instrument, dict) else None
    captured = document.get("conditions") if isinstance(document.get("conditions"), dict) else {}
    source = Source(
        id=source_id,
        importer="scpi-capture",
        path=relative(ctx.cwd, folder),
        sha256=record["sha256"],
        files=files,
        channels=channels,
        time_zero="the oscilloscope's trigger (the capture's xorigin)",
        captured=captured,
        identity={
            **({k: identity.get(k) for k in ("manufacturer", "model", "serial", "firmware")} if isinstance(identity, dict) else {}),
            **({"profile": profile.get("id"), "verification": profile.get("verification", {}).get("status") if isinstance(profile.get("verification"), dict) else None} if isinstance(profile, dict) else {}),
            "alias": instrument.get("alias") if isinstance(instrument, dict) else None,
        },
        info={"operation": document.get("operation"), "runId": document.get("runId"), "status": document.get("status")},
    )
    if document.get("status") == "incomplete":
        source.diagnostics.append("source-incomplete")
    return source


def _clipped(ctx: Context, folder: Path, field_name: str, artifacts: dict[str, dict[str, Any]], channel: str,
             what: str, files: list[dict[str, Any]]) -> list[bool] | None:
    preamble_name, raw_name = f"preamble-{channel}.json", f"raw-{channel}.bin"
    if preamble_name not in artifacts or raw_name not in artifacts:
        return None
    _, preamble_data, preamble_record = _member(ctx, folder, preamble_name, field_name, RESULT_LIMIT)
    _check_hash(preamble_record, artifacts, preamble_name, what)
    preamble = _json(preamble_data, preamble_name)
    form = preamble.get("samples") if isinstance(preamble, dict) else None
    if not isinstance(form, dict) or form.get("width") not in (1, 2, 4) or form.get("endian") not in ("little", "big"):
        raise Refused("source", f"{preamble_name} has no sample format (width 1, 2 or 4, endian little or big).")
    width = int(form["width"])
    _, raw, raw_record = _member(ctx, folder, raw_name, field_name, CSV_LIMIT)
    _check_hash(raw_record, artifacts, raw_name, what)
    files += [preamble_record, raw_record]
    if len(raw) % width:
        raise Refused("source", f"{raw_name} is not a whole number of {width}-byte samples.")
    low, high = form.get("clipLow"), form.get("clipHigh")
    signed, order = bool(form.get("signed")), form["endian"]
    codes = (int.from_bytes(raw[i : i + width], order, signed=signed) for i in range(0, len(raw), width))
    return [code == low or code == high for code in codes]


# ---- csv and sigrok-csv ----

CSV_FIELDS = {"delimiter", "comment", "header", "time", "sampleRate", "start", "columns", "uniform"}
DELIMITERS = {",": ",", ";": ";", "\t": "\t", " ": " ", "tab": "\t", "space": " "}


def _rows(text: str, delimiter: str, comment: str | None) -> tuple[list[list[str]], list[int]]:
    lines: list[str] = []
    numbers: list[int] = []
    for number, line in enumerate(text.splitlines(), start=1):
        if not line.strip() or (comment and line.lstrip().startswith(comment)):
            continue
        lines.append(line)
        numbers.append(number)
        if len(lines) > ROW_LIMIT + 1:
            raise Refused("limit", f"the file holds more than {ROW_LIMIT} rows.")
    reader = csv.reader(lines, delimiter=delimiter, skipinitialspace=delimiter == " ")
    return [row for row in reader], numbers


def _column(header: list[str] | None, ref: Any, field_name: str) -> tuple[int, str]:
    if isinstance(ref, int) and not isinstance(ref, bool):
        if ref < 1:
            raise Refused("request", f"{field_name}: a column index starts at 1.")
        return ref - 1, f"#{ref}"
    if isinstance(ref, str) and header is not None:
        names = [name.strip() for name in header]
        if names.count(ref) != 1:
            raise Refused("request", f"{field_name}: the header has {'no' if ref not in names else 'more than one'} column '{ref[:60]}'.")
        return names.index(ref), ref
    raise Refused("request", f"{field_name}: name a header column or give a 1-based index.")


def _csv(source_id: str, spec: dict[str, Any], ctx: Context, sigrok: bool) -> Source:
    prefix = f"sources.{source_id}"
    _, data, record = _file(ctx, spec["path"], f"{prefix}.path", CSV_LIMIT)
    _requested_hash(spec, record, record["path"])
    text = _text(data, record["path"])
    delimiter = DELIMITERS[spec.get("delimiter", ",")]
    comment = spec.get("comment", ";" if sigrok else None)
    rows, lines = _rows(text, delimiter, comment)
    header = None
    if spec.get("header", True):
        if not rows:
            raise Refused("source", f"{record['path']} has no header row.")
        header, rows, lines = rows[0], rows[1:], lines[1:]
    time_spec = spec.get("time")
    rate = spec.get("sampleRate")
    start = spec.get("start", 0.0)
    rate_origin = "request"
    if time_spec is None and rate is None and sigrok and comment:
        for line in text.splitlines():
            match = SAMPLERATE.match(line.strip())
            if match:
                rate = float(match.group(1)) * {"": 1.0, "k": 1e3, "K": 1e3, "M": 1e6, "G": 1e9, "g": 1e9}.get(match.group(2), 1e-3)
                rate_origin = "the file's Samplerate comment"
                break
        if rate is None:
            raise Refused("request", f"{prefix}: the file states no '; Samplerate:' and the request gives neither time nor sampleRate.")
        if not rate > 0:
            raise Refused("source", f"{prefix}: the file's Samplerate comment states no positive rate.")
    if time_spec is None and rate is None:
        raise Refused("request", f"{prefix}: give time {{column, unit}} or sampleRate.")
    if time_spec is not None:
        time_index, time_name = _column(header, time_spec["column"], f"{prefix}.time.column")
        time_factor = time_spec["factor"]
        times: list[float | None] = []
        for row, line in zip(rows, lines):
            if time_index >= len(row):
                raise Refused("source", f"row {line} has no column {time_name}.")
            value = _cell(row[time_index], line, time_name)
            if value is None:
                raise Refused("source", f"row {line} has no time.")
            times.append(value * time_factor)
        time_text = f"{time_name} ({time_spec['unit']})"
    else:
        times = [start + i / rate for i in range(len(rows))]
        time_text = f"{units.show(rate, 'Hz')} sample rate from {rate_origin}, starting at {units.show(start, 's')}"
    if len(rows) * len(spec["columns"]) > POINT_LIMIT:
        raise Refused("limit", f"{prefix}: {len(rows)} rows x {len(spec['columns'])} channels exceed {POINT_LIMIT} samples.")
    channels: dict[str, Channel] = {}
    uniform = spec.get("uniform", True)
    for name, column in spec["columns"].items():
        index, shown = _column(header, column["column"], f"{prefix}.columns.{name}.column")
        factor, base = column["factor"], column["base"]
        low, high = column.get("clipLow"), column.get("clipHigh")
        t: list[float] = []
        v: list[float] = []
        clip: list[bool] = []
        kept_lines: list[int] = []
        missing: set[int] = set()
        for row, line, time in zip(rows, lines, times):
            cell = row[index] if index < len(row) else ""
            value = _cell(cell, line, shown)
            if value is None:
                if t:
                    missing.add(len(t) - 1)
                continue
            value *= factor
            t.append(time)  # type: ignore[arg-type]
            v.append(value)
            clip.append((low is not None and value <= low) or (high is not None and value >= high))
            kept_lines.append(line)
        _increasing(t, kept_lines, record["path"])
        mapping = {"column": shown, "unit": column["unit"], "time": time_text if time_spec is None else {"column": time_text.split(" (")[0], "unit": time_spec["unit"]}}
        if low is not None or high is not None:
            mapping["clip"] = {"low": column.get("clip", {}).get("low"), "high": column.get("clip", {}).get("high")}
        channels[name] = Channel(t, v, clip, base, bool(uniform), missing, mapping)
    comments = [line for line in text.splitlines()[:50] if comment and line.lstrip().startswith(comment)][:20]
    return Source(
        id=source_id,
        importer="sigrok-csv" if sigrok else "csv",
        path=record["path"],
        sha256=record["sha256"],
        files=[record],
        channels=channels,
        time_zero="the file's own time axis" if time_spec is not None else f"the first row at {units.show(start, 's')}",
        info={"rows": len(rows), "header": [name.strip() for name in header] if header else None, "comments": comments},
    )


@register("csv", CSV_FIELDS, "a CSV file with a declared time column {column, unit} or sampleRate and declared channel columns with their units")
def csv_file(source_id: str, spec: dict[str, Any], ctx: Context) -> Source:
    return _csv(source_id, spec, ctx, sigrok=False)


@register("sigrok-csv", CSV_FIELDS, "the CSV that sigrok-cli -O csv writes: comment lines start with ';'; the sample rate comes from '; Samplerate:' unless declared")
def sigrok_csv(source_id: str, spec: dict[str, Any], ctx: Context) -> Source:
    return _csv(source_id, spec, ctx, sigrok=True)


# ---- spice: ngspice-tool and ltspice-tool run folders (REQ-DATA-29b9a988 section 6) ----


@register("spice", set(), "an ngspice-tool or ltspice-tool run folder of a transient analysis: result.json and series.csv, hash-checked; v(...) in V, i(...) in A")
def spice(source_id: str, spec: dict[str, Any], ctx: Context) -> Source:
    field_name = f"sources.{source_id}.path"
    folder = _folder(ctx, spec["path"], field_name)
    _, data, record = _member(ctx, folder, "result.json", field_name, RESULT_LIMIT)
    _requested_hash(spec, record, "result.json")
    document = _json(data, "result.json")
    what = f"the simulation folder {relative(ctx.cwd, folder)}"
    if not (isinstance(document, dict) and document.get("format") == 1 and document.get("kind") in ("ngspice-tool-result", "ltspice-tool-result")
            and isinstance(document.get("artifacts", []), list)):
        raise Refused("source", f"{what} has no format 1 ngspice-tool or ltspice-tool result.json.")
    analysis = str(document.get("analysis") or "")
    if not analysis.strip().lstrip(".").lower().startswith("tran"):
        raise Refused("domain", f"{what} holds a '{analysis[:40]}' analysis; only transient time series are compared (AC complex data and time series are not compared directly).")
    series = document.get("series")
    if not isinstance(series, dict) or series.get("file") != "series.csv":
        raise Refused("source", f"{what} has no series.csv.")
    artifacts = _artifacts(document)
    _, csv_data, csv_record = _member(ctx, folder, "series.csv", field_name, CSV_LIMIT)
    _check_hash(csv_record, artifacts, "series.csv", what)
    rows, lines = _rows(_text(csv_data, "series.csv"), ",", None)
    if not rows or len(rows[0]) < 2:
        raise Refused("source", f"series.csv of {what} has no columns.")
    columns = [name.strip() for name in rows[0]]
    if (len(rows) - 1) * (len(columns) - 1) > POINT_LIMIT:
        raise Refused("limit", f"series.csv of {what} holds more than {POINT_LIMIT} samples.")
    values = [[_cell(cell, line, columns[index] if index < len(columns) else "?") for index, cell in enumerate(row)] for row, line in zip(rows[1:], lines[1:])]
    channels: dict[str, Channel] = {}
    for index, name in enumerate(columns[1:], start=1):
        t: list[float] = []
        v: list[float] = []
        kept_lines: list[int] = []
        missing: set[int] = set()
        for row, line in zip(values, lines[1:]):
            if len(row) != len(columns) or row[0] is None:
                raise Refused("source", f"series.csv row {line} does not hold {len(columns)} numbers.")
            if row[index] is None:
                if t:
                    missing.add(len(t) - 1)
                continue
            t.append(row[0])
            v.append(row[index])  # type: ignore[arg-type]
            kept_lines.append(line)
        _increasing(t, kept_lines, "series.csv")
        lower = name.lower()
        unit = "V" if lower.startswith("v(") else "A" if lower.startswith("i(") else None
        channels[name] = Channel(t, v, [False] * len(t), unit, False, missing, {"column": name, "unit": unit or "declared by the signal", "time": f"{columns[0]} (s)"})
    return Source(
        id=source_id,
        importer="spice",
        path=relative(ctx.cwd, folder),
        sha256=record["sha256"],
        files=[record, csv_record],
        channels=channels,
        time_zero="the simulation start",
        bandwidth=math.inf,
        info={"kind": document.get("kind"), "analysis": analysis, "runId": document.get("runId"), "columns": columns},
    )


def read(source_id: str, spec: dict[str, Any], ctx: Context) -> Source:
    source = REGISTRY[spec["importer"]].read(source_id, spec, ctx)
    if "bandwidth" in spec:
        source.bandwidth = spec["bandwidth"]
    return source


# ---- inspect --path ----


def inspect_path(ctx: Context, raw: str) -> dict[str, Any]:
    """What a path holds: a capture or simulation run folder through its importer, or the first lines of a text file."""
    try:
        path = confined(ctx.cwd, raw, "--path", ctx.spelled)
    except PathRefused as error:
        raise Refused("path", str(error)) from error
    if path.is_dir():
        _, data, _ = _member(ctx, path, "result.json", "--path", RESULT_LIMIT)
        document = _json(data, "result.json")
        kind = document.get("kind") if isinstance(document, dict) else None
        if kind == "scpi-result":
            source = scpi_capture("path", {"path": raw}, ctx)
            return {"kind": "scpi-capture", "path": source.path, "sha256": source.sha256, "identity": source.identity,
                    "captured": source.captured, "channels": _describe(source), "timeZero": source.time_zero}
        if kind in ("ngspice-tool-result", "ltspice-tool-result"):
            source = spice("path", {"path": raw}, ctx)
            return {"kind": "spice", "path": source.path, "sha256": source.sha256, "resultKind": source.info["kind"],
                    "analysis": source.info["analysis"], "runId": source.info["runId"], "columns": source.info["columns"],
                    "channels": _describe(source)}
        raise Refused("source", f"--path names a folder whose result.json is of kind {str(kind)[:40]}, not a capture or simulation.")
    _, data, record = _file(ctx, raw, "--path", CSV_LIMIT)
    text = _text(data, record["path"])
    lines = text.splitlines()
    comments = [line for line in lines[:200] if line.lstrip().startswith((";", "#"))][:20]
    body = [line for line in lines if line.strip() and not line.lstrip().startswith((";", "#"))]
    first = body[0] if body else ""
    delimiter = max(("\t", ",", ";"), key=first.count) if first else ","
    header = next(csv.reader(io.StringIO(first), delimiter=delimiter)) if first else []
    return {"kind": "text", "path": record["path"], "sha256": record["sha256"], "bytes": record["bytes"],
            "comments": comments, "delimiter": {"\t": "tab"}.get(delimiter, delimiter), "header": [cell.strip() for cell in header],
            "rows": max(len(body) - 1, 0), "sample": body[1:4]}


def _describe(source: Source) -> list[dict[str, Any]]:
    out = []
    for name, channel in source.channels.items():
        out.append({"channel": name, "points": len(channel.t), "unit": channel.unit,
                    "start": channel.t[0] if channel.t else None, "end": channel.t[-1] if channel.t else None,
                    "clipped": sum(channel.clipped), "missing": len(channel.missing_after)})
    return out
