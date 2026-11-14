"""Address-to-function attribution from an ELF's symbol table (spec REQ-DATA-d7da2a71 section 7).

Attribution is offered only when the caller has established that the ELF matches the target; a mismatched or
different ELF would name the wrong function with full confidence (REQ-SEC-7e237fa9).
"""

from __future__ import annotations

from bisect import bisect_right
from dataclasses import dataclass

from .elf import STT_FUNC, Elf


@dataclass(frozen=True)
class Site:
    symbol: str
    offset: int


class Symbols:
    def __init__(self, elf: Elf | None) -> None:
        functions = []
        if elf is not None:
            for symbol in elf.symbols():
                if symbol.kind == STT_FUNC and symbol.name:
                    # Thumb functions have bit 0 set in their value.
                    start = symbol.value & ~1 if elf.machine == 40 else symbol.value
                    functions.append((start, max(symbol.size, 1), symbol.name))
        functions.sort()
        self._starts = [start for start, _size, _name in functions]
        self._functions = functions

    def lookup(self, address: int) -> Site | None:
        address &= ~1
        index = bisect_right(self._starts, address) - 1
        if index < 0:
            return None
        start, size, name = self._functions[index]
        return Site(name, address - start) if address < start + size else None


def site(symbols: Symbols, role: str, address: int | None, trusted: bool) -> dict[str, object]:
    """One fault site; the symbol is only named for a trusted ELF."""
    if address is None:
        return {"role": role, "addr": None}
    out: dict[str, object] = {"role": role, "addr": f"0x{address:08x}"}
    if trusted:
        found = symbols.lookup(address)
        if found:
            out["symbol"] = found.symbol
            out["offset"] = found.offset
    return out
