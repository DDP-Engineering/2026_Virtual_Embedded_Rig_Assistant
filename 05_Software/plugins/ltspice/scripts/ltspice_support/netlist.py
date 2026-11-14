"""The LTspice netlist chain as ltspice-tool reads it (spec REQ-DATA-0f9e36a3 §3): logical lines, cards, elements and
words that read or write files, includes inside the working directory or LTspice's own library, top-level `.param`
assignments. Everything is decided from the text before LTspice runs; the run folder receives rewritten copies.

Comments are decided on the raw text (`*` first, `;` inline, as the LTspice help documents); every other decision is
made on the NFKC-normalized, case-folded text, since LTspice folds case with Unicode normalization. Every line of every
workbench file is checked, also after a `.end`."""

from __future__ import annotations

import hashlib
import os
import re
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

from . import workspace
from .request import Problem, Refused

FILE_LIMIT = 4 * 1024 * 1024
CHAIN_LIMIT = 16 * 1024 * 1024
LIBRARY_LIMIT = 64 * 1024 * 1024
FILE_COUNT = 256
DEPTH = 16
KEPT = frozenset({".param", ".func", ".subckt", ".ends", ".model", ".global", ".options", ".option", ".ic", ".nodeset",
                  ".include", ".inc", ".lib", ".endl", ".backanno", ".keepnode", ".end"})
DROPPED = frozenset({".op", ".dc", ".ac", ".tran", ".noise", ".tf", ".fra", ".four", ".net", ".meas", ".measure",
                     ".step", ".temp", ".save"})
FILE_CARDS = frozenset({".wave", ".savebias", ".loadbias", ".savestate", ".loadstate"})
UNSUPPORTED = frozenset({".machine", ".mach", ".endmachine", ".endmach", ".state", ".rule", ".output"})
ELEMENTS = frozenset("abcdefghijklmoqrstuvwxz")
INCLUDE_CARDS = frozenset({".include", ".inc", ".lib"})
QUOTE_CARDS = INCLUDE_CARDS | {".model"}
# LTspice matches its file keywords by prefix - `file x`, `fileC:\\x`, `.incl x` read files as `file=x` and `.include`
# do - so outside include cards these are refused as plain substrings of the normalized text (a node named `profile`
# is refused too: the price of matching what LTspice may read).
FILE_SUBSTRINGS = ("file", "scopedata", "tbl", ".inc", "include", ".lib", "loadbias", "savebias", "loadstate",
                   "savestate", "fastaccess")
# Characters LTspice drops before reading a word (Unicode default-ignorable code points outside category Cf).
_IGNORABLE = (range(0x034F, 0x0350), range(0x115F, 0x1161), range(0x17B4, 0x17B6), range(0x180B, 0x1810),
              range(0x3164, 0x3165), range(0xFE00, 0xFE10), range(0xFFA0, 0xFFA1), range(0x1BCA0, 0x1BCA4),
              range(0x1D173, 0x1D17B), range(0xE0000, 0xE1000))
_MILLI = re.compile(r"^[+-]?(?:\d+(?:\.\d*)?|\.\d+)M$")
_ASSIGNMENT = re.compile(r"\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*")
ENCRYPTED = "* ltspice encrypted file"
# LTspice 26.1.1 also ends a line at NEL and LINE SEPARATOR (PARAGRAPH SEPARATOR refused alike): a file holding one
# would show LTspice a line the helper never checked.
LINE_BREAKS = ("\u0085", "\u2028", "\u2029")
# An absolute path runs to the end of the line, to a `(line):` mark or to a character no Windows path holds.
_ABSOLUTE = re.compile(r"(?:(?<![A-Za-z])[A-Za-z]:[\\/]|\\\\|(?<![:\w./\\])//(?=[^/\s])|(?<![\w.\\/])\\(?=[^\\\s]))"
                       r"[^\"'<>|\r\n]*?(?=\(\d+\):|[\"'<>|]|$)", re.M)  # not a URL's "s://" nor a relative ..\\
TITLE = "* ltspice-tool effective netlist"
LIBRARY = "<LTspice library>"


