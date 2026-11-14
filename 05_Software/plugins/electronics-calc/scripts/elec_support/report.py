"""Operation `report` and the path guards (spec REQ-DATA-3d15fdfc §1 and §8).

A report is all or nothing: every calculation is validated and computed before anything is written, the run
folder and its files are created exclusively, and whatever a failed run created is removed again.

Every command of the program runs without approval, so a path is judged from its text first: network, device
and other-drive paths are refused before the file system is asked anything about them.
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

from . import FORMAT, TOOL, VERSION, workspace
from .contract import CalcError, Problem, Reader, Result, refuse, result_document, stamp
from .workspace import DEVICES, PATH_TEXT_LIMIT, RUN_ID, is_device, valid_run_id  # noqa: F401 - the program's API

INPUT_LIMIT = 1024 * 1024
MAX_CALCULATIONS = 32
MAX_NOTES = 16
MAX_REPORT_SAMPLES = 1_000_000
DEFAULT_RESULTS = "electronics-results"
CALCULATION_ID = re.compile(r"[a-z0-9][a-z0-9-]{0,63}")
# The path rules live in workspace.py, shared with the kicad plugin; these names keep their callers unchanged.
_relative = workspace.relative
_allowed_output = workspace.allowed_output


class OutputFailure(Exception):
    """An input or output failure after the request was accepted (exit code 3)."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.problem = Problem("output", "", message)


def _confined(cwd: Path, raw: str, option: str, spelled: Path | None = None) -> Path:
    """workspace.confined with its refusal as this program's `path` problem."""
    try:
        return workspace.confined(cwd, raw, option, spelled)
    except workspace.PathRefused as error:
        raise refuse("path", "", str(error)) from error


def read_input(cwd: Path, raw: str, spelled: Path | None = None) -> tuple[bytes, str]:
    """The bytes of an `--input` file inside the working directory and its path relative to it."""
    try:
        resolved = workspace.regular_file(cwd, raw, "--input", spelled)
    except workspace.PathRefused as error:
        raise refuse("path", "", str(error)) from error
    shown = raw[:120]
    try:
        if resolved.stat().st_size > INPUT_LIMIT:
            raise refuse("path", "", f"--input '{shown}' is larger than {INPUT_LIMIT} bytes.")
        data = resolved.read_bytes()
    except OSError as error:
        raise refuse("path", "", f"--input '{shown}' cannot be read: {error.strerror or error}.") from error
    return data, _relative(cwd, resolved)


def results_directory(cwd: Path, raw: str, spelled: Path | None = None) -> Path:
    """Where reports go: inside the working directory, never inside `.vera`, never below or over a file."""
    try:
        return workspace.results_directory(cwd, raw, spelled)
    except workspace.PathRefused as error:
        raise refuse("path", "", str(error)) from error


def _escape(text: object) -> str:
    return str(text).replace("\\", "\\\\").replace("|", "\\|").replace("\r", " ").replace("\n", " ")


def _table(head: list[str], rows: list[list[object]]) -> list[str]:
    lines = ["| " + " | ".join(head) + " |", "|" + " --- |" * len(head)]
    lines += ["| " + " | ".join(_escape(cell) for cell in row) + " |" for row in rows]
    return lines


def _bullets(title: str, items: list[str], code: bool = False) -> list[str]:
    if not items:
        return []
    return [f"### {title}", "", *[f"- `{item}`" if code else f"- {item}" for item in items], ""]


