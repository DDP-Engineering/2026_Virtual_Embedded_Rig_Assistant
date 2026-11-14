"""tools: the host tools, SDK candidates and, with a request, the workspace's versions (REQ-FUNC-b9bd62a7).

Reports only; selects nothing and builds nothing. A problem with the request's SDK or workspace is reported as a
problem, not as a refusal, so the report is always complete.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path
from typing import Any

from . import VERSION, boards, environment, model, sdk
from .errors import Refused
from .request import load
from .result import emit


def _version(command: list[str], pattern: str) -> str | None:
    try:
        done = subprocess.run(command, capture_output=True, timeout=30, stdin=subprocess.DEVNULL, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return None
    match = re.search(pattern, (done.stdout + done.stderr).decode("utf-8", errors="replace"))
    return match.group(1) if match else None


def tools(cwd: Path, spelled: Path, raw: str | None) -> int:
    from west.version import __version__ as west_version  # noqa: PLC0415

    cmake, ninja, git = environment.tool("cmake"), environment.tool("ninja"), environment.git()
    document: dict[str, Any] = {
        "format": 1, "kind": "zephyr-tools", "status": "pass", "helper": VERSION,
        "python": {"path": sys.executable, "version": sys.version.split()[0]},
        "west": {"version": west_version, "source": "helper environment"},
        "cmake": {"path": str(cmake) if cmake else None,
                  "version": _version([str(cmake), "--version"], r"cmake version (\S+)") if cmake else None},
        "ninja": {"path": str(ninja) if ninja else None,
                  "version": _version([str(ninja), "--version"], r"^(\d+\.\d+\.\d+)") if ninja else None},
        "git": {"path": str(git) if git else None,
                "version": _version([str(git), "--version"], r"git version (\S+)") if git else None},
        "sdkCandidates": sdk.candidates(),
        "supported": {"zephyr": ">=4.4,<4.6", "sdk": f">={sdk.MINIMUM}", "toolchainVariant": "zephyr",
                      "verifiedBoards": ["stm32f4_disco"]},
        "problems": [],
    }
    if raw is not None:
        request = load(cwd, spelled, raw)
        model.isolate_west_config()
        try:
            workspace = model.load(request.workspace, request.manifest)
            document["zephyr"] = {"base": str(workspace.zephyr), "version": workspace.version, "sdkMinimum": workspace.sdk_minimum}
            document["projects"] = [{"name": p.name, "head": p.head, "requested": request.projects.get(p.name)}
                                    for p in workspace.projects]
            board = boards.check(workspace.zephyr, request.board_name, request.board_revision, request.board_qualifiers)
            document["board"] = {"target": board.target, "arch": board.arch}
            found = sdk.check(request.sdk, board.toolchain, workspace.sdk_minimum)
            document["sdk"] = {"path": str(found.path), "version": found.version, "toolchain": str(found.toolchain),
                               "gcc": _version([str(found.toolchain), "--version"], r"\) (\d+\.\d+\.\d+)")}
        except Refused as problem:
            document["problems"].append({"code": problem.code, "reason": problem.message})
            document["status"] = "incomplete"
    emit(document)
    return 0
