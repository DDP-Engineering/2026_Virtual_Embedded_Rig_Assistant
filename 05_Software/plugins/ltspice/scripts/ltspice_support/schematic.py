"""LTspice schematics (spec REQ-DATA-0f9e36a3 §4): the symbol check, the copy of the schematic's folder and the
conversion of the copy with `LTspice -netlist`."""

from __future__ import annotations

import hashlib
import os
import re
import subprocess
import sys
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

from . import workspace
from .engine import CREATE_NO_WINDOW, Engine
from .request import Problem, Refused

FILE_LIMIT = 4 * 1024 * 1024
FOLDER_LIMIT = 16 * 1024 * 1024
FOLDER_COUNT = 64
CONVERT_SECONDS = 60.0


@dataclass
class Schematic:
    path: Path
    rel: str
    sha256: str
    siblings: list[tuple[Path, str, bytes, str]] = field(default_factory=list)  # path, rel, content, sha256 (itself included)

    @property
    def netlist_rel(self) -> str:
        """Where the converted netlist is taken to lie: next to the schematic, with the extension .net."""
        return self.rel[: -len(Path(self.rel).suffix)] + ".net"


def is_schematic(name: str) -> bool:
    return name.lower().endswith(".asc")


def _readings(data: bytes) -> list[str]:
    """Every text LTspice may read from these bytes: UTF-8 or Latin-1 (Latin-1 keeps every ASCII line), and UTF-16LE
    or UTF-16BE with or without a BOM - the symbol check looks at all of them, so no encoding hides a line from it."""
    texts = [data.decode("latin-1")]
    for encoding, bom in (("utf-16-le", b"\xff\xfe"), ("utf-16-be", b"\xfe\xff")):
        body = data[2:] if data[:2] == bom else data
        texts.append(body[: len(body) - len(body) % 2].decode(encoding, errors="replace"))
    return texts


def _escaping(name: str) -> bool:
    return bool(re.match(r"^[A-Za-z]:", name)) or name.startswith(("\\", "/")) or ".." in re.split(r"[\\/]", name)


def _symbol_problems(data: bytes, rel: str) -> list[Problem]:
    problems: list[Problem] = []
    seen: set[str] = set()
    for text in _readings(data):
        for number, line in enumerate(text.replace("\r\n", "\n").replace("\r", "\n").split("\n"), 1):
            words = line.replace("\x00", "").split()
            if len(words) >= 2 and words[0].upper() == "SYMBOL" and _escaping(words[1]) and words[1] not in seen:
                seen.add(words[1])
                problems.append(Problem("symbol", f"{rel}:{number}", f"The symbol '{words[1][:120]}' is named by an absolute or escaping path; LTspice would read a file outside the schematic's folder and its library."))
    return problems


def load(cwd: Path, spelled: Path, raw: str, option: str) -> Schematic:
    """The schematic and the schematics and symbols of its folder, read once; every schematic of the folder (LTspice
    reads hierarchical sheets from there) has its SYMBOL lines checked."""
    try:
        resolved = workspace.regular_file(cwd, raw, option, spelled)
        if resolved.stat().st_size > FILE_LIMIT:
            raise Refused([Problem("limit", option, f"'{raw[:120]}' is larger than {FILE_LIMIT} bytes.")])
        entries = sorted(e for e in resolved.parent.iterdir() if e.is_file() and e.suffix.lower() in (".asc", ".asy"))
    except workspace.PathRefused as error:
        raise Refused([Problem("path", option, str(error))]) from error
    except OSError as error:
        raise Refused([Problem("path", option, f"'{raw[:120]}' cannot be read: {error.strerror or error}.")]) from error
    rel = workspace.relative(cwd, resolved)
    if unicodedata.normalize("NFC", rel) != rel:  # the converted netlist would lie there too (netlist.load refuses it)
        raise Refused([Problem("path", rel, f"The workbench path '{rel[:120]}' is not in Unicode NFC (a folder copied from a Mac, for example); LTspice composes include names and would read another file than the one checked. Rename it.")])
    if len(entries) > FOLDER_COUNT:
        raise Refused([Problem("limit", rel, f"The schematic's folder has more than {FOLDER_COUNT} schematics and symbols.")])
    schematic = Schematic(resolved, rel, "")
    total = 0
    problems: list[Problem] = []
    for entry in entries:
        try:
            content = entry.read_bytes()
        except OSError as error:
            raise Refused([Problem("path", rel, f"'{entry.name}' cannot be read: {error.strerror or error}.")]) from error
        total += len(content)
        if total > FOLDER_LIMIT:
            raise Refused([Problem("limit", rel, f"The schematics and symbols of the schematic's folder exceed {FOLDER_LIMIT} bytes.")])
        entry_rel = workspace.relative(cwd, entry)
        digest = hashlib.sha256(content).hexdigest()
        if entry.suffix.lower() == ".asc":
            problems += _symbol_problems(content, entry_rel)
        if os.path.normcase(str(entry)) == os.path.normcase(str(resolved)):
            schematic.sha256 = digest
        schematic.siblings.append((entry, entry_rel, content, digest))
    if problems:
        raise Refused(problems)
    return schematic


def inputs(schematic: Schematic) -> list[dict[str, object]]:
    return [{"path": rel, "role": "schematic" if rel == schematic.rel else ("symbol" if rel.lower().endswith(".asy") else "schematic-sheet"),
             "bytes": len(content), "sha256": digest} for _, rel, content, digest in schematic.siblings]


def hashes_unchanged(schematic: Schematic) -> bool:
    for path, _, _, digest in schematic.siblings:
        try:
            if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
                return False
        except OSError:
            return False
    return True


def convert(engine: Engine, schematic: Schematic, run_dir: Path) -> tuple[Path | None, list[dict[str, str]]]:
    """Copies the checked bytes of the schematic's folder below input/ (keeping its workbench path) and converts the
    copy there. Returns the written netlist, or None and the problems."""
    for _, rel, content, _ in schematic.siblings:
        target = run_dir / "input" / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    copy = run_dir / "input" / schematic.rel
    try:
        done = subprocess.run([engine.executable, "-netlist", str(copy)], cwd=run_dir, stdin=subprocess.DEVNULL,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=CONVERT_SECONDS,
                              creationflags=CREATE_NO_WINDOW if sys.platform == "win32" else 0)
        code = done.returncode
    except subprocess.TimeoutExpired:
        return None, [{"kind": "convert", "line": f"LTspice did not convert the schematic within {CONVERT_SECONDS:.0f} s."}]
    written = copy.with_suffix(".net")
    if code != 0 or not written.is_file():
        return None, [{"kind": "convert", "line": f"LTspice wrote no netlist for {Path(schematic.rel).name} (exit {code}); check that every symbol exists in the schematic's folder or LTspice's library."}]
    return written, []
