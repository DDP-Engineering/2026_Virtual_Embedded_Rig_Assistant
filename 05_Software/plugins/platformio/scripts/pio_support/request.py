"""The platformio-request document (spec REQ-DATA-865c8fbd section 2, REQ-REL-6548e65a).

A request names everything an operation depends on: the project folder, the environment, the PlatformIO core folder
and the owned build folder, plus the test suites, the host toolchain and approved hooks where they apply. Nothing is
taken from the caller's environment or from the project's own defaults (default_envs).
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
FIELDS = {"format", "kind", "project", "environment", "core", "buildDir", "tests", "hostToolchain", "upload", "hooks"}
REQUIRED = {"format", "kind", "project", "core", "buildDir"}
SHA256 = re.compile(r"[0-9a-f]{64}")
ENVIRONMENT = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,63}")
SUITE = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}(?:/[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}){0,3}")


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
    project: Path
    environment: str | None
    core: Path
    build_dir: Path
    build_dir_text: str
    tests: list[str] = field(default_factory=list)
    host_toolchain: Path | None = None
    upload: bool = False
    hooks: list[Hook] = field(default_factory=list)

    def env(self) -> str:
        """The environment of an environment-specific operation (checked by `load(needs_environment=True)`)."""
        assert self.environment is not None
        return self.environment

    @property
    def libdeps(self) -> Path:
        return self.build_dir / "libdeps"

    def workspace(self, family: str) -> Path:
        return self.build_dir / family

    def described(self) -> dict[str, Any]:
        return {"path": str(self.path), "sha256": self.sha256, "content": self.content}


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


def load(cwd: Path, spelled: Path, raw: str, needs_environment: bool = False, needs_tests: bool = False) -> Request:
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
    if document.get("format") != 1 or document.get("kind") != "platformio-request":
        raise Refused("request", "The request must have format 1 and kind platformio-request.")
    unknown = sorted(set(document) - FIELDS)
    if unknown:
        raise Refused("request", f"The request has unknown fields: {', '.join(unknown[:8])}.")
    missing = sorted(REQUIRED - set(document))
    if missing:
        raise Refused("request", f"The request lacks the fields: {', '.join(missing)}.")

    project = _folder(cwd, _text(document, "project"), "project")
    if not (project / "platformio.ini").is_file():
        raise Refused("input", f"The project folder {document['project'][:200]} has no platformio.ini.")
    environment = document.get("environment")
    if environment is not None and (not isinstance(environment, str) or not ENVIRONMENT.fullmatch(environment)):
        raise Refused("request", "environment is the NAME of one [env:NAME] section.")
    if needs_environment and environment is None:
        raise Refused("environment", "This operation needs the request field environment; VERA never uses the "
                      "project's default_envs or acts on every environment.")
    core = _folder(cwd, _text(document, "core"), "core")

    build_text = _text(document, "buildDir", 512)
    if Path(build_text).is_absolute() or PureWindowsPath(build_text).drive:
        raise Refused("build-dir", "buildDir is a workbench-relative folder.")
    try:
        build_dir = confined(cwd, build_text, "buildDir", spelled)
    except PathRefused as error:
        raise Refused("build-dir", str(error)) from error
    parts = build_dir.relative_to(cwd).parts if inside(cwd, build_dir) else ()
    if build_dir == cwd or any(is_vera(part) for part in parts) or (parts and parts[0].casefold() == "embedded-lab-results"):
        raise Refused("build-dir", "buildDir must be a folder of its own inside the workbench, outside .vera and embedded-lab-results.")
    for name, folder in (("project", project), ("core", core)):
        if inside(folder, build_dir) or inside(build_dir, folder):
            raise Refused("build-dir", f"buildDir must not lie inside or contain the {name} folder.")

    tests: list[str] = []
    raw_tests = document.get("tests")
    if raw_tests is not None:
        if not isinstance(raw_tests, list) or not raw_tests or len(raw_tests) > 16:
            raise Refused("request", "tests lists between 1 and 16 test suite names.")
        for item in raw_tests:
            if not isinstance(item, str) or not SUITE.fullmatch(item) or item in tests or ".." in item.split("/"):
                raise Refused("request", "tests entries are distinct suite folder names below the project's test folder.")
            tests.append(item)
    elif needs_tests:
        raise Refused("request", "This operation needs the request field tests: the suites to run, by name.")

    upload = document.get("upload", False)
    if not isinstance(upload, bool):
        raise Refused("request", "upload is true or false: whether prepare-packages installs the uploaders.")
    toolchain: Path | None = None
    if document.get("hostToolchain") is not None:
        toolchain = _folder(cwd, _text(document, "hostToolchain"), "hostToolchain")

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

    return Request(path=path, sha256=hashlib.sha256(data).hexdigest(), content=document, project=project,
                   environment=environment, core=core, build_dir=build_dir, build_dir_text=build_text, tests=tests,
                   host_toolchain=toolchain, upload=upload, hooks=hooks)


def fingerprint(request: Request) -> str:
    """The build folder's identity (spec section 6): project, environment and core folder."""
    data = {"project": os.path.normcase(str(request.project)), "environment": request.environment,
            "core": os.path.normcase(str(request.core))}
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode("utf-8")).hexdigest()
