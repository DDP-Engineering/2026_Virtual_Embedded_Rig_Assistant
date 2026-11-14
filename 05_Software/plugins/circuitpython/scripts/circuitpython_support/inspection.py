"""identify, inspect-code and inspect-libraries: reads of a CIRCUITPY volume (spec REQ-DATA-8f309a53).

REQ-FUNC-96d699ae (identify), REQ-FUNC-33fb01a8 (inspect-code; settings.toml and secrets.py never read),
REQ-FUNC-e51d0294 (inspect-libraries: .mpy ABI verdicts). Nothing here writes to the volume.
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
from typing import Any

from . import conventions, volumes, workspace
from .report import problem

LIST_LIMIT = 2000
DEPTH = 8
HASH_LIMIT = 1024 * 1024
STARTUP = ("code.txt", "code.py", "main.txt", "main.py")
SECRETS = frozenset({"settings.toml", "secrets.py"})
SKIPPED = frozenset({".fseventsd", ".trashes", "system volume information", ".metadata_never_index"})


def sha256_file(path: Path, limit: int | None = None) -> str | None:
    digest = hashlib.sha256()
    total = 0
    with open(path, "rb") as handle:
        while chunk := handle.read(65536):
            total += len(chunk)
            if limit is not None and total > limit:
                return None
            digest.update(chunk)
    return digest.hexdigest()


def secret(name: str) -> bool:
    return name.casefold() in SECRETS


def startup_file(root: Path) -> str | None:
    """The file CircuitPython runs at start: the first of code.txt, code.py, main.txt, main.py that exists."""
    for name in STARTUP:
        if (root / name).is_file():
            return "/" + name
    return None


def identify(entry: dict[str, Any], firmware: dict[str, Any], document: dict[str, Any]) -> None:
    document["platform"] = conventions.platform(firmware["major"])
    document["mpyHeader"] = "C6"
    document["filesystem"] = volumes.space(entry)
    document["readOnly"] = entry["readOnly"]
    document["port"] = entry["port"]


def _walk(root: Path) -> tuple[list[dict[str, Any]], int]:
    entries: list[dict[str, Any]] = []
    omitted = 0
    stack: list[tuple[Path, int]] = [(root, 0)]
    while stack:
        folder, depth = stack.pop()
        try:
            children = sorted(os.scandir(folder), key=lambda item: item.name.casefold())
        except OSError:
            continue
        for child in children:
            if child.name.casefold() in SKIPPED or child.name.startswith("._"):
                continue
            if len(entries) >= LIST_LIMIT:
                omitted += 1
                continue
            path = "/" + Path(os.path.relpath(child.path, root)).as_posix()
            try:
                if child.is_dir(follow_symlinks=False):
                    entries.append({"path": path, "type": "dir"})
                    if depth + 1 < DEPTH:
                        stack.append((Path(child.path), depth + 1))
                    continue
                size = child.stat(follow_symlinks=False).st_size
            except OSError:
                continue
            item: dict[str, Any] = {"path": path, "type": "file", "size": size}
            if secret(child.name):
                item["secret"] = True
            elif size <= HASH_LIMIT:
                try:
                    item["sha256"] = sha256_file(Path(child.path), HASH_LIMIT)
                except OSError:
                    item["sha256"] = None
            entries.append(item)
    entries.sort(key=lambda item: item["path"].casefold())
    return entries, omitted


def inspect_code(cwd: Path, folder: Path, entry: dict[str, Any], document: dict[str, Any]) -> None:
    root = Path(entry["path"])
    entries, omitted = _walk(root)
    document["entries"] = entries
    document["omitted"] = omitted
    start = startup_file(root)
    document["startup"] = start
    copies = []
    for name in [start, "/boot.py"]:
        if not name or not (root / name[1:]).is_file():
            continue
        source = root / name[1:]
        if source.stat().st_size > HASH_LIMIT:
            document["warnings"].append(problem("too-large", f"{name} has more than 1 MiB and was not copied."))
            continue
        local = folder / "files" / name[1:]
        local.parent.mkdir(exist_ok=True)
        data = source.read_bytes()
        local.write_bytes(data)
        copies.append({"remote": name, "path": workspace.relative(cwd, local), "size": len(data), "sha256": hashlib.sha256(data).hexdigest()})
    document["copies"] = copies


def _mpy_files(path: Path) -> list[Path]:
    if path.is_file():
        return [path] if path.suffix == ".mpy" else []
    return sorted(item for item in path.rglob("*.mpy") if item.is_file())


def _head(path: Path) -> bytes:
    with open(path, "rb") as handle:
        return handle.read(2)


def module_entry(root: Path, path: Path) -> dict[str, Any] | None:
    """One /lib module: kind, version and ABI verdict (REQ-FUNC-e51d0294)."""
    if path.name.startswith("."):
        return None
    if path.is_dir():
        kind, name = "package", path.name
    elif path.suffix in (".mpy", ".py"):
        kind, name = path.suffix[1:], path.stem
    else:
        return None
    mpys = _mpy_files(path)
    bad = []
    for item in mpys:
        try:
            if not conventions.mpy_compatible(_head(item)):
                bad.append("/" + Path(os.path.relpath(item, root)).as_posix())
        except OSError:
            bad.append("/" + Path(os.path.relpath(item, root)).as_posix())
    if kind == "package":
        candidates = sorted(item for item in path.rglob("*") if item.suffix in (".py", ".mpy") and item.is_file())
        files = len([item for item in path.rglob("*") if item.is_file()])
    else:
        candidates, files = [path], 1
    version = None
    for candidate in candidates:
        version = conventions.version(str(candidate))
        if version:
            break
    return {
        "name": name,
        "path": "/" + Path(os.path.relpath(path, root)).as_posix(),
        "kind": kind,
        "version": version,
        "abi": "incompatible" if bad else ("compatible" if mpys else "source"),
        "files": files,
        "incompatibleFiles": bad,
    }


def inspect_libraries(entry: dict[str, Any], firmware: dict[str, Any], document: dict[str, Any]) -> None:
    root = Path(entry["path"])
    lib = root / "lib"
    modules = []
    if lib.is_dir():
        for child in sorted(lib.iterdir(), key=lambda item: item.name.casefold()):
            found = module_entry(root, child)
            if found:
                modules.append(found)
    document["platform"] = conventions.platform(firmware["major"])
    document["modules"] = modules
    for module in modules:
        if module["abi"] == "incompatible":
            files = ", ".join(module["incompatibleFiles"][:5])
            document["warnings"].append(problem("mpy-incompatible", f"{module['name']} holds .mpy files that are not CircuitPython 9+ bytecode ({files}); CircuitPython {firmware['version']} cannot import them."))
    if not lib.is_dir():
        document["warnings"].append(problem("no-lib", "The volume has no /lib folder."))

