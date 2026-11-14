"""The command line of kicad-tool and the order of a run (spec REQ-DATA-c32834e3 §2, §5, §7).

Validate, then run, then write: every refusal (exit 2) happens before kicad-cli runs; kicad-cli works on a copy
in a temporary folder; the sources are hashed again; only then is the run folder created exclusively in the
working directory, and a failure while writing removes it (exit 3).
"""

from __future__ import annotations

import argparse
import hashlib
import os
import secrets
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Any

from . import TOOL, VERSION, discovery, document, exports, kicad, operations, project, review, workspace

DEFAULT_RESULTS = "electronics-results"
SUFFIXES = (".kicad_pro", ".kicad_sch", ".kicad_pcb")
OPERATIONS = {
    "inspect": "the sheet hierarchy, symbol instances, nets (from KiCad's netlist) and board facts",
    "erc": "KiCad's electrical rules check on a copy, every severity, with objects and positions",
    "drc": "KiCad's design rules check on a copy, with unconnected items and schematic parity",
    "bom": "a BOM grouped by value, footprint, MPN and DNP (bom.csv, bom.json)",
    "netlist": "KiCad's netlist (netlist.net) and its nets as JSON (nets.json)",
    "export": "inspection (PDF, SVG) or fabrication (Gerber, drill, position) files, each checked",
    "review-report": "inspect, ERC and DRC in one run folder, with report.md for a design review",
}
DESCRIPTION = """Analyse a KiCad 10 project without changing it (program kicad-tool of the kicad plugin).

  kicad-tool <operation> --project FILE [--results-dir DIR] [--run-id ID] [options]
  kicad-tool <operation> --help

kicad-cli runs on a copy of the project in a temporary folder, never on the project itself. Each operation
creates <results-dir>/<run-id>/ with result.json, report.md and KiCad's own files, and prints one JSON document
of at most 11 000 characters; result.json holds everything. Exit codes: 0 completed (violations are results),
2 refused before KiCad ran, 3 KiCad or a write failed (nothing kept)."""
EXPORT_HELP = "kinds:\n" + "\n".join(f"  {kind:<8} {text}" for kind, (_, text) in exports.KINDS.items()) + (
    "\n\n--layers (KiCad's names, e.g. F.Cu,B.Cu,F.Mask,B.Mask,Edge.Cuts) is required for pcb-pdf, pcb-svg and gerbers"
    " and refused for the other kinds."
)


class Usage(Exception):
    """A command line the parser refuses."""


class Parser(argparse.ArgumentParser):
    def error(self, message: str) -> None:  # type: ignore[override]
        raise Usage(message)


class Once(argparse.Action):
    """Stores one value and refuses the option a second time."""

    def __call__(self, parser, namespace, values, option_string=None):  # type: ignore[no-untyped-def]
        if getattr(namespace, f"_seen_{self.dest}", False):
            raise Usage(f"{option_string} was given more than once")
        setattr(namespace, f"_seen_{self.dest}", True)
        setattr(namespace, self.dest, values)


class OnceFlag(argparse.Action):
    """A flag that refuses being given a second time."""

    def __init__(self, option_strings, dest, **kwargs):  # type: ignore[no-untyped-def]
        super().__init__(option_strings, dest, nargs=0, default=False, **kwargs)

    def __call__(self, parser, namespace, values, option_string=None):  # type: ignore[no-untyped-def]
        if getattr(namespace, f"_seen_{self.dest}", False):
            raise Usage(f"{option_string} was given more than once")
        setattr(namespace, f"_seen_{self.dest}", True)
        setattr(namespace, self.dest, True)


def _run_id(value: str) -> str:
    if not workspace.valid_run_id(value):
        raise argparse.ArgumentTypeError(
            "use 1..64 letters, digits, '.', '_' or '-', starting and ending with a letter or digit; device names such as NUL are not accepted"
        )
    return value


def _parser() -> Parser:
    formatter = argparse.RawDescriptionHelpFormatter
    parser = Parser(prog=TOOL, description=DESCRIPTION, allow_abbrev=False, formatter_class=formatter)
    parser.add_argument("--version", action="version", version=f"{TOOL} {VERSION}")
    sub = parser.add_subparsers(dest="operation", metavar="<operation>", parser_class=Parser, title="operations")
    sub.required = True
    for name, text in OPERATIONS.items():
        epilog = EXPORT_HELP if name == "export" else None
        command = sub.add_parser(name, help=text, description=text, allow_abbrev=False, formatter_class=formatter, epilog=epilog)
        command.add_argument("--project", action=Once, required=True, metavar="FILE", help="a .kicad_pro, .kicad_sch or .kicad_pcb file inside the working directory")
        command.add_argument("--results-dir", action=Once, default=DEFAULT_RESULTS, metavar="DIR", help=f"folder for run folders, inside the working directory (default: {DEFAULT_RESULTS})")
        command.add_argument("--run-id", action=Once, type=_run_id, metavar="ID", help="name of the new run folder (default: UTC time and 8 random hex digits)")
        if name in ("drc", "review-report"):
            command.add_argument("--refill-zones", action=OnceFlag, help="refill the zones of the work copy before DRC (the project is never saved)")
        if name == "export":
            command.add_argument("--kind", action=Once, required=True, choices=list(exports.KINDS), help="what to export (see below)")
            command.add_argument("--layers", action=Once, metavar="LIST", help="comma-separated layer names for pcb-pdf, pcb-svg and gerbers")
    return parser


