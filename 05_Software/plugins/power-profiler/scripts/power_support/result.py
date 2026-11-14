"""The format 1 result document `power-result` and its run folder (spec REQ-DATA-dd3e4fe1 section 8)."""

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
from .errors import Problem, Refused
from .workspace import PathRefused, allowed_output, results_directory, utf16_length, valid_run_id

OUTPUT_LIMIT = 11000
DEFAULT_RESULTS = "embedded-lab-results"
ORDER = ["pass", "incomplete", "blocked", "error"]
EXIT = {"pass": 0, "incomplete": 3, "blocked": 2, "error": 4}
ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def now() -> str:
    moment = datetime.now(timezone.utc)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


def ulid() -> str:
    """A ULID-like run id: 48-bit milliseconds and 80 random bits in Crockford base 32."""
    value = (int(time.time() * 1000) << 80) | secrets.randbits(80)
    return "".join(ALPHABET[(value >> shift) & 31] for shift in range(125, -1, -5))


def emit(document: dict[str, Any]) -> None:
    text = json.dumps(document, ensure_ascii=False)
    if utf16_length(text) > OUTPUT_LIMIT:
        text = json.dumps({"format": 1, "kind": document.get("kind"), "operation": document.get("operation"),
                           "status": document.get("status"), "result": document.get("result"), "truncated": True})
    print(text)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class Result:
    def __init__(self, operation: str, run_id: str | None, tool: str) -> None:
        if run_id is not None and not valid_run_id(run_id):
            raise Refused("request", f"--run-id {run_id[:64]!r} is not a plain folder name.")
        self.document: dict[str, Any] = {
            "format": 1,
            "kind": "power-result",
            "operation": operation,
            "runId": run_id or ulid(),
            "status": "pass",
            "tool": {"name": tool, "version": VERSION},
            "started": now(),
            "ended": None,
            "problems": [],
            "inputs": {},
            "artifacts": [],
        }
        self.folder: Path | None = None
        self.cwd: Path | None = None
        self.files: list[Path] = []

    def __setitem__(self, key: str, value: Any) -> None:
        self.document[key] = value

    def __getitem__(self, key: str) -> Any:
        return self.document[key]

    def problem(self, code: str, message: str, status: str | None = None) -> None:
        entry = {"code": code, "message": message[:400]}
        if entry not in self.document["problems"]:
            self.document["problems"].append(entry)
        if status is not None:
            self.raise_status(status)

    def raise_status(self, status: str) -> None:
        if ORDER.index(status) > ORDER.index(self.document["status"]):
            self.document["status"] = status

    def fail(self, problem: Problem) -> None:
        self.problem(problem.code, problem.message, problem.status)

    def create_folder(self, cwd: Path, spelled: Path, raw: str | None) -> Path:
        """A new run folder `<results-dir>/<run-id>/`, never inside .vera, never an existing one."""
        base = self.results_base(cwd, spelled, raw)
        folder = base / str(self.document["runId"])
        try:
            folder.mkdir()
        except FileExistsError as error:
            raise Refused("request", f"The run folder {folder.name} exists already; choose another --run-id.") from error
        except OSError as error:
            raise Refused("request", f"The run folder cannot be created: {error.strerror or error}.") from error
        self.folder = folder
        self.cwd = cwd
        return folder

    @staticmethod
    def results_base(cwd: Path, spelled: Path, raw: str | None) -> Path:
        """The checked results directory, created when missing (checked again before the run folder is made)."""
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
        return base

    def write(self, name: str, text: str) -> Path:
        assert self.folder is not None
        path = self.folder / name
        with open(path, "x", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
        self.files.append(path)
        return path

    def finish(self) -> int:
        self.document["ended"] = now()
        if self.folder is not None and self.cwd is not None:
            for path in self.files:
                data = path.read_bytes()
                self.document["artifacts"].append({"path": path.name, "bytes": len(data),
                                                   "sha256": hashlib.sha256(data).hexdigest()})
            text = json.dumps(self.document, ensure_ascii=False, indent=1) + "\n"
            try:
                with open(self.folder / "result.json", "x", encoding="utf-8", newline="\n") as handle:
                    handle.write(text)
            except OSError as error:
                self.problem("request", f"result.json could not be written: {error.strerror or error}", "error")
        emit(self.summary())
        return EXIT[self.document["status"]]

    def summary(self) -> dict[str, Any]:
        """The printed document: bulky entries stay in result.json."""
        shown = {key: value for key, value in self.document.items() if key not in ("artifacts", "events", "gaps")}
        if self.folder is not None and self.cwd is not None:
            shown["result"] = Path(os.path.relpath(self.folder / "result.json", self.cwd)).as_posix()
        for key in ("gaps", "events"):
            if key in self.document:
                shown[key] = f"{len(self.document[key])} in result.json"
        for key in ("settings", "states", "inputs", "definitions"):
            if utf16_length(json.dumps(shown, ensure_ascii=False)) <= OUTPUT_LIMIT:
                break
            if key in shown:
                shown[key] = "see result.json"
                shown["truncated"] = True
        while utf16_length(json.dumps(shown, ensure_ascii=False)) > OUTPUT_LIMIT and shown["problems"]:
            shown["problems"] = shown["problems"][:-1]
            shown["truncated"] = True
        return shown
