"""Artifacts and memory use of an owned PlatformIO build (spec REQ-DATA-865c8fbd section 7, REQ-FUNC-f4583edd,
REQ-FUNC-c54befe2)."""

from __future__ import annotations

import re
import shutil
from pathlib import Path
from typing import Any

from . import elf
from .result import sha256

# Role and file name below <workspace>/build/<env>/.
OUTPUTS = [("elf", "firmware.elf"), ("bin", "firmware.bin"), ("hex", "firmware.hex"), ("map", "firmware.map"),
           ("program", "program.exe"), ("program", "program")]
IMAGES = {"elf", "bin", "hex", "program"}
SIZE = re.compile(r"^(RAM|Flash):\s*\[[^\]]*\]\s*([0-9.]+)%\s*\(used (\d+) bytes from (\d+) bytes\)")


def output_dir(workspace: Path, environment: str) -> Path:
    return workspace / "build" / environment


def collect(folder: Path, run_folder: Path | None) -> tuple[list[dict[str, Any]], list[str]]:
    """Every output of an environment's build folder with its hash; copies into `<run>/artifacts/`."""
    found: list[dict[str, Any]] = []
    roles: set[str] = set()
    target = run_folder / "artifacts" if run_folder is not None else None
    if target is not None:
        target.mkdir(exist_ok=True)
    for role, name in OUTPUTS:
        path = folder / name
        if role in roles or not path.is_file():
            continue
        roles.add(role)
        entry: dict[str, Any] = {"role": role, "source": str(path), "sha256": sha256(path), "size": path.stat().st_size}
        if target is not None:
            shutil.copyfile(path, target / name)
            entry["path"] = f"artifacts/{name}"
            if sha256(target / name) != entry["sha256"]:
                entry["copy"] = "changed-while-copying"
        found.append(entry)
    missing = [role for role in ("elf", "bin") if role not in roles] if "program" not in roles else []
    return found, missing


def usage(log: Path | None) -> dict[str, Any]:
    """PlatformIO's own RAM/Flash summary (`checkprogsize`) of the build log."""
    result: dict[str, Any] = {}
    if log is None:
        return result
    try:
        lines = log.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return result
    for line in lines:
        match = SIZE.match(line.strip())
        if match:
            result[match.group(1).lower()] = {"used": int(match.group(3)), "limit": int(match.group(4)),
                                              "percent": float(match.group(2))}
    return result


def sections(elf_path: Path) -> dict[str, Any]:
    try:
        image = elf.read(elf_path)
    except elf.ElfError as error:
        return {"error": str(error)}
    alloc = [section for section in image.sections if section.flags & elf.SHF_ALLOC and section.size]
    text = sum(s.size for s in alloc if s.flags & 0x4)
    nobits = sum(s.size for s in alloc if s.type == elf.SHT_NOBITS)
    data = sum(s.size for s in alloc if not s.flags & 0x4 and s.type != elf.SHT_NOBITS)
    return {"machine": image.machine_name, "entry": f"0x{image.entry:08x}", "text": text, "data": data, "bss": nobits,
            "sections": [{"name": s.name, "addr": f"0x{s.addr:08x}", "size": s.size} for s in alloc][:64]}


def limits(board: dict[str, Any] | None) -> dict[str, Any]:
    upload = (board or {}).get("upload") or {}
    return {"flash": upload.get("maximum_size"), "ram": upload.get("maximum_ram_size")}
