"""Sketch folders: validation, file hashes, the combined source hash and the copy a compile works on.

A sketch is a folder holding `<folder name>.ino`. `sketch.yaml` and `sketch.json` stay out of the copy (their
`default_profile` would turn a compile into a profile build that installs platforms), as do a top-level `build`
folder (exported binaries) and hidden entries. Links are refused: a link could reach files outside the workbench.
"""

from __future__ import annotations

import hashlib
import os
import re
import shutil
from dataclasses import dataclass, field
from pathlib import Path

from . import workspace
from .environment import sha256_file

MAX_FILES = 2000
MAX_BYTES = 16 * 1024 * 1024
NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,62}")
IGNORED = ("sketch.yaml", "sketch.json")
YAML_KEY = re.compile(r"^([A-Za-z_]+)\s*:", re.M)


class SketchInvalid(Exception):
    """The folder is not a sketch VERA compiles; the message is meant for the user."""


@dataclass
class Sketch:
    folder: Path
    path: str
    name: str
    files: list[dict] = field(default_factory=list)
    excluded: list[str] = field(default_factory=list)
    ignored: list[dict] = field(default_factory=list)
    sha256: str = ""

    @property
    def main(self) -> str:
        return f"{self.name}.ino"


def combined(files: list[dict]) -> str:
    digest = hashlib.sha256()
    for item in sorted(files, key=lambda entry: entry["path"]):
        digest.update(f"{item['path']}\0{item['sha256']}\n".encode("utf-8"))
    return digest.hexdigest()


def scan(folder: Path, option: str = "--sketch") -> tuple[list[dict], list[str], list[dict]]:
    """The files of a sketch folder (relative POSIX path, hash, size), the excluded names and ignored project files."""
    files: list[dict] = []
    excluded: list[str] = []
    ignored: list[dict] = []
    total = 0
    root = os.path.realpath(folder)
    for current, folders, names in os.walk(folder, followlinks=False):
        here = Path(current)
        relative_dir = here.relative_to(folder)
        for name in sorted(folders):
            # A Windows junction is no symlink to Python, but its real path leaves the folder.
            if (here / name).is_symlink() or not workspace.inside(Path(root), Path(os.path.realpath(here / name))):
                raise SketchInvalid(f"{option} holds a link ({(relative_dir / name).as_posix()}); VERA does not follow links in a sketch.")
        keep = []
        for name in sorted(folders):
            if name.startswith(".") or (relative_dir == Path(".") and name == "build"):
                excluded.append((relative_dir / name).as_posix() + "/")
            else:
                keep.append(name)
        folders[:] = keep
        for name in sorted(names):
            path = here / name
            relative = (relative_dir / name).as_posix()
            if path.is_symlink() or not path.is_file() or not workspace.inside(Path(root), Path(os.path.realpath(path))):
                raise SketchInvalid(f"{option} holds {relative}, which is a link or not a regular file.")
            if relative_dir == Path(".") and name in IGNORED:
                text = path.read_text(encoding="utf-8", errors="replace")
                ignored.append({"path": name, "keys": sorted(set(YAML_KEY.findall(text)))})
                continue
            if name.startswith("."):
                excluded.append(relative)
                continue
            size = path.stat().st_size
            total += size
            if len(files) >= MAX_FILES or total > MAX_BYTES:
                raise SketchInvalid(f"{option} holds more than {MAX_FILES} files or {MAX_BYTES // (1024 * 1024)} MiB.")
            if not workspace.control_free(relative):
                raise SketchInvalid(f"{option} holds a file name with control characters.")
            files.append({"path": relative, "sha256": sha256_file(path), "bytes": size})
    return files, excluded, ignored


def load(cwd: Path, spelled: Path, raw: str, option: str = "--sketch") -> Sketch:
    try:
        folder = workspace.confined(cwd, raw, option, spelled)
    except workspace.PathRefused as error:
        raise SketchInvalid(str(error)) from error
    if not folder.is_dir():
        raise SketchInvalid(f"{option} '{raw[:120]}' is not a folder.")
    name = folder.name
    if not NAME.fullmatch(name):
        raise SketchInvalid(f"{option} '{raw[:120]}': a sketch folder name has 1-63 letters, digits, '_', '.' or '-' and starts with a letter or digit.")
    entries = {entry.name for entry in folder.iterdir()}
    if f"{name}.ino" not in entries or not (folder / f"{name}.ino").is_file():
        raise SketchInvalid(f"{option} '{raw[:120]}' holds no {name}.ino; a sketch's main file is named after its folder.")
    files, excluded, ignored = scan(folder, option)
    sketch = Sketch(folder=folder, path=workspace.relative(cwd, folder), name=name, files=files, excluded=excluded, ignored=ignored)
    sketch.sha256 = combined(files)
    return sketch


def copy(sketch: Sketch, target: Path) -> None:
    """Copies the sketch's files (not its excluded or ignored ones) to `target`."""
    for item in sketch.files:
        destination = target / item["path"]
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(sketch.folder / item["path"], destination)


def current(folder: Path) -> str | None:
    """The combined hash a sketch folder has now, or None when it is gone or no longer a valid sketch."""
    try:
        if not folder.is_dir():
            return None
        files, _, _ = scan(folder)
        return combined(files)
    except (OSError, SketchInvalid):
        return None
