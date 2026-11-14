"""Firmware checks against a profile before anything runs (spec REQ-DATA-8a943977 section 4, REQ-FUNC-ebfa3d95,
REQ-REL-0423211e). Every check has its own refusal code; a refused firmware never reaches the engine."""

from __future__ import annotations

import re
import struct
from pathlib import Path
from typing import Any

from . import elf
from .errors import Refused
from .profiles import Profile

FIRMWARE_BYTES = 32 * 1024 * 1024
ADDRESS = re.compile(r"0x[0-9a-fA-F]{1,8}")
PT_LOAD = 1
ET_EXEC = 2


def _region(profile: Profile, start: int, end: int) -> tuple[str, str] | None:
    for name, kind, base, size in profile.regions():
        if base <= start and end <= base + size:
            return name, kind
    return None


def check(profile: Profile, path: Path, shown: str, arch: str, boot: str) -> dict[str, Any]:
    """The validation document of a firmware that fits the profile; raises Refused with the first failed check."""
    try:
        size = path.stat().st_size
    except OSError as error:
        raise Refused("elf", f"The firmware cannot be read: {error.strerror or error}.") from error
    if size > FIRMWARE_BYTES:
        raise Refused("elf", "The firmware is larger than 32 MiB.")
    try:
        image = elf.read(path)
    except elf.ElfError as error:
        raise Refused("elf", f"{shown}: {error}") from error
    if image.bits != 32 or image.endian != "little":
        raise Refused("elf-class", f"{shown} is a {image.bits}-bit {image.endian}-endian ELF; profile {profile.id} runs 32-bit little-endian firmware.")
    if image.machine != 40:
        raise Refused("machine", f"{shown} is built for {image.machine_name}, not ARM; profile {profile.id} simulates a {profile.arch}.")
    if image.type != ET_EXEC:
        raise Refused("elf-type", f"{shown} is not an executable ELF ({elf.TYPES.get(image.type, image.type)}).")
    if arch != profile.arch:
        raise Refused("arch-mismatch", f"--arch {arch[:32]} does not match profile {profile.id}, which simulates a {profile.arch}.")
    notes: list[str] = []
    try:
        attributes = image.arm_attributes()
    except elf.ElfError as error:
        raise Refused("elf", f"{shown}: {error}") from error
    isa = elf.arm_arch(attributes)
    if isa is None:
        notes.append("no-attributes: the ELF declares no ARM architecture; only the stated --arch was checked.")
    elif isa != profile.isa:
        raise Refused("arch-mismatch", f"{shown} is built for {isa}; profile {profile.id} ({profile.arch}) runs {profile.isa}.")
    if not ADDRESS.fullmatch(boot) or int(boot, 16) != profile.boot:
        raise Refused("boot-address", f"--boot-address {boot[:20]} is not the boot address {profile.data['boot']} of profile {profile.id}.")
    segments: list[dict[str, Any]] = []
    vector: bytes | None = None
    for segment in image.segments:
        if segment.type != PT_LOAD or (segment.filesz == 0 and segment.memsz == 0):
            continue
        for label, start, length in (("load", segment.paddr, segment.filesz), ("run", segment.vaddr, segment.memsz)):
            if length == 0:
                continue
            region = _region(profile, start, start + length)
            if region is None:
                raise Refused(
                    "memory-map",
                    f"{shown}: a loadable segment ({label} address {start:#010x}, {length} bytes) lies outside every "
                    f"memory region of profile {profile.id}.",
                    {"segment": {"address": f"{start:#010x}", "bytes": length}},
                )
            segments.append({"address": f"{start:#010x}", "bytes": length, "use": label, "region": region[0]})
        if segment.filesz >= 8 and segment.paddr <= profile.boot < segment.paddr + segment.filesz - 7:
            offset = segment.offset + profile.boot - segment.paddr
            vector = image.data[offset:offset + 8]
    if vector is None or len(vector) != 8:
        raise Refused("vector-table", f"{shown}: no loadable data at the boot address {profile.boot:#010x} holds a vector table.")
    stack, reset = struct.unpack("<II", vector)
    ram = [(base, base + size) for _name, kind, base, size in profile.regions() if kind == "ram"]
    flash = [(base, base + size) for _name, kind, base, size in profile.regions() if kind == "flash"]
    if not any(base < stack <= end for base, end in ram):
        raise Refused("vector-table", f"{shown}: the initial stack pointer {stack:#010x} lies outside the profile's RAM.")
    if not reset & 1 or not any(base <= (reset & ~1) < end for base, end in flash):
        raise Refused("vector-table", f"{shown}: the reset vector {reset:#010x} is not a Thumb address inside the profile's flash.")
    return {
        "status": "validated",
        "path": shown,
        "sha256": image.sha256,
        "bytes": size,
        "buildId": image.build_id(),
        "entry": f"{image.entry:#010x}",
        "arch": arch,
        "isa": isa,
        "bootAddress": f"{profile.boot:#010x}",
        "vectorTable": {"initialSp": f"{stack:#010x}", "reset": f"{reset:#010x}"},
        "segments": segments,
        "notes": notes,
    }
