"""Result documents, run folders, stdout output and the report operation of wokwi-tool (spec REQ-DATA-d985bb3d)."""

from __future__ import annotations

import html
import json
import os
import secrets
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape, quoteattr

from . import FORMAT, NOTE, REPORT_KIND, RESULT_KIND, RUN_KIND, TOOL, VERSION, workspace

OUTPUT_LIMIT = 11000
DEFAULT_RESULTS = "arduino-iot-results"
EXIT = {"pass": 0, "fail": 1, "blocked": 2, "incomplete": 3, "error": 3}


class Refused(Exception):
    """Blocked before anything was sent: `{code, message}` problems."""

    def __init__(self, problems: list[dict[str, Any]], **fields: Any) -> None:
        super().__init__(problems[0]["message"] if problems else "refused")
        self.problems = problems
        self.fields = fields


class Ended(Exception):
    """An operation that ended with `status` (fail or error) after its checks."""

    def __init__(self, status: str, code: str, message: str, **fields: Any) -> None:
        super().__init__(message)
        self.status = status
        self.problem = problem(code, message)
        self.fields = fields


def problem(code: str, message: str, **extra: Any) -> dict[str, Any]:
    return {"code": code, "message": message, **extra}


def refused(code: str, message: str, **extra: Any) -> Refused:
    return Refused([problem(code, message, **extra)])


def stamp(moment: datetime | None = None) -> str:
    moment = moment or datetime.now(timezone.utc)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


def new_run_id(operation: str) -> str:
    return f"{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}-{operation}-{secrets.token_hex(2)}"


def header(operation: str, started: str) -> dict[str, Any]:
    return {
        "format": FORMAT,
        "kind": RESULT_KIND,
        "tool": f"{TOOL} {VERSION}",
        "operation": operation,
        "startedAt": started,
        "status": "pass",
        "errors": [],
        "warnings": [],
        "note": NOTE,
    }


def check_run_id(value: str | None) -> None:
    if value is not None and not workspace.valid_run_id(value):
        raise refused("usage", "--run-id takes 1-64 letters, digits, '.', '_' or '-', starting and ending with a letter or digit.")


def run_folder(cwd: Path, spelled: Path, results_dir: str, run_id: str) -> Path:
    """Creates `<results-dir>/<run-id>` exclusively inside the working directory and outside `.vera`."""
    try:
        results = workspace.results_directory(cwd, results_dir, spelled)
    except workspace.PathRefused as error:
        raise refused("path", str(error)) from error
    folder = results / run_id
    if folder.exists():
        raise refused("run-exists", f"The run folder {workspace.relative(cwd, folder)} exists already; choose another --run-id.")
    results.mkdir(parents=True, exist_ok=True)
    try:
        folder.mkdir()
    except FileExistsError as error:
        raise refused("run-exists", f"The run folder {workspace.relative(cwd, folder)} exists already.") from error
    if not workspace.allowed_output(cwd, folder):
        folder.rmdir()
        raise refused("path", "--results-dir resolves outside the working directory or into .vera.")
    return folder


def write_json(path: Path, document: dict[str, Any]) -> None:
    """Written aside and renamed, so a killed helper never leaves half a document."""
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    os.replace(temporary, path)


def write_text(path: Path, text: str) -> None:
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(text, encoding="utf-8", newline="\n")
    os.replace(temporary, path)


def cell(value: Any) -> str:
    return str(value).replace("|", "\\|").replace("\n", " ").replace("`", "'")


def emit(document: dict[str, Any]) -> None:
    """One JSON document on stdout, long lists cut until it fits OUTPUT_LIMIT UTF-16 units."""
    shown = json.loads(json.dumps(document))

    def render() -> str:
        return json.dumps(shown, ensure_ascii=False, indent=2) + "\n"

    def size() -> int:
        return len(render().encode("utf-16-le")) // 2

    def omitted(key: str) -> None:
        shown.setdefault("omittedFromOutput", {})[key] = shown.get("omittedFromOutput", {}).get(key, 0) + 1

    holders: list[tuple[dict[str, Any], str]] = []
    for name in ("diagram", "project"):
        value = shown.get(name)
        if isinstance(value, dict):
            holders += [(value, "issues"), (value, "parts"), (value, "candidates")]
    holders += [(shown, "runs"), (shown, "artifacts"), (shown, "files"), (shown, "warnings"), (shown, "errors")]
    for holder, key in holders:
        items = holder.get(key)
        while isinstance(items, list) and items and size() > OUTPUT_LIMIT:
            omitted(key)
            items.pop()
    sys.stdout.write(render())
    sys.stdout.flush()


# The report operation (REQ-FUNC-1b2f02bd).


