"""comparison.json, comparison.md and bom.csv in a new run folder, all or nothing (spec REQ-DATA-6b26f2a5 §5)."""

from __future__ import annotations

import csv
import hashlib
import io
import json
from pathlib import Path
from typing import Any, Callable

from . import FORMAT, TOOL, VERSION, workspace
from .evaluate import best_offer

LIMITS = [
    "Offers are snapshots of each supplier's declared values at retrievedAt, not live stock; taxes, shipping, duties and future availability are not included.",
    "Only confirmed datasheet values with a page or table, stated under the constraint's conditions, count as evidence; typical, proposed and supplier values never pass a hard constraint.",
    "Curves, graphs and scanned pages are not read: a value taken from a figure must be entered and confirmed by a person.",
    "Nothing is ordered, and no schematic, BOM or source file is changed; bom.csv is a proposal.",
]
BOM_HEADER = ["Status", "Quantity", "Manufacturer", "MPN", "Package", "Supplier", "SKU", "Packaging", "OrderQuantity", "UnitPrice", "Currency", "CapturedAt", "Stale"]


class OutputFailure(Exception):
    """An input or output failure after the request was accepted (exit code 3)."""


def _cell(value: object) -> str:
    text = "" if value is None else str(value)
    return text.replace("|", "\\|").replace("\n", " ")


def _table(head: list[str], rows: list[list[object]]) -> list[str]:
    lines = ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
    lines += ["| " + " | ".join(_cell(cell) for cell in row) + " |" for row in rows]
    return lines + [""]


def _source(source: dict[str, Any]) -> str:
    if source.get("kind") == "supplier":
        return f"supplier {source.get('supplier', '')} {source.get('sku', '')}".strip()
    parts = [f"page {source['page']}" if source.get("page") else "", source.get("table", ""), source.get("figure", ""), source.get("revision", ""), source.get("url", "")]
    return "datasheet " + ", ".join(part for part in parts if part)


def _proposed(document: dict[str, Any]) -> dict[str, Any] | None:
    index = document["proposed"]
    return None if index is None else document["devices"][index]


def markdown(document: dict[str, Any]) -> str:
    lines = [f"# {document['title']}", "", f"Run `{document['runId']}`, {document['startedAt']}. Quantity {document['quantity']}"
             + (f", currency {document['currency']}." if document["currency"] else ", no comparable currency."), ""]
    proposed = _proposed(document)
    lines += [f"**Proposed:** {proposed['manufacturer']} {proposed['mpn']} ({proposed['package'] or 'package not stated'})." if proposed
              else "**Proposed:** none - no candidate meets every hard constraint with confirmed evidence.", ""]
    lines += ["## Summary", ""] + _table(
        ["Rank", "Outcome", "Manufacturer", "MPN", "Package", "Drop-in"],
        [[row["rank"] or "-", row["outcome"], row["manufacturer"], row["mpn"], row["package"] or "-", row["dropIn"] or "-"] for row in document["devices"]],
    )
    for row in document["devices"]:
        lines += [f"## {row['manufacturer']} {row['mpn']} - {row['outcome']}", ""]
        if row["datasheet"]:
            lines += [f"Datasheet: {row['datasheet'].get('url', '')} {row['datasheet'].get('revision', '')}".rstrip(), ""]
        lines += _table(
            ["Constraint", "Requirement", "Status", "Value", "Evidence and conditions", "Why unknown"],
            [
                [
                    check["constraint"],
                    check["requirement"],
                    check["status"],
                    check["value"] or "-",
                    "; ".join(
                        f"{item['value']} ({item['basis']}"
                        + "".join(f", {name} {value}" for name, value in item["conditions"].items())
                        + f") - {_source(item['source'])}"
                        for item in check["evidence"]
                    ) or "-",
                    "; ".join(check["reasons"]) or "-",
                ]
                for check in row["checks"]
            ],
        )
        if row["unconfirmedValues"]:
            lines += ["Unconfirmed values (not evidence):", ""] + [
                f"- {item['name']} {item['value']} ({item['status']}, {_source(item['source'])})" for item in row["unconfirmedValues"]
            ] + [""]
        if row["offers"]:
            lines += _table(
                ["Supplier", "SKU", "Packaging", "Stock", "MOQ", "Order qty", "Unit price", "Currency", "Captured", "Stale"],
                [
                    [o["supplier"], o["sku"], o["packaging"] or "-", "unknown" if o["stock"] is None else o["stock"], o["moq"] or "-",
                     o["orderQuantity"], "unknown" if o["unitPrice"] is None else o["unitPrice"], o["currency"] or "unknown",
                     o["retrievedAt"], "yes" if o["stale"] else "no"]
                    for o in row["offers"]
                ],
            )
    if document["warnings"]:
        lines += ["## Warnings", ""] + [f"- {warning}" for warning in document["warnings"]] + [""]
    lines += ["## Limits", ""] + [f"- {limit}" for limit in document["limits"]] + [""]
    return "\n".join(lines)


