"""`hil report --run DIR`: report.html, report.md and junit.xml of a finished HIL run (spec REQ-DATA-5f714098 §8)."""

from __future__ import annotations

import html
import json
import os
import sys
from pathlib import Path
from typing import Any
from xml.sax.saxutils import quoteattr

from . import VERSION

RESULT_BYTES = 16 * 1024 * 1024
EVENTS_SHOWN = 2000
OUTPUTS = ("report.html", "report.md", "junit.xml")
USAGE = "usage: hil report --run DIR | hil --version"


class Refused(Exception):
    """A request the helper refuses before writing anything."""


def _inside(root: Path, path: Path) -> bool:
    left, right = os.path.normcase(str(root)), os.path.normcase(str(path))
    return right == left or right.startswith(left.rstrip("\\/") + os.sep)


def _run_folder(raw: str) -> Path:
    if not raw or any(ord(char) < 32 for char in raw) or raw.startswith(("\\\\", "//")):
        raise Refused("--run takes a folder inside the working directory.")
    cwd = Path(os.path.realpath(os.getcwd()))
    folder = Path(os.path.realpath(cwd / raw))
    if not _inside(cwd, folder) or folder == cwd:
        raise Refused("--run must lie inside the working directory.")
    if any(part.rstrip(". ").casefold() == ".vera" for part in folder.relative_to(cwd).parts):
        raise Refused("--run must not lie inside .vera.")
    if not folder.is_dir():
        raise Refused(f"--run {raw[:120]} is not a folder.")
    return folder