@dataclass
class Logical:
    file: int
    first: int  # index of its first physical line
    last: int
    raw: str  # the non-comment text, continuation lines joined
    norm: str  # the same, NFKC-normalized and case-folded
    tight: str = ""  # norm with continuation lines joined without a blank (LTspice may join them so)


@dataclass
class SourceFile:
    path: Path  # the file read (a converted netlist: its copy in the run folder)
    rel: str  # as shown and as copied below input/
    role: str
    data: bytes
    lines: list[str]
    sha256: str
    header: list[str] = field(default_factory=list)
    logical: list[Logical] = field(default_factory=list)
    includes: dict[int, int] = field(default_factory=dict)  # logical index -> chain file index
    libraries: dict[int, "LibraryFile"] = field(default_factory=dict)  # logical index -> LTspice library file
    whole: bool = True  # included whole somewhere (or the netlist); False while reached only as `.lib FILE SECTION`
    section_starts: list[str] = field(default_factory=list)  # single-name .lib cards taken as section starts


@dataclass
class LibraryFile:
    path: Path
    name: str  # <LTspice library>/sub/LTC.lib
    bytes: int
    sha256: str


@dataclass
class Chain:
    files: list[SourceFile] = field(default_factory=list)
    libraries: list[LibraryFile] = field(default_factory=list)
    subckts: dict[str, list[str]] = field(default_factory=dict)
    models: dict[str, str] = field(default_factory=dict)
    dropped: list[dict[str, object]] = field(default_factory=list)
    options: list[str] = field(default_factory=list)
    params: dict[str, list[tuple[int, int]]] = field(default_factory=dict)  # name -> (file, logical) of top-level assignments
    unsplit: list[str] = field(default_factory=list)  # top-level .param cards the helper cannot split
    problems: list[Problem] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    shown_title: str | None = None

    @property
    def title(self) -> str:
        if self.shown_title is not None:
            return self.shown_title
        return scrub(self.files[0].lines[0].strip())[:200] if self.files and self.files[0].lines else ""

    def inputs(self) -> list[dict[str, object]]:
        out: list[dict[str, object]] = [{"path": f.rel, "role": f.role, "bytes": len(f.data), "sha256": f.sha256,
                                         **({"header": f.header} if f.header else {})} for f in self.files]
        out += [{"path": lib.name, "role": "library", "bytes": lib.bytes, "sha256": lib.sha256} for lib in self.libraries]
        return out


def scrub(text: str) -> str:
    """Absolute paths in a text replaced by their file names (spec §9)."""
    return _ABSOLUTE.sub(lambda m: re.split(r"[\\/]", m.group(0).rstrip("\\/ "))[-1], text)


def library_root() -> Path | None:
    base = os.environ.get("LOCALAPPDATA")
    return Path(base) / "LTspice" / "lib" if base else None


def _norm(text: str) -> str:
    return unicodedata.normalize("NFKC", text).casefold()


def _invisible(text: str) -> str | None:
    """The first character LTspice would drop before reading a word: a format character or another default-ignorable
    code point (soft hyphen, zero-width characters, an inner BOM, variation selectors...)."""
    for char in sorted({c for c in text if ord(c) > 127}):
        if unicodedata.category(char) == "Cf" or any(ord(char) in span for span in _IGNORABLE):
            return char
    return None


def _decode(data: bytes, rel: str, problems: list[Problem]) -> list[str] | None:
    if data[:2] in (b"\xff\xfe", b"\xfe\xff"):
        problems.append(Problem("encoding", rel, "The file is UTF-16 text; LTspice reads it, ltspice-tool checks UTF-8 only. Save it as UTF-8."))
        return None
    try:
        text = data.decode("utf-8").removeprefix("﻿")
    except UnicodeDecodeError:
        problems.append(Problem("encoding", rel, "The file is not UTF-8 text (LTspice would read it as Latin-1). Save it as UTF-8."))
        return None
    if "\x00" in text:
        problems.append(Problem("encoding", rel, "The file holds a NUL character."))
        return None
    if any(mark in text for mark in LINE_BREAKS):
        problems.append(Problem("encoding", rel, "The file holds U+0085 or U+2028 (LTspice reads them as line breaks) or U+2029; remove them."))
        return None
    hidden = _invisible(text)
    if hidden is not None:
        problems.append(Problem("encoding", rel, f"The file holds the invisible character U+{ord(hidden):04X}, which LTspice drops before reading a word; remove it."))
        return None
    return text.replace("\r\n", "\n").replace("\r", "\n").split("\n")


