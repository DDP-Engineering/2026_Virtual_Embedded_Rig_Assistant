"""The outcome of one wokwi-cli run, from its exit record and output (spec REQ-DATA-d985bb3d section 7;
REQ-FUNC-4ba54556, REQ-REL-85779c4c, REQ-DATA-6e0fbd5a, REQ-REL-01c5b557).

The texts are wokwi-cli 0.29.1's own (commands/simulate.ts, transport/WebSocketTransport.ts, TestScenario.ts); another
CLI version is refused before a run, so a changed text can never turn into a pass.
"""

from __future__ import annotations

import re
from typing import Any

TIMEOUT = "Timeout: simulation did not finish"
FAIL_TEXT = "Unexpected text found"
ASSERTION = re.compile(r"Error: \[(\d+)ns\] ([^\r\n]*)")
CONNECT = re.compile(r"Error connecting to \S+: ([^\r\n]*)")
HTTP_AUTH = re.compile(r"^(401|403)\b")
GIVING_UP = "Giving up"
LOST = "closed unexpectedly"
API_ERROR = re.compile(r"API Error: ([^\r\n]*)")
MISSING_TOKEN = "Missing WOKWI_CLI_TOKEN"
RETRY = "Will retry in"
CONNECTED = re.compile(r"Connected to Wokwi Simulation API (\S+)")
FIRST_ERROR = re.compile(r"(?:^|\n)(?:Error|error)[: ]([^\r\n]*)")

STATUS = {
    "passed": "pass",
    "virtual-timeout": "fail",
    "fail-text": "fail",
    "assertion-failed": "fail",
    "auth-failed": "error",
    "network-error": "error",
    "api-error": "error",
    "cli-failed": "error",
    "credential-missing": "blocked",
    "connection-lost": "incomplete",
    "stopped": "incomplete",
    "real-budget-exceeded": "incomplete",
    "output-limit": "incomplete",
    "interrupted": "incomplete",
}


def _remote(state: str, cancel: str) -> dict[str, Any]:
    return {"state": state, "confirmed": state == "not-started", "cancel": cancel}


def derive(exit_record: dict[str, Any] | None, stdout: str, stderr: str, timeout_ms: int) -> dict[str, Any]:
    """`{outcome, status, message, remote, reachedNs, connectRetries, api}` of one run."""
    text = stdout + "\n" + stderr
    connected = CONNECTED.search(stdout)
    retries = text.count(RETRY)
    reached: int | None = None
    requested = "connection-closed-requested"
    if exit_record is None:
        outcome, message, remote = "interrupted", "The helper ended before wokwi-cli's end was recorded (VERA's Stop or a crash).", _remote("unknown", "not-requested")
    else:
        reason, code = exit_record.get("reason"), exit_record.get("exitCode")
        assertion = ASSERTION.search(stderr)
        connect = CONNECT.search(stderr)
        api = API_ERROR.search(stderr)
        if reason == "not-started":
            outcome, message, remote = "cli-failed", stderr.strip()[:300] or "wokwi-cli could not be started.", _remote("not-started", "not-requested")
        elif reason == "real-budget":
            outcome, message, remote = "real-budget-exceeded", "The real-time budget ended before the simulation; wokwi-cli was asked to close its session.", _remote("unknown", requested)
        elif reason == "output-limit":
            outcome, message, remote = "output-limit", "The serial or CLI output exceeded its bound; wokwi-cli was asked to close its session.", _remote("unknown", requested)
        elif reason == "stopped":
            outcome, message, remote = "stopped", "The run was stopped; wokwi-cli was asked to close its session. Whether Wokwi ended the job is not confirmed.", _remote("unknown", requested)
        elif (isinstance(code, int) and code >= 128) or code is None:
            outcome, message, remote = "stopped", f"wokwi-cli ended by a signal or a crash (exit {code}) without a stop from wokwi-tool. Whether Wokwi ended the job is not confirmed.", _remote("unknown", "not-requested")
        elif code == 0:
            outcome, message, remote = "passed", "The simulation met its assertion.", _remote("closed-by-client", "not-requested")
        elif code == 42 and TIMEOUT in stderr:
            reached = timeout_ms * 1_000_000
            outcome, message, remote = "virtual-timeout", f"The assertion was not met within {timeout_ms} ms of simulated time.", _remote("closed-by-client", "not-requested")
        elif code == 1 and FAIL_TEXT in stderr:
            outcome, message, remote = "fail-text", "The serial output contained the fail text.", _remote("closed-by-client", "not-requested")
        elif code == 1 and assertion:
            reached = int(assertion.group(1))
            outcome, message, remote = "assertion-failed", assertion.group(2)[:500], _remote("closed-by-client", "not-requested")
        elif code == 1 and connect and HTTP_AUTH.match(connect.group(1)):
            outcome, message, remote = "auth-failed", f"Wokwi refused the token: {connect.group(1)[:200]}", _remote("not-started", "not-requested")
        elif code == 1 and (connect or GIVING_UP in text):
            outcome, message, remote = "network-error", f"wokwi-cli could not connect: {(connect.group(1) if connect else 'gave up after its retries')[:200]}", _remote("not-started", "not-requested")
        elif code == 1 and LOST in stderr:
            outcome, message, remote = "connection-lost", f"The connection to Wokwi was lost during the run: {(api.group(1) if api else '')[:200]}", _remote("unknown", "not-requested")
        elif code == 1 and api:
            outcome, message, remote = "api-error", f"Wokwi reported an error: {api.group(1)[:300]}", _remote("unknown", "not-requested")
        elif code == 1 and MISSING_TOKEN in stderr:
            outcome, message, remote = "credential-missing", "wokwi-cli received no token.", _remote("not-started", "not-requested")
        else:
            first = FIRST_ERROR.search(stderr)
            outcome = "cli-failed"
            message = f"wokwi-cli ended with exit {code}: {(first.group(1) if first else stderr.strip()[:200])[:300]}"
            remote = _remote("unknown", "not-requested")
    return {
        "outcome": outcome,
        "status": STATUS[outcome],
        "message": message,
        "remote": remote,
        "reachedNs": reached,
        "connectRetries": retries,
        "api": connected.group(1) if connected else None,
    }
