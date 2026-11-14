"""Unity output and PlatformIO test reports into case results (spec REQ-DATA-865c8fbd section 7, REQ-FUNC-427ebd28,
REQ-FUNC-a98ab34c).

Unity prints one line per case, `<file>:<line>:<case>:PASS`, `...:FAIL: <message>` or `...:IGNORE: <message>`, then a
summary `<n> Tests <f> Failures <i> Ignored` and `OK` or `FAIL`. A failure stays a failure whatever a later line says;
output without the summary, a summary that disagrees with the cases, an ignored case or a second summary (a reboot)
is incomplete, never a pass.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

CASE = re.compile(r"(?P<file>(?:[A-Za-z]:)?[^:\r\n]+):(?P<line>\d+):(?P<name>[A-Za-z_][A-Za-z0-9_]*):"
                  r"(?P<status>PASS|IGNORE|FAIL)(?::\s*(?P<message>.*))?$")
SUMMARY = re.compile(r"(\d+) Tests (\d+) Failures (\d+) Ignored")
STATUS = {"PASS": "pass", "FAIL": "fail", "IGNORE": "skipped"}
PIO_STATUS = {"PASSED": "pass", "FAILED": "fail", "SKIPPED": "skipped", "ERRORED": "error"}


@dataclass
class Parsed:
    cases: dict[str, dict[str, Any]] = field(default_factory=dict)
    summaries: list[tuple[int, int, int]] = field(default_factory=list)
    ok: bool | None = None


def parse(text: str) -> Parsed:
    parsed = Parsed()
    awaiting = False
    for raw in text.splitlines():
        line = raw.strip().strip("\x00")
        if awaiting and line in ("OK", "FAIL"):
            parsed.ok = line == "OK" if parsed.ok is not False else False
            awaiting = False
            continue
        match = CASE.search(line)
        if match:
            name = match.group("name")
            status = STATUS[match.group("status")]
            if parsed.cases.get(name, {}).get("status") != "fail":
                parsed.cases[name] = {"name": name, "status": status, "file": match.group("file").strip(),
                                      "line": int(match.group("line")), "message": (match.group("message") or None)}
            continue
        match = SUMMARY.search(line)
        if match:
            parsed.summaries.append((int(match.group(1)), int(match.group(2)), int(match.group(3))))
            awaiting = True
    return parsed


def verdict(parsed: Parsed) -> tuple[str, str | None]:
    values = [case["status"] for case in parsed.cases.values()]
    if "fail" in values or parsed.ok is False or any(failures for _, failures, _ in parsed.summaries):
        return "fail", "case-failed"
    if not values:
        return "incomplete", "no-cases"
    if len(parsed.summaries) > 1:
        return "incomplete", "rebooted"
    if not parsed.summaries or parsed.ok is None:
        return "incomplete", "output-ended"
    total = parsed.summaries[0][0]
    if total != len(values):
        return "incomplete", "count-mismatch"
    if any(value != "pass" for value in values):
        return "incomplete", "not-all-passed"
    return "pass", None


def report(path: Path, environment: str) -> list[dict[str, Any]]:
    """The suites of PlatformIO's JSON test report (`--json-output-path`) for one environment."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    suites: list[dict[str, Any]] = []
    for suite in data.get("test_suites", []) if isinstance(data, dict) else []:
        if not isinstance(suite, dict) or suite.get("env_name") != environment:
            continue
        cases = []
        for case in suite.get("test_cases", []) or []:
            if not isinstance(case, dict):
                continue
            source = case.get("source") or {}
            cases.append({"name": str(case.get("name")), "status": PIO_STATUS.get(str(case.get("status")), "error"),
                          "file": source.get("file") if isinstance(source, dict) else None,
                          "line": source.get("line") if isinstance(source, dict) else None,
                          "message": case.get("message")})
        suites.append({"suite": str(suite.get("test_name")), "platformio": suite.get("status"), "cases": cases})
    return suites


def suite_status(cases: list[dict[str, Any]]) -> tuple[str, str | None]:
    values = [case["status"] for case in cases]
    if "fail" in values:
        return "fail", "case-failed"
    if "error" in values:
        return "error", "case-error"
    if not values:
        return "incomplete", "no-cases"
    if any(value != "pass" for value in values):
        return "incomplete", "not-all-passed"
    return "pass", None
