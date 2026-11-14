"""prepare-workspace: the only operation that contacts the network (spec REQ-DATA-d8ecee6a section 3,
REQ-FUNC-cf1cadee).

`west init -l` creates `.west/config` from the local manifest folder when it is missing (no network); `west update
--narrow -o=--depth=1` then fetches exactly the manifest's projects. Afterwards every checkout must be at the request's
revision, otherwise the run is `error` naming the projects.
"""

from __future__ import annotations

import sys
from pathlib import Path

from . import environment, model
from .ops import context, describe, require_clean
from .result import Run


def prepare(cwd: Path, spelled: Path, raw: str, results: str | None) -> int:
    ctx = context(cwd, spelled, raw, "prepare-workspace")
    require_clean(ctx)
    run = Run("prepare-workspace", "workspace")
    run.document.update(describe(ctx))
    run.create_folder(cwd, spelled, results)
    assert run.folder is not None
    request = ctx.request
    env = environment.build(run.folder, ctx.workspace.zephyr, offline=False)
    code = 0
    if not (request.workspace / ".west").exists():
        code, _ = run.step("init", [sys.executable, "-m", "west", "init", "-l", request.manifest], request.workspace, env)
    if code == 0:
        code, _ = run.step("update", [sys.executable, "-m", "west", "update", "--narrow", "-o=--depth=1"],
                           request.workspace, env)
    if code != 0:
        run.set_status("error", "west-failed", f"west exited {code}; see the step logs.")
    after = model.load(request.workspace, request.manifest)
    projects = []
    differing = []
    for project in after.projects:
        wanted = request.projects.get(project.name)
        projects.append({"name": project.name, "path": str(project.path), "revision": wanted, "head": project.head})
        if wanted is None or project.head != wanted:
            differing.append(project.name)
    run["workspace"] = {"topdir": str(request.workspace), "projects": projects}
    if differing:
        run.set_status("error", "project-checkout", f"Not at the requested revision afterwards: {', '.join(differing)}.")
    return run.finish({"projects": projects})
