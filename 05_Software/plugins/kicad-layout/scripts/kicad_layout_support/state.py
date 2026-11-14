"""The run folder's files (spec REQ-DATA-891d5b5d §3, §4): state.json, the inventories, requests and reports, each
written whole (a temporary file and a rename), and the run folder an edit or close names."""

from __future__ import annotations

import hashlib
import json
import os
import re
from pathlib import Path
from typing import Any

from . import workspace
from .request import refuse

KIND = "kicad-layout-state"
_SHA = re.compile(r"^[0-9a-f]{64}$")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def write_json(path: Path, data: Any) -> None:
    write_text(path, json.dumps(data, indent=2, ensure_ascii=False) + "\n")


def write_text(path: Path, text: str) -> None:
    """Written through a temporary file and a rename, so a reader never sees half a file; no temporary file is left."""
    temporary = path.with_name(f".{path.name}.tmp")
    try:
        temporary.write_text(text, encoding="utf-8", newline="\n")
        os.replace(temporary, path)
    except OSError:
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            pass
        raise


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def run_folder(cwd: Path, raw: str, spelled: Path) -> Path:
    """The run folder `--run` names: inside the working directory and holding a kicad-layout state.json."""
    try:
        folder = workspace.confined(cwd, raw, "--run", spelled)
    except workspace.PathRefused as error:
        raise refuse("run", "--run", str(error)) from error
    if not (folder / "state.json").is_file():
        raise refuse("run", "--run", f"'{raw[:120]}' is not a kicad-layout run folder (it holds no state.json).")
    return folder


def read_state(folder: Path) -> dict[str, Any]:
    try:
        state = read_json(folder / "state.json")
        valid = (
            state.get("format") == 1 and state.get("kind") == KIND
            and isinstance(state.get("source", {}).get("path"), str)
            and _SHA.match(str(state.get("source", {}).get("sha256", "")))
            and isinstance(state.get("candidate", {}).get("path"), str)
            and _SHA.match(str(state.get("candidate", {}).get("sha256", "")))
            and _SHA.match(str(state.get("candidate", {}).get("memorySha256", "")))
            and isinstance(state.get("editor", {}).get("pid"), int)
            and isinstance(state.get("edits"), int)
        )
    except (OSError, ValueError, AttributeError):
        valid = False
    if not valid:
        raise refuse("run", "--run", "The run folder's state.json is not a kicad-layout state of format 1.")
    return state


def candidate_path(folder: Path, state: dict[str, Any]) -> Path:
    path = (folder / state["candidate"]["path"]).resolve()
    if not workspace.inside(folder.resolve(), path) or path.suffix.lower() != ".kicad_pcb" or not path.is_file():
        raise refuse("run", "--run", "The run folder's candidate is not a .kicad_pcb file inside it.")
    return path


def created(folder: Path) -> list[dict[str, Any]]:
    """The items created by every saved edit (created.json), in order."""
    path = folder / "created.json"
    if not path.is_file():
        return []
    try:
        items = read_json(path)
    except (OSError, ValueError):
        return []
    return items if isinstance(items, list) else []
