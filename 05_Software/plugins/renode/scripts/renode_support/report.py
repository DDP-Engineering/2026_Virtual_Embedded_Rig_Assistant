"""`renode-sim report --run DIR [--hil DIR]` (spec REQ-DATA-8a943977 section 8, REQ-FUNC-ea40de9f, REQ-FUNC-31a21cb5).

Writes report.md, report.html and junit.xml in the hil-testing report shape, so virtual results and HIL results can be
read side by side at the requirement level; the virtual column is always labelled simulation evidence. A run folder
whose result.json still says `running` and whose heartbeat is older than 90 s was stopped or killed: report completes
it as `stopped` with reason `interrupted` (REQ-REL-c7579edf).
"""

from __future__ import annotations

import html
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from xml.sax.saxutils import quoteattr

from .errors import Refused
from .result import EXIT, emit, now, worst
from .workspace import PathRefused, confined, relative

RESULT_BYTES = 32 * 1024 * 1024
STALE_SECONDS = 90


def _folder(cwd: Path, spelled: Path, raw: str, option: str) -> Path:
    try:
        folder = confined(cwd, raw, option, spelled)
    except PathRefused as error:
        raise Refused("request", str(error)) from error
    if not folder.is_dir():
        raise Refused("request", f"{option} {raw[:120]!r} is not a run folder.")
    return folder


def _load(folder: Path, kind: str, option: str) -> dict[str, Any]:
    path = folder / "result.json"
    try:
        if not path.is_file() or path.stat().st_size > RESULT_BYTES:
            raise Refused("request", f"{option}: the folder has no readable result.json.")
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise Refused("request", f"{option}: result.json cannot be read.") from error
    if not isinstance(document, dict) or document.get("format") != 1 or document.get("kind") != kind:
        raise Refused("request", f"{option}: result.json is not a format 1 {kind}.")
    return document


def _age(stamp: Any) -> float:
    try:
        moment = datetime.strptime(str(stamp), "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return float("inf")
    return (datetime.now(timezone.utc) - moment).total_seconds()


def complete_interrupted(folder: Path, result: dict[str, Any]) -> dict[str, Any]:
    """Marks a run that never finished as stopped/interrupted and rewrites its result.json."""
    if result.get("state") == "done":
        return result
    if _age(result.get("heartbeat")) < STALE_SECONDS:
        raise Refused("running", "The run is still running (its heartbeat is recent); report it once it has ended.")
    result["state"] = "done"
    result["ended"] = result.get("ended") or now()
    result["status"] = worst(str(result.get("status", "pass")), "stopped")
    result["code"] = "interrupted"
    result["reason"] = "The run was stopped or killed before it finished; this report holds the part recorded until then."
    cases = result.get("cases")
    for case in cases if isinstance(cases, list) else []:
        if isinstance(case, dict) and case.get("status") == "running":
            case.update(status="stopped", code="interrupted", reason="interrupted while the case ran")
    text = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    temporary = folder / "result.json.tmp"
    with open(temporary, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)
    os.replace(temporary, folder / "result.json")
    return result


def _cases(result: dict[str, Any]) -> list[dict[str, Any]]:
    cases = [case for case in result.get("cases") or [] if isinstance(case, dict)]
    if cases:
        return cases
    # run and capture-uart: the operation itself is the one test case.
    return [{"id": str(result.get("operation")), "requirement": None, "status": result.get("status"),
             "reason": result.get("reason"), "virtualSeconds": (result.get("time") or {}).get("virtualSeconds", 0)}]


def junit(result: dict[str, Any]) -> str:
    cases = _cases(result)
    counts = {"failures": 0, "errors": 0, "skipped": 0}
    suite = (result.get("testSet") or {}).get("id") or result.get("operation") or "renode"
    profile = (result.get("profile") or {}).get("id", "")
    rows = []
    for case in cases:
        status = str(case.get("status", ""))
        message = f"{status}: {case.get('reason') or ''}".strip()
        body = ""
        if status == "fail":
            counts["failures"] += 1
            body = f"<failure message={quoteattr(message[:400])}/>"
        elif status in ("timeout", "error", "blocked"):
            counts["errors"] += 1
            body = f"<error message={quoteattr(message[:400])}/>"
        elif status in ("incomplete", "stopped", "skipped"):
            counts["skipped"] += 1
            body = f"<skipped message={quoteattr(message[:400])}/>"
        requirement = case.get("requirement")
        properties = f"<properties><property name=\"requirement\" value={quoteattr(str(requirement))}/></properties>" if requirement else ""
        seconds = float(case.get("virtualSeconds") or 0)
        rows.append(
            f'  <testcase classname={quoteattr(f"{suite}.{profile}")} name={quoteattr(str(case.get("id")))} time="{seconds:.6f}">'
            f"{properties}{body}</testcase>"
        )
    firmware = (result.get("firmware") or {}).get("sha256", "")
    total = float((result.get("time") or {}).get("virtualSeconds") or 0)
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n'
        f'<testsuite name={quoteattr(str(suite))} tests="{len(rows)}" failures="{counts["failures"]}" errors="{counts["errors"]}" '
        f'skipped="{counts["skipped"]}" time="{total:.6f}">\n'
        f'  <properties><property name="status" value={quoteattr(str(result.get("status")))}/>'
        f'<property name="runId" value={quoteattr(str(result.get("runId")))}/>'
        '<property name="evidence" value="virtual"/>'
        f'<property name="profile" value={quoteattr(str(profile))}/>'
        f'<property name="firmwareSha256" value={quoteattr(str(firmware))}/>'
        '<property name="time" value="testcase and testsuite times are virtual seconds"/></properties>\n'
        + "\n".join(rows)
        + "\n</testsuite>\n</testsuites>\n"
    )


