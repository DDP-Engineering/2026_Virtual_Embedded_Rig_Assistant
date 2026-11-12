"""Inspection and fabrication exports with their checks (spec REQ-DATA-c32834e3 §6.6).

kicad-cli plots a layer list partially when one name is unknown (observed with KiCad 10.0.8), so every requested
layer is checked against the board's layer table first. A check that fails is reported, never hidden.
"""

from __future__ import annotations

import json
import re
import xml.etree.ElementTree as ElementTree
from pathlib import Path
from typing import Any, Callable

from . import board as board_facts
from . import kicad

KINDS = {
    "sch-pdf": ("schematic", "the schematic as one PDF, every sheet a page"),
    "sch-svg": ("schematic", "one SVG per sheet instance"),
    "pcb-pdf": ("board", "the requested board layers as one multi-page PDF"),
    "pcb-svg": ("board", "one SVG per requested board layer"),
    "gerbers": ("board", "Gerber X2 files of the requested layers with netlist attributes, precision 6, and the job file"),
    "drill": ("board", "Excellon drill files in mm, plated and non-plated holes apart, with the drill report"),
    "pos": ("board", "the component position file as CSV in mm, both sides"),
}
LAYER_KINDS = frozenset({"pcb-pdf", "pcb-svg", "gerbers"})
MAX_LAYERS = 64
POS_HEADER = "Ref,Val,Package,PosX,PosY,Rot,Side"
_TOOL = re.compile(r"^T(\d+)C([\d.]+)")
# A hole: a coordinate line, or the start of a slot (G00 in KiCad's "alternate" oval format, G85 in one line).
_HIT = re.compile(r"^(?:G00)?(?:X-?[\d.]+)?(?:Y-?[\d.]+)?(?:G85(?:X-?[\d.]+)?(?:Y-?[\d.]+)?)?$")


class LayerError(Exception):
    """A requested layer the board does not have (exit 2, problem `layer`)."""


def layer_list(text: str) -> list[str]:
    names = [name.strip() for name in text.split(",")]
    if any(not name for name in names):
        raise ValueError("--layers takes a comma-separated list of layer names without empty entries")
    if len(names) > MAX_LAYERS or len(set(names)) != len(names):
        raise ValueError(f"--layers takes at most {MAX_LAYERS} distinct layer names")
    return names


def check_layers(tree: list[Any], layers: list[str], rel: str) -> None:
    known = board_facts.layer_names(tree)
    unknown = [name for name in layers if name not in known]
    if unknown:
        raise LayerError(f"'{rel}' has no layer {', '.join(repr(name) for name in unknown)}; its layers are {', '.join(sorted(known))}.")


def _pdf(data: bytes) -> str | None:
    if not data.startswith(b"%PDF-"):
        return "the file does not start with %PDF-"
    return None if b"%%EOF" in data[-2048:] else "the file does not end with %%EOF"


def _svg(path: Path) -> str | None:
    try:
        for _, element in ElementTree.iterparse(path, events=("start",)):
            return None if element.tag.rsplit("}", 1)[-1] == "svg" else f"the root element is {element.tag}, not svg"
    except ElementTree.ParseError as error:
        return f"not well-formed XML: {error}"
    return "the file holds no element"


def _gerber(text: str) -> tuple[str | None, str | None]:
    function = None
    for line in text.splitlines():
        if line.startswith("%TF.FileFunction,"):
            function = line[len("%TF.FileFunction,") :].rstrip("*%")
            break
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if function is None:
        return "no %TF.FileFunction attribute", None
    if not lines or lines[-1] != "M02*":
        return "the file does not end with M02*", function
    return None, function


def _excellon(text: str) -> tuple[str | None, int, int]:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    tools = sum(1 for line in lines if _TOOL.match(line))
    holes = 0
    body = False
    for line in lines:
        if line in ("%", "G90", "G05") or re.fullmatch(r"T\d+", line):
            body = True
            continue
        if body and line.startswith(("X", "Y", "G00X", "G00Y")) and _HIT.match(line):
            holes += 1
    if not lines or lines[0] != "M48":
        return "the file does not start with M48", tools, holes
    if lines[-1] != "M30":
        return "the file does not end with M30", tools, holes
    return None, tools, holes


