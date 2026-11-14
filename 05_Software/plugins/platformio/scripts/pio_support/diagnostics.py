"""Error analysis of PlatformIO step logs (spec REQ-DATA-865c8fbd section 7, REQ-REL-78cf222a).

Each diagnostic cites the log file and its 1-based line, and the source file and line when the compiler names them.
Nothing here edits a project file: the inputs are hashed before and after, and a change is reported, never made.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

LIMIT = 50
RULES: list[tuple[str, re.Pattern[str]]] = [
    ("compiler", re.compile(r"^(.+?):(\d+):(\d+): (?:fatal )?error: (.*)$")),
    ("linker", re.compile(r"undefined reference to|region `?\S+'? overflowed|ld(?:\.bfd)?(?:\.exe)?: error|"
                          r"collect2(?:\.exe)?: error")),
    ("package", re.compile(r"(?:UnknownPackageError|UnknownPlatform|PackageException|Could not find the package|"
                           r"InternetConnectionError|HTTPClientError|Tool Manager: Installing|Library Manager: Installing)")),
    ("config", re.compile(r"(?:InvalidProjectConfError|ProjectOptionValueError|UnknownEnvNames|Error: .*platformio\.ini)")),
    ("size", re.compile(r"Error: The program size .* is greater than maximum allowed")),
    ("scons", re.compile(r"^\*\*\* \[.+\] Error \d+|^scons: \*\*\*")),
    ("platformio", re.compile(r"^Error: ")),
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
                entry: dict[str, Any] = {"code": code, "log": log.name, "logLine": number, "text": line.strip()[:300]}
                if code == "compiler":
                    entry.update({"file": match.group(1).strip(), "line": int(match.group(2)),
                                  "message": match.group(4).strip()[:200]})
                found.append(entry)
                break
        if len(found) >= LIMIT:
            break
    return found