def _logical(lines: list[str], index: int, title: bool) -> list[Logical]:
    out: list[Logical] = []
    for number in range(1 if title else 0, len(lines)):
        stripped = lines[number].strip()
        if not stripped or stripped.startswith("*"):
            continue
        body = stripped.split(";", 1)[0].strip()
        if stripped.startswith("+") and out:
            extra = body[1:].strip()
            out[-1].raw += " " + extra
            out[-1].norm += " " + _norm(extra)
            out[-1].tight += _norm(extra)
            out[-1].last = number
            continue
        if body:
            out.append(Logical(index, number, number, body, _norm(body), _norm(body)))
    return out


def _include_args(lines: list[str], line: Logical, card: str) -> tuple[str, str | None] | None:
    """(path, section) of an include card as LTspice reads it, from the physical lines (`;` is no comment there): a
    quoted name, followed for `.lib` by at most one section word; otherwise the whole rest of the card - blanks and
    `;` included - is the file name. None when the name cannot be read."""
    parts = []
    for number in range(line.first, line.last + 1):
        text = lines[number].strip()
        if not text or (number > line.first and text.startswith("*")):
            continue
        parts.append(text[1:].strip() if number > line.first and text.startswith("+") else text)
    words = " ".join(parts).split(None, 1)
    if len(words) < 2:
        return None
    rest = words[1].strip()
    if rest[:1] not in ('"', "'"):
        return (rest, None)
    end = rest.find(rest[0], 1)
    if end < 1:
        return None
    tail = rest[end + 1:].split(";", 1)[0].split()
    if len(tail) > (1 if card == ".lib" else 0):
        return None
    return (rest[1:end], tail[0] if tail else None)


def _is_absolute(path: str) -> bool:
    return bool(re.match(r"^[A-Za-z]:", path)) or path.startswith(("\\", "/"))


def _within(root: Path, candidate: Path) -> bool:
    try:
        return os.path.normcase(os.path.commonpath([os.path.realpath(root), os.path.realpath(candidate)])) == os.path.normcase(os.path.realpath(root))
    except ValueError:
        return False


def _library(raw_path: str, chain: Chain) -> LibraryFile | None:
    """A file of LTspice's own library: a bare name in cmp/ or sub/, or an absolute path inside the library."""
    root = library_root()
    if root is None or raw_path.startswith(("\\\\", "//")):
        return None  # network and device paths are never resolved (no lookup may reach a host)
    if _is_absolute(raw_path):
        candidate = Path(raw_path)
        if not _within(root, candidate) or ".." in re.split(r"[\\/]", raw_path):
            return None
    elif re.search(r"[\\/]", raw_path) or raw_path in ("", ".", ".."):
        return None
    else:
        found = [root / sub / raw_path for sub in ("cmp", "sub") if (root / sub / raw_path).is_file()]
        if not found:
            return None
        candidate = found[0]
    try:
        if not candidate.is_file() or candidate.stat().st_size > LIBRARY_LIMIT:
            return None
        data = candidate.read_bytes()
    except OSError:
        return None
    relative = os.path.relpath(os.path.realpath(candidate), os.path.realpath(root)).replace("\\", "/")
    for existing in chain.libraries:
        if os.path.normcase(str(existing.path)) == os.path.normcase(str(candidate)):
            return existing
    library = LibraryFile(candidate, f"{LIBRARY}/{relative}", len(data), hashlib.sha256(data).hexdigest())
    chain.libraries.append(library)
    return library