_FUNCTIONS = {
    "F.Cu": ("Copper,", ",Top"), "B.Cu": ("Copper,", ",Bot"), "F.Mask": ("Soldermask,Top", ""),
    "B.Mask": ("Soldermask,Bot", ""), "F.Paste": ("Paste,Top", ""), "B.Paste": ("Paste,Bot", ""),
    "F.SilkS": ("Legend,Top", ""), "B.SilkS": ("Legend,Bot", ""), "Edge.Cuts": ("Profile", ""),
}  # fmt: skip
_FUNCTION_TEXT = {
    "F.Cu": "Copper ... Top", "B.Cu": "Copper ... Bot", "F.Mask": "Soldermask,Top", "B.Mask": "Soldermask,Bot",
    "F.Paste": "Paste,Top", "B.Paste": "Paste,Bot", "F.SilkS": "Legend,Top", "B.SilkS": "Legend,Bot",
    "Edge.Cuts": "Profile", "inner": "Copper ... Inr",
}  # fmt: skip


def _function(layer: str) -> Callable[[str], bool] | None:
    """What the Gerber X2 file function of a requested layer must look like, when KiCad's layer fixes it."""
    if layer in _FUNCTIONS:
        start, end = _FUNCTIONS[layer]
        return lambda function: function.startswith(start) and function.endswith(end)
    if re.fullmatch(r"In\d+\.Cu", layer):
        return lambda function: function.startswith("Copper,") and function.endswith(",Inr")
    return None


def _count(check: str, found: int, expected: int, what: str, of: str) -> dict[str, Any]:
    return {"id": check, "status": "pass" if found == expected else "fail", "detail": f"{found} {what} for {expected} {of}"}


def _key(name: str) -> str:
    return re.sub(r"[^0-9a-z]+", "_", name.casefold())


def _entry(path: str, reason: str | None, **more: Any) -> dict[str, Any]:
    entry: dict[str, Any] = {"path": path, "check": "pass" if reason is None else "fail"}
    if reason is not None:
        entry["reason"] = reason
    entry.update(more)
    return entry


