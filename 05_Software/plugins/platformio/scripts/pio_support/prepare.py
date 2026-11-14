"""prepare-packages: the one operation that contacts the network (spec REQ-DATA-865c8fbd section 3,
REQ-FUNC-335f12b1).

PlatformIO's own package manager installs the requested environment's platform (with the packages the platform
selects), its declared libraries and Unity when the project has tests into the request's core folder and the owned
libdeps folder, then the build engine tool-scons into the core. `--no-save` keeps platformio.ini unchanged; the
project files are hashed before and after. A package's own postinstall script is PlatformIO's behavior and runs on
the host (the rule's note says so). Nothing else of the project runs: the preflight refuses URL platforms, platform
packages and non-exact libraries first.
"""

from __future__ import annotations

from pathlib import Path

from . import builddir, environment, packages
from .ops import changed, context, describe, needed_for, project_files, require_clean, summary
from .result import Run

SCONS = "platformio/tool-scons@4.41101.0"
UPLOADERS = {"stlink": "tool-openocd"}


def prepare(cwd: Path, spelled: Path, raw: str, results: str | None) -> int:
    ctx = context(cwd, spelled, raw, "build")
    require_clean(ctx)
    builddir.precheck(ctx.request, False)
    command = environment.pio_command()
    request = ctx.request
    name = request.env()
    run = Run("prepare-packages", "none")
    run.document.update(describe(ctx, needed_for(ctx, tests=True)))
    run.create_folder(cwd, spelled, results)
    assert run.folder is not None
    run["buildFolder"] = builddir.claim(request, "prepare", False, run["runId"])
    request.libdeps.mkdir(exist_ok=True)
    before = project_files(request.project)
    run["inputs"] = {"before": before, "after": None}
    env = environment.build(request.core, request.workspace("build"), request.libdeps, offline=False)
    code, _ = run.step("install", [*command, "pkg", "install", "-d", str(request.project), "-e", name, "--no-save"],
                       request.project, env)
    if code == 0:
        code, _ = run.step("install-scons", [*command, "pkg", "install", "-g", "-t", SCONS], request.project, env)
    protocol = str(summary(ctx, name).get("uploadProtocol") or "")
    platform = packages.platform_of(request.core, str(ctx.config.value(name, "platform") or ""))
    if code == 0 and request.upload and protocol in UPLOADERS and platform is not None:
        # Only when the request asks for uploading: PlatformIO requires every uploader of the platform for an upload
        # target, at the requirements the platform declares.
        specs = packages.uploaders(platform, protocol)
        if specs:
            code, _ = run.step("install-uploaders", [*command, "pkg", "install", "-g", *[a for s in specs for a in ("-t", s)]],
                               request.project, env)
    if code != 0:
        run.set_status("fail", "install-failed", f"PlatformIO's package installation exited {code}; see the step logs.")
    after = project_files(request.project)
    run["inputs"]["after"] = after
    moved = changed(before, after)
    if moved:
        run.set_status("error", "input-changed", f"Project files changed during the installation: {', '.join(moved[:4])}.")
    found = needed_for(ctx, tests=True)
    run["packages"] = found.as_json()
    run["missing"] = found.missing
    if code == 0 and found.missing:
        run.set_status("incomplete", "packages-missing", "Still missing after the installation: " + ", ".join(found.missing[:6]))
    run["core"] = {"platforms": [p.as_json() for p in packages.platforms(request.core)],
                   "packages": [p.as_json() for p in packages.tools(request.core)]}
    builddir.record(request, "prepare", run["runId"], run["status"])
    return run.finish({"environment": name, "packages": [{k: p.get(k) for k in ("kind", "name", "version")}
                                                         for p in run["packages"]], "missing": found.missing})
