"""The netlist chain as ngspice-tool reads it (spec REQ-DATA-29b9a988 §4): logical lines, the card allowlist, the
include chain inside the working directory, models, subcircuits and pin counts. Everything is decided from the text
before the engine runs; the run folder receives rewritten copies."""

from __future__ import annotations

import hashlib
import os
import re
from dataclasses import dataclass, field
from pathlib import Path

from . import workspace
from .request import Problem, Refused

FILE_LIMIT = 4 * 1024 * 1024
CHAIN_LIMIT = 16 * 1024 * 1024
FILE_COUNT = 256
DEPTH = 16
ALLOWED = frozenset({".title", ".include", ".inc", ".lib", ".endl", ".param", ".func", ".subckt", ".ends", ".model",
                     ".global", ".option", ".options", ".opt", ".ic", ".nodeset", ".temp", ".save", ".csparam", ".end"})
DROPPED = frozenset({".op", ".dc", ".ac", ".tran", ".noise", ".tf", ".sens", ".pz", ".disto", ".sp", ".pss", ".four",
                     ".meas", ".measure", ".print", ".plot", ".probe", ".width"})
ELEMENTS = frozenset("rclkvieefghbdqjmxswtouyanpz")
# Element letter -> the node counts after which its model name may stand.
MODEL_AFTER = {"d": (2,), "j": (3,), "z": (3,), "q": (3, 4), "m": (4,), "s": (4,), "w": (3,)}
BANNED = re.compile(r"(?<![A-Za-z0-9_])(pre_osdi|osdi|codemodel|shell)(?![A-Za-z0-9_])", re.I)
_INLINE = re.compile(r";.*$|\$\s.*$")
# A SPICE value with an upper-case M suffix is milli, not mega (MEG); worth a warning, never a guess.
_MILLI = re.compile(r"^[+-]?(?:\d+(?:\.\d*)?|\.\d+)M$")
TITLE = "ngspice-tool effective netlist"


@dataclass
class Logical:
    file: int
    first: int  # index of its first physical line
    last: int
    text: str


@dataclass
class SourceFile:
    path: Path
    rel: str
    role: str
    data: bytes
    lines: list[str]
    sha256: str
    header: list[str] = field(default_factory=list)
    logical: list[Logical] = field(default_factory=list)
    includes: list[tuple[int, int]] = field(default_factory=list)  # (logical index, file index)


@dataclass
class Chain:
    files: list[SourceFile] = field(default_factory=list)
    subckts: dict[str, list[str]] = field(default_factory=dict)
    models: dict[str, str] = field(default_factory=dict)
    dropped: list[dict[str, object]] = field(default_factory=list)
    options: list[str] = field(default_factory=list)
    params: set[str] = field(default_factory=set)
    problems: list[Problem] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def title(self) -> str:
        return self.files[0].lines[0].strip()[:200] if self.files and self.files[0].lines else ""

    def inputs(self) -> list[dict[str, object]]:
        return [{"path": f.rel, "role": f.role, "bytes": len(f.data), "sha256": f.sha256, **({"header": f.header} if f.header else {})}
                for f in self.files]


def _decode(data: bytes, where: str, problems: list[Problem]) -> list[str] | None:
    try:
        text = data.decode("utf-8").removeprefix("﻿")
    except UnicodeDecodeError:
        problems.append(Problem("netlist", where, "The file is not UTF-8 text."))
        return None
    if "\x00" in text:
        problems.append(Problem("netlist", where, "The file holds a NUL character."))
        return None
    return text.replace("\r\n", "\n").replace("\r", "\n").split("\n")


def _logical(lines: list[str], index: int, title: bool) -> list[Logical]:
    out: list[Logical] = []
    start = 1 if title else 0
    for number in range(start, len(lines)):
        raw = lines[number]
        stripped = raw.strip()
        if not stripped or stripped.startswith("*"):
            continue
        body = _INLINE.sub("", stripped).strip()
        if stripped.startswith("+") and out:
            out[-1].text += " " + body[1:].strip() if body.startswith("+") else ""
            out[-1].last = number
            continue
        if body:
            out.append(Logical(index, number, number, body))
    return out


