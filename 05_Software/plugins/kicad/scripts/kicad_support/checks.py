"""KiCad's ERC and DRC reports as summaries (spec REQ-DATA-c32834e3 §6.4, §6.5).

Violations are results: counts by severity and type, every violation with its sheet, objects and positions, and
the checks KiCad ignored, so exclusions and filters stay visible. The reference of a symbol object comes from
KiCad's own item description ("Symbol U101 Pin 1 [...]"), because one pin UUID serves every instance of a
repeated sheet.
"""

from __future__ import annotations

import re
from collections import Counter
from typing import Any

SEVERITIES = ("error", "warning", "exclusion")
_SYMBOL = re.compile(r"^Symbol (\S+)")
_RANK = {severity: rank for rank, severity in enumerate(SEVERITIES)}

DRC_LIMIT = (
    "DRC compares the board with its design rules only: zero violations does not validate function, current "
    "capacity, impedance or return paths, and close placement alone does not prove good decoupling."
)


def _items(violation: dict[str, Any], symbols: bool) -> list[dict[str, Any]]:
    items = []
    for item in violation.get("items") or []:
        position = item.get("pos") or {}
        entry: dict[str, Any] = {
            "description": item.get("description", ""),
            "uuid": item.get("uuid", ""),
            "x": position.get("x"),
            "y": position.get("y"),
        }
        found = _SYMBOL.match(entry["description"]) if symbols else None
        if found:
            entry["reference"] = found.group(1)
        items.append(entry)
    return items


def _entry(violation: dict[str, Any], symbols: bool, sheet: dict[str, Any] | None = None) -> dict[str, Any]:
    entry: dict[str, Any] = {
        "type": violation.get("type", ""),
        "severity": violation.get("severity", ""),
        "description": violation.get("description", ""),
    }
    if sheet is not None:
        entry["sheet"] = {"path": sheet.get("path", ""), "uuidPath": sheet.get("uuid_path", "")}
    entry["items"] = _items(violation, symbols)
    return entry


def _counts(entries: list[dict[str, Any]]) -> dict[str, int]:
    found = Counter(entry["severity"] for entry in entries)
    return {severity: found.get(severity, 0) for severity in SEVERITIES} | {
        severity: count for severity, count in found.items() if severity not in SEVERITIES
    }


def _ordered(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(entries, key=lambda entry: _RANK.get(entry["severity"], len(SEVERITIES)))


def erc(report: dict[str, Any]) -> dict[str, Any]:
    violations = _ordered(
        [_entry(violation, True, sheet) for sheet in report.get("sheets") or [] for violation in sheet.get("violations") or []]
    )
    return {
        "counts": _counts(violations),
        "types": dict(Counter(entry["type"] for entry in violations)),
        "violations": violations,
        "ignoredChecks": [check.get("key", "") for check in report.get("ignored_checks") or []],
        "libraryIssues": [entry for entry in violations if entry["type"] == "lib_symbol_issues"],
    }


def drc(report: dict[str, Any], parity_checked: bool, refilled: bool) -> dict[str, Any]:
    violations = _ordered([_entry(item, False) for item in report.get("violations") or []])
    unconnected = [_entry(item, False) for item in report.get("unconnected_items") or []]
    parity = [_entry(item, True) for item in report.get("schematic_parity") or []]
    return {
        "counts": {"violations": _counts(violations), "unconnected": len(unconnected), "parity": len(parity)},
        "types": dict(Counter(entry["type"] for entry in [*violations, *unconnected, *parity])),
        "violations": violations,
        "unconnected": unconnected,
        "parity": parity,
        "ignoredChecks": [check.get("key", "") for check in report.get("ignored_checks") or []],
        "zonesRefilled": refilled,
        "parityChecked": parity_checked,
    }
