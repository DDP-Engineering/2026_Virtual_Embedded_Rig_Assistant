"""Owned build folders (spec REQ-DATA-d8ecee6a section 6, REQ-REL-2de3e20e, REQ-SEC-01b0aa08).

A build folder belongs to VERA only while it carries the marker `.vera-zephyr-build.json` of the same operation
family. The marker binds the folder to one configuration (the request fingerprint). Deletion re-checks marker and
placement and walks the tree without following links or junctions: a link is removed, its target stays.
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

MARKER = ".vera-zephyr-build.json"


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
    if not isinstance(data, dict) or data.get("format") != 1 or data.get("kind") != "zephyr-build-dir":
        return None
    if not isinstance(data.get("fingerprint"), str) or data.get("family") not in ("build", "test-build"):
        return None
    return data


def _owned(request: Request, family: str | None) -> dict[str, Any]:
    folder = request.build_dir
    if _is_link(folder):
        raise Refused("build-dir-foreign", f"{request.build_dir_text} is a link; VERA never builds into or deletes it.")
    marker = read_marker(folder)
    if marker is None or (family is not None and marker["family"] != family):
        raise Refused("build-dir-foreign", f"{request.build_dir_text} exists without VERA's {family or 'zephyr'} build marker; "
                      "VERA neither reuses nor deletes it. Choose another buildDir or remove it yourself.")
    return marker


def remove_tree(folder: Path) -> int:
    """Deletes a folder without following links or junctions; returns the number of entries removed."""
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


def precheck(request: Request, family: str, pristine: bool) -> None:
    """The refusals of `claim`, without changing anything (run before the run folder exists)."""
    folder = request.build_dir
    if folder.exists() or _is_link(folder):
        marker = _owned(request, family)
        if marker["fingerprint"] != fingerprint(request, family) and not pristine:
            raise Refused("build-dir-mismatch", f"{request.build_dir_text} holds a build of another configuration "
                          f"(made by run {marker.get('runId')}); use another buildDir or --pristine.")


def claim(request: Request, family: str, pristine: bool, run_id: str) -> str:
    """Prepares the build folder: `created`, `reused` or `pristine`."""
    folder = request.build_dir
    wanted = fingerprint(request, family)
    state = "created"
    if folder.exists() or _is_link(folder):
        marker = _owned(request, family)
        if marker["fingerprint"] == wanted and not pristine:
            return "reused"
        if not pristine:
            raise Refused("build-dir-mismatch", f"{request.build_dir_text} holds a build of another configuration "
                          f"(made by run {marker.get('runId')}); use another buildDir or --pristine.")
        _owned(request, family)
        remove_tree(folder)
        state = "pristine"
    folder.mkdir(parents=True)
    marker = {"format": 1, "kind": "zephyr-build-dir", "family": family, "fingerprint": wanted, "created": now(),
              "runId": run_id, "request": str(request.path)}
    (folder / MARKER).write_text(json.dumps(marker, indent=2) + "\n", encoding="utf-8")
    return state


def record(request: Request, run_id: str, status: str, regions: list[dict[str, Any]]) -> None:
    """Notes the last run's outcome and memory regions in the marker (read by `artifacts`)."""
    marker = read_marker(request.build_dir)
    if marker is None:
        return
    marker.update({"lastRun": run_id, "lastStatus": status, "regions": regions, "updated": now()})
    temporary = request.build_dir / (MARKER + ".tmp")
    temporary.write_text(json.dumps(marker, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, request.build_dir / MARKER)


def mark_running(request: Request, run_id: str) -> None:
    record(request, run_id, "running", [])


def check_owned(request: Request, family: str | None = None) -> dict[str, Any]:
    if not request.build_dir.exists():
        raise Refused("build-dir-foreign", f"{request.build_dir_text} does not exist; build first.")
    return _owned(request, family)


def clean(request: Request) -> int:
    if not request.build_dir.exists() and not _is_link(request.build_dir):
        raise Refused("build-dir-foreign", f"{request.build_dir_text} does not exist; nothing to clean.")
    _owned(request, None)
    return remove_tree(request.build_dir)
