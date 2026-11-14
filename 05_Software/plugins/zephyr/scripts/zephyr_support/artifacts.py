"""Artifacts and memory use of an owned build folder (spec REQ-DATA-d8ecee6a section 7, REQ-FUNC-d30944ca)."""

from __future__ import annotations

import re
import shutil
from pathlib import Path
from typing import Any

from . import elf
from .result import sha256

# Role, path below the build folder, copied name in the run folder.
OUTPUTS = [
    ("elf", "zephyr/zephyr.elf", "zephyr.elf"),
    ("hex", "zephyr/zephyr.hex", "zephyr.hex"),
    ("bin", "zephyr/zephyr.bin", "zephyr.bin"),
    ("config", "zephyr/.config", "config"),
    ("devicetree", "zephyr/zephyr.dts", "zephyr.dts"),
    ("map", "zephyr/zephyr.map", "zephyr.map"),
    ("build-info", "build_info.yml", "build_info.yml"),
    ("runners", "zephyr/runners.yaml", "runners.yaml"),
]
IMAGES = {"elf", "hex", "bin"}
REGION = re.compile(r"^\s*([A-Za-z0-9_]+):\s+(\d+)\s+(B|KB|MB|GB)\s+(\d+)\s+(B|KB|MB|GB)\s+([0-9.]+)%")
UNITS = {"B": 1, "KB": 1024, "MB": 1024 * 1024, "GB": 1024 ** 3}


def collect(build_dir: Path, run_folder: Path | None) -> tuple[list[dict[str, Any]], list[str]]:
    """Every output with its hash; copies into `<run>/artifacts/` when a run folder is given; missing roles."""
    found: list[dict[str, Any]] = []
    missing: list[str] = []
    target = run_folder / "artifacts" if run_folder is not None else None
    if target is not None:
        target.mkdir(exist_ok=True)
    for role, source, name in OUTPUTS:
        path = build_dir / source
        if not path.is_file():
            missing.append(role)
            continue
        entry: dict[str, Any] = {"role": role, "source": str(path), "sha256": sha256(path), "size": path.stat().st_size}
        if target is not None:
            shutil.copyfile(path, target / name)
            entry["path"] = f"artifacts/{name}"
            if sha256(target / name) != entry["sha256"]:
                entry["copy"] = "changed-while-copying"
        found.append(entry)
    return found, missing


def regions(log: Path | None) -> list[dict[str, Any]]:
    """The linker's memory region table (Zephyr prints it after the final link)."""
    if log is None:
        return []
    table: list[dict[str, Any]] = []
    try:
        lines = log.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return table
    for line in lines:
        match = REGION.match(line)
        if match:
            used = int(match.group(2)) * UNITS[match.group(3)]
            total = int(match.group(4)) * UNITS[match.group(5)]
            entry = {"name": match.group(1), "used": used, "size": total, "percent": float(match.group(6))}
            table = [row for row in table if row["name"] != entry["name"]] + [entry]
    return table


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
