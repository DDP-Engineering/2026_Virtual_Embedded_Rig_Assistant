"""Result documents, run folders, stdout output and Markdown reports of arduino-tool (spec REQ-DATA-e444904d)."""

from __future__ import annotations

import json
import secrets
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import FORMAT, KIND, TOOL, VERSION, workspace

OUTPUT_LIMIT = 11000
DEFAULT_RESULTS = "arduino-iot-results"
EXIT = {"pass": 0, "blocked": 2, "fail": 3, "error": 3, "incomplete": 3}


class Refused(Exception):
    """Refusal before arduino-cli acted: one or more `{code, message}` problems."""

    def __init__(self, problems: list[dict[str, str]]) -> None:
        super().__init__(problems[0]["message"] if problems else "refused")
        self.problems = problems


def problem(code: str, message: str, **extra: Any) -> dict[str, Any]:
    return {"code": code, "message": message, **extra}


def stamp(moment: datetime | None = None) -> str:
    moment = moment or datetime.now(timezone.utc)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


def new_run_id(operation: str) -> str:
    return f"{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}-{operation}-{secrets.token_hex(2)}"


def header(operation: str, run_id: str | None, started: str) -> dict[str, Any]:
    document: dict[str, Any] = {"format": FORMAT, "kind": KIND, "tool": f"{TOOL} {VERSION}", "operation": operation}
    if run_id:
        document["runId"] = run_id
    document.update({"startedAt": started, "status": "pass", "errors": [], "warnings": []})
    return document


def run_folder(cwd: Path, spelled: Path, results_dir: str, run_id: str) -> Path:
    """Creates `<results-dir>/<run-id>` exclusively inside the working directory and outside `.vera`."""
    try:
        results = workspace.results_directory(cwd, results_dir, spelled)
    except workspace.PathRefused as error:
        raise Refused([problem("path", str(error))]) from error
    folder = results / run_id
    if folder.exists():
        raise Refused([problem("run-exists", f"The run folder {workspace.relative(cwd, folder)} exists already; choose another --run-id.")])
    results.mkdir(parents=True, exist_ok=True)
    try:
        folder.mkdir()
    except FileExistsError as error:
        raise Refused([problem("run-exists", f"The run folder {workspace.relative(cwd, folder)} exists already.")]) from error
    if not workspace.allowed_output(cwd, folder):
        folder.rmdir()
        raise Refused([problem("path", "--results-dir resolves outside the working directory or into .vera.")])
    return folder


def write_json(path: Path, document: dict[str, Any]) -> None:
    path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")


def _cell(value: Any) -> str:
    return str(value).replace("|", "\\|").replace("\n", " ")


