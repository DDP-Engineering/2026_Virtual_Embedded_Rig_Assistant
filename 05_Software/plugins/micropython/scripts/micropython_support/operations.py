"""identify, files, read-file, run-file, capture-output and reset (spec REQ-DATA-cb0ccbea)."""

from __future__ import annotations

import hashlib
import re
import time
from pathlib import Path
from typing import Any

from . import ports, remote, workspace
from .device import HARD_RESET, IDENTIFY, Session
from .report import Ended, Refused, problem

READ_LIMIT = 1024 * 1024
LIST_LIMIT = 1000
CAPTURE_LIMIT = 1024 * 1024


def _local_name(path: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]", "_", remote.name(path))[:100] or "file"


def identify(session: Session, document: dict[str, Any]) -> None:
    machine, platform, release, unique, free, filesystem, mpy = session.value(IDENTIFY)
    document["firmware"].update({"machine": machine, "platform": platform, "release": release, "mpy": mpy})
    document["uniqueId"] = unique
    document["memFree"] = free
    document["filesystem"] = None if filesystem is None else {"size": filesystem[0], "free": filesystem[1], "blockSize": filesystem[2]}


def files(session: Session, document: dict[str, Any], path: str, depth: int) -> None:
    found = session.stat(path)
    if found is None:
        raise Refused([problem("remote-missing", f"{path} does not exist on the board.")])
    if not found[0]:
        document["entries"] = [{"path": path, "type": "file", "size": found[1]}]
        document["omitted"] = 0
    else:
        entries, omitted = session.walk(path, depth, LIST_LIMIT)
        document["entries"] = [{"path": item[0], "type": "dir" if item[1] else "file", "size": item[2]} for item in entries]
        document["omitted"] = omitted
    document["filesystem"] = session.statvfs(path)


def read_file(session: Session, cwd: Path, folder: Path, document: dict[str, Any], path: str) -> None:
    found = session.stat(path)
    if found is None:
        raise Refused([problem("remote-missing", f"{path} does not exist on the board.")])
    if found[0]:
        raise Refused([problem("not-a-file", f"{path} is a folder on the board.")])
    if found[1] > READ_LIMIT:
        raise Refused([problem("too-large", f"{path} has {found[1]} bytes; read-file copies at most 1 MiB.")])
    data = session.read(path)
    device = session.sha256(path)
    local = folder / "files" / _local_name(path)
    local.parent.mkdir(exist_ok=True)
    local.write_bytes(data)
    digest = hashlib.sha256(data).hexdigest()
    document["file"] = {"remote": path, "size": len(data), "sha256": digest, "deviceSha256": device, "path": workspace.relative(cwd, local)}
    if device is not None and device != digest:
        raise Ended("fail", "hash-mismatch", f"The copy of {path} has sha256 {digest}, the board reports {device}.")


def run_file(session: Session, cwd: Path, folder: Path, document: dict[str, Any], code: bytes, timeout: int, limit: int) -> None:
    kept = bytearray()
    dropped = [0]

    def consume(byte: bytes) -> None:
        if byte == b"\x04":
            return
        if len(kept) < limit:
            kept.extend(byte)
        else:
            dropped[0] += len(byte)

    started = time.monotonic()
    session.send(code)
    transport = session.transport
    try:
        first = transport.read_until(1, b"\x04", timeout=None, data_consumer=consume, timeout_overall=timeout)
        finished = first.endswith(b"\x04")
        error = b""
        if finished:
            remaining = max(5.0, timeout - (time.monotonic() - started))
            error = transport.read_until(1, b"\x04", timeout=None, timeout_overall=remaining)
            finished = error.endswith(b"\x04")
            error = error[:-1] if finished else error
    except Exception as failure:  # noqa: BLE001 - the link failed while the script ran
        raise session.lost(failure) from failure
    output = kept.decode("utf-8", "replace")
    local = folder / "output.txt"
    local.write_text(output, encoding="utf-8", newline="")
    document.update({"output": output, "outputTruncated": dropped[0], "outputPath": workspace.relative(cwd, local)})
    if not finished:
        try:
            transport.serial.write(b"\x03")
            transport.read_until(1, b"\x04", timeout=2, timeout_overall=3)
            transport.read_until(1, b"\x04", timeout=2, timeout_overall=3)
        except Exception as failure:  # noqa: BLE001
            raise session.lost(failure) from failure
        document["application"] = "interrupted"
        raise Ended("incomplete", "timeout", f"The script ran longer than {timeout} s and was interrupted (Ctrl-C).")
    document["application"] = "stopped"
    traceback = error.decode("utf-8", "replace")
    if traceback.strip():
        document["traceback"] = traceback[-4000:]
        document["exception"] = traceback.strip().splitlines()[-1]
        raise Ended("fail", "exception", f"The script raised {document['exception']}.")


def capture(session: Session, cwd: Path, folder: Path, document: dict[str, Any], duration: int, restart: bool) -> None:
    transport = session.transport
    data = bytearray()
    dropped = 0
    if restart:
        document["application"] = "restarted" if session.restart_now() else "unknown"
    else:
        document["application"] = "unchanged"
    end = time.monotonic() + duration
    transport.serial.clear()
    try:
        while time.monotonic() < end:
            waiting = transport.serial.inWaiting()
            if waiting:
                chunk = transport.serial.read(waiting)
                room = CAPTURE_LIMIT - len(data)
                data.extend(chunk[:room])
                dropped += max(0, len(chunk) - room)
            else:
                time.sleep(0.05)
    except Exception as failure:  # noqa: BLE001
        raise session.lost(failure) from failure
    local = folder / "output.txt"
    local.write_bytes(bytes(data))
    document.update({"outputBytes": len(data), "outputTruncated": dropped, "outputPath": workspace.relative(cwd, local)})


def hard_reset(session: Session, document: dict[str, Any]) -> None:
    """machine.reset(), then the port with the same identity (a soft reset is the session's restart on finish)."""
    session.send(HARD_RESET)
    session.raw = False
    session.finish()
    identity = document["port"]["identity"]
    time.sleep(1.0)
    end = time.monotonic() + 15
    while True:
        entry = ports.with_identity(identity)
        if entry is not None:
            document["port"]["after"] = entry["address"]
            document["application"] = "restarted"
            return
        if time.monotonic() > end:
            document["application"] = "unknown"
            raise Ended("error", "port-lost", f"No port showed the identity {identity} within 15 s of the reset.")
        time.sleep(0.5)

