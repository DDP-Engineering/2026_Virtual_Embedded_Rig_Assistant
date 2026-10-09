"""Shared paths and environment for the repository-local toolchain (Python standard library only)."""

from __future__ import annotations

import json
import os
import platform
import sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
REPO = TOOLS.parent
SOFTWARE = REPO / "05_Software"
RUNTIME = TOOLS / "runtime"
CACHE = TOOLS / "cache"
CONFIG = json.loads((TOOLS / "toolchain.json").read_text(encoding="utf-8"))
NODE = CONFIG["node"]


def platform_key() -> str:
    """The archive key of toolchain.json for this machine; exits on unsupported platforms."""
    machine = platform.machine().lower()
    if sys.platform == "win32" and machine in ("amd64", "x86_64"):
        return "win-x64"
    if sys.platform.startswith("linux") and machine in ("x86_64", "amd64"):
        return "linux-x64"
    if sys.platform.startswith("linux") and machine in ("aarch64", "arm64"):
        return "linux-arm64"
    sys.exit(f"unsupported platform: {sys.platform} {machine} (supported: Windows x64, Linux x64/arm64)")


def node_home() -> Path:
    """Folder of the extracted Node.js archive, named after the archive without its extension."""
    name = NODE["archives"][platform_key()]["file"]
    for suffix in (".zip", ".tar.xz"):
        name = name.removesuffix(suffix)
    return RUNTIME / name


def node_bin() -> Path:
    """Folder holding the node executable; it goes first on PATH."""
    home = node_home()
    return home if sys.platform == "win32" else home / "bin"


def node_exe() -> Path:
    return node_bin() / ("node.exe" if sys.platform == "win32" else "node")


def npm_cli(tool: str) -> Path:
    """npm-cli.js or npx-cli.js, run through node so no shell wrapper is needed."""
    home = node_home()
    modules = home / "node_modules" if sys.platform == "win32" else home / "lib" / "node_modules"
    return modules / "npm" / "bin" / f"{tool}-cli.js"


def environment() -> dict[str, str]:
    """Process environment with the local Node first on PATH and npm/Electron caches inside 02_Tools."""
    env = dict(os.environ)
    env["PATH"] = str(node_bin()) + os.pathsep + env.get("PATH", "")
    env["npm_config_cache"] = str(CACHE / "npm")
    env["electron_config_cache"] = str(CACHE / "electron")
    env["npm_config_update_notifier"] = "false"
    return env
