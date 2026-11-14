"""The project manifest `vera-pi.json` and its files (spec REQ-DATA-44547a17 section 3).

Paths are judged by their text first (the remote helper judges them again): relative, `/`-separated, no `.` or `..`
segment, no control character or backslash, never VERA's `.vera-pi` state folder. Spaces and shell characters are
ordinary characters: nothing on the board passes them through a shell.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import stat
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from . import PROJECT_KIND, workspace
from .report import refused

MANIFEST_BYTES = 256 * 1024
FILES = 512
FILE_BYTES = 16 * 1024 * 1024
TOTAL_BYTES = 64 * 1024 * 1024
# The longest task budget: pi-tool waits at most 30 s more, within the 3600 s limit of a VERA run.
BUDGET_S = 3500
SEGMENT = re.compile(r"[^/\\\x00-\x1f\x7f]{1,128}")
NAME = re.compile(r"[a-z0-9][a-z0-9-]{0,63}")
TASK = re.compile(r"[a-z0-9][a-z0-9-]{0,31}")
UNIT = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.@-]{0,118}\.service")
KEYS = {"format", "kind", "name", "files", "exclude", "hardware", "tasks", "services"}
TASK_KEYS = {"argv", "budgetS", "outputLimitBytes", "extraArgs", "actuates", "note"}
SERVICE_KEYS = {"keepRunning", "actuates", "note"}


@dataclass(frozen=True)
class File:
    path: str
    absolute: Path
    size: int
    sha256: str
    mode: str

    def entry(self) -> dict[str, Any]:
        return {"path": self.path, "size": self.size, "sha256": self.sha256, "mode": self.mode}


@dataclass(frozen=True)
class Project:
    name: str
    manifest: Path
    shown: str
    sha256: str
    files: tuple[File, ...]
    tasks: dict[str, dict[str, Any]]
    services: dict[str, dict[str, Any]]
    hardware: dict[str, Any]

    def summary(self) -> dict[str, Any]:
        return {"name": self.name, "manifest": self.shown, "sha256": self.sha256}


def check_path(path: object, where: str) -> list[str]:
    if not isinstance(path, str) or not path or len(path) > 1024:
        raise refused("path", f"{where} must be a relative path of 1 to 1024 characters.")
    segments = path.split("/")
    if len(segments) > 8 or any(not SEGMENT.fullmatch(part) or part in (".", "..") for part in segments):
        raise refused("path", f"{where} {path[:120]!r} must be relative, '/'-separated, without '.', '..', backslashes or control characters, at most 8 segments.")
    if segments[0].startswith(".vera-pi"):
        raise refused("path", f"{where} {path[:120]!r} would lie in VERA's .vera-pi state folder on the board.")
    return segments


def _mode(path: Path, info: os.stat_result) -> str:
    if os.name != "nt":
        return "0755" if info.st_mode & 0o111 else "0644"
    # Windows keeps no executable bit: a shell script, a script with #! or an ELF binary is executable on the board.
    if path.suffix.lower() == ".sh":
        return "0755"
    try:
        with path.open("rb") as handle:
            head = handle.read(4)
            return "0755" if head[:2] == b"#!" or head == b"\x7fELF" else "0644"
    except OSError:
        return "0644"


def _hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _collect(folder: Path, entries: list[str], exclude: set[str]) -> list[File]:
    found: dict[str, File] = {}

    def add(relative: str) -> None:
        segments = check_path(relative, "A project file")
        if any(part in exclude for part in segments):
            return
        absolute = folder.joinpath(*segments)
        try:
            info = absolute.lstat()
        except OSError as error:
            raise refused("path", f"The project file {relative[:120]!r} cannot be read: {error.strerror or error}.") from error
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode) or os.path.realpath(absolute) != os.path.abspath(absolute):
            raise refused("path", f"The project file {relative[:120]!r} is not a regular file inside the project folder (links are refused).")
        if info.st_size > FILE_BYTES:
            raise refused("path", f"The project file {relative[:120]!r} is larger than 16 MiB.")
        if relative not in found:
            found[relative] = File(relative, absolute, info.st_size, _hash(absolute), _mode(absolute, info))
        if len(found) > FILES:
            raise refused("manifest", f"A project deploys at most {FILES} files.")

    for entry in entries:
        segments = check_path(entry, "files[]")
        absolute = folder.joinpath(*segments)
        if absolute.is_dir() and not absolute.is_symlink():
            if os.path.realpath(absolute) != os.path.abspath(absolute):
                raise refused("path", f"The project folder {entry[:120]!r} lies behind a link.")
            for current, dirs, names in os.walk(absolute, followlinks=False):
                dirs[:] = sorted(name for name in dirs if name not in exclude)
                for name in sorted(names):
                    add(Path(os.path.relpath(Path(current) / name, folder)).as_posix())
        else:
            add(entry)
    total = sum(item.size for item in found.values())
    if total > TOTAL_BYTES:
        raise refused("manifest", "A project deploys at most 64 MiB.")
    if not found:
        raise refused("manifest", "The project lists no file.")
    return sorted(found.values(), key=lambda item: item.path)


def _flag(raw: dict, key: str, where: str) -> bool:
    value = raw.get(key, False)
    if not isinstance(value, bool):
        raise refused("manifest", f"{where}.{key} must be true or false.")
    return value


def _note(raw: dict, where: str) -> str:
    note = raw.get("note", "")
    if not isinstance(note, str) or len(note) > 256:
        raise refused("manifest", f"{where}.note must be text of at most 256 characters.")
    return note


def load(cwd: Path, spelled: Path, raw_path: str) -> Project:
    try:
        manifest = workspace.regular_file(cwd, raw_path, "--project", spelled)
    except workspace.PathRefused as error:
        raise refused("path", str(error)) from error
    data = manifest.read_bytes()
    if len(data) > MANIFEST_BYTES:
        raise refused("manifest", "vera-pi.json is larger than 256 KiB.")
    try:
        document = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise refused("manifest", f"{raw_path[:120]} is not valid UTF-8 JSON.") from error
    if not isinstance(document, dict) or document.get("format") != 1 or document.get("kind") != PROJECT_KIND:
        raise refused("manifest", f"The project manifest must be {{format: 1, kind: {PROJECT_KIND}, ...}}.")
    if not set(document) <= KEYS:
        raise refused("manifest", f"The project manifest has unknown fields {', '.join(sorted(set(document) - KEYS))}.")
    name = document.get("name")
    if not isinstance(name, str) or not NAME.fullmatch(name):
        raise refused("manifest", "name must match [a-z0-9][a-z0-9-]{0,63}.")
    entries = document.get("files")
    if not isinstance(entries, list) or not 1 <= len(entries) <= FILES:
        raise refused("manifest", f"files lists 1 to {FILES} paths.")
    exclude = document.get("exclude", [])
    if not isinstance(exclude, list) or len(exclude) > 32 or not all(isinstance(item, str) and SEGMENT.fullmatch(item) for item in exclude):
        raise refused("manifest", "exclude lists at most 32 file or folder names.")
    hardware = document.get("hardware", {})
    if not isinstance(hardware, dict) or not set(hardware) <= {"actuates", "note"}:
        raise refused("manifest", "hardware is {actuates, note}.")
    hardware = {"actuates": _flag(hardware, "actuates", "hardware"), "note": _note(hardware, "hardware")}
    files = _collect(manifest.parent, entries, set(exclude))
    listed = {item.path for item in files}
    tasks: dict[str, dict[str, Any]] = {}
    raw_tasks = document.get("tasks", {})
    if not isinstance(raw_tasks, dict) or len(raw_tasks) > 16:
        raise refused("manifest", "tasks holds at most 16 tasks.")
    for task, raw in raw_tasks.items():
        where = f"tasks.{task}"
        if not TASK.fullmatch(task) or not isinstance(raw, dict) or not set(raw) <= TASK_KEYS:
            raise refused("manifest", f"{where} must be named [a-z0-9][a-z0-9-]{{0,31}} and hold only {', '.join(sorted(TASK_KEYS))}.")
        argv = raw.get("argv")
        if not isinstance(argv, list) or not 1 <= len(argv) <= 32 or not all(isinstance(a, str) and 0 < len(a) <= 1024 and "\x00" not in a for a in argv):
            raise refused("manifest", f"{where}.argv is 1 to 32 arguments of 1 to 1024 characters.")
        if argv[0] != "python3":
            if argv[0] not in listed:
                raise refused("command-not-allowed", f"{where} runs {argv[0][:120]!r}: a task runs python3 or a file the project deploys, never sudo, a shell or a system program.")
        budget, limit = raw.get("budgetS"), raw.get("outputLimitBytes", 1024 * 1024)
        if not isinstance(budget, int) or isinstance(budget, bool) or not 1 <= budget <= BUDGET_S:
            raise refused("manifest", f"{where}.budgetS is 1 to {BUDGET_S} seconds.")
        if not isinstance(limit, int) or isinstance(limit, bool) or not 1024 <= limit <= FILE_BYTES:
            raise refused("manifest", f"{where}.outputLimitBytes is 1024 to 16777216.")
        tasks[task] = {"argv": argv, "budgetS": budget, "outputLimitBytes": limit, "extraArgs": _flag(raw, "extraArgs", where), "actuates": _flag(raw, "actuates", where), "note": _note(raw, where)}
    services: dict[str, dict[str, Any]] = {}
    raw_services = document.get("services", {})
    if not isinstance(raw_services, dict) or len(raw_services) > 8:
        raise refused("manifest", "services holds at most 8 user units.")
    for unit, raw in raw_services.items():
        where = f"services.{unit[:64]}"
        if not UNIT.fullmatch(unit) or not isinstance(raw, dict) or not set(raw) <= SERVICE_KEYS:
            raise refused("manifest", f"{where} must be a user unit name ending in .service holding only {', '.join(sorted(SERVICE_KEYS))}.")
        services[unit] = {"keepRunning": _flag(raw, "keepRunning", where), "actuates": _flag(raw, "actuates", where), "note": _note(raw, where)}
    return Project(name, manifest, workspace.relative(cwd, manifest), hashlib.sha256(data).hexdigest(), tuple(files), tasks, services, hardware)