def _load(folder: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    path = folder / "result.json"
    try:
        if not path.is_file() or path.stat().st_size > RESULT_BYTES:
            raise Refused("The run folder has no readable result.json.")
        result = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise Refused("The run folder's result.json cannot be read.") from error
    if not isinstance(result, dict) or result.get("format") != 1 or result.get("kind") != "hil-test-result":
        raise Refused("result.json is not a format 1 hil-test-result.")
    if result.get("state") != "done":
        raise Refused("The run has not finished; report it once its state is done.")
    events: list[dict[str, Any]] = []
    try:
        with (folder / "events.jsonl").open(encoding="utf-8") as stream:
            for line in stream:
                if len(events) >= EVENTS_SHOWN:
                    break
                value = json.loads(line)
                if isinstance(value, dict):
                    events.append(value)
    except (OSError, ValueError):
        pass
    return result, events


def _steps(result: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    rows: list[tuple[str, dict[str, Any]]] = []
    for group in ("steps", "cleanup"):
        for step in result.get(group) or []:
            if isinstance(step, dict):
                rows.append((group, step))
    return rows


def _seconds(step: dict[str, Any]) -> float:
    total = 0.0
    for attempt in step.get("attempts") or []:
        if isinstance(attempt, dict) and isinstance(attempt.get("startT"), (int, float)) and isinstance(attempt.get("endT"), (int, float)):
            total += max(0.0, attempt["endT"] - attempt["startT"]) / 1000
    return total


def _link(folder: Path, target: Any) -> str:
    """A relative link from the report to a workbench path the result names; empty for anything else."""
    if not isinstance(target, str) or not target:
        return ""
    cwd = Path(os.path.realpath(os.getcwd()))
    path = Path(os.path.realpath(cwd / target))
    if not _inside(cwd, path):
        return ""
    return Path(os.path.relpath(path, folder)).as_posix()


def junit(result: dict[str, Any]) -> str:
    rows = _steps(result)
    counts = {"failures": 0, "errors": 0, "skipped": 0}
    cases = []
    for group, step in rows:
        status = str(step.get("status", ""))
        name = str(step.get("id", ""))
        classname = f"{result.get('plan', {}).get('id', 'plan')}.{group}.{step.get('phase', '')}"
        body = ""
        message = f"{status}: {step.get('use', '')}"
        if status == "fail":
            counts["failures"] += 1
            body = f"<failure message={quoteattr(message)}/>"
        elif status in ("error", "blocked"):
            counts["errors"] += 1
            body = f"<error message={quoteattr(message)}/>"
        elif status in ("skipped", "not-run", "incomplete", "stopped", "pending"):
            counts["skipped"] += 1
            reason = step.get("reason") or status
            body = f"<skipped message={quoteattr(str(reason))}/>"
        cases.append(
            f'  <testcase classname={quoteattr(classname)} name={quoteattr(name)} time="{_seconds(step):.3f}">{body}</testcase>'
        )
    plan = result.get("plan", {}) if isinstance(result.get("plan"), dict) else {}
    used = result.get("budget", {}).get("usedMs", 0) if isinstance(result.get("budget"), dict) else 0
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n'
        f"<testsuite name={quoteattr(str(plan.get('id', 'plan')))} tests=\"{len(rows)}\" failures=\"{counts['failures']}\" "
        f"errors=\"{counts['errors']}\" skipped=\"{counts['skipped']}\" time=\"{(used or 0) / 1000:.3f}\">\n"
        f"  <properties><property name=\"status\" value={quoteattr(str(result.get('status')))}/>"
        f"<property name=\"physical\" value={quoteattr(str(result.get('physical')))}/>"
        f"<property name=\"runId\" value={quoteattr(str(result.get('runId')))}/></properties>\n"
        + "\n".join(cases)
        + "\n</testsuite>\n</testsuites>\n"
    )


def markdown(result: dict[str, Any]) -> str:
    plan = result.get("plan") or {}
    setup = result.get("setup") or {}
    firmware = result.get("firmware") or {}
    lines = [
        f"# HIL run {result.get('runId')}: {plan.get('title', '')}",
        "",
        f"- Plan: `{plan.get('id')}` ({plan.get('path')}, sha256 {plan.get('sha256')})",
        f"- Status: **{result.get('status')}**; physical state: **{result.get('physical')}**; risk {result.get('risk')}",
        f"- Board: {setup.get('board')} revision {setup.get('revision')}; firmware effect {setup.get('firmwareEffect')}",
        f"- Firmware: {firmware.get('path')} ({firmware.get('format')}) sha256 {firmware.get('sha256')}",
        f"- Started {result.get('started')}, ended {result.get('ended')}",
        "",
        "| Group | Step | Phase | Use | Status | Attempts |",
        "|---|---|---|---|---|---|",
    ]
    for group, step in _steps(result):
        attempts = ", ".join(
            f"{a.get('repetition')}.{a.get('attempt')} {a.get('status')} (exit {a.get('exitCode')})"
            for a in step.get("attempts") or []
            if isinstance(a, dict)
        )
        cells = [group, step.get("id"), step.get("phase"), step.get("use"), step.get("status"), attempts or "-"]
        lines.append("| " + " | ".join(str(cell).replace("|", "\\|") for cell in cells) + " |")
    problems = result.get("problems") or []
    if problems:
        lines += ["", "## Problems", ""]
        lines += [f"- `{p.get('code')}` {p.get('step', '')}: {p.get('message')}" for p in problems if isinstance(p, dict)]
    lines += ["", f"_{result.get('correlation', '')}_", ""]
    return "\n".join(lines)


def report_html(result: dict[str, Any], events: list[dict[str, Any]], folder: Path) -> str:
    e = lambda value: html.escape("" if value is None else str(value))  # noqa: E731
    plan = result.get("plan") or {}
    setup = result.get("setup") or {}
    firmware = result.get("firmware") or {}
    rows = []
    for group, step in _steps(result):
        for attempt in step.get("attempts") or [{}]:
            if not isinstance(attempt, dict):
                continue
            log = _link(folder, attempt.get("log"))
            output = _link(folder, attempt.get("folder"))
            rows.append(
                "<tr>"
                f"<td>{e(group)}</td><td>{e(step.get('id'))}</td><td>{e(step.get('phase'))}</td><td>{e(step.get('use'))}</td>"
                f"<td class=\"{e(step.get('status'))}\">{e(step.get('status'))}</td>"
                f"<td>{e(attempt.get('repetition', ''))}.{e(attempt.get('attempt', ''))} {e(attempt.get('status', ''))}</td>"
                f"<td>{e(attempt.get('exitCode', ''))}</td><td>{e(attempt.get('startT', ''))} - {e(attempt.get('endT', ''))}</td>"
                f"<td>{e(attempt.get('problem', ''))}</td>"
                f"<td>{f'<a href={quoteattr(log)}>log</a>' if log else ''} {f'<a href={quoteattr(output)}>result</a>' if output else ''}</td>"
                "</tr>"
            )
    timeline = "".join(
        f"<tr><td>{e(event.get('t'))}</td><td>{e(event.get('at'))}</td><td>{e(event.get('event'))}</td>"
        f"<td>{e(event.get('step', ''))}</td><td>{e(json.dumps({k: v for k, v in event.items() if k not in ('seq', 't', 'at', 'event', 'step')}))}</td></tr>"
        for event in events
    )
    problems = "".join(
        f"<li><code>{e(p.get('code'))}</code> {e(p.get('step', ''))}: {e(p.get('message'))}</li>"
        for p in result.get("problems") or []
        if isinstance(p, dict)
    )
    wiring = "".join(f"<li>{e(wire)}</li>" for wire in setup.get("wiring") or [])
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>HIL {e(plan.get('id'))} {e(result.get('runId'))}</title>
<style>body{{font-family:sans-serif;margin:1.5em}}table{{border-collapse:collapse}}td,th{{border:1px solid #999;padding:2px 6px;font-size:90%}}
.pass{{background:#d8f0d8}}.fail{{background:#f6d0d0}}.error,.blocked{{background:#f8e0b0}}</style></head><body>
<h1>{e(plan.get('title'))}</h1>
<p>Plan <code>{e(plan.get('id'))}</code> ({e(plan.get('path'))}, sha256 {e(plan.get('sha256'))}) - run {e(result.get('runId'))}</p>
<p>Status <strong class="{e(result.get('status'))}">{e(result.get('status'))}</strong>; physical state <strong>{e(result.get('physical'))}</strong>; risk {e(result.get('risk'))}; started {e(result.get('started'))}, ended {e(result.get('ended'))}</p>
<h2>Setup</h2><p>{e(setup.get('board'))} revision {e(setup.get('revision'))}: {e(setup.get('description'))}</p><ul>{wiring}</ul>
<p>Firmware effect {e(setup.get('firmwareEffect'))}: {e(setup.get('effectNote'))}</p>
<p>Firmware {e(firmware.get('path'))} ({e(firmware.get('format'))}) sha256 {e(firmware.get('sha256'))}</p>
<h2>Steps</h2><table><tr><th>Group</th><th>Step</th><th>Phase</th><th>Use</th><th>Status</th><th>Attempt</th><th>Exit</th><th>t (ms)</th><th>Problem</th><th>Links</th></tr>{"".join(rows)}</table>
<h2>Problems</h2><ul>{problems or "<li>none</li>"}</ul>
<h2>Timeline</h2><p>{e(result.get('correlation'))}</p>
<table><tr><th>t (ms)</th><th>Host time</th><th>Event</th><th>Step</th><th>Details</th></tr>{timeline}</table>
<p>Generated by hil-testing {e(VERSION)}.</p></body></html>
"""


def report(folder: Path) -> dict[str, Any]:
    result, events = _load(folder)
    for name in OUTPUTS:
        # lexists: a link (even a dangling one) in place of a report file counts as present.
        if os.path.lexists(folder / name):
            raise Refused(f"{name} already exists in the run folder; a report is written once.")
    contents = {
        "report.html": report_html(result, events, folder),
        "report.md": markdown(result),
        "junit.xml": junit(result),
    }
    written: list[str] = []
    try:
        for name in OUTPUTS:
            with (folder / name).open("x", encoding="utf-8", newline="\n") as stream:
                written.append(name)
                stream.write(contents[name])
    except OSError as error:
        # All or nothing: remove what this call created before refusing.
        for name in written:
            try:
                (folder / name).unlink()
            except OSError:
                pass
        raise Refused(f"The report cannot be written: {error.strerror or error}.") from error
    return {"format": 1, "kind": "hil-report", "status": result.get("status"), "files": written}


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if args in (["--version"],):
        print(f"hil-testing {VERSION}")
        return 0
    if args in (["--help"], ["-h"]) or not args:
        print(USAGE)
        return 0 if args else 2
    try:
        if len(args) != 3 or args[0] != "report" or args[1] != "--run":
            if args and args[0] in ("check", "run"):
                raise Refused("VERA runs hil check and hil run itself; this helper only writes reports.")
            raise Refused(USAGE)
        outcome = report(_run_folder(args[2]))
    except Refused as refused:
        print(json.dumps({"format": 1, "kind": "hil-report", "status": "refused", "problem": str(refused)}))
        return 2
    print(json.dumps(outcome))
    return 0
