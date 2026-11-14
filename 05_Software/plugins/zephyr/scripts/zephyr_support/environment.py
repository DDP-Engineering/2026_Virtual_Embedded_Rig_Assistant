"""The scrubbed process environment (spec REQ-DATA-d8ecee6a section 5, REQ-SEC-f67c1f73).

Processes see the helper's own tools first (west, cmake, ninja in the helper environment), the folder of git (Zephyr's
module script reads the west manifest through git), the system folders of PATH and a short list of system
variables. Nothing else of the caller survives: no ZEPHYR_*, WEST_*, CMAKE_*, proxy or VERA variable. Offline
operations get a closed loopback proxy and git restricted to the file protocol.
"""

from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

SYSTEM = ("SYSTEMROOT", "SystemRoot", "WINDIR", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "LOCALAPPDATA", "APPDATA",
          "PROGRAMDATA", "PATHEXT", "COMSPEC", "LANG", "LC_ALL", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE")
DEAD_PROXY = "http://127.0.0.1:9"


def tool_folder() -> Path:
    """Where the helper environment keeps its console scripts (cmake, ninja, west)."""
    return Path(sys.executable).parent


def tool(name: str) -> Path | None:
    suffix = ".exe" if os.name == "nt" else ""
    candidate = tool_folder() / f"{name}{suffix}"
    return candidate if candidate.is_file() else None


def git() -> Path | None:
    found = shutil.which("git")
    return Path(found) if found else None


def _system_path() -> list[str]:
    keep: list[str] = []
    windows = os.environ.get("SYSTEMROOT") or os.environ.get("SystemRoot")
    for entry in os.environ.get("PATH", "").split(os.pathsep):
        if not entry:
            continue
        if windows and os.path.normcase(entry).startswith(os.path.normcase(windows)):
            keep.append(entry)
        elif os.name != "nt" and entry in ("/usr/bin", "/bin", "/usr/local/bin"):
            keep.append(entry)
    return keep


def build(run_folder: Path, zephyr: Path, offline: bool = True, first: list[Path] | None = None) -> dict[str, str]:
    env = {key: value for key, value in os.environ.items() if key in SYSTEM}
    folders = [str(path) for path in first or []] + [str(tool_folder())]
    found_git = git()
    if found_git is not None:
        folders.append(str(found_git.parent))
    env["PATH"] = os.pathsep.join(folders + _system_path())
    env["ZEPHYR_BASE"] = str(zephyr)
    for name in ("WEST_CONFIG_GLOBAL", "WEST_CONFIG_SYSTEM", "GIT_CONFIG_GLOBAL"):
        empty = run_folder / f"empty-{name.lower()}"
        if not empty.exists():
            empty.write_text("", encoding="utf-8")
        env[name] = str(empty)
    env["GIT_CONFIG_NOSYSTEM"] = "1"
    env["GIT_TERMINAL_PROMPT"] = "0"
    env["PYTHONUTF8"] = "1"
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    env["NO_COLOR"] = "1"
    if offline:
        env["GIT_ALLOW_PROTOCOL"] = "file"
        for name in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
            env[name] = DEAD_PROXY
        env["NO_PROXY"] = ""
        env["no_proxy"] = ""
    return env
