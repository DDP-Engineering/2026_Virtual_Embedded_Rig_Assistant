"""The seven operations over a project's work copy (spec REQ-DATA-c32834e3 §6).

Each operation runs kicad-cli through `Run.call` (inside the work copy, outputs in the work folder), keeps the
files the run folder will hold through `Run.keep`, and returns its summary. Nothing here writes into the working
directory.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from . import bom, board, checks, exports, kicad, netlist, review, sexpr
from .discovery import Kicad
from .project import Project


@dataclass
class Run:
    project: Project
    kicad: Kicad
    copy: Path  # The work copy of the project folder.
    out: Path  # Where kicad-cli writes.
    run_rel: str  # The run folder relative to the working directory.
    keeps: list[tuple[Path, str, str]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    limits: list[str] = field(default_factory=list)
    details: dict[str, Any] = field(default_factory=dict)
    sheet_count: int = 0

    @property
    def schematic(self) -> Path:
        assert self.project.schematic is not None
        return self.project.copy_of(self.project.schematic, self.copy)

    @property
    def board(self) -> Path:
        assert self.project.board is not None
        return self.project.copy_of(self.project.board, self.copy)

    def call(self, args: list[str], expected: list[Path]) -> str:
        return kicad.execute(self.kicad, args, self.copy, expected)

    def keep(self, path: Path, name: str, kind: str) -> str:
        """Marks a work file for the run folder; returns its path relative to the working directory."""
        self.keeps.append((path, name, kind))
        return f"{self.run_rel}/{name}"

    def write(self, name: str, data: Any, kind: str) -> None:
        path = self.out / name
        path.parent.mkdir(parents=True, exist_ok=True)
        text = data if isinstance(data, str) else json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
        path.write_text(text, encoding="utf-8", newline="\n")
        self.keep(path, name, kind)


def _json(path: Path) -> dict[str, Any]:
    try:
        loaded = json.loads(path.read_text("utf-8"))
    except (OSError, ValueError, UnicodeDecodeError) as error:
        raise kicad.RunFailure(f"kicad-cli wrote '{path.name}' that is not JSON: {error}") from error
    if not isinstance(loaded, dict):
        raise kicad.RunFailure(f"kicad-cli wrote '{path.name}' without a JSON object")
    return loaded


def _netlist(run: Run, keep: bool) -> dict[str, Any]:
    target = run.out / "netlist.net"
    if not target.exists():
        run.call(kicad.netlist(run.schematic, target), [target])
        if keep:
            run.keep(target, "netlist.net", "kicad-netlist")
    try:
        return netlist.read(sexpr.parse(target.read_text("utf-8")))
    except (sexpr.SexprError, UnicodeDecodeError) as error:
        raise kicad.RunFailure(f"kicad-cli wrote a netlist that cannot be read: {error}") from error


def _hierarchy(run: Run) -> list[dict[str, Any]]:
    return [{"path": sheet.path, "uuidPath": sheet.uuid_path, "file": sheet.file.rel, "sheetName": sheet.name} for sheet in run.project.sheets]


def inspect(run: Run) -> dict[str, Any]:
    data = _netlist(run, keep=True) if run.project.schematic is not None else {"instances": [], "nets": []}
    facts = None
    if run.project.board is not None:
        target = run.out / "stats.json"
        run.call(kicad.stats(run.board, target), [target])
        run.keep(target, "stats.json", "kicad-stats")
        assert run.project.board.tree is not None
        facts = board.facts(run.project.board.tree, _json(target), run.project.settings)
    hierarchy = _hierarchy(run)
    return {
        "counts": {
            "sheets": len(hierarchy),
            "instances": len(data["instances"]),
            "nets": len(data["nets"]),
            "footprints": len(facts["footprints"]) if facts is not None else 0,
        },
        "hierarchy": hierarchy,
        "instances": data["instances"],
        "nets": data["nets"],
        "board": facts,
    }


def netlist_operation(run: Run) -> dict[str, Any]:
    data = _netlist(run, keep=True)
    run.write("nets.json", {"nets": data["nets"], "components": data["components"]}, "nets")
    return {"counts": {"nets": len(data["nets"]), "components": len(data["components"])}, "nets": data["nets"]}


def bom_operation(run: Run) -> dict[str, Any]:
    data = _netlist(run, keep=False)
    built = bom.build(data["instances"])
    run.write("bom.csv", bom.csv_text(built["rows"]), "bom-csv")
    run.write("bom.json", {"rows": built["rows"], "excluded": built["excluded"], "instances": built["instances"]}, "bom-json")
    return {"counts": {"rows": len(built["rows"]), "instances": built["included"], "excluded": len(built["excluded"])}, "rows": built["rows"]}


def erc(run: Run) -> dict[str, Any]:
    target = run.out / "erc.json"
    run.call(kicad.erc(run.schematic, target), [target])
    run.keep(target, "erc.json", "kicad-erc")
    summary = checks.erc(_json(target))
    summary["duplicateReferences"] = run.project.duplicates()
    summary["duplicateCount"] = len(summary["duplicateReferences"])
    return summary


def drc(run: Run, refill: bool) -> dict[str, Any]:
    target = run.out / "drc.json"
    parity = run.project.schematic is not None
    run.call(kicad.drc(run.board, target, parity, refill), [target])
    run.keep(target, "drc.json", "kicad-drc")
    run.limits.append(checks.DRC_LIMIT)
    return checks.drc(_json(target), parity, refill)


def export(run: Run, kind: str, layers: list[str] | None) -> dict[str, Any]:
    project = run.project
    return exports.run(
        kind,
        layers,
        stem=project.name,
        schematic=run.schematic if project.schematic is not None else None,
        board=run.board if project.board is not None else None,
        tree=project.board.tree if project.board is not None else None,
        sheets=run.sheet_count,
        out=run.out,
        call=run.call,
        keep=run.keep,
    )


def review_report(run: Run, refill: bool) -> dict[str, Any]:
    inspected = inspect(run)
    found_erc = erc(run) if run.project.schematic is not None else None
    found_drc = drc(run, refill) if run.project.board is not None else None
    run.details = {"erc": found_erc, "drc": found_drc}
    return {
        "counts": inspected["counts"],
        "erc": found_erc,
        "drc": found_drc,
        "facts": review.facts(inspected["nets"], inspected["instances"]),
        "hierarchy": inspected["hierarchy"],
        "instances": inspected["instances"],
        "nets": inspected["nets"],
        "board": inspected["board"],
    }
