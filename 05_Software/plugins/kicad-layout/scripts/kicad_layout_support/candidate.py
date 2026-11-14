"""The candidate's project context (spec REQ-DATA-891d5b5d §3): the board, its project file and design rules, the
footprint library table and the schematics of its folder, copied byte for byte into the run folder. The source is
only read; each file's hash is that of the bytes copied."""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

from . import workspace
from .request import refuse

FILE_LIMIT = 64 * 1024 * 1024
TOTAL_LIMIT = 256 * 1024 * 1024
SCHEMATICS = 64


def context(board: Path) -> list[Path]:
    """The source files a candidate needs, the board first."""
    folder = board.parent
    stem = board.stem
    files = [board]
    for name in (f"{stem}.kicad_pro", f"{stem}.kicad_dru", "fp-lib-table"):
        if (folder / name).is_file():
            files.append(folder / name)
    schematics = sorted(p for p in folder.glob("*.kicad_sch") if p.is_file())
    return files + schematics[:SCHEMATICS]


def copy(cwd: Path, board: Path, target: Path) -> list[dict[str, Any]]:
    """Copies the context into `target` (created here) and returns the inputs with their hashes."""
    target.mkdir()
    inputs: list[dict[str, Any]] = []
    total = 0
    for source in context(board):
        if source.stat().st_size > FILE_LIMIT:
            raise refuse("path", "--board", f"{source.name} is larger than {FILE_LIMIT // (1024 * 1024)} MiB.")
        data = source.read_bytes()
        total += len(data)
        if total > TOTAL_LIMIT:
            raise refuse("path", "--board", f"The board's project files exceed {TOTAL_LIMIT // (1024 * 1024)} MiB.")
        (target / source.name).write_bytes(data)
        inputs.append({
            "path": workspace.relative(cwd, source),
            "role": "board" if source == board else "project",
            "bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
        })
    return inputs


def lock_files(folder: Path) -> list[Path]:
    """KiCad's lock files (`~<name>.lck`) in a folder."""
    return sorted(p for p in folder.glob("~*.lck") if p.is_file())
