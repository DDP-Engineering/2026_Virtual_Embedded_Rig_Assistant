"""Searches over the downloaded package and library indexes, without arduino-cli.

arduino-cli 1.6 refreshes an index older than 24 hours before `core search` and `lib search`; under the offline
configuration that refresh fails, so arduino-tool reads `data/package_index.json`, the `data/package_*_index.json` of
added index URLs and `data/library_index.json` itself. Matching: every word of the text, case-insensitive, appears in
the entry's id, name, sentence or board names. Libraries rank the exact name first, then names holding every word.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

LIMIT = 50


class IndexMissing(Exception):
    """The index file is not downloaded yet."""


def version_key(version: str) -> tuple:
    """Numeric parts compare as numbers; a pre-release sorts before its release."""
    main, _, pre = str(version).partition("-")
    parts = [int(part) if part.isdigit() else -1 for part in re.split(r"[.+]", main)]
    return (*parts, 0 if not pre else -1, pre)


def _load(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _matches(words: list[str], *texts: Any) -> bool:
    haystack = " ".join(str(text) for text in texts if text).casefold()
    return all(word in haystack for word in words)


def search_platforms(data: Path, text: str) -> list[dict]:
    files = [data / "package_index.json", *sorted(path for path in data.glob("package_*_index.json") if path.is_file())]
    if not (data / "package_index.json").is_file():
        raise IndexMissing()
    words = text.casefold().split()
    latest: dict[str, dict] = {}
    for path in files:
        document = _load(path)
        packages = document.get("packages") if isinstance(document, dict) else None
        for package in packages if isinstance(packages, list) else []:
            if not isinstance(package, dict):
                continue
            for platform in package.get("platforms") or []:
                if not isinstance(platform, dict) or not platform.get("architecture") or not platform.get("version"):
                    continue
                identifier = f"{package.get('name')}:{platform['architecture']}"
                boards = [board.get("name") for board in platform.get("boards") or [] if isinstance(board, dict)]
                if not _matches(words, identifier, platform.get("name"), *boards):
                    continue
                known = latest.get(identifier)
                if known is None or version_key(platform["version"]) > version_key(known["latest"]):
                    latest[identifier] = {"id": identifier, "name": platform.get("name"), "latest": platform["version"]}
    return sorted(latest.values(), key=lambda item: item["id"])[:LIMIT]


def search_libraries(data: Path, text: str) -> list[dict]:
    path = data / "library_index.json"
    if not path.is_file():
        raise IndexMissing()
    document = _load(path)
    entries = document.get("libraries") if isinstance(document, dict) else None
    words = text.casefold().split()
    latest: dict[str, dict] = {}
    for entry in entries if isinstance(entries, list) else []:
        if not isinstance(entry, dict) or not entry.get("name") or not entry.get("version"):
            continue
        if not _matches(words, entry["name"], entry.get("sentence")):
            continue
        known = latest.get(entry["name"])
        if known is None or version_key(entry["version"]) > version_key(known["latest"]):
            latest[entry["name"]] = {
                "name": entry["name"],
                "latest": entry["version"],
                "sentence": str(entry.get("sentence") or "")[:200],
                "architectures": entry.get("architectures"),
            }
    return sorted(latest.values(), key=lambda item: (_rank(item["name"], text), item["name"].casefold()))[:LIMIT]


def _rank(name: str, text: str) -> int:
    """0 for the exact name, 1 when every word is in the name, 2 for a match in the sentence only."""
    folded, wanted = name.casefold(), text.casefold().strip()
    if folded == wanted:
        return 0
    return 1 if all(word in folded for word in wanted.split()) else 2
