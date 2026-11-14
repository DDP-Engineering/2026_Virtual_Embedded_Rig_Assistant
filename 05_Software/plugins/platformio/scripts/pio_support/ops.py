"""The operations of the `platformio` helper (spec REQ-DATA-865c8fbd section 3).

Every process-starting operation runs the same checks first - request, configuration through PlatformIO's own parser,
preflight, installed packages, build folder - and refuses (exit 2, nothing written) before the run folder exists.
PlatformIO always gets `-e <environment>` and explicit targets (REQ-SEC-82cb079b).
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from . import PLATFORMIO_VERSION, VERSION, artifacts, builddir, config, diagnostics, environment, packages, preflight
from .errors import Refused
from .request import Request, load
from .result import Run, emit, read_run, sha256
from .workspace import inside

VERIFIED = [
    {"platform": "platformio/ststm32@20.0.0", "board": "disco_f407vg", "frameworks": ["cmsis"]},
    {"platform": "platformio/native@1.2.1", "board": None, "frameworks": []},
]
HASH_LIMIT_FILES = 4096
SKIPPED_FOLDERS = {".pio", ".git", ".vscode"}


@dataclass
class Context:
    request: Request
    config: config.Config
    report: preflight.Report
    family: str

    @property
    def environment(self) -> str | None:
        return self.request.environment


def context(cwd: Path, spelled: Path, raw: str, family: str, needs_environment: bool = True,
            needs_tests: bool = False) -> Context:
    request = load(cwd, spelled, raw, needs_environment=needs_environment, needs_tests=needs_tests)
    env = environment.build(request.core, request.workspace(family), request.libdeps)
    parsed = config.load(request.project, env)
    if request.environment is not None and request.environment not in parsed.environments:
        raise Refused("environment", f"The project defines no environment {request.environment}; it has: "
                      f"{', '.join(parsed.environments) or 'none'}.")
    scope = [request.environment] if request.environment is not None else parsed.environments
    report = preflight.run(parsed, request, scope)
    return Context(request, parsed, report, family)


def require_clean(ctx: Context) -> None:
    refusing = preflight.selected(ctx.report, ctx.environment)
    if refusing:
        raise Refused("preflight", f"The preflight refused {len(refusing)} finding(s); see detail.",
                      {"findings": [finding.as_json() for finding in refusing][:20]})


def summary(ctx: Context, name: str) -> dict[str, Any]:
    """The resolved identity of one environment."""
    cfg = ctx.config
    platform = str(cfg.value(name, "platform") or "")
    frameworks = cfg.listed(name, "framework")
    board = cfg.value(name, "board")
    found = packages.needed(ctx.request.core, ctx.request.libdeps, name, platform, frameworks,
                            cfg.listed(name, "lib_deps"), False, "")
    board_json = packages.board(found, str(board or ""))
    protocol = cfg.value(name, "upload_protocol") or ((board_json or {}).get("upload") or {}).get("protocol")
    verified = any(item["platform"] == platform and item["board"] == board and item["frameworks"] == frameworks
                   for item in VERIFIED)
    return {"name": name, "platform": platform, "board": board, "framework": frameworks,
            "testFramework": cfg.value(name, "test_framework") or "unity", "uploadProtocol": protocol,
            "native": platform.split("@")[0].split("/")[-1] == "native", "verified": verified,
            "options": cfg.options(name)}


def project_files(project: Path) -> dict[str, str]:
    """SHA-256 of every project file outside PlatformIO's and the editors' own folders (bounded)."""
    hashes: dict[str, str] = {}
    for root, folders, files in os.walk(project, followlinks=False):
        folders[:] = sorted(f for f in folders if not (Path(root) == project and f in SKIPPED_FOLDERS))
        for name in sorted(files):
            path = Path(root) / name
            if path.is_symlink():
                continue
            hashes[Path(os.path.relpath(path, project)).as_posix()] = sha256(path)
            if len(hashes) >= HASH_LIMIT_FILES:
                return hashes
    return hashes


def changed(before: dict[str, str], after: dict[str, str]) -> list[str]:
    return sorted(set(before) ^ set(after) | {key for key in before if key in after and before[key] != after[key]})


def tools_block() -> dict[str, Any]:
    try:
        from platformio import __version__ as core_version  # noqa: PLC0415
    except ImportError:
        core_version = None
    return {"helper": VERSION, "platformio": core_version, "platformioPinned": PLATFORMIO_VERSION,
            "python": sys.version.split()[0], "executable": sys.executable}


def describe(ctx: Context, found: packages.Needed | None = None) -> dict[str, Any]:
    request = ctx.request
    block: dict[str, Any] = {
        "tools": tools_block(),
        "request": request.described(),
        "project": {"path": str(request.project), "files": [{"path": str(path), "sha256": sha256(path)}
                                                             for path in ctx.config.files if path.is_file()]},
        "buildDir": str(request.build_dir),
        "findings": [finding.as_json() for finding in ctx.report.findings],
    }
    if ctx.environment is not None:
        block["environment"] = summary(ctx, ctx.environment)
    if found is not None:
        block["packages"] = found.as_json()
    return block


def has_test_suites(ctx: Context) -> bool:
    """Whether the project has `test_*` suites: then PlatformIO adds the test framework to every `pio run` and
    installs it if it can (its own list_test_names rule), so the framework counts as needed for every operation."""
    test_dir = ctx.config.folders["test_dir"]
    if not test_dir.is_dir():
        return False
    for count, (root, _, _) in enumerate(os.walk(test_dir, followlinks=True)):  # as PlatformIO walks it
        if Path(root).name.startswith("test_") or count > 10_000:  # a link loop counts as suites (fails closed)
            return True
    return False


def needed_for(ctx: Context, tests: bool) -> packages.Needed:
    name = ctx.request.env()
    cfg = ctx.config
    return packages.needed(ctx.request.core, ctx.request.libdeps, name, str(cfg.value(name, "platform") or ""),
                           cfg.listed(name, "framework"), cfg.listed(name, "lib_deps"), tests or has_test_suites(ctx),
                           str(cfg.value(name, "test_framework") or "unity"))


def toolchain_for(ctx: Context) -> Path | None:
    native = summary(ctx, ctx.request.env())["native"]
    if ctx.request.host_toolchain is not None and not native:
        raise Refused("request", "hostToolchain applies only to environments of the native platform.")
    return ctx.request.host_toolchain if native else None


def run_env(ctx: Context, family: str, toolchain: Path | None, run_folder: Path | None) -> dict[str, str]:
    request = ctx.request
    return environment.build(request.core, request.workspace(family), request.libdeps, offline=True,
                             toolchain=toolchain, cache=run_folder / "pio-cache" if run_folder is not None else None)


def build(cwd: Path, spelled: Path, raw: str, pristine: bool, results: str | None) -> int:
    ctx = context(cwd, spelled, raw, "build")
    require_clean(ctx)
    toolchain = toolchain_for(ctx)
    found = needed_for(ctx, tests=False)
    builddir.precheck(ctx.request, pristine)
    packages.require(found)
    command = environment.pio_command()
    run = Run("build", "build")
    run.document.update(describe(ctx, found))
    run.create_folder(cwd, spelled, results)
    assert run.folder is not None
    request = ctx.request
    name = request.env()
    run["buildFolder"] = builddir.claim(request, "build", pristine, run["runId"])
    before = project_files(request.project)
    run["inputs"] = {"before": before, "after": None}
    run.write(force=True)
    argv = [*command, "run", "-d", str(request.project), "-e", name, "-t", "buildprog"]
    code, log = run.step("build", argv, request.project, run_env(ctx, "build", toolchain, run.folder))
    run["diagnostics"] = diagnostics.analyse(log)
    if code != 0:
        run.set_status("fail", "build-failed", f"PlatformIO exited {code}; {len(run['diagnostics'])} diagnostic(s) "
                       "cite build.log.")
    after = project_files(request.project)
    run["inputs"]["after"] = after
    moved = changed(before, after)
    if moved:
        run.set_status("error", "input-changed", f"Project files changed during the build: {', '.join(moved[:4])}.")
    output = artifacts.output_dir(request.workspace("build"), name)
    found_artifacts, missing = artifacts.collect(output, run.folder)
    run["artifacts"] = found_artifacts
    run["missing"] = missing
    elf_entry = next((a for a in found_artifacts if a["role"] == "elf"), None)
    if code == 0 and elf_entry is None and not any(a["role"] == "program" for a in found_artifacts):
        run.set_status("error", "artifact-missing", "PlatformIO finished without firmware.elf.")
    board_json = packages.board(found, str(ctx.config.value(name, "board") or ""))
    run["size"] = {"usage": artifacts.usage(log), "limits": artifacts.limits(board_json),
                   "elf": artifacts.sections(output / "firmware.elf") if elf_entry else None}
    builddir.record(request, "build", run["runId"], run["status"],
                    {"elf": elf_entry["sha256"] if elf_entry else None, "usage": run["size"]["usage"]})
    return run.finish({"environment": name, "artifacts": [{k: a.get(k) for k in ("role", "path", "sha256", "size")}
                                                          for a in found_artifacts],
                       "usage": run["size"]["usage"], "diagnostics": run["diagnostics"][:8]})


def artifacts_op(cwd: Path, spelled: Path, raw: str, results: str | None) -> int:
    ctx = context(cwd, spelled, raw, "build")
    request = ctx.request
    marker = builddir.check_owned(request)
    name = request.env()
    run = Run("artifacts", "build")
    run.document.update(describe(ctx))
    run.create_folder(cwd, spelled, results)
    output = artifacts.output_dir(request.workspace("build"), name)
    found, missing = artifacts.collect(output, None)
    run["artifacts"] = found
    run["missing"] = missing
    last = (marker.get("runs") or {}).get("build") or {}
    board_json = packages.board(needed_for(ctx, False), str(ctx.config.value(name, "board") or ""))
    elf_path = output / "firmware.elf"
    run["size"] = {"usage": last.get("usage") or {}, "limits": artifacts.limits(board_json),
                   "elf": artifacts.sections(elf_path) if elf_path.is_file() else None}
    run["lastRun"] = {"runId": last.get("runId"), "status": last.get("status"), "elf": last.get("elf")}
    elf_entry = next((a for a in found if a["role"] == "elf"), None)
    if last.get("status") != "pass":
        run.set_status("incomplete", "build-unfinished", f"The last build of this folder is {last.get('status') or 'missing'}.")
    elif missing:
        run.set_status("incomplete", "artifact-missing", f"Missing outputs: {', '.join(missing)}.")
    elif elf_entry is not None and last.get("elf") and elf_entry["sha256"] != last.get("elf"):
        run.set_status("incomplete", "artifact-changed", "firmware.elf differs from the one the last build recorded.")
    return run.finish({"artifacts": [{k: a.get(k) for k in ("role", "sha256", "size")} for a in found],
                       "missing": missing, "lastRun": run["lastRun"], "usage": run["size"]["usage"]})


def clean_op(cwd: Path, spelled: Path, raw: str, results: str | None) -> int:
    request = load(cwd, spelled, raw, needs_environment=True)
    builddir.check_owned(request)
    run = Run("clean", "none")
    run["request"] = request.described()
    run["buildDir"] = str(request.build_dir)
    run.create_folder(cwd, spelled, results)
    removed = builddir.clean(request)
    run["removed"] = removed
    return run.finish({"removed": removed, "buildDir": request.build_dir_text})


def tools(cwd: Path, spelled: Path, raw: str | None) -> int:
    document: dict[str, Any] = {"format": 1, "kind": "platformio-tools", "status": "pass", **tools_block(),
                                "verified": VERIFIED}
    if raw:
        request = load(cwd, spelled, raw)
        document["core"] = {"path": str(request.core),
                            "platforms": [p.as_json() for p in packages.platforms(request.core)],
                            "packages": [p.as_json() for p in packages.tools(request.core)]}
        libdeps: dict[str, Any] = {}
        if request.libdeps.is_dir():
            for folder in sorted(child for child in request.libdeps.iterdir() if child.is_dir()):
                libdeps[folder.name] = [p.as_json() for p in packages.libraries(request.libdeps, folder.name)]
        document["libdeps"] = libdeps
        if not document["core"]["platforms"]:
            document["status"] = "incomplete"
            document["code"] = "core-empty"
            document["reason"] = "The core folder holds no platform; run platformio prepare-packages."
    emit(document)
    return 0 if document["status"] == "pass" else 3


def inspect_project(cwd: Path, spelled: Path, raw: str) -> int:
    ctx = context(cwd, spelled, raw, "build", needs_environment=False)
    request = ctx.request
    ctx.report = preflight.run(ctx.config, request, ctx.config.environments)
    refusing = ctx.report.refusing
    document = {"format": 1, "kind": "platformio-inspect-project", "status": "refused" if refusing else "pass",
                "tools": tools_block(), "project": str(request.project),
                "files": [{"path": str(path), "sha256": sha256(path) if path.is_file() else None,
                           "inside": inside(request.project, path)} for path in ctx.config.files],
                "environments": ctx.config.environments, "defaultEnvs": ctx.config.default_envs,
                "platformio": ctx.config.platformio,
                "findings": [finding.as_json() for finding in ctx.report.findings]}
    emit(document)
    return 2 if refusing else 0


def inspect_environments(cwd: Path, spelled: Path, raw: str) -> int:
    ctx = context(cwd, spelled, raw, "build", needs_environment=False)
    names = [ctx.environment] if ctx.environment else ctx.config.environments
    listed: list[dict[str, Any]] = []
    status = "pass"
    for name in names:
        entry = summary(ctx, name)
        found = packages.needed(ctx.request.core, ctx.request.libdeps, name, entry["platform"], entry["framework"],
                                ctx.config.listed(name, "lib_deps"), bool((ctx.config.folders["test_dir"]).is_dir()),
                                entry["testFramework"])
        entry["installed"] = found.as_json()
        entry["missing"] = found.missing
        entry["findings"] = [f.as_json() for f in ctx.report.findings if f.environment in (None, name)]
        if any(f["refusing"] for f in entry["findings"]):
            status = "refused"
        listed.append(entry)
    emit({"format": 1, "kind": "platformio-inspect-environments", "status": status, "tools": tools_block(),
          "project": str(ctx.request.project), "environments": listed})
    return 2 if status == "refused" else 0


def evidence_run(cwd: Path, raw: str) -> tuple[Path, dict[str, Any]]:
    folder = Path(os.path.realpath(cwd / raw)) if not Path(raw).is_absolute() else Path(os.path.realpath(raw))
    if folder.name == "result.json":
        folder = folder.parent
    if not inside(cwd, folder):
        raise Refused("evidence", f"{raw[:120]} lies outside the workbench.")
    return folder, read_run(folder)