def _include_target(card: str, tokens: list[str]) -> str | None:
    if card in (".include", ".inc") and len(tokens) >= 2:
        return " ".join(tokens[1:]).strip().strip('"').strip("'")
    if card == ".lib" and len(tokens) >= 3:
        return tokens[1].strip('"').strip("'")
    return None


def load(cwd: Path, spelled: Path, raw: str) -> Chain:
    """Reads the netlist and every file it includes; refuses with all problems found."""
    chain = Chain()
    seen: dict[Path, int] = {}
    total = 0

    def read(raw_path: str, base: Path | None, role: str, depth: int, where: str) -> int | None:
        nonlocal total
        if depth > DEPTH:
            chain.problems.append(Problem("include", where, f"The include chain is deeper than {DEPTH} files."))
            return None
        candidate = raw_path
        if base is not None and not os.path.isabs(raw_path) and not re.match(r"^[A-Za-z]:", raw_path):
            joined = (base / raw_path)
            try:
                candidate = os.path.relpath(joined, cwd)
            except ValueError:
                candidate = str(joined)
        try:
            resolved = workspace.regular_file(cwd, candidate, "include" if base else "--netlist", spelled)
        except workspace.PathRefused as error:
            chain.problems.append(Problem("include" if base else "path", where, str(error)))
            return None
        if resolved in seen:
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
        rel = workspace.relative(cwd, resolved)
        lines = _decode(data, rel, chain.problems)
        if lines is None:
            return None
        index = len(chain.files)
        source = SourceFile(resolved, rel, role, data, lines, hashlib.sha256(data).hexdigest())
        # ngspice reads a leading '*' - and ';', '$', '!' and other punctuation, which it turns into '*' - as a comment
        # mark, and runs a comment line whose next character is '#' as a control command. The netlist's own title line
        # is replaced instead.
        for number, line in enumerate(lines):
            stripped = line.lstrip()
            if len(stripped) >= 2 and stripped[1] == "#" and not stripped[0].isalnum() and not (role == "netlist" and number == 0):
                chain.problems.append(Problem("directive", f"{rel}:{number + 1}", f"A line starting with '{stripped[:2]}' is run by ngspice as a control command; it is not accepted."))
        # The leading comment lines of a model file: its provenance and licence as the file states them.
        for line in lines[(1 if role == "netlist" else 0):]:
            if not line.strip():
                continue
            if not line.lstrip().startswith("*") or len(source.header) >= 5:
                break
            text = line.lstrip().lstrip("*").strip()
            if text:
                source.header.append(text[:200])
        chain.files.append(source)
        seen[resolved] = index
        source.logical = _logical(lines, index, title=(role == "netlist"))
        for position, line in enumerate(source.logical):
            tokens = line.text.split()
            card = tokens[0].lower()
            here = f"{rel}:{line.first + 1}"
            target = _include_target(card, tokens)
            if target is not None:
                child = read(target, resolved.parent, "library" if card == ".lib" else "include", depth + 1, here)
                if child is not None:
                    source.includes.append((position, child))
        return index

    read(raw, None, "netlist", 0, "netlist")
    if chain.problems:
        raise Refused(chain.problems)
    _check(chain)
    if chain.problems:
        raise Refused(chain.problems)
    return chain


