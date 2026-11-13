"""The format 1 result document and its run folder (spec REQ-DATA-b3e2930f section 4)."""

from __future__ import annotations

import hashlib
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import VERSION
from .errors import Problem, Refused
from .workspace import PathRefused, allowed_output, results_directory, utf16_length

OUTPUT_LIMIT = 11000
SAFE_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}")
DEFAULT_RESULTS = "embedded-lab-results"


def now() -> str:
    moment = datetime.now(timezone.utc)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


class Result:
    def __init__(self, operation: str, run_id: str | None) -> None:
        self.document: dict[str, Any] = {
            "format": 1,
            "kind": "scpi-result",
            "tool": {"name": "scpi-instruments", "version": VERSION},
            "operation": operation,
            "runId": run_id,
            "started": now(),
            "finished": None,
            "status": "pass",
            "problems": [],
            "artifacts": [],
        }
        self.folder: Path | None = None
        self.cwd: Path | None = None

    def __setitem__(self, key: str, value: Any) -> None:
        self.document[key] = value

    def __getitem__(self, key: str) -> Any:
        return self.document[key]

    def problem(self, code: str, message: str) -> None:
        if not any(item["code"] == code and item["message"] == message for item in self.document["problems"]):
            self.document["problems"].append({"code": code, "message": message[:400]})

    def fail(self, problem: Problem) -> None:
        self.problem(problem.code, problem.message)
        order = ["pass", "fail", "incomplete", "blocked", "error"]
        if order.index(problem.status) > order.index(self.document["status"]):
            self.document["status"] = problem.status

    def create_folder(self, cwd: Path, spelled: Path, raw: str | None) -> None:
        """A new run folder `<results-dir>/<run-id>/`, never inside .vera, never an existing one."""
        try:
            base = results_directory(cwd, raw or DEFAULT_RESULTS, spelled)
        except PathRefused as error:
            raise Refused("request", str(error)) from error
        base.mkdir(parents=True, exist_ok=True)
        if not allowed_output(cwd, base):
            raise Refused("request", "--results-dir resolves outside the working directory or inside .vera.")
        folder = base / str(self.document["runId"])
        try:
            folder.mkdir()
        except FileExistsError as error:
            raise Refused("request", f"The run folder {folder.name} exists already; choose another --run-id.") from error
        self.folder = folder
        self.cwd = cwd

    def write(self, name: str, data: bytes) -> str:
        assert self.folder is not None and self.cwd is not None
        if not SAFE_NAME.fullmatch(name):
            raise Refused("request", f"{name[:64]!r} is not a plain file name.")
        path = self.folder / name
        with open(path, "xb") as handle:
            handle.write(data)
        shown = Path(os.path.relpath(path, self.cwd)).as_posix()
        self.document["artifacts"].append(
            {"path": shown, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
        )
        return shown

    def finish(self, exit_code: int) -> int:
        self.document["finished"] = now()
        if self.folder is not None:
            text = json.dumps(self.document, ensure_ascii=False, indent=2) + "\n"
            try:
                with open(self.folder / "result.json", "x", encoding="utf-8", newline="\n") as handle:
                    handle.write(text)
            except OSError as error:
                self.problem("request", f"result.json could not be written: {error.strerror or error}")
                exit_code = max(exit_code, 3)
        emit(self.summary())
        return exit_code

    def summary(self) -> dict[str, Any]:
        """The printed document: bulky lists are left to result.json."""
        shown = {key: value for key, value in self.document.items() if key not in ("commands",)}
        if self.folder is not None and self.cwd is not None:
            shown["result"] = Path(os.path.relpath(self.folder / "result.json", self.cwd)).as_posix()
        for key in ("values", "settings", "outputs", "channels", "entries", "local"):
            if utf16_length(json.dumps(shown, ensure_ascii=False)) <= OUTPUT_LIMIT:
                break
            if isinstance(shown.get(key), list):
                shown[key] = f"{len(self.document[key])} entries in result.json"
                shown["truncated"] = True
        while utf16_length(json.dumps(shown, ensure_ascii=False)) > OUTPUT_LIMIT and shown["problems"]:
            shown["problems"] = shown["problems"][:-1]
            shown["truncated"] = True
        return shown


def emit(document: dict[str, Any]) -> None:
    text = json.dumps(document, ensure_ascii=False)
    while utf16_length(text) > OUTPUT_LIMIT:
        text = json.dumps({"format": 1, "kind": "scpi-result", "status": document.get("status"), "truncated": True})
    print(text)
