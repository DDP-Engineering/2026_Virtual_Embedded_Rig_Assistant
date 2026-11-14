"""Preflight of a workspace, application and test folder (spec REQ-DATA-d8ecee6a section 4, REQ-SEC-8c4432cd).

Everything that would let a build run code VERA was not asked to run, or take inputs the request does not name, is a
finding. A refusing finding on a file stops every process-starting operation unless the request's `hooks` approve
that file by its current SHA-256. Findings without a file (projects, west configuration) and extensions that shadow
build, flash or twister are never approvable.
"""

from __future__ import annotations

import hashlib
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .cmake_scan import CMakeSyntax, commands
from .model import LOCAL_KEYS, Workspace, outer_west
from .request import Request

ALLOWED_CMAKE = {
    "cmake_minimum_required", "find_package", "project", "target_sources", "target_sources_ifdef",
    "target_include_directories", "target_compile_definitions", "zephyr_library", "zephyr_library_named",
    "zephyr_library_sources", "zephyr_library_sources_ifdef", "zephyr_include_directories",
    "zephyr_library_include_directories", "if", "elseif", "else", "endif",
}
SHADOWED = {"build", "flash", "twister"}
SETTINGS_OK = {"board_root", "dts_root", "soc_root"}
SYSBUILD = ("sysbuild.conf", "sysbuild.cmake", "Kconfig.sysbuild", "sysbuild")
HARNESS_OK = {None, "ztest"}
NEVER_APPROVED = {"extension-shadow", "project-unlisted", "project-missing", "project-revision", "project-checkout",
                  "west-config", "west-outer", "testcase-missing", "testcase-nested"}
FIND_ZEPHYR = {("Zephyr", "REQUIRED"), ("Zephyr", "REQUIRED", "HINTS", "$ENV{ZEPHYR_BASE}")}
ENV = re.compile(r"\$ENV\{([A-Za-z_][A-Za-z0-9_]*)\}")


@dataclass
class Finding:
    code: str
    detail: str
    file: Path | None = None
    sha256: str | None = None
    refuse: bool = True
    approved: bool = False

    def as_json(self) -> dict[str, Any]:
        return {"code": self.code, "detail": self.detail, "file": str(self.file) if self.file else None,
                "sha256": self.sha256, "refuse": self.refuse and not self.approved, "approved": self.approved}


@dataclass
class Report:
    findings: list[Finding] = field(default_factory=list)
    commands: list[dict[str, Any]] = field(default_factory=list)
    modules: list[dict[str, Any]] = field(default_factory=list)

    def add(self, code: str, detail: str, file: Path | None = None, refuse: bool = True) -> None:
        digest = None
        if file is not None:
            try:
                digest = hashlib.sha256(file.read_bytes()).hexdigest() if file.is_file() else None
            except OSError:
                digest = None
        self.findings.append(Finding(code, detail[:400], file, digest, refuse))

    @property
    def refusing(self) -> list[Finding]:
        return [finding for finding in self.findings if finding.refuse and not finding.approved]


def _same(left: Path, right: Path) -> bool:
    return os.path.normcase(os.path.realpath(left)) == os.path.normcase(os.path.realpath(right))


def _yaml(path: Path) -> Any:
    import yaml  # noqa: PLC0415

    try:
        return yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, yaml.YAMLError):
        return None


def _commands_of(spec_file: Path) -> list[str]:
    data = _yaml(spec_file)
    names: list[str] = []
    for group in (data or {}).get("west-commands", []) if isinstance(data, dict) else []:
        for command in (group or {}).get("commands", []) if isinstance(group, dict) else []:
            if isinstance(command, dict) and isinstance(command.get("name"), str):
                names.append(command["name"])
    return names


