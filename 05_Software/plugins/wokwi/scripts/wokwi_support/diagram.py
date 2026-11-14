"""diagram.json: structural checks, boards and wokwi-cli's offline linter (spec REQ-DATA-d985bb3d sections 3-4;
REQ-FUNC-380b0542)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from . import engine, workspace
from .report import refused

DIAGRAM_LIMIT = 4 * 1024 * 1024
PART_LIMIT = 512
BOARD_PREFIXES = ("wokwi-arduino-", "board-", "wokwi-esp32", "wokwi-pi-pico", "wokwi-stm32")


def locate(cwd: Path, spelled: Path, raw: str) -> Path:
    try:
        return workspace.regular_file(cwd, raw, "--diagram", spelled)
    except workspace.PathRefused as error:
        raise refused("path", str(error)) from error


def _error(message: str, part: str | None = None) -> dict[str, Any]:
    return {"severity": "error", "rule": "structure", "message": message, **({"part": part} if part else {})}


def structure(path: Path) -> dict[str, Any]:
    """Parts, boards and structural issues of a diagram; a file that is not a diagram at all is one issue."""
    issues: list[dict[str, Any]] = []
    try:
        if path.stat().st_size > DIAGRAM_LIMIT:
            return {"parts": [], "boards": [], "issues": [_error("diagram.json is larger than 4 MiB.")]}
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, ValueError) as error:
        return {"parts": [], "boards": [], "issues": [_error(f"diagram.json is not valid JSON: {str(error)[:200]}")]}
    if not isinstance(document, dict):
        return {"parts": [], "boards": [], "issues": [_error("diagram.json must be an object.")]}
    if document.get("version") != 1 or isinstance(document.get("version"), bool):
        issues.append(_error("diagram.json needs version 1."))
    parts = document.get("parts")
    ids: dict[str, str] = {}
    if not isinstance(parts, list) or not 1 <= len(parts) <= PART_LIMIT:
        issues.append(_error(f"diagram.json needs 1-{PART_LIMIT} parts."))
        parts = parts if isinstance(parts, list) else []
    for index, part in enumerate(parts[:PART_LIMIT]):
        if not isinstance(part, dict) or not isinstance(part.get("id"), str) or not part["id"] or not isinstance(part.get("type"), str) or not part["type"]:
            issues.append(_error(f"Part {index} needs a string id and type."))
            continue
        if part["id"] in ids:
            issues.append(_error(f"Part id {part['id'][:80]} is used twice.", part["id"][:80]))
            continue
        ids[part["id"]] = part["type"]
    connections = document.get("connections", [])
    if not isinstance(connections, list):
        issues.append(_error("connections must be a list."))
        connections = []
    for index, connection in enumerate(connections[:4096]):
        if not isinstance(connection, list) or len(connection) < 2 or not all(isinstance(end, str) for end in connection[:2]):
            issues.append(_error(f"Connection {index} needs a from and a to endpoint."))
            continue
        for end in connection[:2]:
            part, _, pin = end.partition(":")
            if not pin:
                issues.append(_error(f"Connection {index} endpoint {end[:80]} is not <part>:<pin>."))
            elif not part.startswith("$") and part not in ids:
                issues.append(_error(f"Connection {index} names the unknown part {part[:80]}.", part[:80]))
    listed = [{"id": key, "type": value} for key, value in ids.items()]
    boards = [entry for entry in listed if entry["type"].startswith(BOARD_PREFIXES)]
    return {"parts": listed, "boards": boards, "issues": issues}


def validate(cwd: Path, path: Path, cli: str) -> dict[str, Any]:
    """Structure, then wokwi-cli's linter on the same file; errors from either make it fail."""
    found = structure(path)
    linted = engine.lint(cli, path)
    issues = found["issues"] + linted["issues"]
    return {
        "path": workspace.relative(cwd, path),
        "parts": found["parts"],
        "boards": found["boards"],
        "linter": {"engine": linted["engine"], "exitCode": linted["exitCode"]},
        "issues": issues,
        "errors": sum(1 for issue in issues if issue["severity"] == "error"),
        "warnings": sum(1 for issue in issues if issue["severity"] == "warning"),
    }