def _emit(data: dict[str, Any]) -> None:
    sys.stdout.write(document.fitted(data))
    sys.stdout.flush()


def _refused(operation: str | None, run_id: str | None, code: str, message: str) -> int:
    _emit(document.error_document(operation, run_id, "refused", [(code, message)]))
    return 2


def _failed(operation: str | None, run_id: str | None, code: str, message: str) -> int:
    _emit(document.error_document(operation, run_id, "failed", [(code, message)]))
    return 3


class OutputFailure(Exception):
    """The run folder could not be written (exit 3, problem `output`)."""


def _write_run(cwd: Path, results_dir: Path, run_id: str, files: list[tuple[str, bytes, str]]) -> list[dict[str, Any]]:
    """Creates the run folder exclusively and writes `files`; removes what it created when anything fails."""
    run_dir = results_dir / run_id
    made: list[Path] = []
    folder = results_dir
    while not folder.exists() and folder != folder.parent:
        made.insert(0, folder)
        folder = folder.parent
    created_run = False
    try:
        results_dir.mkdir(parents=True, exist_ok=True)
        try:
            run_dir.mkdir()
        except FileExistsError as error:
            raise OutputFailure(f"The run folder '{workspace.relative(cwd, run_dir)}' appeared during the run; run folders are never overwritten.") from error
        created_run = True
        if not workspace.allowed_output(cwd, run_dir):
            raise OutputFailure("The results directory moved out of the working directory during the run; nothing was kept.")
        artifacts = []
        for name, data, kind in files:
            target = run_dir / name
            target.parent.mkdir(parents=True, exist_ok=True)
            with open(target, "xb") as handle:
                handle.write(data)
            artifacts.append({"path": workspace.relative(cwd, target), "kind": kind, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
        return artifacts
    except (OSError, OutputFailure) as error:
        if created_run:
            shutil.rmtree(run_dir, ignore_errors=True)
        for path in reversed(made):
            try:
                path.rmdir()
            except OSError:
                pass
        if isinstance(error, OutputFailure):
            raise
        raise OutputFailure(f"The run folder '{workspace.relative(cwd, run_dir)}' could not be written: {error.strerror or error}.") from error


def main(argv: list[str]) -> int:
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8", errors="backslashreplace", newline="\n")  # type: ignore[union-attr]
    operation: str | None = argv[0] if argv and argv[0] in OPERATIONS else None
    try:
        args = _parser().parse_args(argv)
    except Usage as error:
        return _refused(operation, None, "usage", f"{error}. Run 'kicad-tool --help'.")
    except SystemExit as stop:  # --help or --version printed their text.
        return int(stop.code or 0)
    operation = args.operation
    started = document.now()
    run_id: str = args.run_id or f"{started.strftime('%Y%m%dT%H%M%SZ')}-{secrets.token_hex(4)}"
    kind: str | None = getattr(args, "kind", None)
    layers: list[str] | None = None
    if operation == "export":
        assert kind is not None
        if kind in exports.LAYER_KINDS and args.layers is None:
            return _refused(operation, run_id, "usage", f"--layers is required for --kind {kind}.")
        if kind not in exports.LAYER_KINDS and args.layers is not None:
            return _refused(operation, run_id, "usage", f"--layers applies to pcb-pdf, pcb-svg and gerbers; --kind {kind} takes none.")
        if args.layers is not None:
            try:
                layers = exports.layer_list(args.layers)
            except ValueError as error:
                return _refused(operation, run_id, "usage", str(error))
    spelled = workspace.entered_directory()
    cwd = Path(os.path.realpath(spelled))
    raw: str = args.project
    try:
        if not raw.endswith(SUFFIXES):
            raise workspace.PathRefused(f"--project takes a .kicad_pro, .kicad_sch or .kicad_pcb file; '{raw[:120]}' is none.")
        named = workspace.confined(cwd, raw, "--project", spelled)
        results_dir = workspace.results_directory(cwd, args.results_dir, spelled)
        run_dir = results_dir / run_id
        if run_dir.exists():
            raise workspace.PathRefused(f"The run folder '{workspace.relative(cwd, run_dir)}' already exists; run folders are never overwritten. Use another --run-id.")
    except workspace.PathRefused as error:
        return _refused(operation, run_id, "path", str(error))
    except OSError as error:
        return _refused(operation, run_id, "path", f"--project '{raw[:120]}' cannot be used: {error.strerror or error}.")
    needs_schematic = operation in ("erc", "bom", "netlist") or kind in ("sch-pdf", "sch-svg")
    needs_board = operation == "drc" or kind in ("pcb-pdf", "pcb-svg", "gerbers", "drill", "pos")
    try:
        if not named.is_file():
            raise project.ProjectError(f"'{workspace.relative(cwd, named)}' does not exist or is not a file.")
        reads_board = operation in ("drc", "inspect", "review-report") or kind in ("pcb-pdf", "pcb-svg", "gerbers", "drill", "pos")
        loaded = project.load(cwd, named, needs_schematic, needs_board, reads_board, operation in ("erc", "review-report"))
        if operation in ("inspect", "review-report") and loaded.schematic is None and loaded.board is None:
            raise project.ProjectError(f"The project '{loaded.folder_rel}/{loaded.name}' has neither a schematic nor a board.")
        if layers is not None:
            assert loaded.board is not None and loaded.board.tree is not None
            exports.check_layers(loaded.board.tree, layers, loaded.board.rel)
    except project.ProjectError as error:
        return _refused(operation, run_id, "project", str(error))
    except exports.LayerError as error:
        return _refused(operation, run_id, "layer", str(error))
    except (OSError, ValueError, RecursionError) as error:
        return _refused(operation, run_id, "project", f"The project cannot be read: {type(error).__name__}: {str(error)[:300]}")
    try:
        found = discovery.find_kicad()
    except discovery.KicadMissing as error:
        return _refused(operation, run_id, "kicad", str(error))

    try:
        work = Path(tempfile.mkdtemp(prefix="kicad-tool-"))
    except OSError as error:
        return _failed(operation, run_id, "output", f"No temporary work folder could be created: {error.strerror or error}.")
    try:
        copy, out = work / "project", work / "out"
        out.mkdir()
        loaded.materialize(copy)
        run = operations.Run(loaded, found, copy, out, workspace.relative(cwd, run_dir))
        refill = bool(getattr(args, "refill_zones", False))
        run.sheet_count = len(loaded.sheets)
        if operation == "inspect":
            summary = operations.inspect(run)
        elif operation == "erc":
            summary = operations.erc(run)
        elif operation == "drc":
            summary = operations.drc(run, refill)
        elif operation == "bom":
            summary = operations.bom_operation(run)
        elif operation == "netlist":
            summary = operations.netlist_operation(run)
        elif operation == "export":
            assert kind is not None
            summary = operations.export(run, kind, layers)
        else:
            summary = operations.review_report(run, refill)
        loaded.verify()
        result = document.base(operation, run_id, started)
        result.update(
            {
                "finished": document.stamp(document.now()),
                "kicad": {"executable": str(found.executable), "version": found.version},
                "project": {"folder": loaded.folder_rel, "name": loaded.name, "files": [source.entry() for source in loaded.files]},
                "summary": summary,
                "warnings": [*loaded.warnings, *run.warnings],
                "limits": run.limits,
                "result": f"{run.run_rel}/result.json",
            }
        )
        files: list[tuple[str, bytes, str]] = [(name, path.read_bytes(), kind_) for path, name, kind_ in run.keeps]
        report = review.markdown(result, run.details).encode("utf-8")
        files.append(("report.md", report, "report-markdown"))
        result["artifacts"] = [
            *[{"path": f"{run.run_rel}/{name}", "kind": kind_, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()} for name, data, kind_ in files],
        ]
        stored = (document.dumps(result, indent=2) + "\n").encode("utf-8")
        files.append(("result.json", stored, "result-json"))
        artifacts = _write_run(cwd, results_dir, run_id, files)
        result["artifacts"] = artifacts
        _emit(result)
        return 0
    except kicad.RunFailure as error:
        return _failed(operation, run_id, "run", str(error))
    except project.SourceChanged as error:
        return _failed(operation, run_id, "source", str(error))
    except OutputFailure as error:
        return _failed(operation, run_id, "output", str(error))
    except OSError as error:
        return _failed(operation, run_id, "output", f"The work folder could not be used: {error.strerror or error}.")
    except Exception as error:  # noqa: BLE001 - a run ends in a document, never in a traceback.
        return _failed(operation, run_id, "run", f"kicad-tool could not complete the run: {type(error).__name__}: {str(error)[:300]}")
    finally:
        shutil.rmtree(work, ignore_errors=True)
