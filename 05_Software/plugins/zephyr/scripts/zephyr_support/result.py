"""Run folders, the progressive zephyr-result document and supervised steps (spec REQ-DATA-d8ecee6a section 7).

A run folder `embedded-lab-results/<run-id>/` is created exclusively once every check passed. result.json is written
at once with state `running`, rewritten with a heartbeat while a step runs and finally with state `done`. Build and
test runs reserve no bench resource, so VERA's Stop and timeout kill the process tree at once: a `running` document
whose heartbeat is older than STALE_SECONDS reads as `stopped` (REQ-REL-274a88e6).
"""

from __future__ import annotations

import hashlib
import json
import os
import secrets
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import VERSION
from .errors import Refused
from .workspace import PathRefused, allowed_output, relative, results_directory, utf16_length

OUTPUT_LIMIT = 11000
DEFAULT_RESULTS = "embedded-lab-results"
ORDER = ["pass", "skipped", "incomplete", "fail", "stopped", "error", "blocked"]
EXIT = {"pass": 0, "skipped": 3, "incomplete": 3, "fail": 1, "stopped": 3, "error": 3, "blocked": 3}
ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
HEARTBEAT_SECONDS = 2.0
STALE_SECONDS = 90.0


def now() -> str:
    moment = datetime.now(timezone.utc)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


def parse_time(text: str | None) -> float | None:
    try:
        return datetime.strptime(str(text), "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc).timestamp()
    except ValueError:
        return None


def ulid() -> str:
    """A ULID-like run id: 48-bit milliseconds and 80 random bits in Crockford base 32."""
    value = (int(time.time() * 1000) << 80) | secrets.randbits(80)
    return "".join(ALPHABET[(value >> shift) & 31] for shift in range(125, -1, -5))


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def emit(document: dict[str, Any]) -> None:
    """Prints one JSON line within VERA's output limit (the full document stays in result.json)."""
    text = json.dumps(document, ensure_ascii=False)
    if utf16_length(text) > OUTPUT_LIMIT:
        keep = ("format", "kind", "operation", "runId", "status", "code", "reason", "result")
        text = json.dumps({key: document.get(key) for key in keep} | {"truncated": True}, ensure_ascii=False)
    print(text)


def refuse(error: Refused, operation: str) -> int:
    document: dict[str, Any] = {"format": 1, "kind": "zephyr-result", "operation": operation, "status": "refused",
                                "code": error.code, "reason": error.message}
    if error.detail:
        document["detail"] = error.detail
    emit(document)
    return 2


def read_run(folder: Path) -> dict[str, Any]:
    """A run folder's result.json; an unfinished run with a stale heartbeat reads as stopped."""
    try:
        document = json.loads((folder / "result.json").read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise Refused("evidence", f"{folder.name}/result.json cannot be read.") from error
    if not isinstance(document, dict) or document.get("format") != 1:
        raise Refused("evidence", f"{folder.name}/result.json is not a format 1 result.")
    if document.get("state") == "running":
        beat = parse_time(document.get("heartbeat"))
        if beat is None or time.time() - beat > STALE_SECONDS:
            document["status"] = "stopped"
            document["code"] = "interrupted"
            document["reason"] = "The run ended without finishing its result (stopped or killed)."
    return document


class Run:
    """A run folder and its progressively written result.json."""

    def __init__(self, operation: str, evidence: str) -> None:
        self.started = time.monotonic()
        self.last_write = 0.0
        self.document: dict[str, Any] = {
            "format": 1,
            "kind": "zephyr-result",
            "operation": operation,
            "runId": ulid(),
            "state": "running",
            "status": "pass",
            "code": None,
            "reason": None,
            "started": now(),
            "ended": None,
            "heartbeat": now(),
            "evidence": evidence,
            "tools": None,
            "request": None,
            "workspace": None,
            "board": None,
            "inputs": [],
            "buildDir": None,
            "artifacts": [],
            "size": None,
            "diagnostics": [],
            "findings": [],
            "steps": [],
        }
        self.folder: Path | None = None
        self.cwd: Path | None = None

    def __getitem__(self, key: str) -> Any:
        return self.document[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.document[key] = value

    def set_status(self, status: str, code: str | None = None, reason: str | None = None) -> None:
        """Raises the status when `status` is more severe; the first code and reason of that status stay."""
        current = self.document["status"]
        if ORDER.index(status) > ORDER.index(current) or (status == current and self.document["code"] is None and code):
            self.document["status"] = status
            self.document["code"] = code
            self.document["reason"] = reason[:400] if reason else None

    def create_folder(self, cwd: Path, spelled: Path, raw: str | None) -> Path:
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
        except OSError as error:
            raise Refused("request", f"The run folder cannot be created: {error.strerror or error}.") from error
        self.folder = folder
        self.cwd = cwd
        self.write(force=True)
        return folder

    def write(self, force: bool = False) -> None:
        if self.folder is None:
            return
        moment = time.monotonic()
        if not force and moment - self.last_write < HEARTBEAT_SECONDS:
            return
        self.last_write = moment
        self.document["heartbeat"] = now()
        text = json.dumps(self.document, ensure_ascii=False, indent=2) + "\n"
        temporary = self.folder / "result.json.tmp"
        try:
            with open(temporary, "w", encoding="utf-8", newline="\n") as handle:
                handle.write(text)
            os.replace(temporary, self.folder / "result.json")
        except OSError:
            pass

    def step(self, name: str, argv: list[str], cwd: Path, env: dict[str, str]) -> tuple[int, Path]:
        """Runs one process with its output in `<name>.log`, closed stdin, no shell; returns the exit code."""
        assert self.folder is not None
        log = self.folder / f"{name}.log"
        entry: dict[str, Any] = {"name": name, "command": [str(part) for part in argv], "cwd": str(cwd),
                                 "exit": None, "log": log.name, "seconds": None}
        self.document["steps"].append(entry)
        self.write(force=True)
        begun = time.monotonic()
        with open(log, "wb") as handle:
            try:
                process = subprocess.Popen(argv, cwd=cwd, env=env, stdin=subprocess.DEVNULL, stdout=handle,
                                           stderr=subprocess.STDOUT)
            except OSError as error:
                handle.write(f"cannot start {argv[0]}: {error.strerror or error}\n".encode())
                entry["exit"] = -1
                return -1, log
            while process.poll() is None:
                time.sleep(0.25)
                self.write()
        entry["exit"] = process.returncode
        entry["seconds"] = round(time.monotonic() - begun, 3)
        self.write(force=True)
        return process.returncode, log

    def finish(self, summary: dict[str, Any] | None = None) -> int:
        self.document["state"] = "done"
        self.document["ended"] = now()
        self.write(force=True)
        shown = {key: self.document[key] for key in ("format", "kind", "operation", "runId", "status", "code",
                                                       "reason", "evidence")}
        if self.folder is not None and self.cwd is not None:
            shown["result"] = relative(self.cwd, self.folder / "result.json")
        shown.update(summary or {})
        emit(shown)
        return EXIT[self.document["status"]]

    def tool_version(self) -> str:
        return VERSION
