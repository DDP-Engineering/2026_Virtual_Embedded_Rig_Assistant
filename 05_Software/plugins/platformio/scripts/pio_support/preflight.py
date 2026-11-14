"""Preflight of a PlatformIO project (spec REQ-DATA-865c8fbd section 4, REQ-SEC-17266b8a).

PlatformIO runs project code in several places: SCons extra scripts, library extra scripts, a custom test runner, a
custom testing or upload command, flag values beginning with '!' (SCons hands them to the shell), and the Python
builder of a platform or package that is not an exact registry release. The preflight names each with its file,
section and option. File-based findings are accepted only while the request approves that file by its SHA-256; the
others are never approvable. The raw values come from PlatformIO's own merged parser (config.py), the effective values
from its own option resolution, so what is judged is what PlatformIO will run.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .config import Config
from .request import Request
from .workspace import inside

REGISTRY = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,63}/[A-Za-z0-9][A-Za-z0-9 _.+-]{0,127}@\d+\.\d+\.\d+")
SYSENV = re.compile(r"\$\{\s*sysenv\.", re.I)
FOLDER_OPTIONS = ("core_dir", "home_dir", "globallib_dir", "platforms_dir", "packages_dir", "cache_dir",
                  "build_cache_dir", "workspace_dir", "build_dir", "libdeps_dir")
SOURCE_FOLDERS = ("src_dir", "include_dir", "lib_dir", "test_dir", "data_dir", "boards_dir", "monitor_dir", "shared_dir")
APPROVABLE = {"extra-script", "library-script", "custom-test-runner", "local-board"}
NOT_REFUSING = {"config-warning", "default-envs"}
MANIFEST_LIMIT = 1024 * 1024
LIBRARY_LIMIT = 256
# What SCons may substitute in a value without evaluating Python: `$$`, `$(`, `$)`, `$NAME` or `${NAME}` with a plain
# name. Anything else after a `$` (`${len('x')}`, `$NAME.attr`, `${a[0]}`) is evaluated by SCons.Subst as Python.
SCONS_SAFE = re.compile(r"\$(?:\$|\(|\)|\{[A-Za-z_]\w*\}|[A-Za-z_]\w*(?![\w.\[]))")


def scons_unsafe(text: str) -> bool:
    """Whether a value holds a `$` substitution SCons would evaluate as a Python expression."""
    index = 0
    while (index := text.find("$", index)) >= 0:
        match = SCONS_SAFE.match(text, index)
        if match is None:
            return True
        index = match.end()
    return False


@dataclass
class Finding:
    code: str
    detail: str
    file: str | None = None
    section: str | None = None
    option: str | None = None
    value: str | None = None
    environment: str | None = None
    sha256: str | None = None
    approved: bool = False

    @property
    def refusing(self) -> bool:
        return self.code not in NOT_REFUSING and not self.approved

    def as_json(self) -> dict[str, Any]:
        return {"code": self.code, "detail": self.detail, "file": self.file, "section": self.section,
                "option": self.option, "value": self.value, "environment": self.environment, "sha256": self.sha256,
                "approvable": self.code in APPROVABLE, "approved": self.approved, "refusing": self.refusing}


@dataclass
class Report:
    findings: list[Finding] = field(default_factory=list)

    def add(self, finding: Finding) -> None:
        key = (finding.code, finding.file, finding.section, finding.option, finding.value, finding.environment)
        if not any((f.code, f.file, f.section, f.option, f.value, f.environment) == key for f in self.findings):
            self.findings.append(finding)

    @property
    def refusing(self) -> list[Finding]:
        return [finding for finding in self.findings if finding.refusing]


def split_values(value: str) -> list[str]:
    """A raw value's items as PlatformIO splits a multi-value option: by line, else by ', ' (parse_multi_values)."""
    return [item.strip() for item in value.split("\n" if "\n" in value else ", ") if item.strip()]


def _effective_items(value: Any) -> list[str]:
    values = value if isinstance(value, (list, tuple)) else [value]
    return [str(item).strip() for item in values if isinstance(item, str)]


