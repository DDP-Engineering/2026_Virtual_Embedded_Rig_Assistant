"""kicad-layout-tool's command line (spec REQ-DATA-891d5b5d): open, edit and close a candidate. Every refusal that
needs no board comes before kicad-python is imported. An edit writes state.json right after KiCad saved the candidate
(objectives none) and again with the objectives at the end, so a failure leaves the run as it was or records the
saved edit and says so."""

from __future__ import annotations

import argparse
import os
import runpy
import secrets
import shutil
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import TOOL, VERSION, workspace
from . import candidate as candidates
from . import report as reports
from . import state as states
from .request import Failed, Problem, Refused, fail, parse, refuse

EPILOG = """operations:
  open --board FILE.kicad_pcb [--results-dir DIR] [--run-id ID]
      copy the board and its project files into a new run folder, open the copy in KiCad's PCB editor (its API must
      be enabled: Preferences > Plugins; no other KiCad window may hold the API), save it through KiCad and write
      state.json, board.json, the DRC and previews
  edit --run DIR (--json TEXT | --request FILE)
      check a request (format 1, units mm: place, align, keepout, track, via) against the candidate the API has open,
      run it in one KiCad commit, check that only the named items changed, save, run DRC, set the objectives and
      write result.json and report.md
  close --run DIR
      stop the PCB editor that open started, when the candidate has no unsaved edits

The source board is never written; VERA's apply_candidate tool writes a passing candidate over it after approval.
Exit codes: 0 completed, 2 refused (nothing changed), 3 failed (nothing saved, unless the problem says that the edit
was saved and only its checks did not finish; state.json then records the saved candidate with objectives none)."""


class Usage(Exception):
    pass


class _Parser(argparse.ArgumentParser):
    def error(self, message: str) -> None:  # type: ignore[override]
        raise Usage(message)


