"""The project's files: which they are, their checks, the work copy and the second hash (spec REQ-DATA-c32834e3 §3, §4).

Every file is read once; its SHA-256 comes from those bytes and the same bytes go to the work copy, so KiCad works
on exactly what was hashed. kicad-cli writes into the folder of the files it reads (it creates or rewrites
`<name>.kicad_prl`), which is why it never sees the source folder.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
from dataclasses import dataclass, field
from pathlib import Path, PureWindowsPath
from typing import Any

from . import sexpr
from .workspace import inside, relative

NEWEST_SCHEMATIC = 20260306  # The newest format versions KiCad 10.0.8 writes.
NEWEST_BOARD = 20260206
OLDEST_SCHEMATIC = 20231120  # KiCad 8.0's formats: the oldest kicad-tool reads.
OLDEST_BOARD = 20240108
FILE_LIMIT = 128 * 1024 * 1024
TOTAL_LIMIT = 512 * 1024 * 1024
PARSE_LIMIT = 64 * 1024 * 1024  # A parsed file takes many times its size in memory.
FILE_COUNT = 2048
MAX_SHEET_DEPTH = 64
MAX_SHEET_INSTANCES = 4096
KIPRJMOD = "${KIPRJMOD}/"


class ProjectError(Exception):
    """A project the helper refuses (exit 2, problem `project`)."""


class SourceChanged(Exception):
    """A source file changed or disappeared while the run went on (exit 3, problem `source`)."""


@dataclass
class SourceFile:
    path: Path  # Absolute, as the project names it (links not resolved): the place of its copy.
    rel: str  # Relative to the working directory, with `/`.
    role: str
    data: bytes
    sha256: str
    format: int | None = None
    tree: list[Any] | None = None

    def entry(self) -> dict[str, Any]:
        item: dict[str, Any] = {"path": self.rel, "role": self.role, "bytes": len(self.data), "sha256": self.sha256}
        if self.format is not None:
            item["format"] = self.format
        return item


@dataclass
class SheetInstance:
    path: str  # Names, e.g. /ch1/.
    uuid_path: str  # Sheet UUIDs below the root, e.g. /<uuid>/ (the netlist's tstamps).
    kicad_path: str  # Root UUID included, e.g. /<root>/<uuid> (ERC's uuid_path).
    file: SourceFile
    name: str


@dataclass
class Project:
    cwd: Path
    folder: Path
    name: str
    files: list[SourceFile] = field(default_factory=list)
    schematic: SourceFile | None = None
    board: SourceFile | None = None
    settings: dict[str, Any] | None = None
    sheets: list[SheetInstance] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    references: dict[tuple[str, int], list[tuple[str, str]]] = field(default_factory=dict)
    unlisted: int = 0  # Placed symbol instances without an `instances` entry for their path.
    variables: dict[str, str] = field(default_factory=dict)
    _bytes: int = 0

    @property
    def folder_rel(self) -> str:
        return relative(self.cwd, self.folder)

    def warn(self, text: str) -> None:
        if text not in self.warnings:
            self.warnings.append(text)

    def duplicates(self) -> list[dict[str, Any]]:
        """References that two placed symbol instances carry for the same unit (KiCad 10's ERC reports none)."""
        found = []
        for (reference, unit), places in sorted(self.references.items()):
            if len(places) > 1:
                found.append(
                    {
                        "reference": reference,
                        "unit": unit,
                        "count": len(places),
                        "sheets": [sheet for sheet, _ in places],
                        "uuidPaths": [uuid for _, uuid in places],
                    }
                )
        return found

    def add(self, named: Path, role: str) -> SourceFile:
        """Reads a project file once. The work copy puts it at the path the project names, relative to the
        project folder, so the copied files name each other as the originals do; that path and the file it
        resolves to (links followed) must both lie inside the project folder, else the copy could be the
        original itself."""
        path = Path(os.path.abspath(named))
        try:
            real = Path(os.path.realpath(path))
        except (OSError, ValueError) as error:
            raise ProjectError(f"'{relative(self.cwd, path)}' cannot be resolved.") from error
        if not inside(self.folder, path) or not inside(self.folder, real):
            raise ProjectError(
                f"'{relative(self.cwd, path)}' resolves outside the project folder; kicad-tool reads only the "
                "project's own files (a link out of the folder is refused)."
            )
        for known in self.files:
            if os.path.normcase(str(known.path)) == os.path.normcase(str(path)):
                return known
        rel = relative(self.cwd, path)
        if len(self.files) >= FILE_COUNT:
            raise ProjectError(f"The project uses more than {FILE_COUNT} files; kicad-tool copies at most that many.")
        try:
            size = path.stat().st_size
            if size > FILE_LIMIT:
                raise ProjectError(f"'{rel}' is larger than {FILE_LIMIT // (1024 * 1024)} MiB.")
            data = path.read_bytes()
        except OSError as error:
            raise ProjectError(f"'{rel}' cannot be read: {error.strerror or error}.") from error
        self._bytes += len(data)
        if self._bytes > TOTAL_LIMIT:
            raise ProjectError(f"The project's files exceed {TOTAL_LIMIT // (1024 * 1024)} MiB together.")
        source = SourceFile(path, rel, role, data, hashlib.sha256(data).hexdigest())
        self.files.append(source)
        return source

    def copy_of(self, source: SourceFile, work: Path) -> Path:
        return work / Path(os.path.relpath(source.path, self.folder))

    def materialize(self, work: Path) -> None:
        """Writes the bytes read into `work`, keeping each file's place relative to the project folder."""
        for source in self.files:
            target = self.copy_of(source, work)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(source.data)

    def verify(self) -> None:
        """Raises SourceChanged when a source no longer holds the bytes the run used."""
        for source in self.files:
            try:
                same = hashlib.sha256(source.path.read_bytes()).hexdigest() == source.sha256
            except OSError:
                same = False
            if not same:
                raise SourceChanged(f"'{source.rel}' changed while the run went on; the results were discarded.")


def _no_constant(name: str) -> Any:
    raise ValueError(f"the file holds {name}; JSON allows no NaN or Infinity")


def _finite_float(text: str) -> float:
    value = float(text)
    if not math.isfinite(value):
        raise ValueError(f"the number {text[:40]} is too large (NaN or Infinity once read)")
    return value


def _text(source: SourceFile) -> str:
    try:
        return source.data.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise ProjectError(f"'{source.rel}' is not UTF-8 text.") from error


def _parse(source: SourceFile, kind: str) -> list[Any]:
    if len(source.data) > PARSE_LIMIT:
        raise ProjectError(f"'{source.rel}' is larger than {PARSE_LIMIT // (1024 * 1024)} MiB, the most kicad-tool parses.")
    text = _text(source)
    start = text.lstrip()[:64]
    if kind == "schematic" and start.startswith("EESchema"):
        raise ProjectError(f"'{source.rel}' is in the KiCad 5 schematic format; open it in KiCad 10 and save it first. kicad-tool converts nothing.")
    if kind == "board" and start.startswith("PCBNEW"):
        raise ProjectError(f"'{source.rel}' is in a legacy KiCad board format; open it in KiCad 10 and save it first. kicad-tool converts nothing.")
    try:
        tree = sexpr.parse(text)
    except sexpr.SexprError as error:
        raise ProjectError(f"'{source.rel}' is not a valid KiCad file: {error}.") from error
    expected = "kicad_sch" if kind == "schematic" else "kicad_pcb"
    if sexpr.head(tree) != expected:
        raise ProjectError(f"'{source.rel}' is not a KiCad {kind} (it starts with '{(sexpr.head(tree) or '?')[:60]}').")
    version = sexpr.value(tree, "version")
    try:
        number = int(version)
    except (TypeError, ValueError) as error:
        raise ProjectError(f"'{source.rel}' names no format version.") from error
    source.format = number
    source.tree = tree
    return tree


def _check_version(project: Project, source: SourceFile, kind: str) -> None:
    newest = NEWEST_SCHEMATIC if kind == "schematic" else NEWEST_BOARD
    oldest = OLDEST_SCHEMATIC if kind == "schematic" else OLDEST_BOARD
    assert source.format is not None
    if source.format > newest:
        raise ProjectError(
            f"'{source.rel}' has format version {source.format}, saved by a newer KiCad than KiCad 10 (which writes "
            f"{newest}); kicad-tool converts nothing."
        )
    if source.format < oldest:
        raise ProjectError(
            f"'{source.rel}' has format version {source.format}, saved by a KiCad older than KiCad 8 (whose format is "
            f"{oldest}); open it in KiCad 10 and save it first. kicad-tool reads files from KiCad 8 on and converts nothing."
        )
    if source.format < newest:
        project.warnings.append(
            f"'{source.rel}' has format version {source.format} from an earlier KiCad; KiCad 10 converts it in memory "
            "for this run and the file stays unchanged."
        )


def _real(path: Path) -> str:
    return os.path.normcase(os.path.realpath(path))


def _climbs(base: tuple[str, ...], name: str) -> bool:
    """Whether a relative name, read from the folder `base` below the project folder, ever climbs above that
    folder with `..`, even if it comes back in by the folder's own name: the copy keeps the project folder's
    contents, not its name, so such a path would reach nothing there."""
    depth = len(base)
    for part in re.split(r"[\\/]+", name):
        if part in ("", "."):
            continue
        depth += -1 if part == ".." else 1
        if depth < 0:
            return True
    return False


def _network(name: str) -> bool:
    """A network or device path: two leading slashes or backslashes (UNC, `\\\\?\\`, `\\\\.\\`) or Windows' NT prefix
    `\\??\\` (any slashes); opening one could reach another host or a device."""
    text = name.replace("/", "\\")
    return text.startswith(("\\\\", "\\??\\"))


# KiCad fills in variables in library tables, drawing-sheet names, sheet file names and simulation model paths, in
# more spellings than a scanner can follow (${N}, $(N), $N with any letters, %N%, nested, unclosed) and lets the
# project's text variables override its own. kicad-tool therefore accepts a variable in such a path only as an
# allowed token at its start: KIPRJMOD (the project folder) or one of KiCad's own KICAD.../KISYS... variables, which
# the project may not redefine. Any other `$` or `%` refuses the path.
_KICAD_NAME = r"KIPRJMOD|KICAD\d*_[A-Z0-9_]+|KISYS[A-Z0-9_]*"
_LEADING = re.compile(rf"^(?:\$\{{({_KICAD_NAME})\}}|\$\(({_KICAD_NAME})\)|\$(KIPRJMOD)|%(KIPRJMOD)%)(?=[\\/])")
_RESERVED = re.compile(rf"^(?:{_KICAD_NAME})$", re.IGNORECASE)
_REFERS = re.compile(r"\$|%\S")  # `$` or `%` before a name: KiCad expands variables inside variable values.
LIBRARY_TYPE = "KiCad"  # KiCad's own library files; a nested Table, an importer or a server library is refused.
SHEET_FILE = ("sheetfile", "sheet file")  # The names KiCad 10 takes for a sheet's file, any case (observed).
SHEET_NAME = ("sheetname", "sheet name")


def _unsafe_value(value: str) -> bool:
    """A text variable value that could make a path in the user's global library table a network or device path:
    two leading slashes or backslashes, slashes only (`${V}/x` gives `//x`) or a reference to another variable."""
    text = value.strip()
    return _network(text) or (text != "" and text.strip("/\\") == "") or _REFERS.search(value) is not None


def _check_variables(project: Project, settings: SourceFile) -> None:
    """Refuses project text variables that could steer KiCad's own file lookups: a name KiCad uses for them
    (KIPRJMOD, KICAD<n>_..., KISYS...) and a value `_unsafe_value` names, which a variable in the user's global
    library table could pick up."""
    for name, value in project.variables.items():
        if "\x00" in name or "\x00" in value:  # KiCad cuts a name or value there: `KIPRJMOD\0x` is KIPRJMOD to it.
            raise ProjectError(
                f"'{settings.rel}' has a text variable whose name or value holds a NUL character, which KiCad reads "
                "only up to that character; kicad-tool refuses such projects."
            )
        if _RESERVED.match(name):
            raise ProjectError(
                f"'{settings.rel}' redefines the text variable '{name[:60]}', which KiCad uses to find project and "
                "library files; kicad-tool refuses such projects."
            )
        if _unsafe_value(value):
            raise ProjectError(
                f"'{settings.rel}' gives the text variable '{name[:60]}' a value that could make a library path a network "
                "or device path (two leading slashes or backslashes, slashes only, or another variable through $ or %); "
                "kicad-tool does not let KiCad open another host's files."
            )


def _vet(text: str) -> tuple[str, str]:
    """How a path text names its file: ("project", rest) after KIPRJMOD, ("kicad", text) after one of KiCad's own
    variables, ("plain", text) without any variable, ("variable", text) for anything else holding `$` or `%`."""
    found = _LEADING.match(text)
    if found:
        rest = text[found.end() + 1 :]  # After the separator the lookahead saw.
        if "$" in rest or "%" in rest:
            return "variable", text
        name = next(group for group in found.groups() if group is not None)
        return ("project" if name == "KIPRJMOD" else "kicad"), (rest.lstrip("/\\") if name == "KIPRJMOD" else text)
    if "$" in text or "%" in text:
        return "variable", text
    return "plain", text


def _field(node: list[Any], names: tuple[str, ...]) -> str | None:
    """The first property whose name is one of `names` in any ASCII letter case: a sheet's name or file, of which
    KiCad takes the first and ignores look-alikes such as U+017F (observed)."""
    for item in sexpr.children(node, "property"):
        name = str(item[1]) if len(item) > 2 else ""
        if name.isascii() and name.lower() in names:
            return str(item[2])
    return None


def _record(project: Project, sheet_path: str, symbol_uuid_path: str, reference: str, unit: int) -> None:
    """One placed symbol unit's reference; power symbols (#) and unannotated ones (R?) are KiCad's to check."""
    if not reference or reference.startswith("#") or reference.endswith("?"):
        return
    project.references.setdefault((reference, unit), []).append((sheet_path, symbol_uuid_path))


def _last(node: list[Any], name: str) -> Any:
    """The value of the last child list `name` (KiCad reads repeated ones in turn, so the last wins)."""
    found = [item[1] for item in sexpr.children(node, name) if len(item) > 1]
    return found[-1] if found else None


def _instances(project: Project, source: SourceFile, sheet_path: str, uuid_path: str, kicad_path: str) -> None:
    """Notes the reference of each placed symbol of `source` in this sheet instance: the last `reference` (and
    `unit`, else 1, as KiCad reads it) of the last entry for this path in its `instances` block (an empty reference is
    unannotated: KiCad shows R?). KiCad 8 and later write such an entry for every placed symbol; one without it (an
    edited or merged file) gets another entry's reference or its Reference field from KiCad, so kicad-tool leaves it
    out of its check and counts it."""
    assert source.tree is not None
    for symbol in sexpr.children(source.tree, "symbol"):
        if sexpr.child(symbol, "lib_id") is None:
            continue
        holder = sexpr.child(symbol, "instances")
        chosen = None
        for entry in sexpr.children(holder, "project") if holder is not None else []:
            for instance in sexpr.children(entry, "path"):
                if len(instance) >= 2 and str(instance[1]) == kicad_path:
                    chosen = instance
        if chosen is None:
            project.unlisted += 1
            continue
        reference = str(_last(chosen, "reference") or "")
        unit = sexpr.integer(_last(chosen, "unit"), 1)
        symbol_uuid = str(sexpr.value(symbol, "uuid", ""))
        _record(project, sheet_path, f"{uuid_path}{symbol_uuid}", reference, unit)


def _check_models(project: Project, settings: SourceFile) -> None:
    """Refuses an ERC run whose project turns on ERC's simulation model check: only that check opens the model files
    symbols name, and a model file can include any other file, a network or device path too. KiCad 10.0.8 runs it
    unless the setting is absent or exactly "ignore" (observed); netlist, BOM and exports open no model."""
    erc = (project.settings or {}).get("erc")
    severities = erc.get("rule_severities") if isinstance(erc, dict) else None
    severity = severities.get("simulation_model_issue", "ignore") if isinstance(severities, dict) else "ignore"
    if severity != "ignore":
        raise ProjectError(
            f"'{settings.rel}' turns on ERC's simulation model check (simulation_model_issue: {json.dumps(severity)[:40]}), "
            "which makes KiCad open every simulation model file and the files they include; kicad-tool does not run "
            "it. Set the check to ignore for this run, or check models with a simulation tool."
        )


def _walk(project: Project, source: SourceFile, path: str, uuid_path: str, kicad_path: str, name: str, chain: tuple[str, ...]) -> None:
    if len(project.sheets) >= MAX_SHEET_INSTANCES:
        raise ProjectError(f"The hierarchy has more than {MAX_SHEET_INSTANCES} sheet instances; kicad-tool reads at most that many.")
    project.sheets.append(SheetInstance(path, uuid_path, kicad_path, source, name))
    _instances(project, source, path, uuid_path, kicad_path)
    if len(chain) > MAX_SHEET_DEPTH:
        raise ProjectError(f"The sheet hierarchy is deeper than {MAX_SHEET_DEPTH} levels at '{source.rel}'.")
    assert source.tree is not None
    for sheet in sexpr.children(source.tree, "sheet"):
        sheet_name = _field(sheet, SHEET_NAME) or ""
        file_name = _field(sheet, SHEET_FILE)
        sheet_uuid = str(sexpr.value(sheet, "uuid", ""))
        shown = sheet_name[:120]
        if not file_name:
            raise ProjectError(f"Sheet '{shown}' in '{source.rel}' names no sheet file.")
        if Path(file_name).is_absolute() or PureWindowsPath(file_name).drive or file_name.startswith(("/", "\\")):
            raise ProjectError(
                f"'{file_name[:300]}', named by sheet '{shown}' in '{source.rel}', is an absolute path; kicad-tool "
                "copies a project only with sheet files named relative to the schematic that uses them."
            )
        if "$" in file_name or "%" in file_name:
            raise ProjectError(
                f"'{file_name[:300]}', named by sheet '{shown}' in '{source.rel}', names its file through a variable; "
                "kicad-tool copies a project only with sheet files named by a literal relative path."
            )
        if file_name.split("/")[0].split("\\")[0].startswith("~"):
            raise ProjectError(
                f"'{file_name[:300]}', named by sheet '{shown}' in '{source.rel}', starts with '~', which KiCad may read "
                "as the home folder; name sheet files relative to the schematic that uses them."
            )
        base = Path(os.path.relpath(source.path.parent, project.folder)).parts
        if _climbs(tuple(part for part in base if part != "."), file_name):
            raise ProjectError(
                f"'{file_name[:300]}', named by sheet '{shown}' in '{source.rel}', climbs above the project folder "
                "with '..', so it lies outside the project folder or re-enters it by name; the copy could not reproduce it."
            )
        target = Path(os.path.abspath(source.path.parent / file_name))
        if not inside(project.folder, target) or not inside(project.folder, Path(_real(target))):
            raise ProjectError(f"'{file_name[:300]}', named by sheet '{shown}' in '{source.rel}', lies outside the project folder.")
        if not target.is_file():
            raise ProjectError(f"'{file_name[:300]}', named by sheet '{shown}' in '{source.rel}', does not exist ('{relative(project.cwd, target)}').")
        if _real(target) in chain:
            raise ProjectError(f"'{file_name[:300]}', named by sheet '{shown}' in '{source.rel}', includes itself.")
        child = project.add(target, "sheet")
        if child.tree is None:
            _parse(child, "schematic")
            _check_version(project, child, "schematic")
        _walk(project, child, f"{path}{sheet_name}/", f"{uuid_path}{sheet_uuid}/", f"{kicad_path}/{sheet_uuid}", sheet_name, (*chain, _real(target)))


def _library_table(project: Project, name: str) -> None:
    path = project.folder / name
    if not path.is_file():
        return
    table = project.add(path, "library-table")
    if len(table.data) > PARSE_LIMIT:
        raise ProjectError(f"'{table.rel}' is larger than {PARSE_LIMIT // (1024 * 1024)} MiB, the most kicad-tool parses.")
    outside: list[str] = []
    try:
        tree = sexpr.parse(_text(table), raw=True)  # KiCad 10 reads library tables without escapes (observed).
    except sexpr.SexprError as error:
        raise ProjectError(f"'{table.rel}' is not a valid library table: {error}.") from error
    for lib in sexpr.children(tree, "lib"):
        # KiCad uses the last `type` and `uri` of an entry (observed), so every one is checked.
        kinds = [str(item) for node in sexpr.children(lib, "type") for item in node[1:]]
        uris = [str(item) for node in sexpr.children(lib, "uri") for item in node[1:]]
        for kind in kinds or [""]:
            if kind != LIBRARY_TYPE:
                raise ProjectError(
                    f"'{table.rel}' names a library of type '{kind[:40]}'; kicad-tool accepts only KiCad's own library "
                    f"files (type '{LIBRARY_TYPE}'), as a nested table, an imported format or a server library could make "
                    "KiCad read files or hosts kicad-tool has not checked."
                )
        for uri in uris:
            _library(project, table, lib, uri, outside)
    if outside:
        project.warn(
            f"'{table.rel}' names library files that resolve outside the project folder ({', '.join(outside[:8])}"
            f"{', ...' if len(outside) > 8 else ''}); they are not copied, so KiCad reports them missing in this run."
        )


def _library(project: Project, table: SourceFile, lib: list[Any], uri: str, outside: list[str]) -> None:
    """Checks one library path and copies it when it lies in the project folder."""
    if _network(uri):
        raise ProjectError(
            f"'{table.rel}' names a network or device path ('{uri[:200]}'); kicad-tool does not let KiCad open "
            "another host's files."
        )
    named_as, rest = _vet(uri)
    if named_as == "variable":
        raise ProjectError(
            f"'{table.rel}' names a library through a variable ('{uri[:120]}'); kicad-tool accepts only KIPRJMOD and "
            "KiCad's own KICAD.../KISYS... variables in project file paths, as any other could lead KiCad to "
            "another file or host (a network or device path)."
        )
    if named_as != "project":
        return  # Read in place by KiCad (KiCad's own libraries or absolute paths).
    target = Path(os.path.abspath(project.folder / rest))
    if _climbs((), rest) or not inside(project.folder, target) or not inside(project.folder, Path(_real(target))):
        outside.append(str(sexpr.value(lib, "name", uri)))
        return
    if target.is_dir():
        for item in sorted(target.iterdir(), key=lambda entry: entry.name):
            if item.suffix in (".kicad_mod", ".kicad_sym") and item.is_file():  # Footprints, or KiCad 10 symbol folders.
                if inside(project.folder, Path(_real(item))):
                    project.add(item, "library")
                else:
                    outside.append(f"{sexpr.value(lib, 'name', uri)}/{item.name}")
    elif target.is_file():
        project.add(target, "library")


def _drawing_sheets(project: Project) -> None:
    settings = project.settings or {}
    for section in ("schematic", "pcbnew"):
        entry = settings.get(section)
        name = entry.get("page_layout_descr_file") if isinstance(entry, dict) else None
        if not isinstance(name, str) or not name:
            continue
        if _network(name):
            raise ProjectError(
                f"The project names a drawing sheet on a network or device path ('{name[:200]}'); kicad-tool does not "
                "let KiCad open another host's files."
            )
        named_as, rest = _vet(name)
        if named_as == "variable":
            raise ProjectError(
                f"The project names its drawing sheet through a variable ('{name[:120]}'); kicad-tool accepts only "
                "KIPRJMOD and KiCad's own KICAD.../KISYS... variables in project file paths."
            )
        name = rest
        if named_as == "kicad" or Path(name).is_absolute() or PureWindowsPath(name).drive:
            continue  # Read in place by KiCad, like global libraries.
        target = Path(os.path.abspath(project.folder / name))
        if _climbs((), name) or not inside(project.folder, target) or not inside(project.folder, Path(_real(target))):
            project.warn(
                f"The project's drawing sheet '{name[:200]}' lies outside the project folder; it is not copied, so "
                "KiCad uses its default frame in this run."
            )
        elif target.is_file():
            project.add(target, "drawing-sheet")


def _unique(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    found: dict[str, Any] = {}
    for key, value in pairs:
        if key in found:
            raise ValueError(f"the key '{key[:60]}' appears twice in one object")
        found[key] = value
    return found


def load(
    cwd: Path,
    named: Path,
    needs_schematic: bool = False,
    needs_board: bool = False,
    parse_board: bool = True,
    runs_erc: bool = True,
) -> Project:
    """Reads, hashes and checks the project of the named `.kicad_pro`, `.kicad_sch` or `.kicad_pcb` file; the board is
    parsed only when `parse_board` (an operation that reads it), else only copied; ERC's settings are checked only
    when `runs_erc`."""
    folder = named.parent
    project = Project(cwd=cwd, folder=folder, name=named.stem)
    stem = folder / named.stem
    pro = Path(f"{stem}.kicad_pro")
    if pro.is_file():
        settings = project.add(pro, "project")
        try:
            loaded = json.loads(_text(settings), parse_constant=_no_constant, parse_float=_finite_float, object_pairs_hook=_unique)
        except json.JSONDecodeError as error:
            raise ProjectError(f"'{settings.rel}' is not valid JSON: {error.msg} at line {error.lineno}, column {error.colno}.") from error
        except (ValueError, RecursionError) as error:
            raise ProjectError(f"'{settings.rel}' cannot be read as a KiCad project (NaN or Infinity, a repeated key, nesting or a number too large): {str(error)[:200]}.") from error
        if not isinstance(loaded, dict):
            raise ProjectError(f"'{settings.rel}' is not a KiCad project file (no JSON object).")
        project.settings = loaded
        raw = loaded.get("text_variables")
        project.variables = {str(key): value for key, value in raw.items() if isinstance(value, str)} if isinstance(raw, dict) else {}
        _check_variables(project, settings)
        if runs_erc:
            _check_models(project, settings)
    schematic = named if named.suffix == ".kicad_sch" else Path(f"{stem}.kicad_sch")
    board = named if named.suffix == ".kicad_pcb" else Path(f"{stem}.kicad_pcb")
    if needs_schematic and not schematic.is_file():
        raise ProjectError(f"The project has no schematic ('{relative(cwd, schematic)}' does not exist).")
    if needs_board and not board.is_file():
        raise ProjectError(f"The project has no board ('{relative(cwd, board)}' does not exist).")
    if schematic.is_file():
        project.schematic = project.add(schematic, "schematic")
        _parse(project.schematic, "schematic")
        _check_version(project, project.schematic, "schematic")
        root_uuid = str(sexpr.value(project.schematic.tree, "uuid", ""))
        _walk(project, project.schematic, "/", "/", f"/{root_uuid}", "", (_real(project.schematic.path),))
        if project.unlisted:
            project.warn(
                f"{project.unlisted} placed symbol instance(s) have no reference entry for their sheet path (an edited "
                "or merged schematic); KiCad gives them another entry's reference or their Reference field, so "
                "kicad-tool's duplicate-reference check leaves them out."
            )
    if board.is_file():
        project.board = project.add(board, "board")
        if parse_board:
            _parse(project.board, "board")
            _check_version(project, project.board, "board")
    rules = Path(f"{stem}.kicad_dru")
    if rules.is_file():
        project.add(rules, "rules")
    _library_table(project, "sym-lib-table")
    _library_table(project, "fp-lib-table")
    _drawing_sheets(project)
    return project
