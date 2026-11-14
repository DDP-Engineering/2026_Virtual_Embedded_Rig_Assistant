"""Result and error documents (spec REQ-DATA-c32834e3 §5 and §7).

The printed document stays within 11 000 UTF-16 units because VERA's runner returns the last 12 000 characters
of a run: list entries are dropped from the end, every count is kept, `truncated` says so, and `result.json` in the
run folder holds the complete document.
"""

from __future__ import annotations

import copy
import json
from datetime import datetime, timezone
from typing import Any

from . import FORMAT, TOOL, VERSION
from .workspace import utf16_length

STDOUT_LIMIT = 11_000
MESSAGE_LIMIT = 600  # UTF-16 units of one message or warning: they may repeat names from the project files.
# Lists given up first, in this order, when a document does not fit: bulk before findings and facts.
_DROP = (
    ("summary", "instances"), ("summary", "nets"), ("summary", "board", "footprints"), ("summary", "board", "tracks"),
    ("summary", "board", "vias"), ("summary", "board", "zones"), ("summary", "board", "layers"),
    ("summary", "board", "stackup", "layers"), ("summary", "board", "netClasses"),
    ("summary", "board", "netClassPatterns"), ("summary", "hierarchy"), ("summary", "rows"), ("summary", "files"),
    ("summary", "violations"), ("summary", "unconnected"), ("summary", "parity"), ("summary", "libraryIssues"),
    ("summary", "erc", "violations"), ("summary", "erc", "libraryIssues"), ("summary", "drc", "violations"),
    ("summary", "drc", "unconnected"), ("summary", "drc", "parity"), ("summary", "duplicateReferences"),
    ("summary", "erc", "duplicateReferences"), ("summary", "facts", "singleNodeNets"),
    ("summary", "facts", "withoutFootprint"), ("summary", "facts", "dnp"), ("summary", "facts", "powerNets"),
    ("artifacts",), ("project", "files"), ("warnings",),
)  # fmt: skip


def now() -> datetime:
    return datetime.now(timezone.utc)


def stamp(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


def base(operation: str, run_id: str, started: datetime | None = None) -> dict[str, Any]:
    moment = stamp(started or now())
    return {
        "format": FORMAT,
        "tool": TOOL,
        "version": VERSION,
        "operation": operation,
        "status": "completed",
        "runId": run_id,
        "started": moment,
        "finished": moment,
        "kicad": None,
        "project": None,
        "summary": {},
        "warnings": [],
        "limits": [],
        "artifacts": [],
        "result": "",
        "truncated": False,
    }


def clipped(text: str, limit: int = MESSAGE_LIMIT) -> str:
    """A text of at most `limit` UTF-16 units, cut with an ellipsis."""
    if utf16_length(text) <= limit:
        return text
    kept = []
    used = 1
    for character in text:
        used += 2 if ord(character) > 0xFFFF else 1
        if used > limit:
            break
        kept.append(character)
    return "".join(kept) + "\u2026"


def error_document(operation: str | None, run_id: str | None, status: str, problems: list[tuple[str, str]]) -> dict[str, Any]:
    document: dict[str, Any] = {"format": FORMAT, "tool": TOOL, "version": VERSION, "operation": operation, "status": status}
    if run_id is not None:
        document["runId"] = run_id
    document["errors"] = [{"code": code, "path": "", "message": clipped(message)} for code, message in problems]
    return document


def dumps(document: dict[str, Any], indent: int | None = None) -> str:
    return json.dumps(document, ensure_ascii=False, indent=indent, allow_nan=False)


def _holder(document: dict[str, Any], path: tuple[str, ...]) -> tuple[dict[str, Any] | None, str]:
    node: Any = document
    for key in path[:-1]:
        node = node.get(key) if isinstance(node, dict) else None
    return (node if isinstance(node, dict) else None), path[-1]


def fitted(document: dict[str, Any], limit: int = STDOUT_LIMIT) -> str:
    """The document as printed: whole when it fits, else with list entries dropped from the end."""
    doc = copy.deepcopy(document)
    if "truncated" in doc:
        doc["truncated"] = False
    for key in ("warnings", "limits"):
        if isinstance(doc.get(key), list):
            doc[key] = [clipped(str(text)) for text in doc[key]]
    text = dumps(doc)
    if utf16_length(text) <= limit:
        return text
    doc["truncated"] = True
    for path in _DROP:
        holder, key = _holder(doc, path)
        if holder is None or not isinstance(holder.get(key), list) or not holder[key]:
            continue
        items = holder[key]
        low, high = 0, len(items)
        while low < high:  # The longest prefix that fits, if any.
            middle = (low + high + 1) // 2
            holder[key] = items[:middle]
            if utf16_length(dumps(doc)) <= limit:
                low = middle
            else:
                high = middle - 1
        holder[key] = items[:low]
        text = dumps(doc)
        if utf16_length(text) <= limit:
            return text
    # Only fixed-size fields remain; a summary that still does not fit keeps every count, also of its parts.
    summary = doc.get("summary")
    if isinstance(summary, dict):
        kept: dict[str, Any] = {"counts": summary.get("counts")}
        for key, part in summary.items():
            if key.endswith("Count") and isinstance(part, int):
                kept[key] = part
            if isinstance(part, dict) and "counts" in part:
                kept[key] = {
                    "counts": part["counts"],
                    **({"types": part["types"]} if "types" in part else {}),
                    **{name: value for name, value in part.items() if name.endswith("Count") and isinstance(value, int)},
                }
        kept["note"] = "The summary is in result.json."
        doc["summary"] = kept
    text = dumps(doc)
    if utf16_length(text) <= limit:
        return text
    return dumps({key: doc[key] for key in doc if key not in ("summary", "project", "warnings")})
