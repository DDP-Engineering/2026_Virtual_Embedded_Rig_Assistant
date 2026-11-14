"""A bounded ELF reader for firmware images (spec REQ-DATA-d7da2a71 section 6, `gdb-elf inspect`).

Reads the header, section and program headers, the symbol table, GNU build-id notes and the ARM build attributes of an
ELF32/ELF64 file of either byte order. Every offset and size is checked against the file before it is used, so a
truncated or hostile file raises ElfError instead of reading past the data.
"""

from __future__ import annotations

import hashlib
import struct
import zlib
from dataclasses import dataclass, field
from pathlib import Path

LIMIT_BYTES = 64 * 1024 * 1024
MACHINES = {
    3: "x86",
    8: "mips",
    20: "powerpc",
    40: "arm",
    62: "x86-64",
    83: "avr",
    94: "xtensa",
    105: "msp430",
    183: "aarch64",
    243: "riscv",
}
TYPES = {0: "NONE", 1: "REL", 2: "EXEC", 3: "DYN", 4: "CORE"}
SEGMENT_TYPES = {
    0: "NULL", 1: "LOAD", 2: "DYNAMIC", 3: "INTERP", 4: "NOTE", 6: "PHDR", 7: "TLS",
    0x6474E551: "GNU_STACK", 0x6474E552: "GNU_RELRO", 0x70000001: "ARM_EXIDX", 0x70000003: "RISCV_ATTRIBUTES",
}
SHT_SYMTAB, SHT_NOTE, SHT_NOBITS, SHT_ARM_ATTRIBUTES = 2, 7, 8, 0x70000003
SHF_ALLOC, SHF_COMPRESSED = 0x2, 0x800
STT_OBJECT, STT_FUNC = 1, 2
# Tag_CPU_arch values of the ARM ABI addenda; with Tag_CPU_arch_profile 'M' value 10 is ARMv7-M.
ARM_ARCH = {
    0: "pre-v4",
    1: "v4",
    2: "v4T",
    3: "v5T",
    4: "v5TE",
    5: "v5TEJ",
    6: "v6",
    7: "v6KZ",
    8: "v6T2",
    9: "v6K",
    10: "v7",
    11: "v6-M",
    12: "v6S-M",
    13: "v7E-M",
    14: "v8-A",
    15: "v8-R",
    16: "v8-M.base",
    17: "v8-M.main",
    18: "v8.1-A",
    19: "v8.2-A",
    20: "v8.3-A",
    21: "v8.1-M.main",
    22: "v9-A",
}


class ElfError(Exception):
    """The file is not an ELF image this reader can trust."""


@dataclass(frozen=True)
class Section:
    index: int
    name: str
    type: int
    flags: int
    addr: int
    offset: int
    size: int
    link: int
    entsize: int


@dataclass(frozen=True)
class Segment:
    type: int
    offset: int
    vaddr: int
    paddr: int
    filesz: int
    memsz: int
    flags: int


@dataclass(frozen=True)
class Symbol:
    name: str
    value: int
    size: int
    kind: int


