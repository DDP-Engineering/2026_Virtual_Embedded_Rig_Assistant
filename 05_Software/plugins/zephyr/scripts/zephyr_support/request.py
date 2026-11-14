"""The zephyr-request document (spec REQ-DATA-d8ecee6a section 2).

A request names everything a build depends on: the west workspace and its projects at exact revisions, the SDK
folder, the application, the exact board, the configuration and overlay files and the owned build folder. Nothing is
taken from the caller's environment or from defaults Zephyr would apply on its own.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path, PureWindowsPath
from typing import Any

from .errors import Refused
from .workspace import PathRefused, confined, control_free, inside, is_vera, regular_file

LIMIT_BYTES = 64 * 1024
FIELDS = {"format", "kind", "workspace", "manifest", "projects", "sdk", "app", "board", "configs", "extraConfigs",
          "overlays", "buildDir", "tests", "hooks"}
REQUIRED = {"format", "kind", "workspace", "manifest", "projects", "sdk", "app", "board", "configs", "buildDir"}
SHA1 = re.compile(r"[0-9a-f]{40}")
SHA256 = re.compile(r"[0-9a-f]{64}")
PROJECT = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}")
SCENARIO = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}")
BOARD = re.compile(r"([A-Za-z0-9][A-Za-z0-9_-]{0,63})(?:@([A-Za-z0-9._-]{1,32}))?((?:/[A-Za-z0-9_-]{1,64}){0,4})")


@dataclass(frozen=True)
class Hook:
    file: Path
    sha256: str
    reason: str


@dataclass
class Request:
    path: Path
    sha256: str
    content: dict[str, Any]
    workspace: Path
    manifest: str
    projects: dict[str, str]
    sdk: Path
    app: Path
    board: str
    board_name: str
    board_revision: str | None
    board_qualifiers: str | None
    configs: list[Path]
    extra_configs: list[Path]
    overlays: list[Path]
    build_dir: Path
    build_dir_text: str
    tests_root: Path | None = None
    scenarios: list[str] = field(default_factory=list)
    hooks: list[Hook] = field(default_factory=list)

    def inputs(self) -> list[tuple[str, Path]]:
        return ([("config", path) for path in self.configs] + [("extra-config", path) for path in self.extra_configs]
                + [("overlay", path) for path in self.overlays])


def _text(document: dict[str, Any], key: str, limit: int = 1024) -> str:
    value = document.get(key)
    if not isinstance(value, str) or not value or len(value) > limit or not control_free(value):
        raise Refused("request", f"The request field {key} must be a non-empty text of at most {limit} characters.")
    return value


def _folder(cwd: Path, raw: str, key: str) -> Path:
    """An existing folder named absolutely or relative to the workbench; never a network or device path."""
    if raw.startswith(("\\\\", "//")) or (os.name == "nt" and PureWindowsPath(raw).drive and not PureWindowsPath(raw).is_absolute()):
        raise Refused("request", f"The request field {key} must be a local absolute or workbench-relative path.")
    path = Path(raw) if Path(raw).is_absolute() else cwd / raw
    try:
        resolved = Path(os.path.realpath(path))
        if not resolved.is_dir():
            raise Refused("input", f"The {key} folder {raw[:200]} does not exist.")
    except OSError as error:
        raise Refused("input", f"The {key} folder {raw[:200]} cannot be read: {error.strerror or error}.") from error
    return resolved


def _files(document: dict[str, Any], key: str, app: Path, required: bool) -> list[Path]:
    value = document.get(key, [])
    if not isinstance(value, list) or len(value) > 16 or (required and not value):
        raise Refused("request", f"The request field {key} must be a list of at most 16 paths{' (at least one)' if required else ''}.")
    found: list[Path] = []
    for item in value:
        if not isinstance(item, str) or not item or not control_free(item) or Path(item).is_absolute() or ".." in Path(item).parts:
            raise Refused("request", f"{key} entries are paths relative to the application, without '..'.")
        path = Path(os.path.realpath(app / item))
        if not inside(app, path):
            raise Refused("request", f"{key} entry {item[:120]} resolves outside the application.")
        if not path.is_file():
            raise Refused("input", f"The {key} file {item[:120]} does not exist in the application.")
        if path in found:
            raise Refused("request", f"{key} lists {item[:120]} twice.")
        found.append(path)
    return found


def load(cwd: Path, spelled: Path, raw: str, needs_tests: bool = False) -> Request:
    try:
        path = regular_file(cwd, raw, "--request", spelled)
    except PathRefused as error:
        raise Refused("request", str(error)) from error
    data = path.read_bytes()[: LIMIT_BYTES + 1]
    if len(data) > LIMIT_BYTES:
        raise Refused("request", "The request is larger than 64 KiB.")
    try:
        document = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as error:
        raise Refused("request", "The request is not valid UTF-8 JSON.") from error
    if not isinstance(document, dict):
        raise Refused("request", "The request must be a JSON object.")
    if document.get("format") != 1 or document.get("kind") != "zephyr-request":
        raise Refused("request", "The request must have format 1 and kind zephyr-request.")
    unknown = sorted(set(document) - FIELDS)
    if unknown:
        raise Refused("request", f"The request has unknown fields: {', '.join(unknown[:8])}.")
    missing = sorted(REQUIRED - set(document))
    if missing:
        raise Refused("request", f"The request lacks the fields: {', '.join(missing)}.")

    workspace = _folder(cwd, _text(document, "workspace"), "workspace")
    manifest = _text(document, "manifest", 256)
    if Path(manifest).is_absolute() or ".." in Path(manifest).parts:
        raise Refused("request", "manifest is the manifest folder relative to the workspace, without '..'.")
    projects_raw = document.get("projects")
    if not isinstance(projects_raw, list) or not projects_raw or len(projects_raw) > 64:
        raise Refused("request", "projects must list between 1 and 64 projects.")
    projects: dict[str, str] = {}
    for item in projects_raw:
        if not isinstance(item, dict) or set(item) != {"name", "revision"}:
            raise Refused("request", "Each project is {name, revision}.")
        name, revision = item["name"], item["revision"]
        if not isinstance(name, str) or not PROJECT.fullmatch(name) or name in projects:
            raise Refused("request", f"Project name {str(name)[:64]!r} is invalid or repeated.")
        if not isinstance(revision, str) or not SHA1.fullmatch(revision):
            raise Refused("request", f"Project {name} needs its full 40-digit commit SHA as revision.")
        projects[name] = revision
    if "zephyr" not in projects:
        raise Refused("request", "projects must list the zephyr project.")
    sdk = _folder(cwd, _text(document, "sdk"), "sdk")
    app = _folder(cwd, _text(document, "app"), "app")
    board = _text(document, "board", 200)
    match = BOARD.fullmatch(board)
    if not match:
        raise Refused("board", f"The board {board[:80]!r} is not name[@revision][/qualifiers].")
    configs = _files(document, "configs", app, True)
    extra = _files(document, "extraConfigs", app, False)
    overlays = _files(document, "overlays", app, False)

    build_text = _text(document, "buildDir", 512)
    try:
        build_dir = confined(cwd, build_text, "buildDir", spelled)
    except PathRefused as error:
        raise Refused("build-dir", str(error)) from error
    relative_parts = build_dir.relative_to(cwd).parts if inside(cwd, build_dir) else ()
    if build_dir == cwd or any(is_vera(part) for part in relative_parts) or (relative_parts and relative_parts[0].casefold() == "embedded-lab-results"):
        raise Refused("build-dir", "buildDir must be a folder of its own inside the workbench, outside .vera and embedded-lab-results.")

    tests_root: Path | None = None
    scenarios: list[str] = []
    tests = document.get("tests")
    if tests is not None:
        if not isinstance(tests, dict) or set(tests) != {"root", "scenarios"}:
            raise Refused("request", "tests is {root, scenarios}.")
        tests_root = _folder(cwd, _text(tests, "root"), "tests.root")
        if not isinstance(tests["scenarios"], list) or not tests["scenarios"] or len(tests["scenarios"]) > 16:
            raise Refused("request", "tests.scenarios lists between 1 and 16 scenario names.")
        for item in tests["scenarios"]:
            if not isinstance(item, str) or not SCENARIO.fullmatch(item) or item in scenarios:
                raise Refused("request", "tests.scenarios entries are distinct scenario names.")
            scenarios.append(item)
    elif needs_tests:
        raise Refused("request", "test-build needs the request field tests {root, scenarios}.")

    for name, folder in (("workspace", workspace), ("sdk", sdk), ("app", app), ("tests.root", tests_root)):
        if folder is not None and (inside(folder, build_dir) or inside(build_dir, folder)):
            raise Refused("build-dir", f"buildDir must not lie inside or contain the {name} folder.")

    hooks: list[Hook] = []
    raw_hooks = document.get("hooks", [])
    if not isinstance(raw_hooks, list) or len(raw_hooks) > 32:
        raise Refused("request", "hooks lists at most 32 approvals.")
    for item in raw_hooks:
        if not isinstance(item, dict) or not {"file", "sha256"} <= set(item) <= {"file", "sha256", "reason"}:
            raise Refused("request", "Each hook is {file, sha256, reason?}.")
        if not isinstance(item["sha256"], str) or not SHA256.fullmatch(item["sha256"]):
            raise Refused("request", "A hook's sha256 is 64 lower-case hex digits.")
        file_text = item["file"]
        if not isinstance(file_text, str) or not file_text or not control_free(file_text):
            raise Refused("request", "A hook names its file.")
        file_path = Path(os.path.realpath(Path(file_text) if Path(file_text).is_absolute() else cwd / file_text))
        hooks.append(Hook(file_path, item["sha256"], str(item.get("reason", ""))[:200]))

    return Request(
        path=path, sha256=hashlib.sha256(data).hexdigest(), content=document, workspace=workspace, manifest=manifest,
        projects=projects, sdk=sdk, app=app, board=board, board_name=match.group(1), board_revision=match.group(2),
        board_qualifiers=match.group(3)[1:] or None, configs=configs, extra_configs=extra, overlays=overlays,
        build_dir=build_dir, build_dir_text=build_text, tests_root=tests_root, scenarios=scenarios, hooks=hooks,
    )


def fingerprint(request: Request, family: str) -> str:
    """The build folder's identity: everything that changes the build's output (spec section 6)."""
    data = {
        "family": family,
        "workspace": str(request.workspace),
        "projects": dict(sorted(request.projects.items())),
        "sdk": str(request.sdk),
        "app": str(request.app),
        "board": request.board,
        "configs": [str(path) for path in request.configs],
        "extraConfigs": [str(path) for path in request.extra_configs],
        "overlays": [str(path) for path in request.overlays],
        "tests": [str(request.tests_root), request.scenarios] if family == "test-build" else None,
    }
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode("utf-8")).hexdigest()
