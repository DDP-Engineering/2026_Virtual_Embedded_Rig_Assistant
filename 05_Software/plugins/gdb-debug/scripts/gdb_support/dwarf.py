"""A minimal DWARF 2-5 reader: compilation unit headers and the first DIE's name, producer and language.

Only what `gdb-elf inspect` reports is decoded (spec REQ-DATA-d7da2a71 section 6). A form whose value needs a table
this reader does not resolve (`strx`, supplementary files) leaves the attribute unknown; it is never guessed.
"""

from __future__ import annotations

import re
import struct
from dataclasses import dataclass, field

from .elf import Elf, ElfError

MAX_UNITS = 4096
LANGUAGES = {
    0x01: "C89",
    0x02: "C",
    0x04: "C++",
    0x0C: "C99",
    0x1A: "C++11",
    0x1C: "Rust",
    0x1D: "C11",
    0x21: "C++14",
    0x2C: "C17",
    0x2A: "C++17",
    0x2B: "C++20",
    0x8001: "assembler",
}
OPTIMIZATION = re.compile(r"(?:^|\s)-O(fast|[0-3sgz]?)(?=\s|$)")


@dataclass
class DebugInfo:
    present: bool = False
    sections: list[str] = field(default_factory=list)
    compressed: bool = False
    versions: set[int] = field(default_factory=set)
    units: int = 0
    producers: list[str] = field(default_factory=list)
    languages: list[str] = field(default_factory=list)
    unreadable: str | None = None

    def optimization(self) -> str:
        """The -O level the producers record: one level, `mixed`, or `unknown` when none records it."""
        levels = set()
        for producer in self.producers:
            found = OPTIMIZATION.findall(producer)
            if found:
                level = found[-1]
                levels.add("O1" if level == "" else f"O{level}")
        if not levels:
            return "unknown"
        return levels.pop() if len(levels) == 1 else "mixed"


class _Reader:
    def __init__(self, data: bytes, order: str, offset: int = 0, end: int | None = None) -> None:
        self.data, self.order, self.offset = data, order, offset
        self.end = len(data) if end is None else end

    def take(self, size: int) -> bytes:
        if size < 0 or self.offset + size > self.end:
            raise ElfError("DWARF data is truncated.")
        chunk = self.data[self.offset : self.offset + size]
        self.offset += size
        return chunk

    def unsigned(self, size: int) -> int:
        return int.from_bytes(self.take(size), "little" if self.order == "<" else "big")

    def uleb(self) -> int:
        value = shift = 0
        while True:
            byte = self.take(1)[0]
            value |= (byte & 0x7F) << shift
            if byte < 0x80:
                return value
            shift += 7
            if shift > 70:
                raise ElfError("A DWARF LEB128 value is too long.")

    def sleb(self) -> int:
        value = shift = 0
        while True:
            byte = self.take(1)[0]
            value |= (byte & 0x7F) << shift
            shift += 7
            if byte < 0x80:
                return value - (1 << shift) if byte & 0x40 else value
            if shift > 70:
                raise ElfError("A DWARF LEB128 value is too long.")

    def cstring(self) -> bytes:
        stop = self.data.find(b"\0", self.offset, self.end)
        if stop < 0:
            raise ElfError("A DWARF string is truncated.")
        text = self.data[self.offset : stop]
        self.offset = stop + 1
        return text


def _abbreviation(abbrev: bytes, offset: int, code: int) -> list[tuple[int, int, int]]:
    reader = _Reader(abbrev, "<", offset)
    while True:
        found = reader.uleb()
        if found == 0:
            raise ElfError("A DWARF abbreviation code is missing.")
        reader.uleb()  # tag
        reader.take(1)  # children
        specs: list[tuple[int, int, int]] = []
        while True:
            name, form = reader.uleb(), reader.uleb()
            implicit = reader.sleb() if form == 0x21 else 0
            if name == 0 and form == 0:
                break
            specs.append((name, form, implicit))
        if found == code:
            return specs


_FIXED = {0x0B: 1, 0x05: 2, 0x06: 4, 0x07: 8, 0x0C: 1, 0x11: 1, 0x12: 2, 0x13: 4, 0x14: 8, 0x1E: 16, 0x20: 8}
_FIXED.update({0x25: 1, 0x26: 2, 0x27: 3, 0x28: 4, 0x29: 1, 0x2A: 2, 0x2B: 3, 0x2C: 4, 0x1C: 4, 0x24: 8})