def markdown(report: dict[str, Any]) -> str:
    """The readable form of a report: per calculation its inputs, formulas, assumptions, results, checks and limits."""
    request = report["request"]
    origin = f"file `{request['path']}`" if request["origin"] == "file" else "inline request"
    lines = [
        f"# {report['title']}",
        "",
        f"- Tool: {report['tool']['name']} {report['tool']['version']} (result format {report['format']})",
        f"- Run: `{report['runId']}`",
        f"- Started: {report['startedAt']}; finished: {report['finishedAt']}",
        f"- Request: {origin}, SHA-256 `{request['sha256']}`",
        "",
    ]
    if report["notes"]:
        lines += ["## Notes", "", *[f"- {note}" for note in report["notes"]], ""]
    for entry in report["calculations"]:
        result = entry["result"]
        model = f" / {result['model']}" if "model" in result else ""
        lines += [f"## {entry['id']}", "", f"Operation: `{result['operation']}{model}`", ""]
        if "note" in entry:
            lines += [entry["note"], ""]
        if result["inputs"]:
            rows = [
                [
                    item["name"],
                    item["given"],
                    f"{item['value']!r} {item['unit']}",
                    item.get("source", ""),
                    item.get("conditions", ""),
                    item.get("note", ""),
                ]
                for item in result["inputs"]
            ]
            lines += ["### Inputs", "", *_table(["Input", "Given", "Value", "Source", "Conditions", "Note"], rows), ""]
        lines += _bullets("Formulas", result["formulas"], code=True)
        lines += _bullets("Assumptions", result["assumptions"])
        if result["results"]:
            rows = [
                [name, item["text"], f"{item['value']!r} {item['unit']}"] for name, item in result["results"].items()
            ]
            lines += ["### Results", "", *_table(["Result", "Value", "Exact"], rows), ""]
        if result["checks"]:
            rows = [[item["id"], item["status"], item["detail"]] for item in result["checks"]]
            lines += ["### Checks", "", *_table(["Check", "Status", "Detail"], rows), ""]
        lines += _bullets("Warnings", result["warnings"])
        lines += _bullets("Limits", result["limits"])
    return "\n".join(lines).rstrip("\n") + "\n"


