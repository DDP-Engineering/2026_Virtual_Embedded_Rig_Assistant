"""deploy-file: a verified temporary copy that replaces the target (spec REQ-DATA-cb0ccbea, deploy-file).

REQ-FUNC-9dc200c3 (temporary copy, device hash, probed replace), REQ-REL-af9aefa3 (expected or concurrent change),
REQ-REL-1499a74b (space), REQ-REL-8d35cfbd (incomplete result while writing; loss reported by the session).
"""

from __future__ import annotations

import copy
import hashlib
from pathlib import Path
from typing import Any

from . import remote, report
from .device import CHUNK_WRITE, BoardError, BoardOSError, Session
from .report import Ended, Refused, problem


def _incomplete(folder: Path, document: dict[str, Any], phase: str, target: str) -> None:
    """The document a killed helper leaves behind: how far the deploy came and what the target holds."""
    document["phase"] = phase
    snapshot = copy.deepcopy(document)
    snapshot.update({"status": "incomplete", "target": target})
    report.write(folder, snapshot)


def _remove(session: Session, path: str) -> None:
    try:
        session.run("import os\nos.remove(%r)" % path)
    except (BoardOSError, BoardError):
        pass


def _hash(session: Session, path: str, data: bytes | None = None) -> tuple[str, bool]:
    """The file's SHA-256 and whether the board computed it (else the helper hashes a read-back copy)."""
    device = session.sha256(path)
    if device is not None:
        return device, True
    return hashlib.sha256(session.read(path) if data is None else data).hexdigest(), False


def run(session: Session, folder: Path, document: dict[str, Any], data: bytes, target: str, args: Any) -> None:
    part = target + remote.PART
    wanted = hashlib.sha256(data).hexdigest()
    parent = remote.parent(target)
    # Every refusal comes before the first write (exit 2 means the file system was not touched).
    # 1. The parent folder: missing levels are refused, or created later with --mkdir.
    missing: list[str] = []
    existing = "/"
    walked = ""
    for segment in [piece for piece in parent.split("/") if piece]:
        walked += "/" + segment
        found = None if missing else session.stat(walked)
        if found is None:
            if not args.mkdir:
                raise Refused([problem("remote-missing", f"The folder {walked} does not exist on the board; add --mkdir to create it.")])
            missing.append(walked)
        elif not found[0]:
            raise Refused([problem("remote-path", f"{walked} is a file on the board, not a folder.")])
        else:
            existing = walked
    # 2. The current target and the caller's expectation.
    current = None if missing else session.stat(target)
    if current is not None and current[0]:
        raise Refused([problem("not-a-file", f"{target} is a folder on the board.")])
    before: dict[str, Any] = {"exists": current is not None}
    if current is not None:
        before["size"] = current[1]
        before["sha256"] = _hash(session, target)[0]
    document["before"] = before
    if args.expect_sha256 and before.get("sha256") != args.expect_sha256.lower():
        raise Refused([problem("conflict", f"{target} does not hold the expected bytes (expected sha256 {args.expect_sha256}).")])
    if args.expect_absent and before["exists"]:
        raise Refused([problem("conflict", f"{target} exists on the board; --expect-absent refused it.")])
    # 3. Space for the copy beside the target.
    space = session.statvfs(existing)
    if space is not None and space["free"] < len(data) + space["blockSize"]:
        raise Refused([problem("no-space", f"The board has {space['free']} bytes free; the copy needs {len(data)} plus one block.")], filesystem=space)
    # Writes start here: missing folders, then a part file left by an earlier deploy.
    for folder_path in missing:
        session.run("import os\nos.mkdir(%r)" % folder_path)
    if missing:
        document["created"] = missing
    if not missing and session.stat(part) is not None:
        _remove(session, part)
        document["warnings"].append(problem("stale-part-removed", f"Removed {part}, left by an earlier deploy that did not finish."))
    # 4. The transfer, with an incomplete result on disk while it runs.
    _incomplete(folder, document, "transfer", "unchanged")
    try:
        session.run("f=open(%r,'wb')\nw=f.write" % part)
        for offset in range(0, len(data), CHUNK_WRITE):
            session.run("w(" + repr(data[offset : offset + CHUNK_WRITE]) + ")")
        session.run("f.close()")
    except BoardOSError as error:
        session.run("try:\n f.close()\nexcept Exception:\n pass")
        _remove(session, part)
        if error.errno == 28:
            raise Ended("fail", "no-space", f"The board ran out of space while {part} was written; the target is unchanged.") from error
        raise Ended("fail", "write-failed", f"The board refused the write: {str(error).strip().splitlines()[-1][:200]}") from error
    # 5. The board's hash of what arrived.
    written, on_board = _hash(session, part, None)
    document["deviceHash"] = on_board
    if written != wanted:
        _remove(session, part)
        raise Ended("fail", "hash-mismatch", f"{part} arrived with sha256 {written}, not {wanted}; the target is unchanged.")
    # 6. The target must still be what it was.
    now = session.stat(target)
    changed = (now is None) != (not before["exists"]) or (now is not None and _hash(session, target)[0] != before.get("sha256"))
    if changed:
        _remove(session, part)
        raise Ended("fail", "conflict", f"{target} changed on the board during the transfer; it was left as it is now.")
    # 7. Replace: rename, or remove then rename where the file system refuses to rename over a file.
    _incomplete(folder, document, "replace", "unknown")
    try:
        session.run("import os\nos.rename(%r,%r)" % (part, target))
        document["mechanism"] = "rename"
    except BoardOSError as error:
        # Only EEXIST means the file system will not rename over a file; any other error leaves the target alone.
        if not before["exists"] or error.errno != 17:
            _remove(session, part)
            document.pop("phase", None)
            raise Ended("fail", "write-failed", f"The board refused to rename {part}: {str(error).strip().splitlines()[-1][:200]}; the target is unchanged.") from error
        session.run("import os\nos.remove(%r)" % target)
        session.run("import os\nos.rename(%r,%r)" % (part, target))
        document["mechanism"] = "remove-then-rename"
    document.pop("phase", None)
    # 8. Verify the target.
    final, _ = _hash(session, target)
    document["after"] = {"size": len(data), "sha256": final}
    document["verified"] = final == wanted
    if final != wanted:
        raise Ended("fail", "verify-failed", f"{target} holds sha256 {final} after the replace, not {wanted}.")