def _value(reader: _Reader, form: int, version: int, address_size: int, offset_size: int, strings: dict[str, bytes]):
    """Reads one attribute value; strings resolve through .debug_str/.debug_line_str, other forms are skipped."""
    for _ in range(4):  # DW_FORM_indirect names the real form; a chain of them is refused, never recursed.
        if form != 0x16:
            break
        form = reader.uleb()
    if form == 0x16:
        raise ElfError("A chain of DW_FORM_indirect forms is not supported.")
    if form in _FIXED:
        reader.take(_FIXED[form])
        return None
    if form == 0x01:  # addr
        reader.take(address_size)
    elif form in (0x03, 0x04, 0x09, 0x0A, 0x18):  # blocks and exprloc
        size = {0x03: lambda: reader.unsigned(2), 0x04: lambda: reader.unsigned(4), 0x0A: lambda: reader.unsigned(1)}
        reader.take(size[form]() if form in size else reader.uleb())
    elif form == 0x08:
        return reader.cstring()
    elif form in (0x0D,):
        reader.sleb()
    elif form in (0x0F, 0x15, 0x1A, 0x1B, 0x22, 0x23):
        reader.uleb()
    elif form in (0x0E, 0x1F):  # strp, line_strp
        offset = reader.unsigned(offset_size)
        table = strings["str" if form == 0x0E else "line_str"]
        stop = table.find(b"\0", offset)
        if offset >= len(table) or stop < 0:
            raise ElfError("A DWARF string offset lies outside its table.")
        return table[offset:stop]
    elif form in (0x10,):
        reader.take(address_size if version == 2 else offset_size)
    elif form in (0x17, 0x1D):
        reader.take(offset_size)
    elif form == 0x19:
        return None
    elif form == 0x21:
        return None
    else:
        raise ElfError(f"Unknown DWARF form 0x{form:x}.")
    return None


def read(elf: Elf) -> DebugInfo:
    info = DebugInfo()
    names = [section.name for section in elf.sections if section.name.startswith((".debug_", ".zdebug_"))]
    info.sections = names
    info.present = ".debug_info" in names or ".zdebug_info" in names
    info.compressed = any(
        name.startswith(".zdebug_") for name in names
    ) or any(section.flags & 0x800 for section in elf.sections if section.name in names)
    if not info.present:
        return info
    section = elf.section(".debug_info")
    abbrev_section = elf.section(".debug_abbrev")
    if section is None or abbrev_section is None:
        info.unreadable = "The debug information uses the legacy .zdebug compression or has no abbreviation table."
        return info
    try:
        data = elf.contents(section)
        abbrev = elf.contents(abbrev_section)
        strings = {}
        for key, name in (("str", ".debug_str"), ("line_str", ".debug_line_str")):
            found = elf.section(name)
            strings[key] = elf.contents(found) if found else b""
        _units(data, abbrev, elf.order, strings, info)
    except (ElfError, struct.error, KeyError, IndexError) as error:
        info.unreadable = f"The debug information could not be read completely: {error}"
    return info


def _units(data: bytes, abbrev: bytes, order: str, strings: dict[str, bytes], info: DebugInfo) -> None:
    """Walks the unit headers and reads the producer and language of each unit's first DIE."""
    producers: dict[str, None] = {}
    languages: dict[str, None] = {}
    offset = 0
    while offset + 11 <= len(data) and info.units < MAX_UNITS:
        reader = _Reader(data, order, offset)
        length = reader.unsigned(4)
        offset_size = 4
        if length == 0xFFFFFFFF:
            length = reader.unsigned(8)
            offset_size = 8
        if length == 0:
            break
        end = reader.offset + length
        if end > len(data):
            raise ElfError("A DWARF unit is truncated.")
        reader.end = end
        version = reader.unsigned(2)
        if version not in (2, 3, 4, 5):
            raise ElfError(f"DWARF version {version} is not supported.")
        if version == 5:
            unit_type = reader.unsigned(1)
            address_size = reader.unsigned(1)
            abbrev_offset = reader.unsigned(offset_size)
            if unit_type in (2, 6):  # type and split-type units carry a signature and an offset
                reader.take(8 + offset_size)
            elif unit_type in (4, 5):  # skeleton and split-compile units carry a DWO id
                reader.take(8)
        else:
            abbrev_offset = reader.unsigned(offset_size)
            address_size = reader.unsigned(1)
        info.units += 1
        info.versions.add(version)
        code = reader.uleb()
        if code:
            for name, form, implicit in _abbreviation(abbrev, abbrev_offset, code):
                if name == 0x13 and form in _CONSTANT:
                    value = implicit if form == 0x21 else reader.uleb() if form == 0x0F else reader.unsigned(_CONSTANT[form])
                    languages.setdefault(LANGUAGES.get(value, f"DW_LANG 0x{value:x}"))
                    continue
                value = _value(reader, form, version, address_size, offset_size, strings)
                if name == 0x25 and isinstance(value, bytes):
                    producers.setdefault(value.decode("utf-8", "replace")[:200])
        offset = end
    info.producers = list(producers)[:8]
    info.languages = list(languages)[:8]


_CONSTANT = {0x0B: 1, 0x05: 2, 0x06: 4, 0x0F: 0, 0x21: 0}
