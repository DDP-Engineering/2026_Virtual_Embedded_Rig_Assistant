"""Owned PlatformIO build folders (spec REQ-DATA-865c8fbd section 6, REQ-REL-7dde63c1, REQ-SEC-4a902240).

A build folder belongs to VERA only while it carries the marker `.vera-platformio-build.json`. The marker binds it to
one project, environment and core folder (the request fingerprint). PlatformIO's workspace of each operation family
(build, test-host, test-device) is a subfolder; `libdeps/` is shared and written only by prepare-packages. Deletion
re-checks marker and placement and walks the tree without following links or junctions: a link is removed, its
target stays.
"""

from __future__ import annotations

import json
import os
import stat
from pathlib import Path
from typing import Any

from .errors import Refused
from .request import Request, fingerprint
from .result import now

MARKER = ".vera-platformio-build.json"
FAMILIES = ("build", "test-host", "test-device")


def _is_link(path: Path) -> bool:
    try:
        return path.is_symlink() or (hasattr(path, "is_junction") and path.is_junction())
    except OSError:
        return True


def read_marker(folder: Path) -> dict[str, Any] | None:
    try:
        data = json.loads((folder / MARKER).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict) or data.get("format") != 1 or data.get("kind") != "platformio-build-dir":
        return None
    if not isinstance(data.get("fingerprint"), str) or not isinstance(data.get("runs", {}), dict):
        return None
    return data


def _owned(request: Request) -> dict[str, Any]:
    folder = request.build_dir
    if _is_link(folder):
        raise Refused("build-dir-foreign", f"{request.build_dir_text} is a link; VERA never builds into or deletes it.")
    marker = read_marker(folder)
    if marker is None:
        raise Refused("build-dir-foreign", f"{request.build_dir_text} exists without VERA's platformio build marker; "
                      "VERA neither reuses nor deletes it. Choose another buildDir or remove it yourself.")
    return marker


def remove_tree(folder: Path) -> int:
    """Deletes a folder without following links or junctions; returns the number of entries removed."""
    if _is_link(folder):
        try:
            os.rmdir(folder) if os.name == "nt" else os.unlink(folder)
        except OSError:
            os.unlink(folder)
        return 1
    removed = 0
    for root, folders, _files in os.walk(folder, topdown=True, followlinks=False):
        root_path = Path(root)
        for name in list(folders):
            child = root_path / name
            if _is_link(child):
                try:
                    os.rmdir(child) if os.name == "nt" else os.unlink(child)
                except OSError:
                    os.unlink(child)
                folders.remove(name)
                removed += 1
    for root, folders, files in os.walk(folder, topdown=False, followlinks=False):
        root_path = Path(root)
        for name in files:
            child = root_path / name
            if os.name == "nt" and not child.is_symlink():
                try:  # Clears the read-only attribute; never touches a link's target.
                    os.chmod(child, stat.S_IWRITE | stat.S_IREAD)
                except OSError:
                    pass
            os.unlink(child)
            removed += 1
        for name in folders:
            os.rmdir(root_path / name)
            removed += 1
    os.rmdir(folder)
    return removed + 1


def _write(request: Request, marker: dict[str, Any]) -> None:
    temporary = request.build_dir / (MARKER + ".tmp")
    temporary.write_text(json.dumps(marker, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, request.build_dir / MARKER)


def precheck(request: Request, pristine: bool) -> None:
    """The refusals of `claim`, without changing anything (run before the run folder exists)."""
    folder = request.build_dir
    if folder.exists() or _is_link(folder):
        marker = _owned(request)
        if marker["fingerprint"] != fingerprint(request) and not pristine:
            raise Refused("build-dir-mismatch", f"{request.build_dir_text} belongs to another project, environment or "
                          f"core folder ({marker.get('project')} / {marker.get('environment')}); use another buildDir "
                          "or --pristine.")


def claim(request: Request, family: str, pristine: bool, run_id: str) -> str:
    """Prepares the build folder for a family: `created`, `reused` or `pristine`."""
    folder = request.build_dir
    wanted = fingerprint(request)
    if folder.exists() or _is_link(folder):
        marker = _owned(request)
        if marker["fingerprint"] == wanted and not pristine:
            state = "reused"
        elif not pristine:
            raise Refused("build-dir-mismatch", f"{request.build_dir_text} belongs to another project, environment "
                          "or core folder; use another buildDir or --pristine.")
        else:
            for name in FAMILIES:
                if (folder / name).exists() or _is_link(folder / name):
                    remove_tree(folder / name)
            marker = {**marker, "fingerprint": wanted, "project": str(request.project),
                      "environment": request.environment, "core": str(request.core), "runs": {}}
            state = "pristine"
    else:
        folder.mkdir(parents=True)
        marker = {"format": 1, "kind": "platformio-build-dir", "fingerprint": wanted, "project": str(request.project),
                  "environment": request.environment, "core": str(request.core), "created": now(), "runId": run_id,
                  "runs": {}}
        state = "created"
    marker.setdefault("runs", {})[family] = {"runId": run_id, "status": "running", "updated": now()}
    _write(request, marker)
    if family in FAMILIES:
        (folder / family).mkdir(exist_ok=True)
    return state


def record(request: Request, family: str, run_id: str, status: str, extra: dict[str, Any] | None = None) -> None:
    """Notes a family's last run and outcome in the marker (read by `artifacts` and upload)."""
    marker = read_marker(request.build_dir)
    if marker is None:
        return
    marker.setdefault("runs", {})[family] = {"runId": run_id, "status": status, "updated": now(), **(extra or {})}
    _write(request, marker)


def check_owned(request: Request) -> dict[str, Any]:
    if not request.build_dir.exists():
        raise Refused("build-dir-foreign", f"{request.build_dir_text} does not exist; build first.")
    marker = _owned(request)
    if marker["fingerprint"] != fingerprint(request):
        raise Refused("build-dir-mismatch", f"{request.build_dir_text} belongs to another project, environment or core folder.")
    return marker


def clean(request: Request) -> list[str]:
    if not request.build_dir.exists() and not _is_link(request.build_dir):
        raise Refused("build-dir-foreign", f"{request.build_dir_text} does not exist; nothing to clean.")
    marker = check_owned(request)
    removed: list[str] = []
    for name in FAMILIES:
        target = request.build_dir / name
        if target.exists() or _is_link(target):
            remove_tree(target)
            removed.append(name)
    marker["runs"] = {}
    _write(request, marker)
    return removed
