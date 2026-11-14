"""prepare-libraries: a library set from a pinned Adafruit bundle tag (spec REQ-DATA-8f309a53).

REQ-FUNC-37730607 (resolution and library set), REQ-REL-33085a32 (incompatible .mpy), REQ-REL-ca9500d0 (unknown
library, failed download), REQ-SEC-15d58156 (pinned release assets, verified cache). No CircuitPython volume is read
or written here: this is the only operation that may reach the network.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import tomllib
import urllib.error
import urllib.request
import zipfile
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import FORMAT, SET_KIND, TOOL, VERSION, conventions, report, workspace
from .report import Ended, Refused, problem

REPO = "adafruit/Adafruit_CircuitPython_Bundle"
RELEASES = f"https://github.com/{REPO}/releases/download/"
PREFIX = "adafruit-circuitpython-bundle"
ZIP_LIMIT = 64 * 1024 * 1024
FILE_LIMIT = 4 * 1024 * 1024
SET_LIMIT = 16 * 1024 * 1024
TIMEOUT = 60
TAG = re.compile(r"\d{8}")
NAME = re.compile(r"[a-z0-9_]{1,64}")
_LOCAL_BASE = re.compile(r"http://127\.0\.0\.1:\d{1,5}/")


def asset(platform: str, tag: str) -> str:
    return f"{PREFIX}-{platform}-{tag}.zip"


def home() -> Path:
    configured = os.environ.get("VERA_CIRCUITPYTHON_HOME")
    return Path(configured) if configured else Path.home() / ".vera-circuitpython"


def _base() -> str:
    override = os.environ.get("VERA_CIRCUITPYTHON_DOWNLOAD_BASE")
    if override:
        if not _LOCAL_BASE.fullmatch(override):
            raise Refused([problem("arguments", "VERA_CIRCUITPYTHON_DOWNLOAD_BASE accepts only http://127.0.0.1:<port>/ (tests).")])
        return override
    return RELEASES


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while chunk := handle.read(1 << 20):
            digest.update(chunk)
    return digest.hexdigest()


def _record_path(tag: str) -> Path:
    return home() / "bundles" / tag / "hashes.json"


def _records(tag: str) -> dict[str, Any]:
    path = _record_path(tag)
    if not path.is_file():
        return {}
    try:
        found = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return found if isinstance(found, dict) else {}


def _save_record(tag: str, name: str, record: dict[str, Any]) -> None:
    records = _records(tag)
    records[name] = record
    report.write_json(_record_path(tag), records)


def fetch(tag: str, name: str) -> dict[str, Any]:
    """The cached zip `name` of `tag`, downloaded and recorded when absent (REQ-SEC-15d58156)."""
    base = _base()
    folder = home() / "bundles" / tag
    path = folder / name
    record = _records(tag).get(name)
    if path.is_file() and isinstance(record, dict) and isinstance(record.get("sha256"), str):
        actual = _sha256(path)
        if actual != record["sha256"]:
            raise Refused([problem("cache-changed", f"The cached {name} has sha256 {actual}, not the {record['sha256']} recorded when it was downloaded; remove {path} to download it again.")])
        return {"name": name, "sha256": actual, "size": path.stat().st_size, "source": "cache", "path": path}
    folder.mkdir(parents=True, exist_ok=True)
    url = base + f"{tag}/{name}"
    partial = folder / f"{name}.{os.getpid()}.part"
    digest = hashlib.sha256()
    size = 0
    try:
        request = urllib.request.Request(url, headers={"User-Agent": f"{TOOL}/{VERSION}"})
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response, open(partial, "wb") as handle:  # noqa: S310 - fixed https base
            while chunk := response.read(1 << 16):
                size += len(chunk)
                if size > ZIP_LIMIT:
                    raise Ended("error", "download-failed", f"{name} is larger than {ZIP_LIMIT // (1024 * 1024)} MiB.")
                digest.update(chunk)
                handle.write(chunk)
        os.replace(partial, path)
    except Ended:
        partial.unlink(missing_ok=True)
        raise
    except (urllib.error.URLError, OSError, ValueError) as error:
        partial.unlink(missing_ok=True)
        reason = getattr(error, "code", None) or getattr(error, "reason", None) or error
        raise Ended("error", "download-failed", f"{url} could not be downloaded: {str(reason)[:200]}.") from error
    record = {"sha256": digest.hexdigest(), "size": size, "downloadedAt": report.stamp(), "url": url}
    _save_record(tag, name, record)
    return {"name": name, "sha256": record["sha256"], "size": size, "source": "download", "path": path}


def _safe(member: str) -> bool:
    return not (member.startswith("/") or "\\" in member or ":" in member or any(part in ("", ".", "..") for part in member.rstrip("/").split("/")))


class Archive:
    """One bundle zip, read by member name and never extracted."""

    def __init__(self, path: Path) -> None:
        try:
            self.zip = zipfile.ZipFile(path)
        except (zipfile.BadZipFile, OSError) as error:
            raise Ended("error", "bundle-invalid", f"{path.name} is not a readable zip file.") from error
        self.members = {info.filename: info for info in self.zip.infolist() if not info.is_dir() and _safe(info.filename)}
        roots = {name.split("/", 1)[0] for name in self.members if "/" in name}
        self.root = roots.pop() if len(roots) == 1 else ""

    def read(self, member: str) -> bytes:
        info = self.members[member]
        if info.file_size > FILE_LIMIT:
            raise Ended("error", "bundle-invalid", f"{member} is larger than {FILE_LIMIT // (1024 * 1024)} MiB.")
        return self.zip.read(info)

    def library_index(self) -> dict[str, list[str]]:
        """Library name -> its members below <root>/lib/."""
        prefix = f"{self.root}/lib/"
        index: dict[str, list[str]] = {}
        for member in self.members:
            if not member.startswith(prefix):
                continue
            rest = member[len(prefix) :]
            head = rest.split("/", 1)[0]
            name = head if "/" in rest else re.sub(r"\.(mpy|py)$", "", head)
            if "/" not in rest and name == head:
                continue  # a loose non-module file in lib/
            index.setdefault(name, []).append(member)
        return index

    def requirement(self, library: str, file: str) -> str | None:
        member = f"{self.root}/requirements/{library}/{file}"
        if member not in self.members:
            return None
        return self.read(member).decode("utf-8", "replace")


def _dependencies(source: Archive, library: str) -> list[str]:
    names = conventions.requirement_names(source.requirement(library, "requirements.txt") or "")
    pyproject = source.requirement(library, "pyproject.toml")
    if pyproject:
        try:
            extra = tomllib.loads(pyproject).get("circup", {}).get("circup_dependencies", [])
        except tomllib.TOMLDecodeError:
            extra = []
        for raw in [extra] if isinstance(extra, str) else extra if isinstance(extra, list) else []:
            if isinstance(raw, str):
                name = conventions.clean_name(raw)
                if name not in names:
                    names.append(name)
    return names


def prepare(cwd: Path, folder: Path, document: dict[str, Any], requested: list[str], major: int, tag: str) -> None:
    platform = conventions.platform(major)
    document.update({"circuitpython": major, "platform": platform, "requested": requested})
    fetched = [fetch(tag, asset("py", tag)), fetch(tag, asset(platform, tag))]
    document["bundle"] = {"repo": REPO, "tag": tag, "assets": [{key: item[key] for key in ("name", "sha256", "size", "source")} for item in fetched]}
    document["network"] = any(item["source"] == "download" for item in fetched)
    source, compiled = Archive(fetched[0]["path"]), Archive(fetched[1]["path"])
    index = compiled.library_index()
    unknown = [name for name in requested if name not in index]
    if unknown:
        raise Refused([problem("unknown-library", f"{', '.join(unknown)} {'is' if len(unknown) == 1 else 'are'} not in the {platform} bundle {tag}.")])
    required_by: dict[str, list[str]] = {name: [] for name in requested}
    queue = deque(requested)
    missing: set[str] = set()
    while queue:
        library = queue.popleft()
        for dependency in _dependencies(source, library):
            if dependency not in index:
                if dependency not in missing:
                    missing.add(dependency)
                    document["warnings"].append(problem("dependency-not-in-bundle", f"{library} lists {dependency}, which the bundle does not hold; it is not part of the set."))
                continue
            if dependency not in required_by:
                required_by[dependency] = []
                queue.append(dependency)
            if library not in required_by[dependency] and dependency not in requested:
                required_by[dependency].append(library)
    # Read and check every file before anything is written (REQ-REL-33085a32).
    contents: dict[str, list[tuple[str, bytes]]] = {}
    bad: list[str] = []
    total = 0
    for library in required_by:
        files = []
        for member in sorted(index[library]):
            data = compiled.read(member)
            relative = "lib/" + member[len(f"{compiled.root}/lib/") :]
            total += len(data)
            if relative.endswith(".mpy") and not conventions.mpy_compatible(data):
                bad.append(relative)
            files.append((relative, data))
        contents[library] = files
    if bad:
        raise Refused([problem("mpy-incompatible", f"The {platform} bundle holds .mpy files that are not CircuitPython 9+ bytecode: {', '.join(bad[:10])}; no library set was written.", files=bad[:50])])
    if total > SET_LIMIT:
        raise Refused([problem("too-large", f"The library set has {total} bytes; at most {SET_LIMIT} are accepted.")])
    libraries = []
    base = folder / "libraries"
    for library, files in contents.items():
        written = []
        for relative, data in files:
            local = base / relative
            local.parent.mkdir(parents=True, exist_ok=True)
            local.write_bytes(data)
            written.append({"path": relative, "size": len(data), "sha256": hashlib.sha256(data).hexdigest()})
        version = None
        for item in sorted(written, key=lambda entry: ("__init__" not in entry["path"], entry["path"])):
            version = conventions.version(str(base / item["path"]))
            if version:
                break
        libraries.append({"name": library, "version": version, "requiredBy": required_by[library], "files": written})
    manifest = {
        "format": FORMAT,
        "kind": SET_KIND,
        "tool": f"{TOOL} {VERSION}",
        "createdAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "circuitpython": major,
        "platform": platform,
        "bundle": document["bundle"],
        "requested": requested,
        "libraries": libraries,
        "totalBytes": total,
    }
    report.write_json(folder / "library-set.json", manifest)
    document["libraries"] = libraries
    document["totalBytes"] = total
    document["librarySet"] = workspace.relative(cwd, folder / "library-set.json")