@dataclass
class Elf:
    data: bytes
    sha256: str
    bits: int
    endian: str
    type: int
    machine: int
    entry: int
    flags: int
    sections: list[Section] = field(default_factory=list)
    segments: list[Segment] = field(default_factory=list)

    @property
    def order(self) -> str:
        return "<" if self.endian == "little" else ">"

    @property
    def machine_name(self) -> str:
        return MACHINES.get(self.machine, f"unknown-{self.machine}")

    def section(self, name: str) -> Section | None:
        return next((section for section in self.sections if section.name == name), None)

    def contents(self, section: Section, limit: int = LIMIT_BYTES) -> bytes:
        """The section's bytes; compressed (zlib) sections are inflated up to `limit` bytes."""
        if section.type == SHT_NOBITS:
            return b""
        raw = _slice(self.data, section.offset, section.size, f"section {section.name}")
        if not section.flags & SHF_COMPRESSED:
            return raw
        header = struct.Struct(self.order + ("III" if self.bits == 32 else "IIQQ"))
        if len(raw) < header.size:
            raise ElfError(f"Compressed section {section.name} is truncated.")
        fields = header.unpack_from(raw)
        kind, size = fields[0], fields[1] if self.bits == 32 else fields[2]
        if kind != 1:
            raise ElfError(f"Section {section.name} uses a compression this reader does not support.")
        if size > limit:
            raise ElfError(f"Section {section.name} inflates beyond {limit} bytes.")
        inflater = zlib.decompressobj()
        try:
            out = inflater.decompress(raw[header.size :], size + 1)
        except zlib.error as error:
            raise ElfError(f"Section {section.name} cannot be inflated: {error}.") from error
        if len(out) != size:
            raise ElfError(f"Section {section.name} does not inflate to its declared size.")
        return out

    def symbols(self) -> list[Symbol]:
        table = next((section for section in self.sections if section.type == SHT_SYMTAB), None)
        if table is None:
            return []
        if not 0 < table.link < len(self.sections):
            raise ElfError("The symbol table names no string table.")
        strings = self.contents(self.sections[table.link])
        entry = struct.Struct(self.order + ("IIIBBH" if self.bits == 32 else "IBBHQQ"))
        size = table.entsize or entry.size
        if size < entry.size:
            raise ElfError("The symbol table's entry size is too small.")
        data = self.contents(table)
        out: list[Symbol] = []
        for offset in range(size, len(data) - size + 1, size):
            if self.bits == 32:
                name, value, length, info, _other, _index = entry.unpack_from(data, offset)
            else:
                name, info, _other, _index, value, length = entry.unpack_from(data, offset)
            kind = info & 0xF
            if kind in (STT_OBJECT, STT_FUNC):
                out.append(Symbol(_string(strings, name), value, length, kind))
        return out

    def build_id(self) -> str | None:
        for section in self.sections:
            if section.type != SHT_NOTE:
                continue
            data = self.contents(section)
            offset = 0
            while offset + 12 <= len(data):
                namesz, descsz, kind = struct.unpack_from(self.order + "III", data, offset)
                name_end = offset + 12 + _align4(namesz)
                desc_end = name_end + _align4(descsz)
                if desc_end > len(data):
                    break
                name = data[offset + 12 : offset + 12 + namesz].rstrip(b"\0")
                if name == b"GNU" and kind == 3:
                    return data[name_end : name_end + descsz].hex()
                offset = desc_end
        return None

    def arm_attributes(self) -> dict[str, object]:
        """Tag_File attributes of the `aeabi` vendor: cpuName, arch, profile and the VFP-arguments tag."""
        section = next((s for s in self.sections if s.type == SHT_ARM_ATTRIBUTES), None)
        if section is None:
            return {}
        data = self.contents(section, 1024 * 1024)
        if not data or data[0:1] != b"A":
            return {}
        out: dict[str, object] = {}
        offset = 1
        while offset + 4 <= len(data):
            (length,) = struct.unpack_from(self.order + "I", data, offset)
            end = offset + length
            if length < 5 or end > len(data):
                break
            vendor_end = data.find(b"\0", offset + 4, end)
            if vendor_end < 0:
                break
            if data[offset + 4 : vendor_end] == b"aeabi":
                _file_attributes(data, vendor_end + 1, end, self.order, out)
            offset = end
        return out

    def loadable(self) -> list[Segment]:
        return [segment for segment in self.segments if segment.type == 1 and segment.memsz > 0]


def _align4(value: int) -> int:
    return (value + 3) & ~3


def _slice(data: bytes, offset: int, size: int, what: str) -> bytes:
    if offset < 0 or size < 0 or offset + size > len(data):
        raise ElfError(f"The {what} lies outside the file.")
    return data[offset : offset + size]


def _string(table: bytes, offset: int) -> str:
    if offset >= len(table):
        raise ElfError("A name lies outside its string table.")
    end = table.find(b"\0", offset)
    return table[offset : end if end >= 0 else len(table)].decode("utf-8", "replace")


def _uleb(data: bytes, offset: int, end: int) -> tuple[int, int]:
    value = shift = 0
    while offset < end:
        byte = data[offset]
        offset += 1
        value |= (byte & 0x7F) << shift
        if byte < 0x80:
            return value, offset
        shift += 7
        if shift > 63:
            break
    raise ElfError("A ULEB128 value is truncated.")


def _ntbs(data: bytes, offset: int, end: int) -> tuple[str, int]:
    stop = data.find(b"\0", offset, end)
    if stop < 0:
        raise ElfError("A build attribute string is truncated.")
    return data[offset:stop].decode("ascii", "replace"), stop + 1


