"""report.md of each run, and the review report's facts (spec REQ-DATA-c32834e3 §6.7).

The review report keeps KiCad's checks apart from facts the agent may use for a functional review; it judges
nothing itself.
"""

from __future__ import annotations

from typing import Any

REVIEW_LIMITS = [
    "The facts below are not a functional review: supplies, logic levels, reset, boot and debug, pull-ups, "
    "decoupling, protection and stress need the circuit's requirements and datasheets.",
    "A net is not sized without its electrical requirements (current, voltage, impedance, return path).",
]
SHOWN = 50


def _escape(text: object) -> str:
    return str(text).replace("\\", "\\\\").replace("|", "\\|").replace("\r", " ").replace("\n", " ")


def facts(nets: list[dict[str, Any]], instances: list[dict[str, Any]]) -> dict[str, Any]:
    power = sorted(net["name"] for net in nets if any(node.get("pinType") in ("power_in", "power_out") for node in net["nodes"]))
    single = sorted(net["name"] for net in nets if len(net["nodes"]) == 1)
    without = sorted({item["reference"] for item in instances if not item["footprint"] and not item["excludeFromBoard"]})
    dnp = sorted({item["reference"] for item in instances if item["dnp"]})
    return {"powerNets": power, "singleNodeNets": single, "withoutFootprint": without, "dnp": dnp}


def _violations(title: str, entries: list[dict[str, Any]]) -> list[str]:
    lines = [f"### {title}", ""]
    if not entries:
        return [*lines, "None.", ""]
    lines += ["| Severity | Type | Where | Objects |", "|---|---|---|---|"]
    for entry in entries[:SHOWN]:
        where = entry.get("sheet", {}).get("path", "")
        objects = "; ".join(f"{item['description']} ({item['x']}, {item['y']})" for item in entry["items"])
        lines.append(f"| {_escape(entry['severity'])} | {_escape(entry['type'])} | {_escape(where)} | {_escape(objects)} |")
    if len(entries) > SHOWN:
        lines.append(f"| ... | {len(entries) - SHOWN} more in result.json | | |")
    return [*lines, ""]


def _project(document: dict[str, Any]) -> list[str]:
    project = document["project"]
    kicad = document["kicad"]
    lines = [
        f"- Project: `{project['folder']}/{project['name']}`",
        f"- KiCad: {kicad['version']} (`{kicad['executable']}`)",
        f"- Run: `{document['runId']}`, {document['started']} to {document['finished']}",
        "",
        "| File | Role | SHA-256 |",
        "|---|---|---|",
    ]
    lines += [f"| `{_escape(item['path'])}` | {item['role']} | `{item['sha256']}` |" for item in project["files"]]
    return [*lines, ""]


def _duplicates(found: list[dict[str, Any]] | None) -> list[str]:
    if found is None:
        return []
    text = ", ".join(f"{_escape(item['reference'])} (unit {item['unit']}) x{item['count']}" for item in found[:SHOWN])
    more = f", ... {len(found) - SHOWN} more in result.json" if len(found) > SHOWN else ""
    return [f"Duplicate references (kicad-tool's check, not KiCad's): {text or 'none'}{more}", ""]


def markdown(document: dict[str, Any], details: dict[str, Any]) -> str:
    """report.md: the review report's four sections, or a short report of any other operation."""
    summary = document["summary"]
    lines = [f"# kicad-tool {document['operation']}", ""]
    if document["operation"] == "review-report":
        lines += ["## Project", "", *_project(document), "## KiCad checks", ""]
        erc, drc = details.get("erc"), details.get("drc")
        if erc is None:
            lines += ["ERC: not run (the project has no schematic).", ""]
        else:
            counts = erc["counts"]
            lines += [
                f"ERC: {counts['error']} errors, {counts['warning']} warnings, {counts['exclusion']} exclusions.",
                "",
                *_violations("ERC violations", erc["violations"]),
                *_duplicates(erc.get("duplicateReferences")),
            ]
        if drc is None:
            lines += ["DRC: not run (the project has no board).", ""]
        else:
            counts = drc["counts"]
            lines += [
                f"DRC: {counts['violations']['error']} errors, {counts['violations']['warning']} warnings, "
                f"{counts['unconnected']} unconnected items, {counts['parity']} parity differences; zones refilled on the work copy: "
                f"{'yes' if drc['zonesRefilled'] else 'no'}.",
                "",
                *_violations("DRC violations", drc["violations"]),
                *_violations("Unconnected items", drc["unconnected"]),
            ]
        found = summary["facts"]
        lines += ["## Facts for review", ""]
        for key, title in (("powerNets", "Power nets (a power input or output pin)"), ("singleNodeNets", "Nets with a single node"), ("withoutFootprint", "Instances without footprint"), ("dnp", "Do-not-populate instances")):
            lines.append(f"- {title}: {', '.join(f'`{_escape(item)}`' for item in found[key]) or 'none'}")
        lines += ["", "## Limits", ""]
        lines += [f"- {text}" for text in [*document["limits"], *REVIEW_LIMITS]]
        return "\n".join(lines) + "\n"
    lines += _project(document)
    counts = summary.get("counts")
    if counts is not None:
        lines += [f"Counts: `{counts}`", ""]
    if "violations" in summary:
        lines += _violations("Violations", summary["violations"])
    lines += _duplicates(summary.get("duplicateReferences"))
    if "unconnected" in summary:
        lines += _violations("Unconnected items", summary["unconnected"])
    if "files" in summary:
        lines += ["| File | Check |", "|---|---|"]
        lines += [f"| `{_escape(item['path'])}` | {item['check']}{(': ' + _escape(item['reason'])) if 'reason' in item else ''} |" for item in summary["files"]]
        lines.append("")
    if document["warnings"]:
        lines += ["Warnings:", "", *[f"- {_escape(text)}" for text in document["warnings"]], ""]
    if document["limits"]:
        lines += ["Limits:", "", *[f"- {_escape(text)}" for text in document["limits"]], ""]
    lines.append("The complete result is in result.json.")
    return "\n".join(lines) + "\n"

