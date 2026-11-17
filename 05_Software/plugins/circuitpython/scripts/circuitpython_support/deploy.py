"""deploy: approved files to a CIRCUITPY volume, one verified file at a time (spec REQ-DATA-8f309a53, deploy).

REQ-FUNC-5a6f4aec (part copy, read-back, replace, confirmed list, startup code last), REQ-SEC-1d4b7f0a (library set
checked against its manifest and the firmware), REQ-SEC-a59697a3 (boot.py only with --boot), REQ-REL-aa8de0c7
(read-only), REQ-REL-3542e56c (space), REQ-REL-dff06f35 (unplug or stop: incomplete with confirmed files),
REQ-REL-b71b5cab (changes outside the deploy), REQ-FUNC-3371a413 (capture of the autoreloaded run).

A USB volume has no transaction across files: every file is confirmed on its own and the result lists what is
confirmed; nothing claims the application updated unless every file is.
"""

from __future__ import annotations

import copy
import errno
import hashlib
import json
import os
import re
import time
from pathlib import Path
from typing import Any

from . import FORMAT, KIND, SET_KIND, console, inspection, ports, report, volumes, workspace
from .report import Ended, Refused, problem

PART = ".vera-part"
STARTUP = ("/code.txt", "/code.py", "/main.txt", "/main.py")
BOOT = "/boot.py"
SOURCE_LIMIT = 1024 * 1024
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")
_WRITE_PROTECT = 19  # ERROR_WRITE_PROTECT on Windows
# A device that went away: EIO/ENODEV/ENXIO on Linux; ERROR_NOT_READY, ERROR_DEV_NOT_EXIST, ERROR_NO_SUCH_DEVICE and
# ERROR_DEVICE_NOT_CONNECTED on Windows.
_GONE_ERRNO = frozenset({errno.EIO, errno.ENODEV, errno.ENXIO})
_GONE_WINERROR = frozenset({21, 55, 433, 1167})


class Lost(OSError):
    """The volume vanished while the deploy wrote it."""


def target(value: str) -> str:
    def refuse(reason: str) -> Refused:
        return Refused([problem("target-path", f"--target {value[:120]!r} {reason}.")])

    if not value.startswith("/"):
        raise refuse("must be an absolute volume path such as /code.py or /lib/sensor.py")
    if len(value) > 255:
        raise refuse("must not exceed 255 characters")
    if "\\" in value or _CONTROL.search(value):
        raise refuse("must not hold a backslash or control characters")
    segments = value[1:].split("/")
    if len(segments) > 8 or any(segment in ("", ".", "..") for segment in segments):
        raise refuse("must name a file without empty, '.' or '..' segments, at most 8 deep")
    # Windows drops a trailing dot or space and reads ':' as a stream, so '/boot.py.' would write boot.py.
    if any(segment.endswith((".", " ")) or ":" in segment for segment in segments):
        raise refuse("has a name that ends in a dot or a space, or holds ':'; name the file without them, such as /code.py")
    if value.casefold() == "/boot_out.txt":
        raise refuse("names the file the firmware writes at every start")
    if value.casefold().endswith(PART):
        raise refuse(f"names a {PART} file, which VERA uses while it writes")
    return value


def _key(path: str) -> str:
    return path.casefold()  # CircuitPython's FAT volume matches names case-insensitively


