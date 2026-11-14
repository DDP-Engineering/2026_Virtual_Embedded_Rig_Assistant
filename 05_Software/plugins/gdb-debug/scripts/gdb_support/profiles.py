"""Board and probe profiles of the gdb-debug package (spec REQ-DATA-d7da2a71 section 3, REQ-SEC-593220cf).

A profile is data: the OpenOCD interface and target script names (from OpenOCD's own scripts folder, never a project
file), the GDB architecture, the expected core, its fault model and the memory regions GDB may read.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

from .errors import Refused
from .faults import MODELS

PROFILE_ID = re.compile(r"[a-z0-9][a-z0-9-]{0,63}")
SCRIPT = re.compile(r"(?:interface|target|board)/[a-z0-9_][a-z0-9_.-]{0,63}\.cfg")
HEX4 = re.compile(r"[0-9a-f]{4}")
ARCHITECTURES = {"armv6-m", "armv7-m", "armv7e-m", "armv8-m.base", "armv8-m.main"}
# ELF Tag_CPU_arch names each profile architecture can run.
RUNS = {
    "v6-M": {"v6-M", "v6S-M"},
    "v7-M": {"v6-M", "v6S-M", "v7-M"},
    "v7E-M": {"v6-M", "v6S-M", "v7-M", "v7E-M"},
    "v8-M.base": {"v6-M", "v6S-M", "v8-M.base"},
    "v8-M.main": {"v6-M", "v6S-M", "v7-M", "v7E-M", "v8-M.base", "v8-M.main"},
}
KEYS = {"format", "id", "status", "description", "probe", "openocd", "gdb", "core", "memory", "rtos"}


@dataclass(frozen=True)
class Profile:
    id: str
    status: str
    description: str
    vid: str
    pids: tuple[str, ...]
    interface: str
    target: str
    speed: int | None
    architecture: str
    core: str
    partno: int
    arch: str
    faults: str
    flash: tuple[tuple[int, int], ...]
    ram: tuple[tuple[int, int], ...]

    def in_ram(self, address: int, size: int) -> bool:
        return any(start <= address and address + size <= start + length for start, length in self.ram)


def _bad(profile: str, what: str) -> Refused:
    return Refused("profile", f"Profile {profile} is not valid: {what}.")


def _regions(name: str, raw: object, field: str) -> tuple[tuple[int, int], ...]:
    if not isinstance(raw, list) or not 1 <= len(raw) <= 8:
        raise _bad(name, f"memory.{field} must list 1 to 8 regions")
    out = []
    for region in raw:
        if not isinstance(region, dict) or set(region) != {"start", "size"}:
            raise _bad(name, f"memory.{field} regions have exactly start and size")
        start, size = region["start"], region["size"]
        if not isinstance(start, str) or not re.fullmatch(r"0x[0-9a-fA-F]{1,8}", start):
            raise _bad(name, f"memory.{field} start must be a 32-bit hex address")
        if not isinstance(size, int) or isinstance(size, bool) or not 0 < size <= 1 << 32:
            raise _bad(name, f"memory.{field} size must be a positive byte count")
        begin = int(start, 16)
        if begin + size > 1 << 32 or 0x40000000 <= begin < 0x60000000 or begin >= 0xE0000000:
            raise _bad(name, f"memory.{field} must not cover peripheral or system space")
        out.append((begin, size))
    return tuple(out)


def load(folder: Path, name: str) -> Profile:
    if not PROFILE_ID.fullmatch(name):
        raise Refused("profile", f"{name[:64]!r} is not a profile id.")
    path = folder / f"{name}.json"
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise Refused("profile", f"The package has no profile {name}.") from error
    except (OSError, ValueError) as error:
        raise _bad(name, "it is not readable JSON") from error
    if not isinstance(raw, dict) or set(raw) != KEYS or raw.get("format") != 1 or raw.get("id") != name:
        raise _bad(name, "it needs exactly the fields " + ", ".join(sorted(KEYS)) + " with format 1 and its own id")
    if raw["status"] not in ("unverified", "verified") or not isinstance(raw["description"], str):
        raise _bad(name, "status is unverified or verified and description is text")
    probe, openocd, gdb, core, memory = (raw[key] for key in ("probe", "openocd", "gdb", "core", "memory"))
    if not isinstance(probe, dict) or set(probe) != {"vid", "pids"} or not HEX4.fullmatch(str(probe["vid"])):
        raise _bad(name, "probe has a vid and pids of four lower-case hex digits")
    pids = probe["pids"]
    if not isinstance(pids, list) or not pids or not all(isinstance(p, str) and HEX4.fullmatch(p) for p in pids):
        raise _bad(name, "probe.pids lists four-digit lower-case hex product ids")
    if not isinstance(openocd, dict) or not {"interface", "target"} <= set(openocd) <= {"interface", "target", "speedKhz"}:
        raise _bad(name, "openocd names interface, target and optionally speedKhz")
    for key in ("interface", "target"):
        value = openocd[key]
        if not isinstance(value, str) or ".." in value or not SCRIPT.fullmatch(value):
            raise _bad(name, f"openocd.{key} must name a script of OpenOCD's interface/, target/ or board/ folder")
    speed = openocd.get("speedKhz")
    if speed is not None and (not isinstance(speed, int) or isinstance(speed, bool) or not 1 <= speed <= 100000):
        raise _bad(name, "openocd.speedKhz is 1...100000")
    if not isinstance(gdb, dict) or set(gdb) != {"architecture"} or gdb["architecture"] not in ARCHITECTURES:
        raise _bad(name, "gdb.architecture is one of " + ", ".join(sorted(ARCHITECTURES)))
    if (
        not isinstance(core, dict)
        or set(core) != {"name", "partno", "arch", "faults"}
        or core["arch"] not in RUNS
        or core["faults"] not in MODELS
        or not isinstance(core["name"], str)
        or not re.fullmatch(r"0x[0-9a-f]{3}", str(core["partno"]))
    ):
        raise _bad(name, "core has name, partno (0xNNN), arch (" + ", ".join(RUNS) + ") and faults (v6m, v7m, v8m)")
    if not isinstance(memory, dict) or set(memory) != {"flash", "ram"}:
        raise _bad(name, "memory has flash and ram")
    flash, ram = _regions(name, memory["flash"], "flash"), _regions(name, memory["ram"], "ram")
    spans = sorted([*flash, *ram])
    for (first, length), (second, _size) in zip(spans, spans[1:], strict=False):
        if first + length > second:
            raise _bad(name, "memory regions overlap")
    if raw["rtos"] != "none":
        raise _bad(name, "rtos must be none (no RTOS awareness is demonstrated)")
    return Profile(
        name,
        raw["status"],
        raw["description"],
        probe["vid"],
        tuple(pids),
        openocd["interface"],
        openocd["target"],
        speed,
        gdb["architecture"],
        core["name"],
        int(core["partno"], 16),
        core["arch"],
        core["faults"],
        flash,
        ram,
    )


def all_profiles(folder: Path) -> list[Profile]:
    return [load(folder, path.stem) for path in sorted(folder.glob("*.json"))]
