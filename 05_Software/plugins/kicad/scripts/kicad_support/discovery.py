"""Locating KiCad 10's kicad-cli (spec REQ-DATA-c32834e3 §1).

A script program receives no other program's path from VERA, so this module repeats the manifest's find order:
each PATH entry, then on Windows `<Program Files>\\KiCad\\<folder>\\bin\\kicad-cli.exe` with the highest folder
name first, on Linux `/usr/bin/kicad-cli`. The program environment carries no `ProgramFiles`, so Windows asks
the known-folder API for it. The first file found is used and must report KiCad 10.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

DOWNLOAD = "https://www.kicad.org/download/"
SUPPORTED_MAJOR = "10"
_VERSION = re.compile(r"^(\d+\.\d+\.\d+)")
_DIGITS = re.compile(r"(\d+)")


@dataclass(frozen=True)
class Kicad:
    executable: Path
    version: str


class KicadMissing(Exception):
    """No usable kicad-cli; the message names what was searched or found and where KiCad comes from."""


def program_files() -> Path | None:
    """Windows' Program Files folder from the known-folder API (FOLDERID_ProgramFiles)."""
    if sys.platform != "win32":
        return None
    try:
        import ctypes
        from ctypes import wintypes

        class GUID(ctypes.Structure):
            _fields_ = [("a", wintypes.DWORD), ("b", wintypes.WORD), ("c", wintypes.WORD), ("d", ctypes.c_ubyte * 8)]

        folder = GUID(0x905E63B6, 0xC1BF, 0x494E, (ctypes.c_ubyte * 8)(0xB2, 0x9C, 0x65, 0xB7, 0x32, 0xD3, 0xD2, 0x1A))
        buffer = ctypes.c_wchar_p()
        shell = ctypes.windll.shell32  # type: ignore[attr-defined]
        if shell.SHGetKnownFolderPath(ctypes.byref(folder), 0, None, ctypes.byref(buffer)) != 0:
            return None
        try:
            return Path(buffer.value) if buffer.value else None
        finally:
            ctypes.windll.ole32.CoTaskMemFree(buffer)  # type: ignore[attr-defined]
    except (OSError, AttributeError, ImportError):
        return None


def _newest_first(name: str) -> tuple:
    return tuple((0, int(part)) if part.isdigit() else (1, part.casefold()) for part in _DIGITS.split(name))


def locate(path_entries: list[str], files: Path | None, windows: bool) -> Path | None:
    """The first kicad-cli in the find order, or None."""
    name = "kicad-cli.exe" if windows else "kicad-cli"
    for entry in path_entries:
        entry = entry.strip().strip('"')
        if not entry or not os.path.isabs(entry):
            continue  # A relative entry would name a folder of the workbench.
        candidate = Path(entry) / name
        try:
            if candidate.is_file() and (windows or os.access(candidate, os.X_OK)):
                return candidate
        except OSError:
            continue
    if windows:
        root = files / "KiCad" if files is not None else None
        try:
            folders = sorted((item for item in root.iterdir() if item.is_dir()), key=lambda item: _newest_first(item.name), reverse=True) if root is not None and root.is_dir() else []
        except OSError:
            folders = []
        for folder in folders:
            candidate = folder / "bin" / name
            try:
                if candidate.is_file():
                    return candidate
            except OSError:
                continue
        return None
    candidate = Path("/usr/bin/kicad-cli")
    return candidate if candidate.is_file() and os.access(candidate, os.X_OK) else None


def search() -> tuple[Path | None, list[str]]:
    """kicad-cli as the find order picks it on this host, and a description of the places searched."""
    windows = sys.platform == "win32"
    files = program_files() if windows else None
    places = ["PATH"]
    if windows:
        places.append(str(files / "KiCad" / "*" / "bin" / "kicad-cli.exe") if files is not None else "Program Files\\KiCad\\*\\bin")
    else:
        places.append("/usr/bin/kicad-cli")
    return locate(os.environ.get("PATH", "").split(os.pathsep), files, windows), places


def probe_version(executable: Path) -> str | None:
    """The version `kicad-cli version` prints on its first line."""
    try:
        done = subprocess.run(
            [str(executable), "version"],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=30,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except (OSError, subprocess.SubprocessError):
        return None
    for line in done.stdout.decode("utf-8", "replace").splitlines():
        found = _VERSION.match(line.strip())
        if found:
            return found.group(1)
    return None


def find_kicad() -> Kicad:
    found, places = search()
    if found is None:
        raise KicadMissing(f"kicad-cli of KiCad 10 was not found (searched {', '.join(places)}). Install KiCad 10 from {DOWNLOAD}; VERA never installs it.")
    version = probe_version(found)
    if version is None:
        raise KicadMissing(f"'{found}' printed no version for 'kicad-cli version'. Install KiCad 10 from {DOWNLOAD}.")
    if version.split(".")[0] != SUPPORTED_MAJOR:
        raise KicadMissing(f"KiCad {version} at '{found}' is not supported: kicad-tool works with KiCad 10. Install KiCad 10 from {DOWNLOAD}.")
    return Kicad(found, version)