def run(
    document: dict[str, Any],
    *,
    cwd: Path,
    results_dir: Path,
    run_id: str,
    started: datetime,
    request: dict[str, Any],
    operations: tuple[str, ...],
    evaluate: Callable[[str, dict[str, Any]], Result],
    unchanged: Callable[[], bool],
    finished: Callable[[], datetime],
) -> dict[str, Any]:
    """Computes every calculation, writes report.json and report.md, and returns the summary fields."""
    reader = Reader(document)
    title = reader.text("title")
    notes_raw = reader.array("notes", low=0, high=MAX_NOTES, required=False) or []
    notes = [reader.text("notes", value=note, path=reader.at(f"notes.{index}")) for index, note in enumerate(notes_raw)]
    entries = reader.objects("calculations", low=1, high=MAX_CALCULATIONS) or []
    planned: list[tuple[int, str, str, dict[str, Any], str | None]] = []
    seen: set[str] = set()
    for index, entry in enumerate(entries):
        identifier = entry.text("id")
        operation = entry.choice("operation", operations)
        body = entry.raw("input")
        note = entry.text("note", required=False)
        if not isinstance(body, dict):
            entry.fail("schema", "input", "This field is required: the JSON object of the calculation's request.")
        if identifier is not None:
            if not CALCULATION_ID.fullmatch(identifier):
                entry.fail(
                    "schema",
                    "id",
                    "Use lower-case letters, digits and hyphens, starting with a letter or digit (at most 64).",
                )
            elif identifier in seen:
                entry.fail("schema", "id", "This id is used twice.")
            seen.add(identifier)
        if identifier is not None and operation is not None and isinstance(body, dict):
            planned.append((index, identifier, operation, body, note))
    # A report must finish inside its rule timeout: the Monte Carlo work of all calculations is bounded.
    samples = 0
    for _, _, operation, body, _ in planned:
        section = body.get("monteCarlo") if operation == "tolerance" else None
        count = section.get("samples") if isinstance(section, dict) else None
        if isinstance(count, int) and not isinstance(count, bool):
            samples += max(count, 0)
    if samples > MAX_REPORT_SAMPLES:
        reader.fail(
            "limit",
            "calculations",
            f"The calculations ask for {samples} Monte Carlo samples; one report runs at most {MAX_REPORT_SAMPLES}.",
        )
    reader.done()
    assert title is not None

    problems: list[Problem] = []
    computed: list[tuple[str, str | None, Result, datetime]] = []
    for index, identifier, operation, body, note in planned:
        begun = finished()
        try:
            computed.append((identifier, note, evaluate(operation, body), begun))
        except CalcError as error:
            problems += [problem.under(f"calculations.{index}.input") for problem in error.problems]
    if problems:
        raise CalcError(problems)

    run_dir = results_dir / run_id
    exists = refuse(
        "output",
        "",
        f"The run folder '{_relative(cwd, run_dir)}' already exists; reports are never overwritten. Use another --run-id.",
    )
    try:
        if run_dir.exists():
            raise exists
    except OSError as error:
        raise refuse("path", "", f"The run folder cannot be used: {error.strerror or error}.") from error
    calculations = []
    for identifier, note, result, begun in computed:
        entry_json: dict[str, Any] = {"id": identifier}
        if note is not None:
            entry_json["note"] = note
        entry_json["result"] = result_document(result, run_id, begun, request)
        calculations.append(entry_json)
    report = {
        "format": FORMAT,
        "kind": "elec-calc-report",
        "tool": {"name": TOOL, "version": VERSION},
        "runId": run_id,
        "startedAt": stamp(started),
        "finishedAt": stamp(finished()),
        "request": request,
        "title": title,
        "notes": notes,
        "calculations": calculations,
    }
    files = {
        "report.json": (
            "report-json",
            (json.dumps(report, indent=2, ensure_ascii=False, allow_nan=False) + "\n").encode("utf-8"),
        ),
        "report.md": ("report-markdown", markdown(report).encode("utf-8")),
    }
    # Everything this run creates, deepest last, so that a failure can take it away again.
    made: list[Path] = []
    folder = results_dir
    while not folder.exists() and folder != folder.parent:
        made.insert(0, folder)
        folder = folder.parent
    created: list[Path] = []
    try:
        results_dir.mkdir(parents=True, exist_ok=True)
        try:
            run_dir.mkdir()
        except FileExistsError as error:
            raise exists from error
        made.append(run_dir)
        # The check of the results directory is as old as the computation: a link put in its place meanwhile
        # must not carry the report out of the working directory or into .vera.
        if not _allowed_output(cwd, run_dir):
            raise OutputFailure("The results directory changed while the report ran; the report was discarded.")
        for name, (_, data) in files.items():
            with open(run_dir / name, "xb") as handle:
                created.append(run_dir / name)
                handle.write(data)
        if not unchanged():
            raise OutputFailure("The input file changed while the report ran; the report was discarded.")
    except (OSError, OutputFailure, CalcError) as error:
        for path in created:
            try:
                path.unlink()
            except OSError:
                pass
        for path in reversed(made):
            try:
                path.rmdir()
            except OSError:
                pass
        if not isinstance(error, OSError):
            raise
        raise OutputFailure(
            f"The report could not be written to '{_relative(cwd, run_dir)}': {error.strerror or error}."
        ) from error
    return {
        "artifacts": [
            {
                "kind": kind,
                "path": _relative(cwd, run_dir / name),
                "bytes": len(data),
                "sha256": hashlib.sha256(data).hexdigest(),
            }
            for name, (kind, data) in files.items()
        ],
        "calculations": [
            {
                "id": identifier,
                "operation": result.operation,
                **({} if result.model is None else {"model": result.model}),
                "results": {name: item["text"] for name, item in result.body()["results"].items()},
                "checks": {
                    "pass": sum(1 for check in result.checks if check["status"] == "pass"),
                    "fail": sum(1 for check in result.checks if check["status"] == "fail"),
                    "unknown": sum(1 for check in result.checks if check["status"] == "unknown"),
                    "notEvaluated": sum(1 for check in result.checks if check["status"] == "not-evaluated"),
                },
            }
            for identifier, _, result, _ in computed
        ],
        "warnings": [],
    }