def workspace(report: Report, request: Request, model: Workspace, prepare: bool = False) -> None:
    outer = outer_west(model.topdir)
    if outer is not None:
        report.add("west-outer", f"{outer} holds a .west folder; west would treat it as the workspace.")
    for section, values in model.config.items():
        for key in values:
            if (section, key) not in LOCAL_KEYS:
                report.add("west-config", f".west/config sets {section}.{key}, which this plugin does not allow.",
                           model.topdir / ".west" / "config")
    configured = model.config.get("manifest", {}).get("path")
    if configured is not None and Path(configured) != Path(request.manifest):
        report.add("west-config", f".west/config names the manifest folder {configured}, the request {request.manifest}.")
    names = {project.name for project in model.projects}
    for project in model.projects:
        wanted = request.projects.get(project.name)
        if wanted is None:
            report.add("project-unlisted", f"The workspace has the project {project.name}, which the request does not list.")
            continue
        if re.fullmatch(r"[0-9a-f]{40}", project.revision) and project.revision != wanted:
            report.add("project-revision", f"The manifest pins {project.name} at {project.revision}, the request at {wanted}.")
        if not prepare and project.head != wanted:
            report.add("project-checkout", f"{project.name} is checked out at {project.head or 'nothing'}, not {wanted}.")
    for name in sorted(set(request.projects) - names) if not prepare else []:
        report.add("project-missing", f"The request lists {name}, which the workspace's manifest does not contain.")
    for project in model.projects:
        for spec_file in project.west_commands:
            commands = _commands_of(spec_file)
            report.commands.append({"project": project.name, "file": str(spec_file), "commands": commands})
            if project.name == "zephyr":
                continue
            shadow = sorted(SHADOWED & set(commands))
            if shadow:
                report.add("extension-shadow", f"{project.name} declares west commands {', '.join(shadow)} that shadow zephyr's.", spec_file)
            else:
                report.add("extension-command", f"{project.name} declares west extension commands {', '.join(commands[:8]) or '(none named)'}.", spec_file)
    for spec_file in model.manifest_commands:
        commands = _commands_of(spec_file)
        report.commands.append({"project": "manifest", "file": str(spec_file), "commands": commands})
        code = "extension-shadow" if SHADOWED & set(commands) else "extension-command"
        report.add(code, f"The manifest repository declares west extension commands {', '.join(commands[:8])}.", spec_file)
    if model.manifest_module is not None:
        report.add("module-hook", "The manifest repository is a Zephyr module, which the request does not list.", model.manifest_module)
    for project in model.projects:
        if project.module is None or project.name == "zephyr":
            continue
        build = project.module.get("build") if isinstance(project.module.get("build"), dict) else {}
        settings = build.get("settings") if isinstance(build.get("settings"), dict) else {}
        report.modules.append({"project": project.name, "file": str(project.module_file),
                               "cmake": build.get("cmake") or ("zephyr" if build.get("cmake-ext") else None),
                               "kconfig": build.get("kconfig") or ("zephyr" if build.get("kconfig-ext") else None),
                               "settings": sorted(settings), "blobs": len(project.module.get("blobs") or [])})
        extra = sorted(set(settings) - SETTINGS_OK)
        if extra:
            report.add("module-hook", f"The module {project.name} adds the build roots {', '.join(extra)}.", project.module_file)
        if project.module.get("runners"):
            report.add("module-hook", f"The module {project.name} adds west runners.", project.module_file)
        if project.module.get("blobs"):
            report.add("module-blobs", f"The module {project.name} declares {len(project.module['blobs'])} binary blobs; "
                       "they are never fetched and their absence is reported, not hidden.", project.module_file, refuse=False)


def _cmake(report: Report, path: Path) -> None:
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        report.add("app-cmake", f"{path.name} cannot be read as UTF-8 text.", path)
        return
    try:
        found = commands(text)
    except CMakeSyntax as error:
        report.add("app-cmake", f"{path.name} cannot be checked: {error}.", path)
        return
    for name in sorted({command.name for command in found} - ALLOWED_CMAKE):
        report.add("app-cmake", f"{path.name} calls {name}(), which is not a plain source or include command.", path)
    for command in found:
        if command.name == "find_package" and command.args not in FIND_ZEPHYR:
            report.add("app-cmake", f"{path.name} line {command.line}: find_package must be exactly "
                       "find_package(Zephyr REQUIRED [HINTS $ENV{ZEPHYR_BASE}]).", path)
        for argument in command.args:
            for name in ENV.findall(argument):
                if name != "ZEPHYR_BASE":
                    report.add("app-cmake", f"{path.name} reads the environment variable {name}.", path)