def load(cwd: Path, spelled: Path, raw: str, *, as_if: Path | None = None, actual: Path | None = None) -> Chain:
    """Reads the netlist and every workbench file it includes and refuses with all problems found. A converted
    netlist is read from `actual` (its copy in the run folder) and checked `as_if` it lay at that workbench path."""
    chain = Chain()
    seen: dict[Path, int] = {}
    total = 0

    def read(raw_path: str, base: Path | None, depth: int, where: str, section_mode: bool = False) -> int | None:
        nonlocal total
        if depth > DEPTH:
            chain.problems.append(Problem("include", where, f"The include chain is deeper than {DEPTH} files."))
            return None
        if base is None and actual is not None and as_if is not None:
            resolved, rel, role = actual, workspace.relative(cwd, as_if), "converted"
        else:
            candidate = raw_path
            if base is not None and not _is_absolute(raw_path):
                joined = base / raw_path
                try:
                    candidate = os.path.relpath(joined, cwd)
                except ValueError:
                    candidate = str(joined)
            try:
                resolved = workspace.regular_file(cwd, candidate, "include" if base else "--netlist", spelled)
            except workspace.PathRefused as error:
                chain.problems.append(Problem("include" if base else "path", where, str(error)))
                return None
            rel, role = workspace.relative(cwd, resolved), ("include" if base else "netlist")
        if unicodedata.normalize("NFC", rel) != rel:
            # The copies' include lines name this path, and LTspice composes include names: it would read another file.
            chain.problems.append(Problem("include" if base else "path", where if base else rel, f"The workbench path '{rel[:120]}' is not in Unicode NFC (a folder copied from a Mac, for example); LTspice composes include names and would read another file than the one checked. Rename it."))
            return None
        if resolved in seen:
            if not section_mode:
                chain.files[seen[resolved]].whole = True
            return seen[resolved]
        if len(chain.files) >= FILE_COUNT:
            chain.problems.append(Problem("limit", where, f"The chain has more than {FILE_COUNT} files."))
            return None
        try:
            if resolved.stat().st_size > FILE_LIMIT:
                chain.problems.append(Problem("limit", where, f"'{raw_path[:120]}' is larger than {FILE_LIMIT} bytes."))
                return None
            data = resolved.read_bytes()
        except OSError as error:
            chain.problems.append(Problem("include", where, f"'{raw_path[:120]}' cannot be read: {error.strerror or error}."))
            return None
        total += len(data)
        if total > CHAIN_LIMIT:
            chain.problems.append(Problem("limit", where, f"The chain is larger than {CHAIN_LIMIT} bytes."))
            return None
        lines = _decode(data, rel, chain.problems)
        if lines is None:
            return None
        if lines and lines[0].strip().casefold() == ENCRYPTED:
            chain.problems.append(Problem("encrypted", rel, "An encrypted model file cannot be checked; only LTspice's own library may hold encrypted models."))
            return None
        index = len(chain.files)
        source = SourceFile(resolved, rel, role, data, lines, hashlib.sha256(data).hexdigest(), whole=not section_mode)
        title = role in ("netlist", "converted")
        for line in lines[(1 if title else 0):]:
            if not line.strip():
                continue
            if not line.lstrip().startswith("*") or len(source.header) >= 5:
                break
            text = line.lstrip().lstrip("*").strip()
            if text:
                source.header.append(scrub(text)[:200])
        chain.files.append(source)
        seen[resolved] = index
        source.logical = _logical(lines, index, title)
        directory = (as_if if (role == "converted" and as_if is not None) else resolved).parent
        for position, line in enumerate(source.logical):
            card = line.norm.split()[0]
            if card not in INCLUDE_CARDS:
                continue
            here = f"{rel}:{line.first + 1}"
            args = _include_args(lines, line, card)
            if args is None:
                chain.problems.append(Problem("include", here, f"The file name of this {card} card cannot be read (missing, an unterminated quote, or words after a quoted name)."))
                continue
            path, section = args
            if any(mark in path for mark in LINE_BREAKS + ("%",)):
                chain.problems.append(Problem("include", here, "An include name may not hold '%' (LTspice 26.1.1 crashes on it) or a line break."))
                continue
            if unicodedata.normalize("NFC", path) != path:
                chain.problems.append(Problem("include", here, "The include name is not in Unicode NFC; LTspice composes it and would read another file than the one checked."))
                continue
            library = None
            exists = False
            if not _is_absolute(path):
                try:
                    exists = (directory / path).exists()
                except OSError:
                    exists = False
            if _is_absolute(path) or not exists:
                library = _library(path, chain)
            if library is not None:
                source.libraries[position] = library
                continue
            pathlike = _is_absolute(path) or bool(re.search(r"[\\/]", path))
            if card == ".lib" and section is None and not source.whole and not exists and not pathlike:
                # LTspice reads `.lib NAME` as a section start only inside a file loaded as `.lib FILE SECTION`.
                source.section_starts.append(here)
                continue
            if _is_absolute(path):
                chain.problems.append(Problem("include", here, f"'{path[:120]}' lies outside the working directory and LTspice's library."))
                continue
            child = read(path, directory, depth + 1, here, section_mode=card == ".lib" and section is not None)
            if child == 0:
                chain.problems.append(Problem("include", here, "The netlist includes itself; its title line would be read as a card."))
            elif child is not None:
                source.includes[position] = child
        return index

    read(raw, None, 0, "netlist")
    for source in chain.files:
        if source.whole:  # included whole somewhere: a single-name .lib there is an include, and it names no file
            chain.problems += [Problem("include", where, ".lib names a file that does not exist (a section start is accepted only in a file included as .lib FILE SECTION).")
                               for where in source.section_starts]
    if chain.problems:
        raise Refused(chain.problems)
    _check(chain)
    if chain.problems:
        raise Refused(chain.problems)
    return chain