def _load_run(cwd: Path, spelled: Path, raw: str) -> tuple[Path, dict[str, Any]]:
    try:
        folder = workspace.confined(cwd, raw, "--run", spelled)
    except workspace.PathRefused as error:
        raise refused("path", str(error)) from error
    try:
        document = json.loads((folder / "result.json").read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise refused("run-invalid", f"--run '{raw[:120]}' holds no wokwi-tool run result.json.") from error
    if not isinstance(document, dict) or document.get("kind") != RUN_KIND or document.get("format") != FORMAT:
        raise refused("run-invalid", f"--run '{raw[:120]}' is not a wokwi-tool run-scenario folder.")
    return folder, document


def _summary(cwd: Path, folder: Path, run: dict[str, Any]) -> dict[str, Any]:
    time = run.get("time") if isinstance(run.get("time"), dict) else {}
    job = run.get("job") if isinstance(run.get("job"), dict) else {}
    remote = run.get("remote") if isinstance(run.get("remote"), dict) else {}
    return {
        "run": workspace.relative(cwd, folder),
        "runId": run.get("runId"),
        "job": job.get("runId"),
        "scenario": run.get("scenario"),
        "board": run.get("board"),
        "status": run.get("status"),
        "outcome": run.get("outcome"),
        "message": (run.get("errors") or [{}])[0].get("message") if run.get("errors") else None,
        "remote": remote.get("state"),
        "virtual": time.get("virtual"),
        "real": time.get("real"),
    }


def _cells(run: dict[str, Any]) -> list[str]:
    board = run.get("board")
    virtual = run.get("virtual")
    real = run.get("real")
    virtual = virtual if isinstance(virtual, dict) else {}
    real = real if isinstance(real, dict) else {}
    reached = virtual.get("reachedNs")
    return [
        str(run.get("runId")),
        str(run.get("scenario") or "-"),
        str(board.get("type", "-")) if isinstance(board, dict) else "-",
        str(run.get("status")),
        str(run.get("outcome")),
        str(run.get("remote")),
        (f"{reached} ns of " if reached is not None else "") + f"{virtual.get('timeoutMs')} ms",
        str(real.get("elapsedS")),
    ]


COLUMNS = ["Run", "Scenario", "Board", "Status", "Outcome", "Remote", "Virtual", "Real (s)"]


def _markdown(runs: list[dict[str, Any]]) -> str:
    lines = ["# wokwi-tool report", "", f"> {NOTE}", "", "| " + " | ".join(COLUMNS) + " |", "|" + "---|" * len(COLUMNS)]
    for run in runs:
        lines.append("| " + " | ".join(cell(value) for value in _cells(run)) + " |")
    lines.append("")
    for run in runs:
        if run.get("message"):
            lines.append(f"- `{cell(run.get('runId'))}`: {cell(run['message'])}")
    return "\n".join(lines).rstrip() + "\n"


def _html(runs: list[dict[str, Any]]) -> str:
    head = "".join(f"<th>{html.escape(name)}</th>" for name in COLUMNS)
    rows = "".join("<tr>" + "".join(f"<td>{html.escape(value)}</td>" for value in _cells(run)) + "</tr>" for run in runs)
    return (
        '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>wokwi-tool report</title></head><body>\n'
        f"<h1>wokwi-tool report</h1>\n<p>{html.escape(NOTE)}</p>\n"
        f"<table><thead><tr>{head}</tr></thead><tbody>{rows}</tbody></table>\n</body></html>\n"
    )


def _junit(runs: list[dict[str, Any]]) -> str:
    failures = sum(1 for run in runs if run.get("status") == "fail")
    errors = sum(1 for run in runs if run.get("status") not in ("pass", "fail"))
    cases = []
    for run in runs:
        name = quoteattr(str(run.get("scenario") or run.get("runId")))
        seconds = (run.get("real") or {}).get("elapsedS") or 0
        body = ""
        message = quoteattr(str(run.get("message") or run.get("outcome")))
        kind = quoteattr(str(run.get("outcome")))
        if run.get("status") == "fail":
            body = f"<failure type={kind} message={message}/>"
        elif run.get("status") != "pass":
            body = f"<error type={kind} message={message}/>"
        cases.append(f'  <testcase classname="wokwi.{escape(str(run.get("runId")))}" name={name} time="{seconds}">{body}</testcase>')
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<testsuite name="wokwi" tests="{len(runs)}" failures="{failures}" errors="{errors}">\n'
        + "\n".join(cases)
        + "\n</testsuite>\n"
    )


def report(args: Any, document: dict[str, Any], cwd: Path, spelled: Path) -> None:
    check_run_id(args.run_id)
    loaded = [_load_run(cwd, spelled, raw) for raw in args.run]
    runs = [_summary(cwd, folder, run) for folder, run in loaded]
    run_id = args.run_id or new_run_id("report")
    folder = run_folder(cwd, spelled, args.results_dir, run_id)
    document.update({"runId": run_id, "runs": runs, "reportPath": workspace.relative(cwd, folder)})
    write_json(folder / "report.json", {"format": FORMAT, "kind": REPORT_KIND, "tool": f"{TOOL} {VERSION}", "createdAt": stamp(), "note": NOTE, "runs": runs})
    write_text(folder / "report.md", _markdown(runs))
    write_text(folder / "report.html", _html(runs))
    write_text(folder / "junit.xml", _junit(runs))
    document["files"] = ["report.json", "report.md", "report.html", "junit.xml"]
