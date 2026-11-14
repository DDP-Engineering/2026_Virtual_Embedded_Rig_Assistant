"""result.json and report.md (spec REQ-DATA-891d5b5d §8), and the bounded document the helper prints."""

from __future__ import annotations

import copy
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import TOOL, VERSION
from .request import Problem

KIND = "kicad-layout-result"
STDOUT_LIMIT = 11_000


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def shown_id(run_id: str | None) -> str | None:
    """A run id as documents repeat it: at most 64 characters (a longer --run argument is cut)."""
    return run_id if run_id is None or len(run_id) <= 64 else run_id[:61] + "..."


def base(operation: str | None, run_id: str | None, started: str) -> dict[str, Any]:
    return {"format": 1, "kind": KIND, "tool": TOOL, "toolVersion": VERSION, "operation": operation,
            "runId": shown_id(run_id), "started": started, "ended": started, "status": "completed", "problems": []}


def artifacts(folder: Path, paths: list[str]) -> list[dict[str, str]]:
    """Files of the run folder with their SHA-256 (paths relative to the run folder)."""
    return [{"path": path, "sha256": hashlib.sha256((folder / path).read_bytes()).hexdigest()} for path in paths]


def problems_document(operation: str | None, run_id: str | None, started: str, status: str, problems: list[Problem]) -> dict[str, Any]:
    doc = base(operation, run_id, started)
    doc.update({"status": status, "ended": now(), "problems": [p.to_json() for p in problems]})
    return doc


def nets(touched: set[str], before: dict[str, Any], after: dict[str, Any]) -> list[dict[str, Any]]:
    empty = {"trackLength": 0.0, "vias": 0}
    return [{"name": name, "before": before["routing"].get(name, empty), "after": after["routing"].get(name, empty)}
            for name in sorted(touched)]


def footprint_changes(opened: dict[str, Any], current: dict[str, Any]) -> list[dict[str, Any]]:
    """Footprints whose position or orientation differs from the board as opened."""
    before = {f["uuid"]: f for f in opened["footprints"]}
    out = []
    for fp in current["footprints"]:
        old = before.get(fp["uuid"])
        if old and (old["at"] != fp["at"] or old["orientation"] != fp["orientation"]):
            out.append({"reference": fp["reference"], "uuid": fp["uuid"],
                        "before": {"at": old["at"], "orientation": old["orientation"]},
                        "after": {"at": fp["at"], "orientation": fp["orientation"]}})
    return out


def markdown(doc: dict[str, Any]) -> str:
    lines = [f"# kicad-layout {doc.get('operation')} - run {doc.get('runId')}", "",
             f"Status: {doc.get('status')}. KiCad {doc.get('kicad', '?')}. {doc.get('ended')}.", ""]
    if doc.get("problems"):
        lines += ["## Problems", ""] + [f"- {p['kind']}: {p['message']}" for p in doc["problems"]] + [""]
    if doc.get("warnings"):
        lines += ["## Warnings", ""] + [f"- {w}" for w in doc["warnings"]] + [""]
    objectives = doc.get("objectives")
    if objectives:
        lines += ["## Objectives", "", f"**{objectives['status']}**" + (": " + "; ".join(objectives.get("reasons", [])) if objectives.get("reasons") else ""), ""]
    changes = doc.get("changes")
    if changes:
        lines += ["## Changes since open", "", "| Footprint | Before | After |", "|---|---|---|"]
        for f in changes["footprints"]:
            lines.append(f"| {f['reference']} | ({f['before']['at'][0]:g}, {f['before']['at'][1]:g}) {f['before']['orientation']:g} deg | ({f['after']['at'][0]:g}, {f['after']['at'][1]:g}) {f['after']['orientation']:g} deg |")
        lines += ["", "| Created | Net | Layer | Size |", "|---|---|---|---|"]
        for c in changes["created"]:
            size = f"{c['width']:g} mm x {c['length']:g} mm" if c["type"] == "track" else f"{c.get('diameter', 0):g}/{c.get('drill', 0):g} mm" if c["type"] == "via" else ""
            lines.append(f"| {c['type']} {c['uuid'][:8]} | {c.get('net', '')} | {c.get('layer', ', '.join(c.get('layers', [])))} | {size} |")
        lines.append("")
    if doc.get("nets"):
        lines += ["## Touched nets", "", "| Net | Track length before | after | Vias before | after |", "|---|---|---|---|---|"]
        lines += [f"| {n['name']} | {n['before']['trackLength']:g} mm | {n['after']['trackLength']:g} mm | {n['before']['vias']} | {n['after']['vias']} |" for n in doc["nets"]]
        lines.append("")
    if doc.get("drc"):
        drc = doc["drc"]
        lines += ["## DRC and unconnected items", ""]
        if "after" in drc:
            lines += [f"- DRC errors {drc['before']['error']} -> {drc['after']['error']}, warnings {drc['before']['warning']} -> {drc['after']['warning']}",
                      f"- unconnected items {doc['unconnected']['before']} -> {doc['unconnected']['after']}"]
        else:
            lines += [f"- DRC errors {drc['before']['error']}, warnings {drc['before']['warning']} (the board as opened)",
                      f"- unconnected items {doc['unconnected']['before']}"]
        lines += [f"- new: {v['severity']} {v['type']}: {v['description']}" for v in drc.get("new", [])]
        lines.append("")
    if doc.get("unchanged"):
        u = doc["unchanged"]
        lines += [f"Verified unchanged: {u['footprints']} footprints, {u['tracks']} tracks, {u['vias']} vias, {u['zones']} zones.", ""]
    if doc.get("previews"):
        lines += ["## Previews", ""] + [f"- {p}" for p in doc["previews"]] + [""]
    if doc.get("inputs"):
        lines += ["## Inputs", ""] + [f"- {i['path']} ({i.get('role', 'input')}) sha256 {i['sha256']}" for i in doc["inputs"]] + [""]
    if doc.get("artifacts"):
        lines += ["## Artifacts", ""] + [f"- {a['path']} sha256 {a['sha256']}" for a in doc["artifacts"]] + [""]
    return "\n".join(lines)


def printed(doc: dict[str, Any]) -> str:
    """The JSON document on stdout, within STDOUT_LIMIT characters; long lists are cut (result.json is whole)."""
    text = json.dumps(doc, ensure_ascii=False)
    if len(text) <= STDOUT_LIMIT:
        return text
    small = copy.deepcopy(doc)
    small["truncated"] = True
    small["see"] = "result.json in the run folder"
    for path in (("changes", "created"), ("changes", "footprints"), ("drc", "new"), ("objectives", "new"), ("nets",), ("problems",), ("previews",)):
        owner: Any = small
        for key in path[:-1]:
            owner = owner.get(key, {}) if isinstance(owner, dict) else {}
        if isinstance(owner, dict) and isinstance(owner.get(path[-1]), list):
            owner[path[-1]] = owner[path[-1]][:5]
        text = json.dumps(small, ensure_ascii=False)
        if len(text) <= STDOUT_LIMIT:
            return text
    return json.dumps({k: small[k] for k in ("format", "kind", "tool", "toolVersion", "operation", "runId", "status")} | {"truncated": True, "see": "result.json in the run folder"})