def _assignments(text: str) -> list[tuple[str, str]] | None:
    """`name=value` pairs of a `.param` card (after the card name); None when the text is not only such pairs. A value
    is a braced expression, or a run of characters up to a blank outside parentheses."""
    out: list[tuple[str, str]] = []
    at = 0
    while at < len(text):
        if text[at].isspace():
            at += 1
            continue
        match = _ASSIGNMENT.match(text, at)
        if not match:
            return None
        at = match.end()
        if at >= len(text):
            return None
        start = at
        if text[at] == "{":
            depth = 0
            while at < len(text):
                depth += {"{": 1, "}": -1}.get(text[at], 0)
                at += 1
                if depth == 0:
                    break
            if depth:
                return None
        else:
            depth = 0
            while at < len(text) and (depth or not text[at].isspace()):
                depth += {"(": 1, ")": -1}.get(text[at], 0)
                if depth < 0:
                    return None
                at += 1
            if depth:
                return None
        out.append((match.group(1), text[start:at]))
    return out


def _check(chain: Chain) -> None:
    for f in chain.files:
        depth = 0
        for position, line in enumerate(f.logical):
            tokens = line.norm.split()
            card = tokens[0]
            where = f"{f.rel}:{line.first + 1}"
            if card not in INCLUDE_CARDS:
                found = next((word for word in FILE_SUBSTRINGS if word in line.norm or word in line.tight), None)
                if found:
                    chain.problems.append(Problem("file", where, f"'{found}' can make LTspice read or write a file (LTspice matches it by prefix, also inside a longer word); ltspice-tool does not accept it."))
                    continue
            if '"' in line.raw and card not in QUOTE_CARDS:
                chain.problems.append(Problem("string", where, "A quoted string can name a file; quotes are accepted only in include, library and model cards."))
                continue
            if card.startswith("."):
                if card in FILE_CARDS:
                    chain.problems.append(Problem("file", where, f"{card} reads or writes a file; ltspice-tool does not accept it."))
                elif card in UNSUPPORTED or card not in KEPT | DROPPED:
                    chain.problems.append(Problem("card", where, f"The card {card[:30]} is not accepted by ltspice-tool."))
                elif card in DROPPED:
                    chain.dropped.append({"file": f.rel, "line": line.first + 1, "card": card})
                elif card == ".subckt":
                    depth += 1
                    if len(tokens) >= 2:
                        ports = []
                        for token in tokens[2:]:
                            if "=" in token or token == "params:":
                                break
                            ports.append(token)
                        chain.subckts[tokens[1]] = ports
                elif card == ".ends":
                    depth = max(0, depth - 1)
                elif card == ".model" and len(tokens) >= 2:
                    chain.models[tokens[1]] = where
                elif card in (".option", ".options"):
                    chain.options.append(line.raw)
                elif card == ".param" and depth == 0:
                    pairs = _assignments(line.raw.split(None, 1)[1] if len(line.raw.split(None, 1)) > 1 else "")
                    if pairs is None:
                        chain.unsplit.append(where)
                    else:
                        for name, _ in pairs:
                            chain.params.setdefault(name.casefold(), []).append((line.file, position))
                continue
            letter = card[0]
            if letter not in ELEMENTS:
                chain.problems.append(Problem("element", where, f"'{line.raw.split()[0][:30]}' is not an element or card ltspice-tool accepts (frequency-response elements write extra files)."))
                continue
            for token in line.raw.split()[1:]:
                if _MILLI.match(token) and len(chain.warnings) < 20:
                    chain.warnings.append(f"{line.raw.split()[0]} at {where}: {token} is {token[:-1]} milli in SPICE (M = milli); write {token[:-1]}MEG for mega.")


