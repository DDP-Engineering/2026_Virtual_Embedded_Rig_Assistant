"""The normalized BOM (spec REQ-DATA-c32834e3 §6.3): groups of equal value, footprint, MPN and DNP flag."""

from __future__ import annotations

import csv
import io
import re
from typing import Any

_DIGITS = re.compile(r"(\d+)")
HEADER = ["Quantity", "References", "Value", "Footprint", "MPN", "DNP"]


def natural(text: str) -> tuple:
    """R2 before R10."""
    return tuple((1, int(part), "") if part.isdigit() else (0, 0, part) for part in _DIGITS.split(text))


def build(instances: list[dict[str, Any]]) -> dict[str, Any]:
    included = [item for item in instances if not item["excludeFromBom"]]
    excluded = sorted((item for item in instances if item["excludeFromBom"]), key=lambda item: natural(item["reference"]))
    groups: dict[tuple[str, str, str, bool], list[str]] = {}
    for item in included:
        key = (item["value"], item["footprint"], item["mpn"] or "", item["dnp"])
        groups.setdefault(key, []).append(item["reference"])
    rows = []
    for (value, footprint, mpn, dnp), references in groups.items():
        references = sorted(set(references), key=natural)
        rows.append({"quantity": len(references), "references": references, "value": value, "footprint": footprint, "mpn": mpn or None, "dnp": dnp})
    rows.sort(key=lambda row: natural(row["references"][0]))
    return {"rows": rows, "excluded": excluded, "instances": instances, "included": len(included)}


def _csv_cell(text: str) -> str:
    """A cell a spreadsheet would run as a formula gets a leading quote; values such as +3V3 or -5V stay as they are."""
    formula = text.startswith(("=", "@", "\t", "\r")) or (text.startswith(("+", "-")) and any(mark in text for mark in "(|!"))
    return "'" + text if formula else text


def csv_text(rows: list[dict[str, Any]]) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(HEADER)
    for row in rows:
        texts = [",".join(row["references"]), row["value"], row["footprint"], row["mpn"] or ""]
        writer.writerow([row["quantity"], *(_csv_cell(text) for text in texts), "yes" if row["dnp"] else ""])
    return buffer.getvalue()
