"""ztest console output into case results (spec REQ-DATA-d8ecee6a section 7, REQ-FUNC-36e3ecdd).

Zephyr's ztest prints `START - <case>`, then ` PASS - <case> in <t> seconds`, ` FAIL - ...` or ` SKIP - ...`, a suite
line `TESTSUITE <suite> succeeded|failed` and at the very end `PROJECT EXECUTION SUCCESSFUL|FAILED`. A case that
started without an outcome is `blocked`; output without the end marker is incomplete.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

CASE = re.compile(r"^\s*(START|PASS|FAIL|SKIP) - (test_[A-Za-z0-9_]+|[A-Za-z0-9_]+)(?: in [0-9.]+ seconds)?\s*$")
SUITE = re.compile(r"^\s*Running TESTSUITE ([A-Za-z0-9_]+)")
END = re.compile(r"PROJECT EXECUTION (SUCCESSFUL|FAILED)")
BOOT = re.compile(r"\*\*\* Booting Zephyr OS")
STATUS = {"PASS": "pass", "FAIL": "fail", "SKIP": "skipped"}


@dataclass
class Parsed:
    cases: dict[str, str] = field(default_factory=dict)
    suites: list[str] = field(default_factory=list)
    end: str | None = None
    failed_marker: bool = False
    boots: int = 0
    lines: int = 0


def parse(text: str) -> Parsed:
    parsed = Parsed()
    suite = ""
    for raw in text.splitlines():
        line = raw.rstrip("\r")
        parsed.lines += 1
        if BOOT.search(line):
            parsed.boots += 1
        match = SUITE.match(line)
        if match:
            suite = match.group(1)
            parsed.suites.append(suite)
            continue
        match = CASE.match(line)
        if match:
            case = match.group(2)[5:] if match.group(2).startswith("test_") else match.group(2)
            name = f"{suite}.{case}" if suite else case
            if match.group(1) == "START":
                parsed.cases.setdefault(name, "blocked")
            elif parsed.cases.get(name) != "fail":  # A failure stays a failure, whatever a rerun prints later.
                parsed.cases[name] = STATUS[match.group(1)]
            continue
        match = END.search(line)
        if match:
            parsed.end = match.group(1)
            parsed.failed_marker = parsed.failed_marker or match.group(1) == "FAILED"
    return parsed


def verdict(parsed: Parsed, expected: list[str]) -> tuple[str, str | None, dict[str, str]]:
    """The run status, a code, and every case's status (expected cases first)."""
    # Twister names a case <scenario>.<suite>.<case without test_>; the console prints <suite> and test_<case>.
    def same(identifier: str, case: str) -> bool:
        return identifier == case or identifier.endswith("." + case)

    cases: dict[str, str] = {}
    for name in expected:
        hit = next((status for case, status in parsed.cases.items() if same(name, case)), None)
        cases[name] = hit or "not-run"
    for case, status in parsed.cases.items():
        if not any(same(name, case) for name in expected):
            cases[case] = status
    values = list(cases.values())
    if not values:
        return "incomplete", "no-cases", cases
    if "fail" in values or parsed.failed_marker:
        return "fail", "case-failed", cases
    if parsed.boots > 1:
        return "incomplete", "rebooted", cases
    if parsed.end is None:
        return "incomplete", "output-ended", cases
    if any(value != "pass" for value in values):
        return "incomplete", "not-all-passed", cases
    return "pass", None, cases