def _round(size: int, block: int) -> int:
    return -(-size // block) * block if size else 0


def _state(root: Path, path: str) -> dict[str, Any]:
    """The target's current size and SHA-256, compared in memory; `shown` drops the hash of a secret file."""
    local = root / path[1:]
    if not local.exists():
        return {"exists": False}
    if not local.is_file():
        raise Refused([problem("target-path", f"{path} is a folder on the volume.")])
    data = local.read_bytes()
    return {"exists": True, "size": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def _shown(path: str, state: dict[str, Any]) -> dict[str, Any]:
    if state["exists"] and inspection.secret(path.rsplit("/", 1)[1]):
        return {"exists": True, "size": state["size"], "secret": True}
    return dict(state)


def _sync() -> None:
    """Pushes renames and data to the device: a Linux vfat mount keeps them in the page cache otherwise."""
    if hasattr(os, "sync"):
        os.sync()


def load_set(cwd: Path, spelled: Path, raw: str, firmware: dict[str, Any]) -> tuple[str, list[tuple[str, bytes, str]]]:
    """The library set's files as (target, data, library), refused unless they match the manifest (REQ-SEC-1d4b7f0a)."""
    try:
        path = workspace.regular_file(cwd, raw, "--libraries", spelled)
    except workspace.PathRefused as error:
        raise Refused([problem("path", str(error))]) from error
    invalid = Refused([problem("library-set-invalid", f"--libraries '{raw[:120]}' is not a format 1 circuitpython library set.")])
    try:
        manifest = json.loads(path.read_text(encoding="utf-8")) if path.stat().st_size <= 4 * 1024 * 1024 else None
    except (OSError, ValueError) as error:
        raise invalid from error
    if not isinstance(manifest, dict) or manifest.get("format") != FORMAT or manifest.get("kind") != SET_KIND or not isinstance(manifest.get("libraries"), list):
        raise invalid
    if manifest.get("circuitpython") != firmware["major"]:
        raise Refused([problem("incompatible-libraries", f"The library set was prepared for CircuitPython {manifest.get('circuitpython')}; the board runs {firmware['version']}.")])
    base = (path.parent / "libraries").resolve()
    files: list[tuple[str, bytes, str]] = []
    changed: list[str] = []
    for library in manifest["libraries"]:
        if not isinstance(library, dict) or not isinstance(library.get("files"), list):
            raise invalid
        for item in library["files"]:
            relative = item.get("path") if isinstance(item, dict) else None
            if not isinstance(relative, str) or not relative.startswith("lib/"):
                raise invalid
            try:
                target("/" + relative)
            except Refused as error:
                raise invalid from error
            local = (base / relative).resolve()
            if not workspace.inside(base, local) or not workspace.inside(cwd, local):
                raise invalid
            try:
                data = local.read_bytes()
            except OSError:
                changed.append(relative)
                continue
            if len(data) != item.get("size") or hashlib.sha256(data).hexdigest() != item.get("sha256") or (relative.endswith(".mpy") and data[:2] != b"C\x06"):
                changed.append(relative)
                continue
            files.append(("/" + relative, data, str(library.get("name"))))
    if changed:
        raise Refused([problem("library-set-changed", f"Files of the library set no longer match its manifest: {', '.join(changed[:10])}; prepare it again.")])
    return workspace.relative(cwd, path), files


def _expectations(cwd: Path, spelled: Path, raw: str, identity: str) -> dict[str, dict[str, Any] | None]:
    """Target path (case-folded) -> the entry an inspect-code result recorded; absent paths map to None."""
    try:
        path = workspace.regular_file(cwd, raw, "--expect-from", spelled)
        document = json.loads(path.read_text(encoding="utf-8"))
    except workspace.PathRefused as error:
        raise Refused([problem("path", str(error))]) from error
    except (OSError, ValueError) as error:
        raise Refused([problem("arguments", "--expect-from must name the result.json of an inspect-code run.")]) from error
    if not isinstance(document, dict) or document.get("kind") != KIND or document.get("operation") != "inspect-code" or not isinstance(document.get("entries"), list):
        raise Refused([problem("arguments", "--expect-from must name the result.json of an inspect-code run.")])
    if (document.get("volume") or {}).get("identity") != identity:
        raise Refused([problem("identity-mismatch", "--expect-from records another board's volume.")])
    found: dict[str, dict[str, Any] | None] = {}
    for entry in document["entries"]:
        if isinstance(entry, dict) and entry.get("type") == "file" and isinstance(entry.get("path"), str):
            found[_key(entry["path"])] = entry
    return found


class Writer:
    """File operations on the volume; a bench's `faults` stand in for unplug, full, write-protected and edited volumes."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.faults = volumes.faults()
        self.index = 0
        self.gone = False

    def present(self) -> bool:
        return not self.gone and self.root.exists()

    def write_part(self, part: Path, data: bytes, path: str) -> None:
        self.index += 1
        faults = self.faults
        if faults.get("slowWriteSeconds"):
            time.sleep(float(faults["slowWriteSeconds"]))
        if faults.get("unplugAtFile") == self.index:
            self.gone = True
            raise Lost(errno.ENOENT, "The volume is gone")
        if faults.get("noSpaceAtFile") == self.index:
            with open(part, "wb") as handle:
                handle.write(data[: len(data) // 2])
            raise OSError(errno.ENOSPC, "No space left on device")
        if faults.get("readOnlyAtFile") == self.index:
            raise OSError(errno.EROFS, "Read-only file system")
        if faults.get("ioErrorAtFile") == self.index:
            raise OSError(errno.EIO, "Input/output error")
        with open(part, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        change = faults.get("changeDuring")
        if isinstance(change, dict) and _key(change.get("target", "")) == _key(path):
            (self.root / path[1:]).write_bytes(str(change.get("content", "edited")).encode("utf-8"))

    def read(self, local: Path, path: str, part: bool) -> bytes:
        if self.gone:
            raise Lost(errno.ENOENT, "The volume is gone")
        data = local.read_bytes()
        if part and _key(self.faults.get("corruptReadBack", "")) == _key(path) and data:
            data = bytes([data[0] ^ 0xFF]) + data[1:]
        return data


def _failure(error: OSError, writer: Writer) -> tuple[str, str]:
    if isinstance(error, Lost) or not writer.present() or error.errno in _GONE_ERRNO or getattr(error, "winerror", None) in _GONE_WINERROR:
        return "incomplete", "disconnected"
    if error.errno == errno.ENOSPC:
        return "fail", "no-space"
    if error.errno in (errno.EROFS, errno.EACCES, errno.EPERM) or getattr(error, "winerror", None) == _WRITE_PROTECT:
        return "fail", "read-only"
    return "fail", "write-failed"


def _snapshot(folder: Path, document: dict[str, Any]) -> None:
    """The result a killed helper leaves behind: confirmed and unconfirmed files so far."""
    snapshot = copy.deepcopy(document)
    snapshot["status"] = "incomplete"
    confirmed = sum(1 for item in snapshot["files"] if item["state"] == "confirmed")
    snapshot["application"] = "partially-updated" if confirmed else "unknown"
    report.write(folder, snapshot)


def run(cwd: Path, spelled: Path, folder: Path, entry: dict[str, Any], firmware: dict[str, Any], document: dict[str, Any], args: Any) -> None:
    root = Path(entry["path"])
    # 1. What goes where; every refusal comes before the first write (exit 2: the volume is untouched).
    plan: list[tuple[str, bytes, str]] = []
    if args.libraries:
        document["librarySet"], plan = load_set(cwd, spelled, args.libraries, firmware)
    pairs = []
    for raw, path in zip(args.source or [], args.target or []):
        try:
            local = workspace.regular_file(cwd, raw, "--source", spelled)
        except workspace.PathRefused as error:
            raise Refused([problem("path", str(error))]) from error
        if local.stat().st_size > SOURCE_LIMIT:
            raise Refused([problem("too-large", f"--source {raw[:120]} has more than 1 MiB.")])
        pairs.append((path, local.read_bytes(), workspace.relative(cwd, local)))
    ordinary = [item for item in pairs if _key(item[0]) not in {_key(name) for name in (*STARTUP, BOOT)}]
    boot = [item for item in pairs if _key(item[0]) == _key(BOOT)]
    startup = sorted((item for item in pairs if _key(item[0]) in {_key(name) for name in STARTUP}), key=lambda item: [_key(name) for name in STARTUP].index(_key(item[0])))
    plan = plan + ordinary + boot + startup
    seen: set[str] = set()
    for path, _, _ in plan:
        if _key(path) in seen:
            raise Refused([problem("target-path", f"{path} is named twice.")])
        seen.add(_key(path))
    if entry["readOnly"]:
        raise Refused([problem("read-only", f"{entry['path']} is mounted read-only (boot.py may have given the file system to CircuitPython); nothing was written.")])
    before = {path: _state(root, path) for path, _, _ in plan}
    if args.expect_from:
        expected = _expectations(cwd, spelled, args.expect_from, entry["identity"])
        changed = []
        for path, state in before.items():
            recorded = expected.get(_key(path))
            if recorded is None and state["exists"]:
                changed.append(path)
            elif recorded is not None and not state["exists"]:
                changed.append(path)
            elif recorded is not None and recorded.get("secret"):
                if recorded.get("size") != state.get("size"):
                    changed.append(path)
            elif recorded is not None and (recorded.get("sha256") is None or recorded.get("sha256") != state.get("sha256")):
                changed.append(path)
        if changed:
            raise Refused([problem("conflict", f"Changed since the inspection: {', '.join(changed[:10])}; inspect the volume again.", targets=changed[:50])])
    deployed = {_key(path) for path, _, _ in plan}
    startups = [name for name in STARTUP if _key(name) in deployed]
    if startups:
        first = next((name for name in STARTUP if _key(name) in deployed or (root / name[1:]).is_file()), None)
        if first and _key(first) not in deployed:
            document["warnings"].append(problem("startup-shadowed", f"{first} exists on the volume and runs before {startups[0]}; CircuitPython will not run the deployed file."))
        document["startup"] = first
    space = volumes.space(entry)
    block = max(512, space["blockSize"])
    need = sum(max(0, _round(len(data), block) - _round(before[path].get("size", 0), block)) for path, data, _ in plan)
    need += max((_round(len(data), block) for _, data, _ in plan), default=0)
    document["space"] = {"free": space["free"], "needed": need, "blockSize": block}
    if space["free"] < need:
        raise Refused([problem("no-space", f"The volume has {space['free']} bytes free; the deploy needs {need}.")])
    reader = None
    if args.capture:
        if not entry["port"] or not ports.same(args.port, entry["port"]):
            raise Refused([problem("port-mismatch", f"{args.port} is not the serial port bound to {entry['path']} ({entry['port'] or 'none'}).")])
        ports.find(args.port, entry["identity"])
        reader = console.Reader(args.port)
    # 2. The transfer: one file at a time, an incomplete result on disk after each.
    document["files"] = [
        {"target": path, "source": source, "size": len(data), "sha256": hashlib.sha256(data).hexdigest(), "before": _shown(path, before[path]), "state": "unconfirmed"}
        for path, data, source in plan
    ]
    document["phase"] = "transfer"
    document["autoreload"] = "expected"
    writer = Writer(root)
    created: list[str] = []
    offset = 0
    try:
        _snapshot(folder, document)
        for record, (path, data, _) in zip(document["files"], plan):
            local = root / path[1:]
            part = local.with_name(local.name + PART)
            try:
                for parent in reversed(local.parents):
                    if workspace.inside(root, parent) and parent != root and not parent.exists():
                        parent.mkdir()
                        created.append("/" + parent.relative_to(root).as_posix())
                if part.exists():
                    part.unlink()
                    document["warnings"].append(problem("stale-part-removed", f"Removed {path}{PART}, left by an earlier deploy that did not finish."))
                writer.write_part(part, data, path)
                if hashlib.sha256(writer.read(part, path, True)).hexdigest() != record["sha256"]:
                    part.unlink(missing_ok=True)
                    record["state"] = "failed"
                    raise Ended("fail", "hash-mismatch", f"{path}{PART} read back with other bytes than written; {path} is unchanged.")
                if _state(root, path) != before[path]:
                    part.unlink(missing_ok=True)
                    record["state"] = "failed"
                    raise Ended("fail", "conflict", f"{path} changed on the volume during the deploy (an editor?); it was left as it is now.")
                os.replace(part, local)
                _sync()
                if hashlib.sha256(writer.read(local, path, False)).hexdigest() != record["sha256"]:
                    record["state"] = "failed"
                    raise Ended("fail", "verify-failed", f"{path} reads back with other bytes after the replace.")
            except OSError as error:
                status, code = _failure(error, writer)
                if code != "disconnected":
                    part.unlink(missing_ok=True)
                    record["state"] = "failed"
                raise Ended(status, code, f"{path}: {error.strerror or error}; the files after it were not written.") from error
            record["state"] = "confirmed"
            if created:
                document["created"] = created
            _snapshot(folder, document)
        if reader is not None:
            offset = reader.mark()
    except Ended as end:
        confirmed = sum(1 for item in document["files"] if item["state"] == "confirmed")
        document["application"] = "unknown" if end.problem["code"] == "disconnected" else ("partially-updated" if confirmed else "unchanged")
        document.pop("phase", None)
        if reader is not None:
            console.record(cwd, folder, document, reader)
        raise
    document.pop("phase", None)
    document["application"] = "updated"
    if reader is not None:
        _capture(cwd, folder, document, reader, offset, args.capture)


def _capture(cwd: Path, folder: Path, document: dict[str, Any], reader: console.Reader, offset: int, seconds: int) -> None:
    """The console run that starts after the last write (REQ-FUNC-3371a413): the firmware reloads once writes stop."""
    console.wait_for_run(reader, offset, seconds)
    found = console.record(cwd, folder, document, reader, offset)
    run = found["run"]
    if run is None:
        raise Ended("incomplete", "no-run-observed", f"No run of the code started within {seconds} s (autoreload {document['autoreload']}); the files are confirmed.")
    if run["state"] == "exception":
        raise Ended("fail", "exception", f"{run['file']} raised {run['exception'] or 'an exception'} after the deploy.")