def run(
    kind: str,
    layers: list[str] | None,
    *,
    stem: str,
    schematic: Path | None,
    board: Path | None,
    tree: list[Any] | None,
    sheets: int,
    out: Path,
    call: Callable[[list[str], list[Path]], str],
    keep: Callable[[Path, str, str], str],
) -> dict[str, Any]:
    """Runs one export into `out/exports`, keeps its files and returns the summary."""
    folder = out / "exports"
    folder.mkdir(parents=True, exist_ok=True)
    summary: dict[str, Any] = {"kind": kind}
    if layers is not None:
        summary["layers"] = layers
    files: list[dict[str, Any]] = []
    if kind == "sch-pdf":
        assert schematic is not None
        target = folder / f"{stem}.pdf"
        call(kicad.sch_pdf(schematic, target), [target])
        summary["options"] = {"pages": "all", "drawingSheet": "the project's"}
        files.append(_entry(keep(target, f"exports/{target.name}", "export-pdf"), _pdf(target.read_bytes())))
    elif kind == "sch-svg":
        assert schematic is not None
        target = folder / "sch-svg"
        target.mkdir()
        call(kicad.sch_svg(schematic, target), [target])
        summary["options"] = {"pages": "all", "drawingSheet": "the project's"}
        produced = sorted(target.glob("*.svg"))
        for path in produced:
            files.append(_entry(keep(path, f"exports/sch-svg/{path.name}", "export-svg"), _svg(path)))
        summary["checks"] = [_count("files", len(produced), sheets, "SVG files", "sheet instances")]
    elif kind == "pcb-pdf":
        assert board is not None and layers is not None
        target = folder / f"{stem}-pcb.pdf"
        call(kicad.pcb_pdf(board, layers, target), [target])
        summary["options"] = {"mode": "multipage", "scale": 1}
        files.append(_entry(keep(target, f"exports/{target.name}", "export-pdf"), _pdf(target.read_bytes())))
    elif kind == "pcb-svg":
        assert board is not None and layers is not None
        target = folder / "pcb-svg"
        target.mkdir()
        call(kicad.pcb_svg(board, layers, target), [target])
        summary["options"] = {"mode": "one file per layer", "scale": 1}
        produced = sorted(target.glob("*.svg"))
        for path in produced:
            files.append(_entry(keep(path, f"exports/pcb-svg/{path.name}", "export-svg"), _svg(path)))
        summary["checks"] = [_count("files", len(produced), len(layers), "SVG files", "layers")]
    elif kind == "gerbers":
        assert board is not None and layers is not None and tree is not None
        target = folder / "gerbers"
        target.mkdir()
        call(kicad.gerbers(board, layers, target), [target])
        summary["options"] = dict(kicad.GERBER_OPTIONS)
        produced = {path.name: path for path in target.iterdir() if path.is_file()}
        table = {layer["name"]: layer for layer in board_facts.layers(tree)}
        used: set[str] = set()
        for layer in layers:
            label = table[layer].get("userName") or layer
            wanted = _key(f"{stem}-{label}")
            match = next((name for name in sorted(produced) if _key(Path(name).stem) == wanted and name not in used), None)
            if match is None:
                files.append(_entry(f"exports/gerbers/<{layer}>", f"kicad-cli wrote no Gerber file for {layer}", layer=layer))
                continue
            used.add(match)
            reason, function = _gerber(produced[match].read_text("utf-8", "replace"))
            expected = _function(layer)
            if reason is None and function is not None and expected is not None and not expected(function):
                reason = f"its %TF.FileFunction is {function}, not the {_FUNCTION_TEXT[layer if layer in _FUNCTION_TEXT else 'inner']} of {layer}"
            more: dict[str, Any] = {"layer": layer}
            if function is not None:
                more["fileFunction"] = function
            files.append(_entry(keep(produced[match], f"exports/gerbers/{match}", "export-gerber"), reason, **more))
        if not any(name.endswith(".gbrjob") for name in produced):
            files.append(_entry("exports/gerbers/<job>", "kicad-cli wrote no Gerber job file"))
        for name in sorted(set(produced) - used):
            path = produced[name]
            reason = None
            if path.suffix == ".gbrjob":
                try:
                    json.loads(path.read_text("utf-8"))
                except (ValueError, UnicodeDecodeError) as error:
                    reason = f"the job file is not JSON: {error}"
            files.append(_entry(keep(path, f"exports/gerbers/{name}", "export-gerber-job" if path.suffix == ".gbrjob" else "export-gerber"), reason))
    elif kind == "drill":
        assert board is not None and tree is not None
        target = folder / "drill"
        target.mkdir()
        call(kicad.drill(board, target), [target])
        summary["options"] = dict(kicad.DRILL_OPTIONS)
        counts = {"plated": 0, "nonPlated": 0}
        for path in sorted(target.iterdir()):
            if path.suffix == ".drl":
                reason, tools, holes = _excellon(path.read_text("utf-8", "replace"))
                counts["nonPlated" if path.stem.upper().endswith("NPTH") else "plated"] += holes
                files.append(_entry(keep(path, f"exports/drill/{path.name}", "export-drill"), reason, tools=tools, holes=holes))
            else:
                files.append(_entry(keep(path, f"exports/drill/{path.name}", "export-drill-report"), None if path.stat().st_size else "the file is empty"))
        expected = board_facts.holes(tree)
        summary["counts"] = {**counts, "boardPlated": expected["plated"], "boardNonPlated": expected["nonPlated"]}
        same = counts["plated"] == expected["plated"] and counts["nonPlated"] == expected["nonPlated"]
        summary["checks"] = [
            {
                "id": "holes",
                "status": "pass" if same else "fail",
                "detail": f"drill files {counts['plated']} plated and {counts['nonPlated']} non-plated holes; the board has {expected['plated']} and {expected['nonPlated']}",
            }
        ]
    elif kind == "pos":
        assert board is not None and tree is not None
        target = folder / f"{stem}-pos.csv"
        call(kicad.pos(board, target), [target])
        summary["options"] = dict(kicad.POS_OPTIONS)
        lines = [line for line in target.read_text("utf-8", "replace").splitlines() if line.strip()]
        reason = None if lines and lines[0] == POS_HEADER else f"the header is not {POS_HEADER}"
        rows = max(len(lines) - 1, 0)
        footprints = sum(1 for footprint in board_facts.footprints(tree) if not footprint["excludeFromPos"])
        files.append(_entry(keep(target, f"exports/{target.name}", "export-position"), reason))
        summary["counts"] = {"rows": rows, "footprints": footprints}
        summary["checks"] = [
            {
                "id": "rows",
                "status": "pass" if rows == footprints else "fail",
                "detail": f"{rows} rows for {footprints} footprints not excluded from position files",
            }
        ]
    summary["files"] = files
    return summary
