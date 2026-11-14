"""Rebuilds the renode fixture ELFs with zig cc (LAB-06), the LAB-04 gdb-debug build pattern.

Run with a Python that has the pinned PyPI package `ziglang==0.13.0` (Zig 0.13.0, clang 18.1.6):

    python build.py

The committed ELFs are the tests' inputs; this script documents and reproduces how they were made. Each source is
compiled to an object first and then linked (a one-step `zig cc` link loses the objects' `.ARM.attributes`). Local
folders are mapped out of the debug information. Tests read hashes from the files, never from constants.

- demo.elf                Cortex-M4F, STM32F407 memory map: banner, version 1.2.3, TIM2 ticks, button/LED, UART echo
- demo-wrong-version.elf  VARIANT=2: prints version 9.9.9
- demo-silent.elf         VARIANT=3: prints nothing
- demo-unmodeled.elf      VARIANT=4: also writes the DAC, which the stm32f4 model of Renode 1.17.0 does not implement
- demo-ccm.elf            the default build linked with its RAM in the CCM (0x10000000): a memory map the profile refuses
"""

from __future__ import annotations

import hashlib
import json
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
LINK = ["-nostdlib", "-Wl,--build-id=sha1", "-Wl,-z,max-page-size=256", "-Wl,--entry=Reset_Handler"]
TARGET = ["-target", "thumb-freestanding-eabihf", "-mcpu=cortex_m4"]


def build(output: str, variant: int, script: str = "link-f407.ld") -> None:
    with tempfile.TemporaryDirectory() as scratch:
        objects = []
        for source in ("startup.c", "demo.c"):
            obj = str(Path(scratch) / (Path(source).stem + ".o"))
            flags = ["-g", "-O1", f"-DVARIANT={variant}"]
            subprocess.run([*ZIG, "cc", *TARGET, *COMPILE, *flags, "-c", source, "-o", obj], cwd=HERE, check=True)
            objects.append(obj)
        subprocess.run([*ZIG, "cc", *TARGET, *LINK, "-T", script, *objects, "-o", output], cwd=HERE, check=True)
    print(output)


VARIANTS = {"demo.elf": "default", "demo-wrong-version.elf": "wrong-version", "demo-silent.elf": "silent",
            "demo-unmodeled.elf": "unmodeled", "demo-ccm.elf": "default"}


def main() -> None:
    build("demo.elf", 1)
    build("demo-wrong-version.elf", 2)
    build("demo-silent.elf", 3)
    build("demo-unmodeled.elf", 4)
    build("demo-ccm.elf", 1, "link-ccm.ld")
    # The engine stand-in (../fake_renode.py) models each build by its hash: the compiler folds the printed strings.
    variants = {hashlib.sha256((HERE / name).read_bytes()).hexdigest(): kind for name, kind in VARIANTS.items()}
    (HERE / "variants.json").write_text(json.dumps(variants, indent=2) + "\n", encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