def _parser() -> _Parser:
    parser = _Parser(prog=TOOL, description="Edit candidate copies of KiCad 10 boards through KiCad's IPC API.",
                     epilog=EPILOG, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--version", action="version", version=f"{TOOL} {VERSION}")
    sub = parser.add_subparsers(dest="operation", parser_class=_Parser)
    opened = sub.add_parser("open", help="open a candidate copy of a board")
    opened.add_argument("--board", required=True, metavar="FILE.kicad_pcb")
    opened.add_argument("--results-dir", default="electronics-results", metavar="DIR")
    opened.add_argument("--run-id", metavar="ID")
    edited = sub.add_parser("edit", help="run a checked request on the candidate")
    edited.add_argument("--run", required=True, metavar="DIR")
    source = edited.add_mutually_exclusive_group(required=True)
    source.add_argument("--json", metavar="TEXT")
    source.add_argument("--request", metavar="FILE")
    closed = sub.add_parser("close", help="stop the candidate's PCB editor")
    closed.add_argument("--run", required=True, metavar="DIR")
    return parser


def _emit(doc: dict[str, Any]) -> None:
    sys.stdout.write(reports.printed(doc) + "\n")
    sys.stdout.flush()


def _kicad_cli() -> Path:
    return Path(os.environ.get("VERA_PROGRAM_KICAD_CLI", "kicad-cli"))


def _need_cli(path: Path) -> Path:
    if not path.is_file():
        raise fail("kicad", "kicad-cli", "kicad-cli of KiCad 10 was not found (VERA passes it as VERA_PROGRAM_KICAD_CLI).")
    return path


def _saved(failed: Failed, what: str) -> Failed:
    """A failure after KiCad saved the candidate: the problem says so (spec §7)."""
    return Failed([Problem(p.kind, p.where, f"{p.message} The edit was saved to the candidate, but {what}.") for p in failed.problems])


def _failed_report(folder: Path, started: str, failed: Failed, state: dict[str, Any], request: Path | None) -> None:
    """result.json and report.md of an edit that failed after the save, so neither shows the previous edit: with the
    request when it was recorded and the saved candidate's hash (spec §7)."""
    try:
        doc = reports.problems_document("edit", folder.name, started, "failed", failed.problems)
        doc["kicad"] = state.get("kicad")
        if request is not None and request.is_file():
            doc["request"] = request.relative_to(folder).as_posix()
        candidate = states.candidate_path(folder, state)
        doc["candidate"] = {"path": state["candidate"]["path"], "sha256": states.sha256_file(candidate)}
        states.write_json(folder / "result.json", doc)
        states.write_text(folder / "report.md", reports.markdown(doc))
    except (OSError, ValueError, KeyError, TypeError):
        pass  # The failure being reported is the one that matters.


def _after_save(error: Exception, what: str, folder: Path, started: str, state: dict[str, Any], request: Path | None = None) -> Failed:
    """Any failure after KiCad saved the candidate: the problem says that the edit was saved and what that means, and
    result.json and report.md become that failed report (spec §7)."""
    if isinstance(error, Failed):
        failed = error
    elif isinstance(error, OSError):
        failed = Failed([Problem("output", "run", f"A run-folder file could not be written or read: {error.strerror or error}.")])
    else:
        failed = Failed([Problem("kicad", "kicad", f"Unexpected error: {type(error).__name__}: {str(error)[:300]}.")])
    saved = _saved(failed, what)
    _failed_report(folder, started, saved, state, request)
    return saved


def _run_files(folder: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    """board-open.json and drc-before.json as open wrote them, read before the commit: a file that is missing or not
    what the tool wrote is an `output` failure with nothing saved (spec §7)."""
    try:
        opened = states.read_json(folder / "board-open.json")
        drc_before = states.read_json(folder / "drc-before.json")
        if not (isinstance(opened, dict) and all(isinstance(opened.get(k), list) for k in ("footprints", "nets", "copperLayers"))
                and isinstance(opened.get("routing"), dict)
                and isinstance(drc_before, dict) and all(isinstance(drc_before.get(k, []), list) for k in ("violations", "unconnected_items", "schematic_parity"))):
            raise ValueError("not the structure the tool wrote")
    except (OSError, ValueError) as error:
        raise fail("output", "run", f"A run-folder file (board-open.json, drc-before.json) is missing or not what the tool wrote "
                                    f"({type(error).__name__}: {str(error)[:200]}). Nothing was saved; open a new candidate.") from error
    return opened, drc_before


def _hook(point: str, **values: Any) -> None:
    """KICAD_LAYOUT_TEST_HOOK names a Python file the tests run at named points (VERA never passes it to programs)."""
    path = os.environ.get("KICAD_LAYOUT_TEST_HOOK")
    if path:
        runpy.run_path(path, init_globals={"point": point, **values})


def _open(args: argparse.Namespace, cwd: Path, spelled: Path, started: str) -> dict[str, Any]:
    try:
        board = workspace.regular_file(cwd, args.board, "--board", spelled)
        if board.suffix.lower() != ".kicad_pcb":
            raise workspace.PathRefused("--board must name a KiCad board (.kicad_pcb).")
    except workspace.PathRefused as error:
        raise refuse("path", "--board", str(error)) from error
    try:
        results = workspace.results_directory(cwd, args.results_dir, spelled)
    except workspace.PathRefused as error:
        raise refuse("path", "--results-dir", str(error)) from error
    run_id = args.run_id or f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{secrets.token_hex(4)}"
    if not workspace.valid_run_id(run_id):
        raise refuse("path", "--run-id", "--run-id takes 1 to 64 letters, digits, dots, hyphens or underscores.")
    folder = results / run_id
    if folder.exists():
        raise refuse("path", "--run-id", f"The run folder {run_id} exists already.")
    kicad_cli = _need_cli(_kicad_cli())
    from . import drc, kicad, operations  # kicad-python from here on

    held = kicad.answering()
    if held is not None:
        names = ", ".join(held) or "a board"
        raise refuse("binding", "kicad", f"Another KiCad window holds the KiCad API ({names} open). Close it, then open the candidate again.")
    results.mkdir(parents=True, exist_ok=True)
    if not workspace.allowed_output(cwd, results):
        raise refuse("path", "--results-dir", "--results-dir must lie inside the working directory and outside .vera.")
    try:
        folder.mkdir()
    except FileExistsError as error:
        raise refuse("path", "--run-id", f"The run folder {run_id} exists already.") from error
    process = None
    try:
        inputs = candidates.copy(cwd, board, folder / "candidate")
        candidate = folder / "candidate" / board.name
        process = kicad.launch(kicad_cli, candidate)
        seconds = kicad.wait_seconds(60)
        api = kicad.connect(seconds)
        bound = kicad.bind(api, candidate, seconds)
        version = api.version()
        api.call(bound.save)
        kicad.reload(api, bound)
        memory = kicad.memory_hash(api, bound)
        candidate_sha = states.sha256_file(candidate)
        inventory = operations.inventory(api, bound)
        states.write_json(folder / "board.json", inventory)
        states.write_json(folder / "board-open.json", inventory)
        before = drc.run(kicad_cli, candidate, folder / "drc-before.json")
        previews = []
        for layer in inventory["copperLayers"]:
            drc.preview(kicad_cli, candidate, layer, folder / drc.preview_name("before", layer))
            previews.append(drc.preview_name("before", layer))
        if states.sha256_file(candidate) != candidate_sha:
            raise fail("kicad", "kicad-cli", "kicad-cli changed the candidate while checking it.")
        doc = reports.base("open", run_id, started)
        doc.update({
            "kicad": version,
            "inputs": inputs,
            "candidate": {"path": f"candidate/{board.name}", "sha256": candidate_sha},
            "board": {k: inventory[k] if not isinstance(inventory[k], list) else len(inventory[k]) for k in ("footprints", "nets", "tracks", "vias", "zones")},
            "drc": {"before": drc.counts(before)},
            "unconnected": {"before": drc.unconnected(before)},
            "previews": previews,
            "warnings": drc.warnings(before),
            "artifacts": reports.artifacts(folder, [f"candidate/{board.name}", "board.json", "board-open.json", "drc-before.json", *previews]),
            "ended": reports.now(),
        })
        states.write_json(folder / "result.json", doc)
        states.write_text(folder / "report.md", reports.markdown(doc))
        states.write_json(folder / "state.json", {
            "format": 1, "kind": states.KIND, "runId": run_id, "tool": TOOL, "toolVersion": VERSION, "kicad": version,
            "source": {"path": inputs[0]["path"], "sha256": inputs[0]["sha256"], "bytes": inputs[0]["bytes"]},
            "candidate": {"path": f"candidate/{board.name}", "sha256": candidate_sha, "memorySha256": memory},
            "editor": {"pid": process.pid},
            "edits": 0,
            "objectives": {"status": "none"},
        })
        return doc
    except BaseException:
        if process is not None:
            kicad.stop_process(process)
        shutil.rmtree(folder, ignore_errors=True)
        raise


def _edit(args: argparse.Namespace, cwd: Path, spelled: Path, started: str) -> dict[str, Any]:
    folder = states.run_folder(cwd, args.run, spelled)
    state = states.read_state(folder)
    if args.json is not None:
        text = args.json
    else:
        try:
            path = workspace.regular_file(cwd, args.request, "--request", spelled)
            if path.stat().st_size > 1024 * 1024:
                raise workspace.PathRefused("--request names a file larger than 1 MiB.")
            text = path.read_text(encoding="utf-8")
        except (workspace.PathRefused, OSError, UnicodeDecodeError) as error:
            raise refuse("request", "--request", str(error)[:300]) from error
    requested, operations_list = parse(text)
    candidate = states.candidate_path(folder, state)
    if requested != state["candidate"]["sha256"]:
        raise refuse("changed", "candidate", "The request names another state of the candidate; read state.json and board.json again.")
    if states.sha256_file(candidate) != state["candidate"]["sha256"]:
        raise refuse("changed", "candidate", "The candidate file changed since its last save; open a new candidate.")
    kicad_cli = _need_cli(_kicad_cli())  # before KiCad is touched: a missing kicad-cli changes nothing
    from . import drc, kicad, operations  # kicad-python from here on

    api = kicad.connect(kicad.wait_seconds(10))
    board = api.board(candidate)
    if kicad.memory_hash(api, board) != state["candidate"]["memorySha256"]:
        raise refuse("changed", "candidate", "The candidate window has edits that kicad-layout-tool did not make (unsaved or reloaded); undo or revert them in KiCad, or open a new candidate.")
    _hook("after-bind", run_dir=folder, state=state, socket=kicad.socket_path())
    opened, drc_before = _run_files(folder)
    limits = operations.outline(api, board)
    resolved = operations.Resolved(api, board, operations_list)
    before = operations.snapshot(api, board)
    try:
        placed_refs, created = resolved.execute(lambda point: _hook(point, run_dir=folder, state=state, socket=kicad.socket_path()))
        _hook("before-unchanged", run_dir=folder, state=state, socket=kicad.socket_path())
        placed = [resolved.footprints[ref] for ref in dict.fromkeys(placed_refs)]
        operations.check_outline(api, board, limits, placed, created)
        after = operations.snapshot(api, board)
        operations.check_nets(after, resolved.requested_nets, resolved.created_by)
        unchanged = operations.check_unchanged(before, after, {fp.id.value for fp in placed}, {operations.id_of(c) for c in created})
        api.board(candidate)  # the candidate is still the API's open document right before the save (spec §2)
    except BaseException as error:
        try:
            kicad.reload(api, board)
        except (Failed, Exception):  # noqa: BLE001 - the original failure is the one to report
            pass
        if isinstance(error, (Refused, Failed, KeyboardInterrupt, SystemExit)):
            raise
        raise fail("kicad", "kicad", f"The edit failed: {type(error).__name__}: {str(error)[:300]}") from error
    api.call(board.save)
    # The candidate file has changed: from here on every failure says that the edit was saved (spec §7), and state.json
    # follows the candidate as soon as KiCad's new state is known.
    edits = int(state["edits"]) + 1
    request_file = folder / "requests" / f"{edits:03d}.json"  # numbered by the edit it belongs to
    request_path = request_file.relative_to(folder).as_posix()
    try:
        kicad.reload(api, board)
        memory = kicad.memory_hash(api, board)
    except Exception as error:  # noqa: BLE001 - any failure here leaves a saved edit that must be reported as such
        raise _after_save(error, "its new state could not be read back from KiCad, so this run cannot continue; close the PCB editor and open a new candidate",
                          folder, started, state) from error
    try:
        candidate_sha = states.sha256_file(candidate)
        created_now = operations.created_items(created)
        state = {**state, "candidate": {**state["candidate"], "sha256": candidate_sha, "memorySha256": memory},
                 "edits": edits, "objectives": {"status": "none"}}
        states.write_json(folder / "state.json", state)
        request_file.parent.mkdir(exist_ok=True)
        states.write_text(request_file, text if text.endswith("\n") else text + "\n")
        states.write_json(folder / "created.json", [*states.created(folder), *created_now])
    except Exception as error:  # noqa: BLE001
        raise _after_save(error, f"the run folder could not record it (edit {edits}); close the PCB editor yourself and open a new candidate",
                          folder, started, state, request_file) from error
    try:
        return _checks(api, board, folder, started, state, kicad_cli, candidate, candidate_sha, created_now, placed, unchanged,
                       opened, drc_before, request_file, requested)
    except Exception as error:  # noqa: BLE001
        raise _after_save(error, f"its checks did not finish or could not be recorded (edit {edits}), so its objectives are not evaluated "
                                 "and it cannot be applied; a later edit checks it again", folder, started, state, request_file) from error


def _checks(api: Any, board: Any, folder: Path, started: str, state: dict[str, Any], kicad_cli: str, candidate: Path, candidate_sha: str,
            created_now: list[dict[str, Any]], placed: list[Any], unchanged: dict[str, int], opened: dict[str, Any],
            drc_before: dict[str, Any], request_file: Path, requested: str) -> dict[str, Any]:
    """The saved edit's inventory, DRC, previews, objectives, result.json and report.md, then state.json's objectives."""
    from . import drc, operations

    request_path = request_file.relative_to(folder).as_posix()
    inventory = operations.inventory(api, board)
    states.write_json(folder / "board.json", inventory)
    drc_after = drc.run(kicad_cli, candidate, folder / "drc-after.json")
    objectives = drc.objectives(drc_before, drc_after)
    sides = {fp["uuid"]: ("F.Cu" if fp["side"] == "front" else "B.Cu") for fp in inventory["footprints"]}
    layers = {c["layer"] for c in created_now if c["type"] == "track"} | {layer for c in created_now if c["type"] == "keepout" for layer in c["layers"]}
    layers |= {sides[fp.id.value] for fp in placed if fp.id.value in sides}
    if any(c["type"] == "via" for c in created_now):
        layers |= set(inventory["copperLayers"])
    # The before previews are open's, one per copper layer of board-open.json.
    previews = [name for name in (drc.preview_name("before", layer) for layer in opened["copperLayers"]) if (folder / name).is_file()]
    for layer in sorted(layers & set(inventory["copperLayers"])):
        drc.preview(kicad_cli, candidate, layer, folder / drc.preview_name("after", layer))
        previews.append(drc.preview_name("after", layer))
    if states.sha256_file(candidate) != candidate_sha:
        raise fail("kicad", "kicad-cli", "kicad-cli changed the candidate while checking it.")
    placed_uuids = {fp.id.value for fp in placed}
    touched = {c["net"] for c in created_now if c.get("net")}
    touched |= {pad["net"] for fp in inventory["footprints"] if fp["uuid"] in placed_uuids for pad in fp["pads"] if pad["net"]}
    doc = reports.base("edit", folder.name, started)
    doc.update({
        "kicad": state.get("kicad"),
        "request": request_path,
        "inputs": [{"path": request_path, "role": "request", "sha256": states.sha256_file(request_file)},
                   {"path": state["candidate"]["path"], "role": "candidate before the edit", "sha256": requested}],
        "candidate": {"path": state["candidate"]["path"], "sha256": candidate_sha},
        "changes": {"footprints": reports.footprint_changes(opened, inventory), "created": states.created(folder)},
        "nets": reports.nets(touched, opened, inventory),
        "drc": {"before": drc.counts(drc_before), "after": drc.counts(drc_after), "new": objectives["new"], "newCount": objectives["newCount"]},
        "unconnected": {"before": drc.unconnected(drc_before), "after": drc.unconnected(drc_after)},
        "unchanged": unchanged,
        "previews": previews,
        "objectives": {"status": objectives["status"], "reasons": objectives["reasons"]},
        "warnings": drc.warnings(drc_after),
        "artifacts": reports.artifacts(folder, [state["candidate"]["path"], "board.json", "created.json", "drc-after.json", request_path,
                                                *[p for p in previews if p.startswith("previews/after-")]]),
        "ended": reports.now(),
    })
    states.write_json(folder / "result.json", doc)
    states.write_text(folder / "report.md", reports.markdown(doc))
    state = {**state, "objectives": {"status": objectives["status"]}}
    states.write_json(folder / "state.json", state)
    return doc


def _close(args: argparse.Namespace, cwd: Path, spelled: Path, started: str) -> dict[str, Any]:
    folder = states.run_folder(cwd, args.run, spelled)
    state = states.read_state(folder)
    candidate = states.candidate_path(folder, state)
    from . import kicad  # kicad-python from here on

    pid = int(state["editor"]["pid"])
    note = "The PCB editor had already closed."
    if kicad.editor_running(pid):
        api = kicad.connect(kicad.wait_seconds(10))
        board = api.board(candidate)
        if kicad.memory_hash(api, board) != state["candidate"]["memorySha256"]:
            raise refuse("changed", "candidate", "The candidate window has edits that kicad-layout-tool did not make; undo or revert them in KiCad (or close the window yourself), then close again.")
        kicad.stop(pid)
        deadline = time.monotonic() + 15
        while kicad.editor_running(pid) and time.monotonic() < deadline:
            time.sleep(0.2)
        note = "The PCB editor was closed."
    for lock in candidates.lock_files(candidate.parent):
        try:
            lock.unlink()
        except OSError:
            pass
    doc = reports.base("close", folder.name, started)
    doc.update({"note": note, "ended": reports.now()})
    return doc


def main(argv: list[str]) -> int:
    started = reports.now()
    operation = argv[0] if argv and argv[0] in ("open", "edit", "close") else None
    try:
        args = _parser().parse_args(argv)
    except Usage as error:
        _emit(reports.problems_document(operation, None, started, "refused", [Problem("usage", "arguments", str(error))]))
        return 2
    if not args.operation:
        _emit(reports.problems_document(None, None, started, "refused", [Problem("usage", "arguments", "Name an operation: open, edit or close (see --help).")]))
        return 2
    cwd = Path(os.getcwd()).resolve()
    spelled = workspace.entered_directory()
    run_id = args.run_id if args.operation == "open" else Path(args.run).name
    try:
        doc = {"open": _open, "edit": _edit, "close": _close}[args.operation](args, cwd, spelled, started)
    except Refused as refused:
        _emit(reports.problems_document(args.operation, run_id, started, "refused", refused.problems))
        return 2
    except Failed as failed:
        _emit(reports.problems_document(args.operation, run_id, started, "failed", failed.problems))
        return 3
    except ImportError as error:
        _emit(reports.problems_document(args.operation, run_id, started, "failed", [Problem("kicad", "kicad-python", f"kicad-python is not installed for this helper ({error}); reinstall the plugin's programs in VERA.")]))
        return 3
    except OSError as error:
        _emit(reports.problems_document(args.operation, run_id, started, "failed", [Problem("output", "run", f"A file could not be written or read: {error.strerror or error}.")]))
        return 3
    except Exception as error:  # noqa: BLE001 - before the save (an edit reports later failures itself): nothing was saved
        _emit(reports.problems_document(args.operation, run_id, started, "failed", [Problem("kicad", "kicad", f"Unexpected error: {type(error).__name__}: {str(error)[:200]}. Nothing was saved.")]))
        return 3
    _emit(doc)
    return 0