def sha256(path: Path) -> str | None:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError:
        return None


def _file_finding(report: Report, code: str, path: Path, detail: str, **where: Any) -> None:
    digest = sha256(path)
    report.add(Finding(code, detail, file=str(path), sha256=digest, **where))


def _raw(report: Report, config: Config) -> None:
    for section, option, value in config.raw:
        for item in split_values(value):
            if item.startswith("!"):
                report.add(Finding("shell-flag", "A value item beginning with '!' is run through the shell by SCons.",
                                   section=section, option=option, value=item[:200]))
        if SYSENV.search(value):
            report.add(Finding("sysenv", "A ${sysenv.*} interpolation makes the configuration depend on the caller's "
                               "environment.", section=section, option=option, value=value[:200]))
        if section == "platformio" and option in FOLDER_OPTIONS:
            report.add(Finding("folder-option", f"[platformio] {option} moves PlatformIO's own folders; VERA sets them.",
                               section=section, option=option, value=value[:200]))
        if option == "targets":
            report.add(Finding("targets", "A targets option would choose what `pio run` does; VERA names targets itself.",
                               section=section, option=option, value=value[:200]))
        if option == "default_envs" and section == "platformio":
            report.add(Finding("default-envs", "default_envs is never used: every operation names its environment.",
                               section=section, option=option, value=value[:200]))


def _files(report: Report, config: Config) -> None:
    for path in config.files:
        if not inside(config.project, path):
            report.add(Finding("config-outside", "extra_configs reads a file outside the project folder.",
                               file=str(path)))
    for name in SOURCE_FOLDERS:
        folder = config.folders.get(name)
        if folder is not None and not inside(config.project, folder):
            report.add(Finding("folder-option", f"[platformio] {name} lies outside the project folder.",
                               section="platformio", option=name, value=str(folder)))
    for warning in config.warnings:
        report.add(Finding("config-warning", warning[:300]))