def comparison(result: dict[str, Any], hil: dict[str, Any]) -> list[dict[str, Any]]:
    """One row per requirement of the virtual run: its virtual status and the status of the mapped HIL steps."""
    steps = {}
    for group in ("steps", "cleanup"):
        for step in hil.get(group) or []:
            if isinstance(step, dict) and isinstance(step.get("id"), str):
                steps[step["id"]] = str(step.get("status"))
    rows: dict[str, dict[str, Any]] = {}
    for case in _cases(result):
        requirement = case.get("requirement")
        if not requirement:
            continue
        row = rows.setdefault(requirement, {"requirement": requirement, "virtual": [], "hardware": []})
        row["virtual"].append(f"{case.get('id')}: {case.get('status')}")
        for step_id in case.get("hil") or []:
            row["hardware"].append(f"{step_id}: {steps.get(step_id, 'not in the HIL run')}")
    for row in rows.values():
        if not row["hardware"]:
            row["hardware"] = ["not run on hardware"]
    return list(rows.values())


def markdown(result: dict[str, Any], rows: list[dict[str, Any]] | None, hil_id: str | None) -> str:
    firmware = result.get("firmware") or {}
    profile = result.get("profile") or {}
    engine = result.get("engine") or {}
    timing = result.get("time") or {}
    lines = [
        f"# Renode run {result.get('runId')} - {result.get('operation')}: {result.get('status')}",
        "",
        "Evidence: **virtual**. A simulation on the profile's model; it does not replace a test on hardware.",
        "",
        f"- Status: {result.get('status')}" + (f" ({result.get('code')}: {result.get('reason')})" if result.get("code") else ""),
        f"- Firmware: `{firmware.get('path')}` SHA-256 `{firmware.get('sha256')}` build id `{firmware.get('buildId')}`",
        f"- Engine: {engine.get('versionLine') or engine.get('version')}",
        f"- Profile: `{profile.get('id')}` ({profile.get('origin')}) SHA-256 `{profile.get('sha256')}`, verification {profile.get('verification')}",
    ]
    for name, digest in sorted((profile.get("files") or {}).items()):
        lines.append(f"  - profile file `{name}` `{digest}`")
    for name, digest in sorted((profile.get("engineFiles") or {}).items()):
        lines.append(f"  - engine file `{name}` `{digest}`")
    budgets = result.get("budgets") or {}
    lines += [
        f"- Virtual time simulated: {timing.get('virtualSeconds')} s (engine: {timing.get('engineVirtual')} s), "
        f"budget {budgets.get('virtualSeconds')} s",
        f"- Real time: {timing.get('realSeconds')} s, budget {budgets.get('realSeconds')} s",
        "",
        "## Cases",
        "",
        "| Case | Requirement | Status | Virtual s | Detail |",
        "|---|---|---|---|---|",
    ]
    for case in _cases(result):
        detail = str(case.get("reason") or "").replace("|", "\\|")
        lines.append(f"| {case.get('id')} | {case.get('requirement') or ''} | {case.get('status')} | {case.get('virtualSeconds')} | {detail} |")
    unmodeled = result.get("unmodeled") or []
    lines += ["", "## Unmodeled accesses", ""]
    lines += [f"- {json.dumps(entry, ensure_ascii=False)}" for entry in unmodeled] or ["- none reported by the engine"]
    simulated = (result.get("coverage") or {}).get("simulated") or []
    lines += ["", "## Simulated", ""] + [f"- {item}" for item in simulated]
    lines += ["", "## Not covered by this simulation", ""]
    lines += [f"- {item}" for item in (result.get("coverage") or {}).get("notCovered") or []]
    if rows is not None:
        lines += [
            "",
            f"## Requirements: virtual run and HIL run {hil_id}",
            "",
            "The virtual column is simulation evidence; only the hardware column is evidence from the board.",
            "",
            "| Requirement | Virtual (simulation) | Hardware (HIL) |",
            "|---|---|---|",
        ]
        lines += [f"| {row['requirement']} | {', '.join(row['virtual'])} | {', '.join(row['hardware'])} |" for row in rows]
    return "\n".join(lines) + "\n"


def report_html(text: str, title: str) -> str:
    body = "\n".join(f"<p>{html.escape(line)}</p>" if line else "" for line in text.splitlines())
    return (
        "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\"><title>"
        + html.escape(title)
        + "</title><style>body{font-family:sans-serif;max-width:60rem;margin:2rem auto;padding:0 1rem}p{margin:.2rem 0;white-space:pre-wrap}</style>"
        "</head><body>\n" + body + "\n</body></html>\n"
    )


def report(cwd: Path, spelled: Path, raw: str, hil_raw: str | None) -> int:
    folder = _folder(cwd, spelled, raw, "--run")
    result = _load(folder, "renode-result", "--run")
    rows = None
    hil_id = None
    if hil_raw is not None:
        hil_folder = _folder(cwd, spelled, hil_raw, "--hil")
        hil = _load(hil_folder, "hil-test-result", "--hil")
        if hil.get("state") != "done":
            raise Refused("request", "--hil: the HIL run has not finished.")
        rows = comparison(result, hil)
        hil_id = str(hil.get("runId"))
    result = complete_interrupted(folder, result)
    text = markdown(result, rows, hil_id)
    written = []
    for name, content in (("report.md", text), ("report.html", report_html(text, f"Renode run {result.get('runId')}")),
                          ("junit.xml", junit(result))):
        with open(folder / name, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(content)
        written.append(relative(cwd, folder / name))
    emit({"format": 1, "kind": "renode-report", "status": result.get("status"), "code": result.get("code"),
          "files": written, "comparison": rows})
    return EXIT.get(str(result.get("status")), 3)