def markdown(document: dict[str, Any]) -> str:
    operation = document.get("operation", "")
    lines = [f"# arduino-tool {operation}: {document.get('status', '')}", ""]
    for key, label in (("runId", "Run"), ("fqbn", "FQBN"), ("startedAt", "Started"), ("finishedAt", "Finished")):
        if document.get(key):
            lines.append(f"- {label}: `{document[key]}`")
    platform = document.get("platform")
    if isinstance(platform, dict) and platform.get("id"):
        lines.append(f"- Core: `{platform['id']}` {platform.get('version', '')}")
    source = document.get("source")
    if isinstance(source, dict) and source.get("path"):
        lines.append(f"- Sketch: `{source['path']}` sha256 `{source.get('sha256', '')}`")
    port = document.get("port")
    if isinstance(port, dict):
        lines.append(f"- Port: `{port.get('before')}` -> `{port.get('after')}`, identity `{document.get('identity', '')}`")
    lines.append("")
    if document.get("sizes"):
        lines += ["| Section | Bytes | Maximum |", "|---|---|---|"]
        lines += [f"| {_cell(item.get('section'))} | {item.get('bytes')} | {item.get('maxBytes')} |" for item in document["sizes"]]
        lines.append("")
    if document.get("libraries"):
        lines += ["| Library | Version | Location | Declared |", "|---|---|---|---|"]
        lines += [
            f"| {_cell(item.get('name'))} | {_cell(item.get('version'))} | {item.get('location')} | {item.get('declared')} |"
            for item in document["libraries"]
        ]
        lines.append("")
    if document.get("binaries"):
        lines += ["| Binary | Bytes | SHA-256 |", "|---|---|---|"]
        lines += [f"| `{_cell(item['path'])}` | {item['bytes']} | `{item['sha256']}` |" for item in document["binaries"]]
        lines.append("")
    if document.get("runs"):
        lines += ["| Run | Operation | Status | FQBN | Binary SHA-256 |", "|---|---|---|---|---|"]
        lines += [
            f"| `{_cell(item.get('path'))}` | {item.get('operation')} | {item.get('status')} | `{_cell(item.get('fqbn'))}` | `{item.get('binarySha256') or ''}` |"
            for item in document["runs"]
        ]
        lines.append("")
    for key, title in (("errors", "Errors"), ("diagnostics", "Diagnostics"), ("warnings", "Warnings")):
        items = document.get(key) or []
        if items:
            lines += [f"## {title}", ""]
            for item in items:
                where = f"{item.get('file')}:{item.get('line')}:{item.get('column')} " if item.get("file") else ""
                lines.append(f"- {where}{item.get('code') or item.get('severity', '')}: {_cell(item.get('message', ''))}")
            lines.append("")
    if document.get("log"):
        lines.append(f"Full output: `{document['log']}`.")
    return "\n".join(lines).rstrip() + "\n"


def write(folder: Path, document: dict[str, Any]) -> None:
    write_json(folder / "result.json", document)
    (folder / "report.md").write_text(markdown(document), encoding="utf-8", newline="\n")


def emit(document: dict[str, Any]) -> None:
    """One JSON document on stdout, long lists cut until it fits OUTPUT_LIMIT UTF-16 units, cuts counted."""
    shown = json.loads(json.dumps(document))

    def render() -> str:
        return json.dumps(shown, ensure_ascii=False, indent=2) + "\n"

    text = render()
    for key in ("ports", "boards", "platforms", "libraries", "files", "diagnostics", "warnings", "runs", "binaries", "errors"):
        items = shown.get(key)
        while isinstance(items, list) and items and len(text.encode("utf-16-le")) // 2 > OUTPUT_LIMIT:
            shown.setdefault("omitted", {})[key] = shown.get("omitted", {}).get(key, 0) + 1
            items.pop()
            text = render()
    if isinstance(shown.get("source"), dict):
        files = shown["source"].get("files")
        while isinstance(files, list) and files and len(text.encode("utf-16-le")) // 2 > OUTPUT_LIMIT:
            shown.setdefault("omitted", {})["source.files"] = shown.get("omitted", {}).get("source.files", 0) + 1
            files.pop()
            text = render()
    sys.stdout.write(text)
    sys.stdout.flush()


def summary(cwd: Path, folder: Path) -> dict[str, Any]:
    """The line a report keeps for one run folder; Refused when it holds no arduino-tool result."""
    path = folder / "result.json"
    try:
        if not path.is_file() or path.stat().st_size > 1024 * 1024:
            raise ValueError("missing")
        document = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(document, dict) or document.get("format") != FORMAT or document.get("kind") != KIND:
            raise ValueError("kind")
    except (OSError, ValueError) as error:
        raise Refused([problem("run-invalid", f"--run '{workspace.relative(cwd, folder)}' holds no arduino-tool result.json.")]) from error
    binary = document.get("binary") if isinstance(document.get("binary"), dict) else None
    binaries = document.get("binaries") if isinstance(document.get("binaries"), list) else []
    return {
        "path": workspace.relative(cwd, folder),
        "operation": document.get("operation"),
        "status": document.get("status"),
        "fqbn": document.get("fqbn"),
        "runId": document.get("runId"),
        "binarySha256": (binary or {}).get("sha256") or (binaries[0].get("sha256") if binaries and isinstance(binaries[0], dict) else None),
        "sizes": document.get("sizes") or [],
        "errors": len(document.get("errors") or []),
    }
