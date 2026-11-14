"""The format 1 renode-result document and its run folder (spec REQ-DATA-8a943977 section 7, REQ-FUNC-9431b520).

The document is written when the run folder is created (state `running`), rewritten when the engine starts, when each
case starts and ends and after a slice once 2 real seconds have passed (`heartbeat`), and finally with state `done`. A run that VERA stops or kills therefore leaves an
identified partial result, which `report` completes (REQ-REL-c7579edf).
"""

from __future__ import annotations

import hashlib
import json
import os
import secrets
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import VERSION
from .errors import Refused
from .workspace import (
    PathRefused,
    allowed_output,
    relative,
    results_directory,
    utf16_length,
    valid_run_id,
)

OUTPUT_LIMIT = 11000
DEFAULT_RESULTS = "embedded-lab-results"
# Run status precedence (spec section 7): the most severe wins.
ORDER = ["pass", "incomplete", "fail", "timeout", "stopped", "error", "blocked"]
EXIT = {"pass": 0, "fail": 1, "timeout": 1, "incomplete": 3, "blocked": 3, "error": 3, "stopped": 3}
ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
HEARTBEAT_SECONDS = 2.0
LINES_KEPT = 2000
NOT_COVERED = [
    "real electrical timing (signal edges, clock accuracy, interrupt latency of the real chip)",
    "analog power consumption (no current or energy is measured by a simulation)",
    "EMI and other physical effects",
    "the behavior of the analog circuit (SPICE) around the microcontroller",
    "peripherals without a model in the profile",
]


def now() -> str:
    moment = datetime.now(timezone.utc)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


def ulid() -> str:
    """A ULID-like run id: 48-bit milliseconds and 80 random bits in Crockford base 32."""
    value = (int(time.time() * 1000) << 80) | secrets.randbits(80)
    return "".join(ALPHABET[(value >> shift) & 31] for shift in range(125, -1, -5))


def worst(*statuses: str) -> str:
    return max(statuses, key=ORDER.index)


def emit(document: dict[str, Any]) -> None:
    text = json.dumps(document, ensure_ascii=False)
    if utf16_length(text) > OUTPUT_LIMIT:
        text = json.dumps({key: document.get(key) for key in ("format", "kind", "operation", "status", "code", "reason", "result")}
                          | {"truncated": True}, ensure_ascii=False)
    print(text)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


