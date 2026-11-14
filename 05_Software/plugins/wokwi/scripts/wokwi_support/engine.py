"""The pinned wokwi-cli: where it is, its version, its child environment and its offline linter (spec REQ-DATA-d985bb3d
sections 1 and 4).

Every wokwi-cli child gets the helper's environment without any WOKWI_* variable (so WOKWI_CLI_SERVER can never point
the token at another host) plus NO_COLOR=1; only run-scenario adds WOKWI_CLI_TOKEN (REQ-SEC-3ab66bb9).
"""

from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path
from typing import Any

from . import CLI_SHA, CLI_VERSION
from .report import Ended, refused

PROGRAM_VARIABLE = "VERA_PROGRAM_WOKWI_CLI"
SHORT_VERSION = re.compile(r"^(\d+\.\d+\.\d+) \(([0-9a-f]{6,40})\)")
LINT_LINE = re.compile(r"^(?P<icon>[✗⚠ℹ]) \[(?P<rule>[A-Za-z0-9_-]+)\] (?P<message>.*?)(?: \((?P<part>[^()]*)\))?$")
SEVERITY = {"✗": "error", "⚠": "warning", "ℹ": "info"}
LINT_TIMEOUT = 60
LINT_OUTPUT_LIMIT = 1024 * 1024


def executable() -> str:
    """The wokwi-cli VERA resolved for this plugin (manifest `uses`), or blocked cli-unavailable (REQ-FUNC-718d9e1b)."""
    path = os.environ.get(PROGRAM_VARIABLE, "")
    if not path or not os.path.isfile(path):
        raise refused("cli-unavailable", "wokwi-cli is not installed for this plugin: choose Install programs for the wokwi plugin (the pinned wokwi-cli 0.29.1).")
    return path


def child_environment(token: str | None = None) -> dict[str, str]:
    environment = {name: value for name, value in os.environ.items() if not name.upper().startswith("WOKWI_")}
    for name in [name for name in environment if name.upper() in ("FORCE_COLOR", "NO_COLOR")]:
        del environment[name]
    environment["NO_COLOR"] = "1"
    if token is not None:
        environment["WOKWI_CLI_TOKEN"] = token
    return environment


def _run(argv: list[str], timeout: int) -> subprocess.CompletedProcess[bytes]:
    try:
        return subprocess.run(argv, stdin=subprocess.DEVNULL, capture_output=True, timeout=timeout, env=child_environment(), check=False)
    except subprocess.TimeoutExpired as error:
        raise Ended("error", "cli-failed", f"wokwi-cli did not answer within {timeout} s.") from error
    except OSError as error:
        raise refused("cli-unavailable", f"wokwi-cli cannot be started: {error.strerror or error}.") from error


def check_version(path: str) -> dict[str, str]:
    """`--short-version` must report the pinned version, else blocked cli-version."""
    completed = _run([path, "--short-version"], LINT_TIMEOUT)
    text = completed.stdout.decode("utf-8", "replace").strip()
    match = SHORT_VERSION.match(text)
    # The build sha too: a wokwi-cli found on PATH receives the token, so only the official 0.29.1 build is accepted.
    if completed.returncode != 0 or not match or match.group(1) != CLI_VERSION or match.group(2) != CLI_SHA:
        raise refused("cli-version", f"wokwi-tool needs the official wokwi-cli {CLI_VERSION} ({CLI_SHA}); the installed one reports '{text[:80] or 'nothing'}'.")
    return {"version": match.group(1), "sha": match.group(2)}


def lint(path: str, diagram: Path) -> dict[str, Any]:
    """`wokwi-cli lint --offline <diagram>`: never downloads board definitions, needs no token."""
    completed = _run([path, "lint", "--offline", str(diagram)], LINT_TIMEOUT)
    text = (completed.stdout[:LINT_OUTPUT_LIMIT] + b"\n" + completed.stderr[:LINT_OUTPUT_LIMIT]).decode("utf-8", "replace")
    issues = []
    for line in text.splitlines():
        match = LINT_LINE.match(line.strip())
        if match:
            issue = {"severity": SEVERITY[match.group("icon")], "rule": match.group("rule"), "message": match.group("message")}
            if match.group("part"):
                issue["part"] = match.group("part")
            issues.append(issue)
    if completed.returncode not in (0, 1) or (completed.returncode == 1 and not any(issue["severity"] == "error" for issue in issues)):
        first = next((line for line in text.splitlines() if line.strip() and not line.startswith("Wokwi CLI v")), "")
        raise Ended("error", "lint-failed", f"wokwi-cli lint ended with exit {completed.returncode}: {first[:300]}")
    return {"engine": "wokwi-cli lint --offline", "exitCode": completed.returncode, "issues": issues}
