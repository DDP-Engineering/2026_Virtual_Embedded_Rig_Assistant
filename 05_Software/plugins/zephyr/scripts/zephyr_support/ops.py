"""The operations of the `zephyr` helper (spec REQ-DATA-d8ecee6a section 3).

Every process-starting operation runs the same checks first - request, workspace, Zephyr version, board, SDK,
preflight, build folder - and refuses (exit 2, nothing written) before the run folder exists. Builds call CMake and
Ninja directly with an explicit module list; west runs only in prepare-workspace.
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from . import VERSION, artifacts, boards, builddir, diagnostics, environment, model, preflight, sdk
from .errors import Refused
from .request import Request, fingerprint, load
from .result import Run, read_run, sha256
from .workspace import inside

ZEPHYR_RANGE = ((4, 4, 0), (4, 6, 0))


@dataclass
class Context:
    request: Request
    workspace: model.Workspace
    board: boards.Board | None
    sdk: sdk.Sdk | None
    report: preflight.Report


def posix(path: Path) -> str:
    return path.as_posix()


def context(cwd: Path, spelled: Path, raw: str, operation: str) -> Context:
    request = load(cwd, spelled, raw, needs_tests=operation == "test-build")
    model.isolate_west_config()
    prepare = operation == "prepare-workspace"
    workspace = model.load(request.workspace, request.manifest, config_required=not prepare)
    board = found_sdk = None
    if not prepare:
        version = model.version_tuple(workspace.version)
        if not version or not ZEPHYR_RANGE[0] <= version < ZEPHYR_RANGE[1]:
            raise Refused("zephyr-version", f"Zephyr {workspace.version or 'unknown'} is outside the supported range >=4.4,<4.6.")
        board = boards.check(workspace.zephyr, request.board_name, request.board_revision, request.board_qualifiers)
        found_sdk = sdk.check(request.sdk, board.toolchain, workspace.sdk_minimum)
    report = preflight.run(request, workspace, operation)
    return Context(request, workspace, board, found_sdk, report)


def require_clean(ctx: Context) -> None:
    if ctx.report.refusing:
        raise Refused("preflight", f"The preflight refused {len(ctx.report.refusing)} finding(s); see detail.",
                      {"findings": [finding.as_json() for finding in ctx.report.refusing][:20]})


def describe(ctx: Context) -> dict[str, Any]:
    request = ctx.request
    return {
        "tools": tools_block(ctx),
        "request": {"path": str(request.path), "sha256": request.sha256, "content": request.content},
        "workspace": {"topdir": str(ctx.workspace.topdir), "projects": [
            {"name": p.name, "path": str(p.path), "revision": request.projects.get(p.name), "head": p.head}
            for p in ctx.workspace.projects]},
        "board": None if ctx.board is None else {"name": ctx.board.name, "revision": ctx.board.revision,
                                                 "qualifiers": ctx.board.qualifiers, "target": ctx.board.target,
                                                 "arch": ctx.board.arch,
                                                 "verified": ctx.board.name == "stm32f4_disco"},
        "inputs": [{"role": role, "path": str(path), "sha256": sha256(path)} for role, path in request.inputs()],
        "buildDir": str(request.build_dir),
        "findings": [finding.as_json() for finding in ctx.report.findings],
    }


def tools_block(ctx: Context | None) -> dict[str, Any]:
    from west.version import __version__ as west_version  # noqa: PLC0415

    block: dict[str, Any] = {"helper": VERSION, "python": sys.version.split()[0], "west": west_version,
                             "cmake": str(environment.tool("cmake")), "ninja": str(environment.tool("ninja"))}
    if ctx is not None:
        block["zephyr"] = {"base": str(ctx.workspace.zephyr), "version": ctx.workspace.version,
                           "sdkMinimum": ctx.workspace.sdk_minimum}
        if ctx.sdk is not None:
            block["sdk"] = {"path": str(ctx.sdk.path), "version": ctx.sdk.version, "toolchain": str(ctx.sdk.toolchain)}
    return block


def cmake_command() -> list[str]:
    """CMake from the helper environment; the offline test seam replaces it only in a test process."""
    if os.environ.get("VERA_ZEPHYR_TEST") == "1" and os.environ.get("VERA_ZEPHYR_TEST_CMAKE"):
        return [sys.executable, os.environ["VERA_ZEPHYR_TEST_CMAKE"]]
    found = environment.tool("cmake")
    if found is None:
        raise Refused("tools", "CMake is missing from the helper environment; reinstall the plugin's programs.")
    return [str(found)]


def module_folders(ctx: Context) -> list[Path]:
    return [p.path for p in ctx.workspace.projects if p.name != "zephyr" and p.module_file is not None]


def configure_args(ctx: Context, source: Path) -> list[str]:
    request = ctx.request
    assert ctx.board is not None and ctx.sdk is not None
    python = posix(Path(sys.executable))
    ninja = environment.tool("ninja")
    args = [
        "-S", posix(source), "-B", posix(request.build_dir), "-G", "Ninja",
        f"-DBOARD={request.board}",
        f"-DCONF_FILE={';'.join(posix(p) for p in request.configs)}",
        f"-DDTC_OVERLAY_FILE={';'.join(posix(p) for p in request.overlays)}",
        f"-DZEPHYR_MODULES={';'.join(posix(p) for p in module_folders(ctx))}",
        "-DZEPHYR_TOOLCHAIN_VARIANT=zephyr", f"-DZEPHYR_SDK_INSTALL_DIR={posix(ctx.sdk.path)}",
        # find_package(Zephyr) takes the workspace's own package, never a ZephyrConfig.cmake a HINTS path offers.
        f"-DZephyr_DIR={posix(ctx.workspace.zephyr / 'share' / 'zephyr-package' / 'cmake')}",
        f"-DPython3_EXECUTABLE={python}", f"-DWEST_PYTHON={python}",
    ]
    if request.extra_configs:
        args.append(f"-DEXTRA_CONF_FILE={';'.join(posix(p) for p in request.extra_configs)}")
    if ninja is not None:
        args.append(f"-DCMAKE_MAKE_PROGRAM={posix(ninja)}")
    return args


def _hashes(request: Request) -> dict[str, str]:
    return {str(path): sha256(path) for _, path in request.inputs()}


def _declared(request: Request, info: Path) -> list[str]:
    """Effective user input files build_info.yml names that the request does not list."""
    import yaml  # noqa: PLC0415

    try:
        data = yaml.safe_load(info.read_text(encoding="utf-8")) or {}
    except (OSError, yaml.YAMLError):
        return []
    cmake = data.get("cmake", {}) if isinstance(data, dict) else {}
    used: list[str] = []
    for section in ("kconfig", "devicetree"):
        files = (cmake.get(section) or {}).get("user-files") or []
        used.extend(str(item) for item in files)
    listed = {os.path.normcase(os.path.realpath(path)) for _, path in request.inputs()}
    return [item for item in used if os.path.normcase(os.path.realpath(item)) not in listed]


def build(cwd: Path, spelled: Path, raw: str, pristine: bool, results: str | None) -> int:
    ctx = context(cwd, spelled, raw, "build")
    require_clean(ctx)
    builddir.precheck(ctx.request, "build", pristine)
    run = Run("build", "build")
    run.document.update(describe(ctx))
    run.create_folder(cwd, spelled, results)
    assert run.folder is not None
    state = builddir.claim(ctx.request, "build", pristine, run["runId"])
    builddir.mark_running(ctx.request, run["runId"])
    run["buildFolder"] = state
    before = _hashes(ctx.request)
    env = environment.build(run.folder, ctx.workspace.zephyr)
    command = cmake_command()
    code, configure_log = run.step("configure", [*command, *configure_args(ctx, ctx.request.app)], ctx.request.app, env)
    logs = [configure_log]
    if code == 0:
        code, build_log = run.step("build", [*command, "--build", posix(ctx.request.build_dir)], ctx.request.app, env)
        logs.append(build_log)
    for log in logs:
        run["diagnostics"].extend(diagnostics.analyse(log))
    if code != 0:
        run.set_status("fail", "build-failed", f"The {'configure' if len(logs) == 1 else 'build'} step exited {code}; "
                       f"{len(run['diagnostics'])} diagnostic(s) cite the logs.")
    after = _hashes(ctx.request)
    changed = [path for path, digest in before.items() if after.get(path) != digest]
    if changed:
        run.set_status("error", "input-changed", f"Input files changed during the build: {', '.join(changed[:4])}.")
    found, missing = artifacts.collect(ctx.request.build_dir, run.folder)
    run["artifacts"] = found
    run["missing"] = missing if code == 0 else []
    if code == 0:
        undeclared = _declared(ctx.request, ctx.request.build_dir / "build_info.yml")
        if undeclared:
            run.set_status("error", "undeclared-input", f"The build used input files the request does not list: {', '.join(undeclared[:4])}.")
        if any(role in missing for role in ("elf",)):
            run.set_status("error", "artifact-missing", "The build finished without zephyr.elf.")
    regions = artifacts.regions(logs[-1])
    elf_path = ctx.request.build_dir / "zephyr" / "zephyr.elf"
    run["size"] = {"regions": regions, "elf": artifacts.sections(elf_path) if elf_path.is_file() and code == 0 else None}
    builddir.record(ctx.request, run["runId"], run["status"], regions)
    return run.finish({"board": run["board"], "artifacts": [{k: a.get(k) for k in ("role", "path", "sha256", "size")} for a in found],
                       "regions": regions, "diagnostics": run["diagnostics"][:8]})


def artifacts_op(cwd: Path, spelled: Path, raw: str, results: str | None) -> int:
    request = load(cwd, spelled, raw)
    marker = builddir.check_owned(request)
    if marker["fingerprint"] != fingerprint(request, marker["family"]):
        raise Refused("build-dir-mismatch", f"{request.build_dir_text} holds a build of another configuration than this request.")
    run = Run("artifacts", "build")
    run["request"] = {"path": str(request.path), "sha256": request.sha256, "content": request.content}
    run["buildDir"] = str(request.build_dir)
    run.create_folder(cwd, spelled, results)
    found, missing = artifacts.collect(request.build_dir, None)
    run["artifacts"] = found
    run["missing"] = missing
    elf_path = request.build_dir / "zephyr" / "zephyr.elf"
    run["size"] = {"regions": marker.get("regions") or [], "elf": artifacts.sections(elf_path) if elf_path.is_file() else None}
    run["lastRun"] = {"runId": marker.get("lastRun"), "status": marker.get("lastStatus")}
    if marker.get("lastStatus") != "pass":
        run.set_status("incomplete", "build-unfinished", f"The last build of this folder is {marker.get('lastStatus') or 'unknown'}.")
    elif any(role in missing for role in ("elf", "hex", "bin")):
        run.set_status("incomplete", "artifact-missing", f"Missing outputs: {', '.join(missing)}.")
    return run.finish({"artifacts": [{k: a.get(k) for k in ("role", "sha256", "size")} for a in found],
                       "missing": missing, "regions": run["size"]["regions"]})


def clean_op(cwd: Path, spelled: Path, raw: str, results: str | None) -> int:
    request = load(cwd, spelled, raw)
    builddir.check_owned(request)
    run = Run("clean", "build")
    run["buildDir"] = str(request.build_dir)
    run.create_folder(cwd, spelled, results)
    removed = builddir.clean(request)
    run["removed"] = removed
    return run.finish({"removed": removed, "buildDir": request.build_dir_text})


def inspect(cwd: Path, spelled: Path, raw: str) -> int:
    from .result import emit  # noqa: PLC0415

    ctx = context(cwd, spelled, raw, "build")
    document = {"format": 1, "kind": "zephyr-inspect", "status": "refused" if ctx.report.refusing else "pass",
                **describe(ctx), "commands": ctx.report.commands, "modules": ctx.report.modules}
    if ctx.request.tests_root is not None:
        tests = preflight.Report()
        names = preflight.testcases(tests, ctx.request)
        preflight.approve(tests, ctx.request)
        document["tests"] = {"root": str(ctx.request.tests_root), "scenarios": names,
                             "findings": [f.as_json() for f in tests.findings]}
        if tests.refusing:
            document["status"] = "refused"
    document.pop("request", None)
    emit(document)
    return 2 if document["status"] == "refused" else 0


def evidence_run(cwd: Path, raw: str) -> tuple[Path, dict[str, Any]]:
    folder = Path(os.path.realpath(cwd / raw)) if not Path(raw).is_absolute() else Path(os.path.realpath(raw))
    if folder.name == "result.json":
        folder = folder.parent
    if not inside(cwd, folder):
        raise Refused("evidence", f"{raw[:120]} lies outside the workbench.")
    return folder, read_run(folder)
