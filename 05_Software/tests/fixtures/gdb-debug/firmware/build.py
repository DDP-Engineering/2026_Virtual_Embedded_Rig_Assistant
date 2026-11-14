"""Rebuilds the gdb-debug fixture ELFs with zig cc (LAB-04).

Run with a Python that has the pinned PyPI package `ziglang==0.13.0` (Zig 0.13.0, clang 18.1.6):

    python build.py

The committed ELFs are the tests' inputs; this script documents and reproduces how they were made. Each source is
compiled to an object first and then linked (a one-step `zig cc` link loses the objects' `.ARM.attributes`). Local
folders are mapped out of the debug information. Tests read hashes from the files, never from constants.

- fault-m4.elf      Cortex-M4F, DWARF 4, -O1 (zig passes -O2 to clang), STM32F401 memory map
- fault-m4-v2.elf   the same with VARIANT=2: a rebuilt firmware whose sections differ
- fault-m0.elf      Cortex-M0+, no debug information (-g0), STM32G071 memory map
- riscv.elf         RV32, DWARF 4: an image an ARM profile refuses
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

import ziglang  # type: ignore[import-not-found]

HERE = Path(__file__).resolve().parent
ZIG = [sys.executable, "-m", "ziglang"]
ZIG_LIB = Path(str(ziglang.__file__)).resolve().parent / "lib"
MAPS = [f"-fdebug-prefix-map={HERE}=/fixture", f"-fdebug-prefix-map={ZIG_LIB}=/zig"]
COMPILE = ["-ffreestanding", "-nostdlib", "-fno-builtin", *MAPS]
LINK = ["-nostdlib", "-Wl,--build-id=sha1", "-Wl,-z,max-page-size=256"]


def build(target: list[str], sources: list[str], output: str, flags: list[str], link: list[str]) -> None:
    with tempfile.TemporaryDirectory() as scratch:
        objects = []
        for source in sources:
            obj = str(Path(scratch) / (Path(source).stem + ".o"))
            subprocess.run([*ZIG, "cc", *target, *COMPILE, *flags, "-c", source, "-o", obj], cwd=HERE, check=True)
            objects.append(obj)
        subprocess.run([*ZIG, "cc", *target, *LINK, *link, *objects, "-o", output], cwd=HERE, check=True)
    print(output)


def main() -> None:
    m4 = ["-target", "thumb-freestanding-eabihf", "-mcpu=cortex_m4"]
    m0 = ["-target", "thumb-freestanding-eabi", "-mcpu=cortex_m0plus"]
    f401 = ["-Wl,--entry=Reset_Handler", "-T", "link-f401.ld"]
    build(m4, ["startup.c", "fault.c"], "fault-m4.elf", ["-g", "-O1"], f401)
    build(m4, ["startup.c", "fault.c"], "fault-m4-v2.elf", ["-g", "-O1", "-DVARIANT=2"], f401)
    build(m0, ["startup.c", "fault_m0.c"], "fault-m0.elf", ["-g0", "-O2"], ["-Wl,--entry=Reset_Handler", "-T", "link-g071.ld"])
    rv = ["-target", "riscv32-freestanding-none", "-mcpu=generic_rv32"]
    build(rv, ["riscv.c"], "riscv.elf", ["-g", "-O1"], ["-Wl,--entry=_start"])


if __name__ == "__main__":
    main()
