"""kicad-cli on the saved candidate (spec REQ-DATA-891d5b5d §8): DRC with zones refilled (and schematic parity when
the candidate folder holds the board's schematic), the comparison with the DRC after open, the objectives, and
per-layer SVG previews. kicad-cli never saves the board here (no --save-board)."""

from __future__ import annotations

import json
import subprocess
from collections import Counter
from pathlib import Path
from typing import Any

from .request import fail

DRC_SECONDS = 600
PREVIEW_SECONDS = 120
NEW_LIMIT = 50


def _run(arguments: list[str], seconds: int, what: str) -> None:
    try:
        done = subprocess.run(arguments, capture_output=True, text=True, timeout=seconds, check=False,
                              stdin=subprocess.DEVNULL, creationflags=0x08000000 if hasattr(subprocess, "STARTUPINFO") else 0)
    except subprocess.TimeoutExpired as error:
        raise fail("kicad", "kicad-cli", f"kicad-cli {what} did not finish within {seconds} s.") from error
    except OSError as error:
        raise fail("kicad", "kicad-cli", f"kicad-cli could not start: {error.strerror or error}.") from error
    if done.returncode not in (0, 5):  # 5: violations found with --exit-code-violations (not used, accepted)
        tail = ((done.stderr or done.stdout or "").strip().splitlines()[-1:] or [""])[0]
        # The documents never carry absolute paths: the files kicad-cli was given are named by their file names.
        for argument in sorted((a for a in arguments if Path(a).is_absolute()), key=len, reverse=True):
            tail = tail.replace(argument, Path(argument).name)
        raise fail("kicad", "kicad-cli", f"kicad-cli {what} failed (exit {done.returncode}): {tail[:200]}")


def run(kicad_cli: Path, board: Path, out: Path) -> dict[str, Any]:
    arguments = [str(kicad_cli), "pcb", "drc", "--format", "json", "--severity-all", "--refill-zones"]
    if board.with_suffix(".kicad_sch").is_file():
        arguments.append("--schematic-parity")
    _run(arguments + ["-o", str(out), str(board)], DRC_SECONDS, "drc")
    try:
        return json.loads(out.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise fail("kicad", "kicad-cli", f"kicad-cli wrote no readable DRC report: {error}") from error


def _key(violation: dict[str, Any]) -> tuple:
    items = tuple(sorted(str(item.get("uuid", "")) for item in violation.get("items", [])))
    return (violation.get("type", ""), violation.get("description", ""), items)


def counts(report: dict[str, Any]) -> dict[str, int]:
    severities = Counter(str(v.get("severity", "error")) for v in report.get("violations", []))
    severities.update(str(v.get("severity", "error")) for v in report.get("schematic_parity", []))
    return {"error": severities.get("error", 0), "warning": severities.get("warning", 0)}


def unconnected(report: dict[str, Any]) -> int:
    return len(report.get("unconnected_items", []))


def new_violations(before: dict[str, Any], after: dict[str, Any]) -> list[dict[str, Any]]:
    """Violations of `after` that no violation of `before` matches by type, description and item UUIDs."""
    old = Counter(_key(v) for v in [*before.get("violations", []), *before.get("schematic_parity", [])])
    fresh: list[dict[str, Any]] = []
    for violation in [*after.get("violations", []), *after.get("schematic_parity", [])]:
        key = _key(violation)
        if old[key]:
            old[key] -= 1
        else:
            fresh.append({
                "type": violation.get("type", ""),
                "severity": violation.get("severity", ""),
                "description": violation.get("description", ""),
                "items": [{"uuid": item.get("uuid", ""), "description": item.get("description", ""), "at": [item.get("pos", {}).get("x"), item.get("pos", {}).get("y")]}
                          for item in violation.get("items", [])],
            })
    return fresh


def objectives(before: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
    fresh = new_violations(before, after)
    errors = [v for v in fresh if v["severity"] == "error"]
    reasons = []
    if errors:
        reasons.append(f"{len(errors)} new DRC error(s): " + ", ".join(sorted({v['type'] for v in errors})))
    if unconnected(after) > unconnected(before):
        reasons.append(f"unconnected items rose from {unconnected(before)} to {unconnected(after)}")
    return {"status": "fail" if reasons else "pass", "reasons": reasons, "new": fresh[:NEW_LIMIT], "newCount": len(fresh)}


def warnings(report: dict[str, Any]) -> list[str]:
    """Notes on a DRC of the candidate copy that are not about the edit."""
    library = sum(1 for v in report.get("violations", []) if str(v.get("type", "")).startswith("lib_footprint"))
    if not library:
        return []
    return [f"{library} DRC footprint-library finding(s) concern the candidate copy (the project's footprint "
            "libraries are not copied into the run folder); they are the same before and after an edit and do not "
            "affect the objectives."]


def preview(kicad_cli: Path, board: Path, layer: str, out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    _run([str(kicad_cli), "pcb", "export", "svg", "--mode-single", "--layers", f"{layer},Edge.Cuts", "--page-size-mode", "2",
          "--exclude-drawing-sheet", "-o", str(out), str(board)], PREVIEW_SECONDS, f"svg export of {layer}")


def preview_name(stage: str, layer: str) -> str:
    return f"previews/{stage}-{layer.replace('.', '_')}.svg"
