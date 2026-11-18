"""The candidate's project context (spec REQ-DATA-891d5b5d §3): the board, its project file and design rules, the
footprint library table and the schematics of its folder, copied byte for byte into the run folder. The source is
only read; each file's hash is that of the bytes copied. A library table that would make KiCad contact another host
is left out, with a warning."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

from . import workspace
from .request import refuse

FILE_LIMIT = 64 * 1024 * 1024
TOTAL_LIMIT = 256 * 1024 * 1024
SCHEMATICS = 64
# KiCad 10 reads library tables without escapes, so a quoted text ends at the next quotation mark.
_ENTRY = re.compile(r'\(\s*(name|uri)\s+(?:"([^"]*)"|([^\s()]+))')
_URL = re.compile(r"[A-Za-z][A-Za-z0-9+.-]+://")  # two letters at least: `C://libs` is a local path


def _network(path: str) -> bool:
    """A path on another host: two leading slashes or backslashes (UNC, device), Windows' NT prefix, or a URL. The
    kicad plugin's project check refuses the same paths."""
    text = path.strip().replace("/", "\\")
    return text.startswith(("\\\\", "\\??\\")) or _URL.match(path.strip()) is not None


def _network_variable(project: bytes) -> str | None:
    """The first text variable of a project file whose value is a network path; a library path may use it."""
    try:
        variables = json.loads(project.decode("utf-8-sig")).get("text_variables")
    except (ValueError, AttributeError, RecursionError):
        return None
    for name, value in variables.items() if isinstance(variables, dict) else ():
        if isinstance(value, str) and _network(value):
            return f"the project's text variable {json.dumps(str(name)[:60])} holds a network path ({json.dumps(value[:120])})"
    return None


def _network_library(table: bytes) -> str | None:
    """The first entry of a library table whose path lies on another host."""
    name = ""
    for key, quoted, bare in _ENTRY.findall(table.decode("utf-8", errors="replace")):
        value = quoted or bare
        if key == "name":
            name = value
        elif _network(value):
            return f"its library {json.dumps(name[:60])} names a network path ({json.dumps(value[:120])})"
    return None


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


def copy(cwd: Path, board: Path, target: Path) -> tuple[list[dict[str, Any]], list[str]]:
    """Copies the context into `target` (created here) and returns the inputs with their hashes, and a warning when
    the library table was left out."""
    target.mkdir()
    inputs: list[dict[str, Any]] = []
    warnings: list[str] = []
    variable: str | None = None
    total = 0
    for source in context(board):
        if source.stat().st_size > FILE_LIMIT:
            raise refuse("path", "--board", f"{source.name} is larger than {FILE_LIMIT // (1024 * 1024)} MiB.")
        data = source.read_bytes()
        if source.suffix == ".kicad_pro":
            variable = _network_variable(data)
        if source.name == "fp-lib-table":
            reason = _network_library(data) or variable
            if reason:
                # KiCad on Windows contacts the host of a UNC library path as soon as it opens the board.
                warnings.append(f"fp-lib-table was not copied into the candidate folder: {reason}, and KiCad would "
                                "contact that host. DRC reports the project's footprint libraries as missing instead.")
                continue
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
    return inputs, warnings


def lock_files(folder: Path) -> list[Path]:
    """KiCad's lock files (`~<name>.lck`) in a folder."""
    return sorted(p for p in folder.glob("~*.lck") if p.is_file())