def bom(document: dict[str, Any]) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\r\n")
    writer.writerow(BOM_HEADER)
    proposed = _proposed(document)
    if proposed:
        offer = best_offer(proposed, document["currency"]) or {}
        writer.writerow([
            "proposed", document["quantity"], proposed["manufacturer"], proposed["mpn"], proposed["package"] or "",
            offer.get("supplier", ""), offer.get("sku", ""), offer.get("packaging") or "", offer.get("orderQuantity", ""),
            "" if offer.get("unitPrice") is None else offer["unitPrice"], offer.get("currency") or "",
            offer.get("retrievedAt", ""), "" if not offer else ("yes" if offer["stale"] else "no"),
        ])
    return buffer.getvalue()


def write(document: dict[str, Any], *, cwd: Path, results_dir: Path, unchanged: Callable[[], bool]) -> list[dict[str, Any]]:
    """Creates the run folder and its three files exclusively; a failure removes what this run created."""
    run_dir = results_dir / document["runId"]
    files = {
        "comparison.json": ("comparison-json", (json.dumps(document, indent=2, ensure_ascii=False, allow_nan=False) + "\n").encode("utf-8")),
        "comparison.md": ("comparison-markdown", markdown(document).encode("utf-8")),
        "bom.csv": ("bom-csv", bom(document).encode("utf-8")),
    }
    made: list[Path] = []
    folder = results_dir
    while not folder.exists() and folder != folder.parent:
        made.insert(0, folder)
        folder = folder.parent
    created: list[Path] = []
    try:
        results_dir.mkdir(parents=True, exist_ok=True)
        run_dir.mkdir()
        made.append(run_dir)
        if not workspace.allowed_output(cwd, run_dir):
            raise OutputFailure("The results directory changed while the comparison ran; the run was discarded.")
        for name, (_, data) in files.items():
            with open(run_dir / name, "xb") as handle:
                created.append(run_dir / name)
                handle.write(data)
        if not unchanged():
            raise OutputFailure("The input file changed while the comparison ran; the run was discarded.")
    except FileExistsError as error:
        _remove(created, [path for path in made if path != run_dir])
        raise FileExistsError(str(run_dir)) from error
    except (OSError, OutputFailure) as error:
        _remove(created, made)
        if isinstance(error, OutputFailure):
            raise
        raise OutputFailure(f"The comparison could not be written to '{workspace.relative(cwd, run_dir)}': {error.strerror or error}.") from error
    return [
        {"kind": kind, "path": workspace.relative(cwd, run_dir / name), "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
        for name, (kind, data) in files.items()
    ]


def _remove(created: list[Path], made: list[Path]) -> None:
    for path in created:
        try:
            path.unlink()
        except OSError:
            pass
    for path in reversed(made):
        try:
            path.rmdir()
        except OSError:
            pass


def header(run_id: str, started: str, status: str, request: dict[str, Any] | None) -> dict[str, Any]:
    return {
        "format": FORMAT,
        "kind": "parts-compare-summary",
        "tool": {"name": TOOL, "version": VERSION},
        "operation": "compare",
        "runId": run_id,
        "startedAt": started,
        "status": status,
        **({"request": request} if request else {}),
    }