class Run:
    """A run folder and its progressively written result.json."""

    def __init__(self, operation: str, run_id: str | None, label: str | None) -> None:
        if run_id is not None and not valid_run_id(run_id):
            raise Refused("request", f"--run-id {run_id[:64]!r} is not a plain folder name.")
        self.started = time.monotonic()
        self.last_write = 0.0
        self.document: dict[str, Any] = {
            "format": 1,
            "kind": "renode-result",
            "tool": {"name": "renode-sim", "version": VERSION},
            "operation": operation,
            "runId": run_id or ulid(),
            "label": label,
            "state": "running",
            "status": "pass",
            "code": None,
            "reason": None,
            "started": now(),
            "ended": None,
            "heartbeat": now(),
            "engine": None,
            "profile": None,
            "firmware": None,
            "testSet": None,
            "budgets": {},
            "time": {"virtualSeconds": 0.0, "engineVirtual": None, "realSeconds": 0.0},
            "uart": None,
            "cases": [],
            "unmodeled": [],
            "coverage": {
                "evidence": "virtual",
                "simulated": [],
                "notCovered": list(NOT_COVERED),
                "statement": "Virtual seconds are what the engine simulated and real seconds are wall-clock time; "
                "neither is physical timing on hardware, and no power consumption was measured.",
            },
            "artifacts": {},
        }
        self.folder: Path | None = None
        self.cwd: Path | None = None

    def __getitem__(self, key: str) -> Any:
        return self.document[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.document[key] = value

    def set_status(self, status: str, code: str | None = None, reason: str | None = None) -> None:
        """Raises the run status to `status` when it is more severe; the first code and reason of that status stay."""
        current = self.document["status"]
        if ORDER.index(status) > ORDER.index(current) or (status == current and self.document["code"] is None and code):
            self.document["status"] = status
            self.document["code"] = code
            self.document["reason"] = reason[:400] if reason else None

    def create_folder(self, cwd: Path, spelled: Path, raw: str | None) -> Path:
        """A new run folder `<results-dir>/<run-id>/`, never inside .vera, never an existing one."""
        try:
            base = results_directory(cwd, raw or DEFAULT_RESULTS, spelled)
        except PathRefused as error:
            raise Refused("request", str(error)) from error
        try:
            base.mkdir(parents=True, exist_ok=True)
        except OSError as error:
            raise Refused("request", f"--results-dir cannot be created: {error.strerror or error}.") from error
        if not allowed_output(cwd, base):
            raise Refused("request", "--results-dir resolves outside the working directory or inside .vera.")
        folder = base / str(self.document["runId"])
        try:
            folder.mkdir()
        except FileExistsError as error:
            raise Refused("request", f"The run folder {folder.name} exists already; choose another --run-id.") from error
        except OSError as error:
            raise Refused("request", f"The run folder cannot be created: {error.strerror or error}.") from error
        self.folder = folder
        self.cwd = cwd
        self.write(force=True)
        return folder

    def elapsed(self) -> float:
        return time.monotonic() - self.started

    def write(self, force: bool = False) -> None:
        """Rewrites result.json (atomically) when forced or after the heartbeat interval."""
        if self.folder is None:
            return
        moment = time.monotonic()
        if not force and moment - self.last_write < HEARTBEAT_SECONDS:
            return
        self.last_write = moment
        self.document["heartbeat"] = now()
        self.document["time"]["realSeconds"] = round(self.elapsed(), 3)
        text = json.dumps(self.document, ensure_ascii=False, indent=2) + "\n"
        temporary = self.folder / "result.json.tmp"
        try:
            with open(temporary, "w", encoding="utf-8", newline="\n") as handle:
                handle.write(text)
            os.replace(temporary, self.folder / "result.json")
        except OSError:
            pass

    def finish(self) -> int:
        self.document["state"] = "done"
        self.document["ended"] = now()
        if self.folder is not None:
            artifacts = {}
            for path in sorted(self.folder.rglob("*")):
                if path.is_file() and path.name not in ("result.json", "result.json.tmp"):
                    try:
                        artifacts[path.relative_to(self.folder).as_posix()] = sha256(path)
                    except OSError:
                        continue
            self.document["artifacts"] = artifacts
        self.write(force=True)
        emit(self.summary())
        return EXIT[self.document["status"]]

    def summary(self) -> dict[str, Any]:
        """The printed document: the UART lines, steps and artifacts stay in result.json."""
        doc = self.document
        shown: dict[str, Any] = {
            key: doc[key] for key in ("format", "kind", "operation", "runId", "status", "code", "reason", "time", "unmodeled")
        }
        if self.folder is not None and self.cwd is not None:
            shown["result"] = relative(self.cwd, self.folder / "result.json")
        if doc.get("firmware"):
            shown["firmware"] = {k: doc["firmware"].get(k) for k in ("path", "sha256", "buildId")}
        if doc.get("profile"):
            shown["profile"] = doc["profile"].get("id")
        shown["cases"] = [{k: case.get(k) for k in ("id", "requirement", "status", "code", "reason", "virtualSeconds")}
                          for case in doc["cases"]]
        if doc.get("uart"):
            lines = doc["uart"].get("lines", [])
            shown["uart"] = {"name": doc["uart"].get("name"), "lines": len(lines), "first": [line["text"] for line in lines[:8]]}
        shown["evidence"] = "virtual: a simulation on the profile's model, not a hardware test"
        while utf16_length(json.dumps(shown, ensure_ascii=False)) > OUTPUT_LIMIT and shown["cases"]:
            shown["cases"] = shown["cases"][:-1]
            shown["truncated"] = True
        return shown
