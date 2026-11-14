"""The Zephyr SDK folder a request names (spec REQ-DATA-d8ecee6a sections 1 and 4, REQ-REL-cb83210f).

The SDK is never guessed for a build: the request names one folder. `candidates` only lists the usual install places
for `tools`. A valid folder holds `sdk_version`, the CMake package `cmake/Zephyr-sdkConfig.cmake` and, for the board's
architecture, the GNU toolchain `gnu/<triple>/bin/<triple>-gcc`.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from .errors import Refused
from .model import version_tuple

MINIMUM = "1.0.1"


@dataclass(frozen=True)
class Sdk:
    path: Path
    version: str
    toolchain: Path | None


def gcc(sdk: Path, triple: str) -> Path:
    suffix = ".exe" if os.name == "nt" else ""
    return sdk / "gnu" / triple / "bin" / f"{triple}-gcc{suffix}"


def read_version(sdk: Path) -> str | None:
    try:
        text = (sdk / "sdk_version").read_text(encoding="utf-8").strip()
    except OSError:
        return None
    return text if version_tuple(text) else None


def check(sdk: Path, triple: str | None, required: str | None) -> Sdk:
    version = read_version(sdk)
    if version is None or not (sdk / "cmake" / "Zephyr-sdkConfig.cmake").is_file():
        raise Refused("sdk-missing", f"{sdk} is not a Zephyr SDK folder (sdk_version and cmake/Zephyr-sdkConfig.cmake).")
    needed = max(MINIMUM, required or MINIMUM, key=version_tuple)
    if version_tuple(version) < version_tuple(needed):
        raise Refused("sdk-version", f"The SDK at {sdk} is {version}; this workspace needs {needed} or newer.")
    if triple is None:
        raise Refused("sdk-toolchain", "The board's architecture has no Zephyr SDK GNU toolchain this plugin knows.")
    compiler = gcc(sdk, triple)
    if not compiler.is_file():
        raise Refused("sdk-toolchain", f"The SDK at {sdk} has no {triple} toolchain ({compiler.relative_to(sdk).as_posix()}); add it to gnu/.")
    return Sdk(sdk, version, compiler)


def candidates() -> list[dict[str, str | None]]:
    """Folders where a Zephyr SDK is usually unpacked; reported, never selected."""
    home = Path.home()
    patterns = [home / "zephyr-sdk-*", home / ".local" / "zephyr-sdk-*", home / ".local" / "opt" / "zephyr-sdk-*",
                Path("/opt") / "zephyr-sdk-*", Path("/usr/local") / "zephyr-sdk-*"]
    if os.name == "nt":
        patterns.append(Path(os.environ.get("SystemDrive", "C:") + "\\") / "zephyr-sdk-*")
    found: list[dict[str, str | None]] = []
    for pattern in patterns:
        for path in sorted(pattern.parent.glob(pattern.name)) if pattern.parent.is_dir() else []:
            if path.is_dir():
                found.append({"path": str(path), "version": read_version(path)})
    return found[:16]
