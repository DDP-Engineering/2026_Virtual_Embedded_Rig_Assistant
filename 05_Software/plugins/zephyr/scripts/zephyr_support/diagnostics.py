"""Error analysis of step logs (spec REQ-DATA-d8ecee6a section 8, REQ-REL-4d0db53e).

Each diagnostic cites the log file and its 1-based line. Nothing here edits a configuration or overlay: the build's
inputs are hashed before and after, and a change is reported, never made.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

LIMIT = 50
RULES: list[tuple[str, re.Pattern[str]]] = [
    ("toolchain", re.compile(r"Could not find a package configuration file provided by \"Zephyr-sdk\"|"
                             r"Unable to find .*zephyr-.* in .*gnu|The C compiler .* is not able to compile")),
    ("cmake-error", re.compile(r"^CMake Error at (\S+):(\d+)")),
    ("kconfig", re.compile(r"warning: .*(undefined symbol|was assigned the value .* but got the value)|"
                           r"error: Aborting due to Kconfig warnings|^.*\.conf:\d+: (error|warning):|Kconfig.* error")),
    ("devicetree", re.compile(r"devicetree error:|^.*\.(overlay|dts|dtsi):\d+(:\d+)?: (parse )?error|edtlib\.EDTError")),
    ("compiler", re.compile(r"^(\S+?):(\d+):(\d+): (fatal )?error:")),
    ("linker", re.compile(r"undefined reference to|region `?\S+'? overflowed|ld(\.bfd)?(\.exe)?: error")),
    ("ninja", re.compile(r"^FAILED: ")),
]


def analyse(log: Path) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    try:
        lines = log.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return found
    for number, line in enumerate(lines, 1):
        for code, pattern in RULES:
            match = pattern.search(line)
            if match:
                entry: dict[str, Any] = {"code": code, "log": log.name, "line": number, "text": line.strip()[:300]}
                if code in ("cmake-error", "compiler") and match.lastindex and match.lastindex >= 2:
                    entry["file"] = match.group(1)
                found.append(entry)
                break
        if len(found) >= LIMIT:
            break
    return found