def _strings(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        return [item for child in value.values() for item in _strings(child)]
    if isinstance(value, list):
        return [item for child in value for item in _strings(child)]
    return []


def _other_manifests(report: Report, folder: Path, environment: str) -> None:
    """A library without library.json: PlatformIO's Arduino builder takes flags from library.properties (ldflags) and
    its mbed builder defines from module.json/mbed_lib.json; every value reaches SCons, so each is judged."""
    sources: list[tuple[Path, list[str]]] = []
    properties = folder / "library.properties"
    if properties.is_file():
        try:
            text = properties.read_bytes()[:MANIFEST_LIMIT].decode("utf-8", errors="replace")
        except OSError:
            text = ""
        sources.append((properties, [line.split("=", 1)[1].strip() for line in text.splitlines() if "=" in line]))
    for name in ("module.json", "mbed_lib.json"):
        path = folder / name
        if path.is_file():
            try:
                sources.append((path, _strings(json.loads(path.read_bytes()[:MANIFEST_LIMIT].decode("utf-8")))))
            except (OSError, UnicodeDecodeError, ValueError):
                report.add(Finding("scons-expression", f"{name} cannot be read, so its values cannot be judged.",
                                   file=str(path), environment=environment))
    for path, values in sources:
        for value in values:
            if value.strip().startswith("!"):
                report.add(Finding("shell-flag", f"{path.name} holds a value beginning with '!' (run through the shell).",
                                   file=str(path), value=value[:200], environment=environment))
            if scons_unsafe(value):
                report.add(Finding("scons-expression", f"{path.name} holds a $ substitution SCons evaluates as Python.",
                                   file=str(path), value=value[:200], environment=environment))


def _library_manifest(report: Report, folder: Path, environment: str) -> None:
    manifest = folder / "library.json"
    if not manifest.is_file():
        _other_manifests(report, folder, environment)
        return
    try:
        data = json.loads(manifest.read_bytes()[:MANIFEST_LIMIT].decode("utf-8"))
    except (OSError, UnicodeDecodeError, ValueError):
        report.add(Finding("library-script", "library.json cannot be read, so its build script cannot be judged.",
                           file=str(manifest), sha256=sha256(manifest), environment=environment))
        return
    build = data.get("build") if isinstance(data, dict) else None
    build = build if isinstance(build, dict) else {}
    script = build.get("extraScript")
    for key in ("flags", "srcFlags", "unflags"):
        values = build.get(key)
        values = values if isinstance(values, list) else [values]
        for value in values:
            if isinstance(value, str) and value.strip().startswith("!"):
                report.add(Finding("shell-flag", f"library.json build.{key} begins with '!' (run through the shell).",
                                   file=str(manifest), value=value[:200], environment=environment))
    for key, value in build.items():
        values = value if isinstance(value, list) else [value]
        for item in values:
            if isinstance(item, str) and key != "extraScript" and scons_unsafe(item):
                report.add(Finding("scons-expression", f"library.json build.{key} holds a $ substitution SCons "
                                   "evaluates as Python.", file=str(manifest), value=item[:200], environment=environment))
    if isinstance(script, str) and "$" in script:
        report.add(Finding("scons-variable", "library.json build.extraScript holds a $ variable SCons expands later.",
                           file=str(manifest), value=script[:200], environment=environment))
    elif isinstance(script, str) and script:
        path = Path(os.path.realpath(folder / script))
        if not path.is_file():
            report.add(Finding("extra-script-missing", "library.json names a build.extraScript that does not exist.",
                               file=str(path), environment=environment))
        else:
            _file_finding(report, "library-script", path, f"Library {data.get('name')} runs this SCons script.",
                          environment=environment)


def _libraries(report: Report, config: Config, request: Request, environment: str) -> None:
    roots = [config.folders["lib_dir"], request.libdeps / environment]
    for entry in config.listed(environment, "lib_extra_dirs"):
        folder = Path(os.path.realpath(config.project / entry))
        if "$" in entry:
            report.add(Finding("scons-variable", "lib_extra_dirs holds a $ variable SCons expands after the preflight.",
                               section=config.options(environment)["lib_extra_dirs"]["section"], option="lib_extra_dirs",
                               value=entry[:200], environment=environment))
        elif not inside(config.project, folder):
            report.add(Finding("lib-extra-dirs", "lib_extra_dirs names a folder outside the project.",
                               section=config.options(environment)["lib_extra_dirs"]["section"], option="lib_extra_dirs",
                               value=entry[:200], environment=environment))
        else:
            roots.append(folder)
    for root in roots:
        try:
            entries = sorted(root.iterdir()) if root.is_dir() else []
        except OSError:
            entries = []
        for entry in entries:
            if entry.name.endswith(".pio-link") and entry.is_file():
                # PlatformIO builds the folder a .pio-link names as a library, wherever it lies.
                report.add(Finding("library-link", "A .pio-link file makes PlatformIO build a library from another folder.",
                                   file=str(entry), environment=environment))
        children = [entry for entry in entries if entry.is_dir()]
        if len(children) > LIBRARY_LIMIT:
            report.add(Finding("library-limit", f"{root} holds more than {LIBRARY_LIMIT} library folders; VERA does not "
                               "judge a partial list.", file=str(root), environment=environment))
        for child in children[:LIBRARY_LIMIT]:
            _library_manifest(report, child, environment)


def _environment(report: Report, config: Config, request: Request, environment: str) -> None:
    options = config.options(environment)

    def where(option: str) -> dict[str, Any]:
        return {"section": options.get(option, {}).get("section"), "option": option, "environment": environment}

    for option, entry in options.items():
        for item in _effective_items(entry["value"]):
            if item.startswith("!"):
                report.add(Finding("shell-flag", "An effective value item beginning with '!' is run through the shell "
                                   "by SCons.", value=item[:200], **where(option)))
            if scons_unsafe(item):
                report.add(Finding("scons-expression", "An effective value holds a $ substitution SCons evaluates as "
                                   "Python.", value=item[:200], **where(option)))
    for entry in config.listed(environment, "extra_scripts"):
        name = entry.split(":", 1)[1] if entry.startswith(("pre:", "post:")) else entry
        path = Path(os.path.realpath(config.project / name))
        if "$" in name:
            report.add(Finding("scons-variable", "extra_scripts holds a $ variable SCons expands after the preflight, so "
                               "the file judged may not be the file run.", value=entry[:200], **where("extra_scripts")))
        elif not path.is_file():
            report.add(Finding("extra-script-missing", "extra_scripts names a file that does not exist.",
                               file=str(path), value=entry[:200], **where("extra_scripts")))
        else:
            _file_finding(report, "extra-script", path, "An SCons extra script runs Python code in the build.",
                          value=entry[:200], **where("extra_scripts"))
    platform = str(config.value(environment, "platform") or "")
    if not REGISTRY.fullmatch(platform):
        report.add(Finding("platform-spec", "platform must be an exact registry release owner/name@X.Y.Z (a URL, path "
                           "or range runs a builder VERA cannot identify).", value=platform[:200], **where("platform")))
    if config.listed(environment, "platform_packages"):
        report.add(Finding("platform-packages", "platform_packages replaces the platform's own toolchains or tools.",
                           value="; ".join(config.listed(environment, "platform_packages"))[:200],
                           **where("platform_packages")))
    for entry in config.listed(environment, "lib_deps"):
        if not REGISTRY.fullmatch(entry.strip()):
            report.add(Finding("library-spec", "lib_deps entries must be exact registry releases owner/name@X.Y.Z.",
                               value=entry[:200], **where("lib_deps")))
    if str(config.value(environment, "test_framework") or "unity") == "custom":
        report.add(Finding("custom-test-runner", "test_framework custom loads test_custom_runner.py into PlatformIO.",
                           value="custom", **where("test_framework")))
    test_dir = config.folders["test_dir"]
    if test_dir.is_dir():
        for runner in sorted(test_dir.rglob("test_custom_runner.py"))[:16]:
            _file_finding(report, "custom-test-runner", runner, "A custom Unity/PlatformIO test runner (Python).",
                          environment=environment)
    if config.value(environment, "test_testing_command"):
        report.add(Finding("testing-command", "test_testing_command runs a program of the project's choice.",
                           value=str(config.value(environment, "test_testing_command"))[:200],
                           **where("test_testing_command")))
    if config.value(environment, "upload_command") or str(config.value(environment, "upload_protocol") or "") == "custom":
        report.add(Finding("upload-command", "A custom upload command runs a program of the project's choice.",
                           value=str(config.value(environment, "upload_command") or "custom")[:200],
                           **where("upload_command" if config.value(environment, "upload_command") else "upload_protocol")))
    if config.listed(environment, "targets"):
        report.add(Finding("targets", "targets would choose what `pio run` does; VERA names targets itself.",
                           value=", ".join(config.listed(environment, "targets"))[:200], **where("targets")))
    board = str(config.value(environment, "board") or "")
    if board:
        local = config.folders["boards_dir"] / f"{board}.json"
        if local.is_file():
            _file_finding(report, "local-board", local, "A board definition of the project replaces the platform's.",
                          **where("board"))
    _libraries(report, config, request, environment)


def run(config: Config, request: Request, environments: list[str]) -> Report:
    report = Report()
    _raw(report, config)
    _files(report, config)
    for option, value in config.platformio.items():
        for item in _effective_items(value):
            if scons_unsafe(item):
                report.add(Finding("scons-expression", "A [platformio] value holds a $ substitution SCons evaluates as "
                                   "Python.", section="platformio", option=option, value=item[:200]))
    for name in environments:
        _environment(report, config, request, name)
    approve(report, request)
    return report


def approve(report: Report, request: Request) -> None:
    for finding in report.findings:
        if finding.code not in APPROVABLE or finding.file is None or finding.sha256 is None:
            continue
        target = os.path.normcase(os.path.realpath(finding.file))
        finding.approved = any(os.path.normcase(str(hook.file)) == target and hook.sha256 == finding.sha256
                               for hook in request.hooks)


def selected(report: Report, environment: str | None) -> list[Finding]:
    """The refusing findings that concern an operation on `environment` (project-wide ones included)."""
    return [finding for finding in report.refusing if finding.environment in (None, environment)]