def check_parameters(chain: Chain, names: list[str]) -> None:
    """Every overridden name must be assigned in a top-level `.param` card the helper can split."""
    problems = []
    for name in names:
        if name.casefold() not in chain.params:
            where = f" (cards it cannot split: {', '.join(chain.unsplit[:5])})" if chain.unsplit else ""
            problems.append(Problem("parameter", f"parameters.{name}", f"No top-level .param card of the netlist or its workbench includes assigns {name}{where}."))
    if problems:
        raise Refused(problems)


def copy_target(rel: str) -> str:
    """Where a chain file lies in the run folder, relative to it."""
    return "input/" + rel.replace("\\", "/")


def _relative_include(chain: Chain, index: int, child: int) -> str:
    here = "." if index == 0 else os.path.dirname(copy_target(chain.files[index].rel))
    return os.path.relpath(copy_target(chain.files[child].rel), here or ".").replace("\\", "/")


def transformed(chain: Chain, index: int, overrides: dict[str, str]) -> str:
    """The copy of one chain file for the run folder (index 0 becomes effective.net at its root): workbench includes
    point at the copies relative to the copy that includes them, dropped cards and every `.end` are commented out,
    and overridden top-level assignments get their new value. Library includes stay as written."""
    source = chain.files[index]
    lines = list(source.lines)
    if index == 0 and lines:
        lines[0] = TITLE
    wanted = {name.casefold(): value for name, value in overrides.items()}
    ended = False
    for position, line in enumerate(source.logical):
        card = line.norm.split()[0]
        span = range(line.first, line.last + 1)
        if ended:
            for number in span:
                lines[number] = "* ltspice-tool (after .end): " + lines[number]
            continue
        if position in source.includes or position in source.libraries:
            args = _include_args(source.lines, line, card)
            target = (_relative_include(chain, index, source.includes[position]) if position in source.includes
                      else str(source.libraries[position].path))
            section = f" {args[1]}" if args and args[1] else ""
            lines[line.first] = f'{line.raw.split()[0]} "{target}"{section}'
            for number in span[1:]:
                lines[number] = "* ltspice-tool: " + lines[number]
        elif card in DROPPED or card == ".end":
            for number in span:
                lines[number] = "* ltspice-tool: " + lines[number]
            ended = card == ".end" and index == 0
        elif card == ".param" and wanted and any((line.file, position) in chain.params.get(n, []) for n in wanted):
            pairs = _assignments(line.raw.split(None, 1)[1]) or []
            rebuilt = " ".join(f"{name}={wanted.get(name.casefold(), value)}" for name, value in pairs)
            lines[line.first] = f"{line.raw.split()[0]} {rebuilt}"
            for number in span[1:]:
                lines[number] = "* ltspice-tool: " + lines[number]
    return "\n".join(lines).rstrip("\n") + "\n"