def _check(chain: Chain) -> None:
    lines = [line for f in chain.files for line in f.logical]
    refused: set[tuple[int, int]] = set()
    for line in lines:
        f = chain.files[line.file]
        tokens = line.text.split()
        card = tokens[0].lower()
        where = f"{f.rel}:{line.first + 1}"
        if BANNED.search(line.text):
            refused.add((line.file, line.first))
            chain.problems.append(Problem("directive", where, f"'{BANNED.search(line.text).group(1)}' loads code or runs commands; it is not accepted."))  # type: ignore[union-attr]
            continue
        if card.startswith("."):
            if card in DROPPED:
                chain.dropped.append({"file": f.rel, "line": line.first + 1, "card": card})
            elif card not in ALLOWED:
                refused.add((line.file, line.first))
                chain.problems.append(Problem("directive", where, f"The card {card[:30]} is not accepted (control blocks and unknown cards are refused)."))
            elif card == ".subckt" and len(tokens) >= 2:
                ports = []
                for token in tokens[2:]:
                    if "=" in token or token.lower() == "params:":
                        break
                    ports.append(token.lower())
                chain.subckts[tokens[1].lower()] = ports
            elif card == ".model" and len(tokens) >= 2:
                chain.models[tokens[1].lower()] = where
            elif card in (".option", ".options", ".opt"):
                chain.options.append(line.text)
            elif card == ".param":
                for name in re.findall(r"([A-Za-z_][A-Za-z0-9_]*)\s*=", line.text):
                    chain.params.add(name.lower())
            continue
        letter = card[0]
        if letter == "a":
            refused.add((line.file, line.first))
            chain.problems.append(Problem("element", where, f"{tokens[0][:30]}: XSPICE code-model instances are not accepted - models such as d_process and d_cosim start programs or load libraries, others read files."))
            continue
        for token in tokens[1:]:
            if _MILLI.match(token) and len(chain.warnings) < 20:
                chain.warnings.append(f"{tokens[0]} at {where}: {token} is {token[:-1]} milli in SPICE (M = milli); write {token[:-1]}MEG for mega.")
        if letter not in ELEMENTS:
            chain.problems.append(Problem("element", where, f"'{tokens[0][:30]}' is not an element or card ngspice-tool accepts."))
    for line in lines:
        if (line.file, line.first) in refused:
            continue
        tokens = line.text.split()
        card = tokens[0].lower()
        where = f"{chain.files[line.file].rel}:{line.first + 1}"
        letter = card[0]
        if letter in MODEL_AFTER:
            candidates = [tokens[1 + n].lower() for n in MODEL_AFTER[letter] if 1 + n < len(tokens)]
            if not any(name in chain.models for name in candidates):
                shown = candidates[0] if candidates else "(none)"
                chain.problems.append(Problem("model", where, f"{tokens[0]} names the model '{shown}', which no .model card of the chain defines."))
        elif letter == "x":
            body = [t for t in tokens[1:] if "=" not in t and t.lower() != "params:"]
            if not body:
                chain.problems.append(Problem("subckt", where, f"{tokens[0]} names no subcircuit."))
                continue
            name, nodes = body[-1].lower(), body[:-1]
            if name not in chain.subckts:
                chain.problems.append(Problem("subckt", where, f"{tokens[0]} names the subcircuit '{name}', which no .subckt of the chain defines."))
            elif len(nodes) != len(chain.subckts[name]):
                chain.problems.append(Problem("pins", where, f"{tokens[0]} connects {len(nodes)} nodes; the subcircuit '{name}' has {len(chain.subckts[name])} ports ({' '.join(chain.subckts[name])})."))


def copy_target(rel: str) -> str:
    """Where a chain file lies in the run folder, relative to it (the engine's working directory)."""
    return "input/" + rel.replace("\\", "/")


def transformed(chain: Chain, index: int) -> str:
    """The copy of one chain file for the run folder: includes point at the copies, analysis and output cards are
    commented out, and the top file loses its .end (the helper appends its control block and .end)."""
    source = chain.files[index]
    lines = list(source.lines)
    if index == 0 and lines:
        # ngspice acts on some cards even on the title line; the copy gets a fixed title.
        lines[0] = TITLE
    by_logical = {position: child for position, child in source.includes}
    for position, line in enumerate(source.logical):
        tokens = line.text.split()
        card = tokens[0].lower()
        if position in by_logical:
            target = copy_target(chain.files[by_logical[position]].rel)
            rewritten = f'{tokens[0]} "{target}"' if card in (".include", ".inc") else f'{tokens[0]} "{target}" {tokens[2]}'
            lines[line.first] = rewritten
            for extra in range(line.first + 1, line.last + 1):
                lines[extra] = "* " + lines[extra]
        elif card in DROPPED or (index == 0 and card == ".end"):
            for number in range(line.first, line.last + 1):
                lines[number] = "* ngspice-tool: " + lines[number]
    return "\n".join(lines).rstrip("\n") + "\n"
