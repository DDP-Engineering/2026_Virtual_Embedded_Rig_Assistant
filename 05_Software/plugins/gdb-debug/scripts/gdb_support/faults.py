"""Cortex-M fault decoding (spec REQ-DATA-d7da2a71 section 7): exception number, active stack, CFSR/HFSR causes and
the fault address registers. Pure functions over register values, used live and by `gdb-elf diagnose`."""

from __future__ import annotations

from typing import Any

SCB_BASE = 0xE000ED00
SCB_LENGTH = 0x40
CPUID, CFSR, HFSR, MMFAR, BFAR = 0x00, 0x28, 0x2C, 0x34, 0x38
PARTS = {
    0xC20: "cortex-m0",
    0xC60: "cortex-m0+",
    0xC21: "cortex-m1",
    0xC23: "cortex-m3",
    0xC24: "cortex-m4",
    0xC27: "cortex-m7",
    0xD20: "cortex-m23",
    0xD21: "cortex-m33",
    0xD22: "cortex-m55",
    0xD23: "cortex-m85",
    0xD24: "cortex-m52",
}
EXCEPTIONS = {
    0: "thread mode",
    1: "reset",
    2: "NMI",
    3: "HardFault",
    4: "MemManage",
    5: "BusFault",
    6: "UsageFault",
    7: "SecureFault",
    11: "SVCall",
    12: "DebugMonitor",
    14: "PendSV",
    15: "SysTick",
}
CFSR_BITS = {
    0: ("IACCVIOL", "instruction fetch from a region the MPU forbids or an XN region"),
    1: ("DACCVIOL", "data access the MPU forbids"),
    3: ("MUNSTKERR", "MPU fault while unstacking on exception return"),
    4: ("MSTKERR", "MPU fault while stacking on exception entry"),
    5: ("MLSPERR", "MPU fault during lazy floating-point state preservation"),
    7: ("MMARVALID", "MMFAR holds the faulting data address"),
    8: ("IBUSERR", "bus error on instruction fetch"),
    9: ("PRECISERR", "precise data bus error; BFAR may hold the address"),
    10: ("IMPRECISERR", "imprecise data bus error; the stacked PC is after the faulting store"),
    11: ("UNSTKERR", "bus error while unstacking on exception return"),
    12: ("STKERR", "bus error while stacking on exception entry (stack overflow or invalid SP)"),
    13: ("LSPERR", "bus error during lazy floating-point state preservation"),
    15: ("BFARVALID", "BFAR holds the faulting data address"),
    16: ("UNDEFINSTR", "undefined instruction"),
    17: ("INVSTATE", "invalid EPSR state, e.g. a branch to an even (ARM-state) address"),
    18: ("INVPC", "invalid EXC_RETURN or PC load on exception return"),
    19: ("NOCP", "coprocessor (FPU) access while disabled or absent"),
    20: ("STKOF", "stack limit (MSPLIM/PSPLIM) violation"),
    24: ("UNALIGNED", "unaligned access with CCR.UNALIGN_TRP set or an unaligned LDM/STM"),
    25: ("DIVBYZERO", "integer division by zero with CCR.DIV_0_TRP set"),
}
HFSR_BITS = {
    1: ("VECTTBL", "bus fault on a vector table read"),
    30: ("FORCED", "a configurable fault escalated to HardFault (see CFSR)"),
    31: ("DEBUGEVT", "debug event while halting debug is off"),
}
MODELS = ("v6m", "v7m", "v8m")


def part(cpuid: int) -> tuple[str, str]:
    number = (cpuid >> 4) & 0xFFF
    return f"0x{number:03x}", PARTS.get(number, "unknown")


def word(data: bytes, offset: int) -> int:
    return int.from_bytes(data[offset : offset + 4], "little")


def decode(model: str, registers: dict[str, int], scb: bytes | None, frame: list[int] | None) -> dict[str, Any]:
    """The fault view of a halted core. `scb` is the 64 bytes at 0xE000ED00 (None when unread), `frame` the eight
    stacked words r0, r1, r2, r3, r12, lr, pc, xpsr (None when unread or outside RAM)."""
    xpsr = registers.get("xpsr")
    number = xpsr & 0x1FF if xpsr is not None else None
    out: dict[str, Any] = {"exception": None, "causes": [], "limits": []}
    if number is None:
        out["limits"].append("xPSR was not read; the exception state is unknown.")
        return out
    name = EXCEPTIONS.get(number, f"IRQ {number - 16}" if number >= 16 else f"reserved {number}")
    out["exception"] = {"number": number, "name": name}
    lr = registers.get("lr")
    if number and lr is not None and lr >> 24 == 0xFF:
        out["excReturn"] = f"0x{lr:08x}"
        out["stack"] = "psp" if lr & 0x4 else "msp"
        out["fpFrame"] = not lr & 0x10
    if frame is not None and len(frame) == 8:
        names = ("r0", "r1", "r2", "r3", "r12", "lr", "pc", "xpsr")
        out["frame"] = {key: f"0x{value:08x}" for key, value in zip(names, frame, strict=True)}
    elif number:
        out["limits"].append("The stacked exception frame was not read (outside the profile's RAM or unavailable).")
    if model == "v6m":
        out["limits"].append("ARMv6-M has no fault status registers; only the exception and the stacked frame are known.")
        return out
    if scb is None or len(scb) < SCB_LENGTH:
        out["limits"].append("The fault status registers were not read.")
        return out
    cfsr, hfsr = word(scb, CFSR), word(scb, HFSR)
    out["cfsr"] = f"0x{cfsr:08x}"
    out["hfsr"] = f"0x{hfsr:08x}"
    for bit, (label, meaning) in CFSR_BITS.items():
        if bit == 20 and model != "v8m":
            continue
        if cfsr & (1 << bit) and label not in ("MMARVALID", "BFARVALID"):
            out["causes"].append({"register": "CFSR", "bit": bit, "name": label, "meaning": meaning})
    for bit, (label, meaning) in HFSR_BITS.items():
        if hfsr & (1 << bit):
            out["causes"].append({"register": "HFSR", "bit": bit, "name": label, "meaning": meaning})
    if cfsr & (1 << 7):
        out["mmfar"] = f"0x{word(scb, MMFAR):08x}"
    if cfsr & (1 << 15):
        out["bfar"] = f"0x{word(scb, BFAR):08x}"
    if number in (3, 4, 5, 6) and not out["causes"]:
        out["limits"].append("The core is in a fault handler but no fault status bit is set (cleared by software?).")
    return out


def stacked_address(registers: dict[str, int]) -> int | None:
    """Where the exception frame lies: PSP or MSP by EXC_RETURN bit 2, else SP."""
    lr = registers.get("lr")
    xpsr = registers.get("xpsr")
    if xpsr is None or xpsr & 0x1FF == 0 or lr is None or lr >> 24 != 0xFF:
        return None
    return registers.get("psp" if lr & 0x4 else "msp", registers.get("sp"))