def _file_attributes(data: bytes, offset: int, end: int, order: str, out: dict[str, object]) -> None:
    while offset + 5 <= end:
        tag = data[offset]
        (size,) = struct.unpack_from(order + "I", data, offset + 1)
        stop = offset + size
        if size < 5 or stop > end:
            return
        if tag == 1:  # Tag_File
            cursor = offset + 5
            while cursor < stop:
                attribute, cursor = _uleb(data, cursor, stop)
                if attribute in (4, 5, 65, 67):
                    text, cursor = _ntbs(data, cursor, stop)
                    if attribute == 5:
                        out["cpuName"] = text
                elif attribute == 32:
                    _flag, cursor = _uleb(data, cursor, stop)
                    _text, cursor = _ntbs(data, cursor, stop)
                elif attribute < 32 or attribute % 2 == 0:
                    value, cursor = _uleb(data, cursor, stop)
                    if attribute == 6:
                        out["archCode"] = value
                    elif attribute == 7:
                        out["profile"] = chr(value) if 0x20 < value < 0x7F else ""
                    elif attribute == 28:
                        out["vfpArgs"] = value
                else:
                    _text, cursor = _ntbs(data, cursor, stop)
        offset = stop


def arm_arch(attributes: dict[str, object]) -> str | None:
    """The architecture name: Tag_CPU_arch 10 with profile M is v7-M."""
    code = attributes.get("archCode")
    if not isinstance(code, int):
        return None
    if code == 10 and attributes.get("profile") == "M":
        return "v7-M"
    return ARM_ARCH.get(code, f"unknown-{code}")


def read(path: Path) -> Elf:
    """Reads and checks one ELF file of at most 64 MiB."""
    try:
        size = path.stat().st_size
        if size > LIMIT_BYTES:
            raise ElfError("The ELF is larger than 64 MiB.")
        with open(path, "rb") as handle:
            data = handle.read(LIMIT_BYTES + 1)
    except OSError as error:
        raise ElfError(f"The ELF cannot be read: {error.strerror or error}.") from error
    if len(data) > LIMIT_BYTES:
        raise ElfError("The ELF is larger than 64 MiB.")
    return parse(data)


def parse(data: bytes) -> Elf:
    if len(data) < 52 or data[:4] != b"\x7fELF":
        raise ElfError("The file is not an ELF image.")
    bits = {1: 32, 2: 64}.get(data[4])
    endian = {1: "little", 2: "big"}.get(data[5])
    if bits is None or endian is None or data[6] != 1:
        raise ElfError("The ELF header names an unknown class, byte order or version.")
    order = "<" if endian == "little" else ">"
    layout = "HHIIIIIHHHHHH" if bits == 32 else "HHIQQQIHHHHHH"
    header = struct.Struct(order + layout)
    if len(data) < 16 + header.size:
        raise ElfError("The ELF header is truncated.")
    (kind, machine, _version, entry, phoff, shoff, flags, _ehsize, phentsize, phnum, shentsize, shnum, shstrndx) = (
        header.unpack_from(data, 16)
    )
    elf = Elf(data, hashlib.sha256(data).hexdigest(), bits, endian, kind, machine, entry, flags)
    section = struct.Struct(order + ("IIIIIIIIII" if bits == 32 else "IIQQQQIIQQ"))
    if shnum:
        if shentsize < section.size or shnum > 4096 or shoff + shnum * shentsize > len(data):
            raise ElfError("The section header table lies outside the file.")
        raw = [section.unpack_from(data, shoff + index * shentsize) for index in range(shnum)]
        if shstrndx >= shnum:
            raise ElfError("The section name table index is invalid.")
        names_header = raw[shstrndx]
        names = _slice(data, names_header[4], names_header[5], "section name table")
        for index, (name, stype, sflags, addr, offset, size, link, _info, _align, entsize) in enumerate(raw):
            if stype != SHT_NOBITS and index:
                _slice(data, offset, size, f"section {index}")
            elf.sections.append(Section(index, _string(names, name) if index else "", stype, sflags, addr, offset, size, link, entsize))
    program = struct.Struct(order + ("IIIIIIII" if bits == 32 else "IIQQQQQQ"))
    if phnum:
        if phentsize < program.size or phnum > 1024 or phoff + phnum * phentsize > len(data):
            raise ElfError("The program header table lies outside the file.")
        for index in range(phnum):
            fields = program.unpack_from(data, phoff + index * phentsize)
            if bits == 32:
                ptype, offset, vaddr, paddr, filesz, memsz, pflags, _align = fields
            else:
                ptype, pflags, offset, vaddr, paddr, filesz, memsz, _align = fields
            elf.segments.append(Segment(ptype, offset, vaddr, paddr, filesz, memsz, pflags))
    return elf


def float_abi(elf: Elf, attributes: dict[str, object]) -> str:
    if elf.machine != 40:
        return "n/a"
    if attributes.get("vfpArgs") == 1 or elf.flags & 0x400:
        return "hard"
    if elf.flags & 0x200 or attributes.get("vfpArgs") == 0:
        return "soft"
    return "unknown"
