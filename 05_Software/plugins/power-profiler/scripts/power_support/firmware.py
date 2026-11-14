"""The firmware build a capture ran (spec REQ-DATA-dd3e4fe1 section 6, REQ-FUNC-cd1e687f): identified by its content,
never by its file name. `elf.py` is a byte-identical copy of the gdb-debug reader."""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

from .elf import ElfError, parse
from .errors import Refused
from .workspace import PathRefused, regular_file, relative

LIMIT_BYTES = 64 * 1024 * 1024


def identify(cwd: Path, spelled: Path, raw: str) -> dict[str, Any]:
    try:
        path = regular_file(cwd, raw, "--firmware", spelled)
    except PathRefused as error:
        raise Refused("path", str(error)) from error
    try:
        size = path.stat().st_size
        if size > LIMIT_BYTES:
            raise Refused("request", "--firmware is larger than 64 MiB.")
        data = path.read_bytes()
    except OSError as error:
        raise Refused("path", f"--firmware cannot be read: {error.strerror or error}.") from error
    found: dict[str, Any] = {"path": relative(cwd, path), "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
    if data[:4] == b"\x7fELF":
        try:
            elf = parse(data)
        except ElfError as error:
            raise Refused("request", f"--firmware is a malformed ELF: {error}") from error
        found.update({"format": "elf", "machine": elf.machine_name, "buildId": elf.build_id()})
    elif data[:1] == b":" and all(line.startswith(b":") for line in data.splitlines()[:4] if line.strip()):
        found.update({"format": "hex", "machine": None, "buildId": None})
    else:
        found.update({"format": "bin", "machine": None, "buildId": None})
    return found
