"""Command line of parts-compare (spec REQ-DATA-6b26f2a5 §1): one operation, `compare`."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import secrets
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import TOOL, VERSION, workspace
from .evaluate import compare
from .report import LIMITS, OutputFailure, header, write
from .request import Problem, Refused, load_json, read

INPUT_LIMIT = 1024 * 1024
OUTPUT_LIMIT = 11000
DEFAULT_RESULTS = "electronics-results"
DESCRIPTION = __doc__ or ""
FIELDS = """
request: {"title", "quantity" 1..1e9, "currency"? (EUR), "constraints": [1..64 {"id", "parameter", "op" (<=, >=,
  ==, in), "value" (quantity, text or list of texts), "conditions"? {name: {"op", "value"}}}], "preferences"?:
  [{"parameter", "goal": min|max} | {"criterion": price|stock}], "replaces"? {"manufacturer", "mpn", "pinout",
  "footprint"}, "candidates": [1..64 {"manufacturer", "mpn", "package"?, "datasheet"? {"url", "revision"?},
  "pinout"? / "footprint"? {"value", "page"}, "parameters"? [{"name", "value", "basis" (min|typ|max|nominal|rating),
  "conditions"? {name: quantity}, "source" ({"kind": "datasheet", "page"?, "table"?, "figure"?} or {"kind":
  "supplier", "supplier", "sku"?}), "status" (confirmed|proposed)}], "offers"? [{"supplier", "sku",
  "retrievedAt", "priceBreaks": [{"quantity", "unitPrice"}], "packaging"?, "stock"?, "moq"?, "multiple"?,
  "currency"?, "region"?, "url"?}]}]}
quantity: "40 mΩ", "3.3 V", "10 V/µs" or {"value": 40, "unit": "mΩ"}; prefixes p n u µ m k M G.
Only confirmed datasheet values with a page or table, under the constraint's conditions, are evidence.
"""


class _Once(argparse.Action):
    def __call__(self, parser, namespace, values, option_string=None):  # type: ignore[no-untyped-def]
        if getattr(namespace, f"_seen_{self.dest}", False):
            parser.error(f"{option_string} was given more than once")
        setattr(namespace, f"_seen_{self.dest}", True)
        setattr(namespace, self.dest, values)


def _run_id(value: str) -> str:
    if not workspace.valid_run_id(value):
        raise argparse.ArgumentTypeError(
            "use 1..64 letters, digits, '.', '_' or '-', starting and ending with a letter or digit; device names such as NUL are not accepted"
        )
    return value


def _parser() -> argparse.ArgumentParser:
    formatter = argparse.RawDescriptionHelpFormatter
    parser = argparse.ArgumentParser(prog=TOOL, description="Evidence-based component comparison, offline.", allow_abbrev=False, formatter_class=formatter)
    parser.add_argument("--version", action="version", version=f"{TOOL} {VERSION}")
    commands = parser.add_subparsers(dest="operation", metavar="operation", required=True)
    text = "compare candidates against hard constraints, then preferences; write comparison.json, comparison.md and bom.csv"
    command = commands.add_parser("compare", help=text, description=text, epilog=FIELDS, allow_abbrev=False, formatter_class=formatter)
    source = command.add_mutually_exclusive_group(required=True)
    source.add_argument("--json", action=_Once, metavar="TEXT", help="the request as one JSON object")
    source.add_argument("--input", action=_Once, metavar="FILE", help="a UTF-8 JSON request file inside the working directory")
    command.add_argument("--run-id", action=_Once, type=_run_id, metavar="ID", help="identifier of this run (default: UTC time and random hex)")
    command.add_argument(
        "--results-dir", action=_Once, default=DEFAULT_RESULTS, metavar="DIR",
        help=f"folder for run folders, inside the working directory (default: {DEFAULT_RESULTS})",
    )
    return parser


def _stamp(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


def _emit(document: dict[str, Any]) -> None:
    """One field per line; lists are shortened from the end until the text fits the runner's window."""
    def render(value: dict[str, Any]) -> str:
        return "{\n" + ",\n".join(f"  {json.dumps(key)}: {json.dumps(item, ensure_ascii=False)}" for key, item in value.items()) + "\n}\n"

    text = render(document)
    for key in ("warnings", "errors", "devices"):
        items = document.get(key)
        while isinstance(items, list) and items and len(text.encode("utf-16-le")) // 2 > OUTPUT_LIMIT:
            dropped = document.setdefault("omitted", {})
            dropped[key] = dropped.get(key, 0) + 1
            items.pop()
            text = render(document)
    sys.stdout.write(text)
    sys.stdout.flush()


