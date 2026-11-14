"""`report`: lab-validation run folders, hash-checked, summarized in one report (spec section 8; the HIL seam)."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any

from . import TOOL, VERSION
from .errors import Refused
from .importers import CSV_LIMIT, RESULT_LIMIT, Context
from .workspace import PathRefused, confined, regular_file, relative

RANK = {"pass": 0, "incomplete": 1, "fail": 2}


def read_run(ctx: Context, raw: str) -> dict[str, Any]:
    try:
        folder = confined(ctx.cwd, raw, "--run", ctx.spelled)
        result_path = regular_file(ctx.cwd, str(folder / "result.json"), "--run (result.json)", ctx.spelled)
    except PathRefused as error:
        raise Refused("path", str(error)) from error
    if result_path.stat().st_size > RESULT_LIMIT:
        raise Refused("limit", f"{relative(ctx.cwd, result_path)} is larger than {RESULT_LIMIT} bytes.")
    data = result_path.read_bytes()
    try:
        document = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as error:
        raise Refused("source", f"{relative(ctx.cwd, result_path)} is not JSON.") from error
    if not (isinstance(document, dict) and document.get("format") == 1 and document.get("kind") == "lab-validation-result"):
        raise Refused("source", f"{relative(ctx.cwd, folder)} holds no format 1 lab-validation-result.")
    artifacts = document.get("artifacts")
    if not isinstance(artifacts, list) or not all(isinstance(a, dict) for a in artifacts):
        raise Refused("source", f"{relative(ctx.cwd, folder)}: result.json lists no artifacts.")
    for artifact in artifacts:
        try:
            path = regular_file(ctx.cwd, str(artifact["path"]), "--run artifact", ctx.spelled)
        except (PathRefused, KeyError, TypeError) as error:
            raise Refused("source-changed", f"{relative(ctx.cwd, folder)}: an artifact it lists is missing or outside the working directory.") from error
        if path.stat().st_size > CSV_LIMIT:
            raise Refused("limit", f"{relative(ctx.cwd, path)} is larger than {CSV_LIMIT} bytes.")
        if hashlib.sha256(path.read_bytes()).hexdigest() != artifact.get("sha256"):
            raise Refused("source-changed", f"{str(artifact['path'])[:120]} differs from the SHA-256 its result.json records.")
    criteria = document.get("criteria") or []
    if not isinstance(criteria, list) or any(not isinstance(c, dict) or c.get("status") not in RANK for c in criteria):
        raise Refused("source", f"{relative(ctx.cwd, folder)}: result.json holds criteria without a pass, fail or incomplete status.")
    counts = {status: sum(1 for c in criteria if c.get("status") == status) for status in ("pass", "fail", "incomplete")}
    verdict = document.get("verdict") if document.get("operation") == "compare" else None
    if document.get("operation") == "compare":
        # result.json is not among its own artifacts: its verdict must follow from its criteria.
        expected = "fail" if counts["fail"] else "incomplete" if counts["incomplete"] or not criteria else "pass"
        if verdict != expected or document.get("status") != expected:
            raise Refused("source-changed", f"{relative(ctx.cwd, folder)}: its verdict {str(verdict)[:20]} does not follow from its criteria ({expected}).")
    return {"path": relative(ctx.cwd, folder), "sha256": hashlib.sha256(data).hexdigest(),
            "title": (document.get("request") or {}).get("title"), "requirement": (document.get("request") or {}).get("requirement"),
            "operation": document.get("operation"), "runId": document.get("runId"), "status": document.get("status"),
            "verdict": verdict if verdict in RANK else "incomplete", "criteria": counts}


def summarize(runs: list[dict[str, Any]], title: str | None, run_id: str, started: str) -> dict[str, Any]:
    verdict = max((run["verdict"] for run in runs), key=lambda v: RANK[v])
    return {"format": 1, "kind": "lab-validation-report", "tool": {"name": TOOL, "version": VERSION}, "operation": "report",
            "runId": run_id, "started": started, "title": title or "Validation report", "verdict": verdict, "status": verdict,
            "runs": runs,
            "note": "A run that is not a compare run counts as incomplete; the verdict is fail when a run fails, else "
                    "incomplete when one is incomplete, else pass."}


def _cell(text: Any) -> str:
    return str(text).replace("|", "\\|").replace("\n", " ")


def markdown(document: dict[str, Any], folder_from_cwd: str) -> str:
    lines = [f"# {_cell(document['title'])} - {document['verdict']}", "", f"lab-validate report, run `{document['runId']}`, {document['started']}.", "",
             "| Run | Title | Requirement | Operation | Verdict | Pass | Fail | Incomplete | SHA-256 |",
             "|---|---|---|---|---|---|---|---|---|"]
    for run in document["runs"]:
        link = Path(os.path.relpath(Path(run["path"]) / "report.md", folder_from_cwd)).as_posix()
        c = run["criteria"]
        lines.append(f"| [{_cell(run['path'])}]({link}) | {_cell(run['title'])} | {_cell(run['requirement'] or '-')} | {run['operation']} | **{run['verdict']}** | "
                     f"{c['pass']} | {c['fail']} | {c['incomplete']} | `{run['sha256'][:16]}...` |")
    lines += ["", document["note"], ""]
    return "\n".join(lines)