def _kconfig(report: Report, path: Path) -> None:
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        report.add("kconfig-macro", f"{path.name} cannot be read as UTF-8 text.", path)
        return
    if "$(" in text:
        report.add("kconfig-macro", f"{path.name} uses a Kconfig preprocessor macro ($(...)), which can run host commands.", path)
    for match in re.finditer(r"^\s*(o?r?source)\s+\"?([^\"\s]+)", text, re.M):
        if match.group(1) != "source" or match.group(2) != "Kconfig.zephyr":
            report.add("kconfig-macro", f"{path.name} includes {match.group(2)} with {match.group(1)}.", path)


def application(report: Report, request: Request, folder: Path) -> None:
    cmake = folder / "CMakeLists.txt"
    if cmake.is_file():
        _cmake(report, cmake)
    else:
        report.add("app-cmake", f"{folder} has no CMakeLists.txt.")
    for kconfig in sorted(folder.glob("Kconfig*")):
        if kconfig.is_file():
            _kconfig(report, kconfig)
    for name in SYSBUILD:
        if (folder / name).exists():
            report.add("sysbuild", f"{name} would start sysbuild, which this plugin does not run.", folder / name if (folder / name).is_file() else None)
    listed = {os.path.normcase(str(path)) for _, path in request.inputs()}
    implicit: list[Path] = []
    for sub in ("boards", "socs"):
        base = folder / sub
        if base.is_dir():
            implicit.extend(path for path in base.rglob("*") if path.is_file())
    # Zephyr's own picks in the application folder: app.overlay and <board>[_<qualifiers>].overlay/.conf.
    implicit.extend(path for path in folder.iterdir() if path.is_file() and (
        path.name == "app.overlay" or (path.name.startswith(request.board_name) and path.suffix in (".overlay", ".conf"))))
    for path in sorted(implicit):
        if os.path.normcase(os.path.realpath(path)) not in listed:
            report.add("implicit-input", f"{path.relative_to(folder).as_posix()} is a board/SoC input the request does not list.", path)


def testcases(report: Report, request: Request) -> list[str]:
    """Checks testcase.yaml and returns the scenarios it declares."""
    assert request.tests_root is not None
    path = request.tests_root / "testcase.yaml"
    data = _yaml(path)
    if not isinstance(data, dict) or not isinstance(data.get("tests"), dict):
        report.add("testcase-missing", f"{path} is missing or has no tests mapping.")
        return []
    common = data.get("common") if isinstance(data.get("common"), dict) else {}
    for name, scenario in data["tests"].items():
        merged = {**common, **(scenario if isinstance(scenario, dict) else {})}
        if merged.get("harness") not in HARNESS_OK:
            report.add("testcase", f"Scenario {name} uses the harness {merged.get('harness')}; only ztest is supported.", path)
        for key in ("harness_config", "extra_args", "required_snippets", "extra_conf_files", "extra_dtc_overlay_files",
                    "extra_overlay_confs"):
            if merged.get(key):
                report.add("testcase", f"Scenario {name} sets {key}.", path)
        if merged.get("sysbuild"):
            report.add("testcase", f"Scenario {name} enables sysbuild.", path)
    # Twister builds every suite below -T whose scenario name matches, and a sample.yaml wins over testcase.yaml.
    for other in sorted(request.tests_root.rglob("*")):
        if other.name in ("testcase.yaml", "sample.yaml") and other != path:
            report.add("testcase-nested", f"{other.relative_to(request.tests_root).as_posix()} is another Twister suite "
                       "below tests.root; only the root's testcase.yaml is checked, so it is refused.", other)
    for scenario in request.scenarios:
        if scenario not in data["tests"]:
            report.add("testcase-missing", f"testcase.yaml has no scenario {scenario}.")
    return list(data["tests"])


def approve(report: Report, request: Request) -> None:
    for finding in report.findings:
        if finding.code in NEVER_APPROVED or finding.file is None or finding.sha256 is None:
            continue
        for hook in request.hooks:
            if _same(hook.file, finding.file) and hook.sha256 == finding.sha256:
                finding.approved = True


def run(request: Request, model: Workspace, operation: str) -> Report:
    report = Report()
    workspace(report, request, model, prepare=operation == "prepare-workspace")
    if operation != "prepare-workspace":
        application(report, request, request.app)
        if request.tests_root is not None and operation == "test-build":
            if not _same(request.tests_root, request.app):
                application(report, request, request.tests_root)
            testcases(report, request)
    approve(report, request)
    return report