def _read_input(cwd: Path, raw: str, spelled: Path) -> tuple[bytes, str]:
    try:
        resolved = workspace.regular_file(cwd, raw, "--input", spelled)
        if resolved.stat().st_size > INPUT_LIMIT:
            raise Refused([Problem("path", "", f"--input '{raw[:120]}' is larger than {INPUT_LIMIT} bytes.")])
        return resolved.read_bytes(), workspace.relative(cwd, resolved)
    except workspace.PathRefused as error:
        raise Refused([Problem("path", "", str(error))]) from error
    except OSError as error:
        raise Refused([Problem("path", "", f"--input '{raw[:120]}' cannot be read: {error.strerror or error}.")]) from error


def main(argv: list[str]) -> int:
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8", errors="backslashreplace", newline="\n")  # type: ignore[union-attr]
    args = _parser().parse_args(argv)
    started = datetime.now(timezone.utc)
    run_id: str = args.run_id or f"{started.strftime('%Y%m%dT%H%M%SZ')}-{secrets.token_hex(4)}"
    spelled = workspace.entered_directory()
    cwd = Path(os.path.realpath(spelled))
    request: dict[str, Any] | None = None
    try:
        try:
            results_dir = workspace.results_directory(cwd, args.results_dir, spelled)
        except workspace.PathRefused as error:
            raise Refused([Problem("path", "", str(error))]) from error
        if args.input is not None:
            data, relative = _read_input(cwd, args.input, spelled)
            request = {"origin": "file", "path": relative, "sha256": hashlib.sha256(data).hexdigest()}
        else:
            data = os.fsencode(args.json)
            request = {"origin": "inline", "sha256": hashlib.sha256(data).hexdigest()}
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError as error:
            raise Refused([Problem("json", "", "The request is not UTF-8 text.")]) from error
        parsed = read(load_json(text.removeprefix("﻿")), started)
        outcome = compare(parsed, started)
        if (results_dir / run_id).exists():
            raise Refused([Problem("output", "", f"The run folder '{workspace.relative(cwd, results_dir / run_id)}' already exists; runs are never overwritten. Use another --run-id.")])
        digest = request["sha256"]

        def unchanged() -> bool:
            if args.input is None:
                return True
            try:
                return hashlib.sha256(_read_input(cwd, args.input, spelled)[0]).hexdigest() == digest
            except Refused:
                return False

        document = {
            "format": 1,
            "kind": "parts-comparison",
            "tool": {"name": TOOL, "version": VERSION},
            "runId": run_id,
            "startedAt": _stamp(started),
            "finishedAt": _stamp(datetime.now(timezone.utc)),
            "request": request,
            "title": parsed.title,
            "quantity": parsed.quantity,
            "currency": outcome["currency"],
            "constraints": [{"id": c.id, "parameter": c.parameter, "op": c.op} for c in parsed.constraints],
            "preferences": parsed.preferences,
            "devices": outcome["devices"],
            "proposed": None if outcome["proposed"] is None else outcome["devices"].index(outcome["proposed"]),
            "warnings": outcome["warnings"],
            "limits": LIMITS,
        }
        try:
            artifacts = write(document, cwd=cwd, results_dir=results_dir, unchanged=unchanged)
        except FileExistsError as error:
            raise Refused([Problem("output", "", f"The run folder '{workspace.relative(cwd, results_dir / run_id)}' already exists; runs are never overwritten. Use another --run-id.")]) from error
        summary = header(run_id, _stamp(started), "ok", request)
        summary.update(
            {
                "artifacts": artifacts,
                "devices": [{"mpn": row["mpn"], "outcome": row["outcome"], "rank": row["rank"]} for row in outcome["devices"]],
                "proposed": None if outcome["proposed"] is None else outcome["proposed"]["mpn"],
                "warnings": outcome["warnings"],
            }
        )
        _emit(summary)
        return 0
    except Refused as error:
        _emit({**header(run_id, _stamp(started), "error", request), "errors": [problem.json() for problem in error.problems]})
        return 2
    except OutputFailure as error:
        _emit({**header(run_id, _stamp(started), "error", request), "errors": [Problem("output", "", str(error)).json()]})
        return 3
