"""Result documents, run folders, stdout output and Markdown reports of circuitpython-tool (spec REQ-DATA-8f309a53)."""

from __future__ import annotations

import json
import os
import secrets
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import FORMAT, KIND, TOOL, VERSION, workspace

OUTPUT_LIMIT = 11000
DEFAULT_RESULTS = "arduino-iot-results"
EXIT = {"pass": 0, "fail": 1, "blocked": 2, "incomplete": 3, "error": 3}


class Refused(Exception):
    """Refusal before any volume file was written or any byte sent to a board: `{code, message}` problems."""

    def __init__(self, problems: list[dict[str, Any]], **fields: Any) -> None:
        super().__init__(problems[0]["message"] if problems else "refused")
        self.problems = problems
        self.fields = fields


class Ended(Exception):
    """An operation that ended with `status` (fail, incomplete or error) after it started acting."""

    def __init__(self, status: str, code: str, message: str, **fields: Any) -> None:
        super().__init__(message)
        self.status = status
        self.problem = problem(code, message)
        self.fields = fields


def problem(code: str, message: str, **extra: Any) -> dict[str, Any]:
    return {"code": code, "message": message, **extra}


def stamp(moment: datetime | None = None) -> str:
    moment = moment or datetime.now(timezone.utc)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


def new_run_id(operation: str) -> str:
    return f"{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}-{operation}-{secrets.token_hex(2)}"


def header(operation: str, started: str) -> dict[str, Any]:
    return {
        "format": FORMAT,
        "kind": KIND,
        "tool": f"{TOOL} {VERSION}",
        "operation": operation,
        "startedAt": started,
        "status": "pass",
        "errors": [],
        "warnings": [],
    }


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
    """Written aside and renamed, so a killed helper never leaves half a document."""
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    os.replace(temporary, path)


def _cell(value: Any) -> str:
    return str(value).replace("|", "\\|").replace("\n", " ")


def markdown(document: dict[str, Any]) -> str:
    lines = [f"# circuitpython-tool {document.get('operation', '')}: {document.get('status', '')}", ""]
    for key, label in (("runId", "Run"), ("startedAt", "Started"), ("finishedAt", "Finished"), ("application", "Application"), ("autoreload", "Autoreload")):
        if document.get(key):
            lines.append(f"- {label}: `{document[key]}`")
    volume = document.get("volume")
    if isinstance(volume, dict):
        bound = f", port `{volume['port']}`" if volume.get("port") else ""
        lines.append(f"- Volume: `{volume.get('path')}`, identity `{volume.get('identity')}`{bound}")
    firmware = document.get("firmware")
    if isinstance(firmware, dict) and firmware.get("version"):
        lines.append(f"- Firmware: CircuitPython {firmware.get('version')} on {_cell(firmware.get('board') or firmware.get('boardId') or '')}")
    bundle = document.get("bundle")
    if isinstance(bundle, dict):
        lines.append(f"- Bundle: `{bundle.get('repo')}` tag `{bundle.get('tag')}`, platform `{document.get('platform', '')}`")
    if document.get("librarySet"):
        lines.append(f"- Library set: `{document['librarySet']}`")
    lines.append("")
    if document.get("files"):
        lines += ["| Target | Bytes | SHA-256 | State |", "|---|---|---|---|"]
        lines += [f"| `{_cell(item.get('target'))}` | {item.get('size')} | `{item.get('sha256')}` | {item.get('state')} |" for item in document["files"]]
        lines.append("")
    if document.get("libraries"):
        lines += ["| Library | Version | Required by | Files |", "|---|---|---|---|"]
        lines += [f"| {item.get('name')} | {item.get('version') or ''} | {', '.join(item.get('requiredBy') or [])} | {len(item.get('files') or [])} |" for item in document["libraries"]]
        lines.append("")
    if document.get("modules"):
        lines += ["| Module | Kind | Version | ABI |", "|---|---|---|---|"]
        lines += [f"| {item.get('name')} | {item.get('kind')} | {item.get('version') or ''} | {item.get('abi')} |" for item in document["modules"]]
        lines.append("")
    if document.get("entries"):
        lines += ["| Path | Type | Bytes |", "|---|---|---|"]
        lines += [f"| `{_cell(item['path'])}` | {item['type']} | {item.get('size', '')} |" for item in document["entries"]]
        lines.append("")
    if document.get("runs"):
        lines += ["| Run | Operation | Status | Identity | Firmware | Confirmed | Library set |", "|---|---|---|---|---|---|---|"]
        lines += [
            f"| `{_cell(item.get('path'))}` | {item.get('operation')} | {item.get('status')} | `{_cell(item.get('identity') or '')}` | {item.get('firmware') or ''} | {item.get('confirmed') if item.get('confirmed') is not None else ''} | {_cell(item.get('librarySet') or '')} |"
            for item in document["runs"]
        ]
        lines.append("")
    run = document.get("run")
    if isinstance(run, dict):
        lines += [f"## Run of {run.get('file')}: {run.get('state')}", ""]
        if run.get("exception"):
            lines.append(f"`{_cell(run['exception'])}`")
            lines.append("")
    for key, title in (("errors", "Errors"), ("warnings", "Warnings")):
        items = document.get(key) or []
        if items:
            lines += [f"## {title}", ""] + [f"- {item.get('code')}: {_cell(item.get('message', ''))}" for item in items] + [""]
    if document.get("consolePath"):
        lines.append(f"Console: `{document['consolePath']}`.")
    return "\n".join(lines).rstrip() + "\n"


def write(folder: Path, document: dict[str, Any]) -> None:
    write_json(folder / "result.json", document)
    (folder / "report.md").write_text(markdown(document), encoding="utf-8", newline="\n")


def emit(document: dict[str, Any]) -> None:
    """One JSON document on stdout, long lists and texts cut until it fits OUTPUT_LIMIT UTF-16 units."""
    shown = json.loads(json.dumps(document))

    def render() -> str:
        return json.dumps(shown, ensure_ascii=False, indent=2) + "\n"

    def size() -> int:
        return len(render().encode("utf-16-le")) // 2

    for key in ("entries", "modules", "libraries", "files", "ports", "volumes", "runs", "warnings", "errors"):
        items = shown.get(key)
        while isinstance(items, list) and items and size() > OUTPUT_LIMIT:
            shown.setdefault("omittedFromOutput", {})[key] = shown.get("omittedFromOutput", {}).get(key, 0) + 1
            items.pop()
    run = shown.get("run")
    if isinstance(run, dict):
        for key in ("output", "traceback"):
            if isinstance(run.get(key), str) and size() > OUTPUT_LIMIT:
                run[key] = run[key][-2000:]
                shown.setdefault("omittedFromOutput", {})[f"run.{key}"] = "cut; see the run folder"
    sys.stdout.write(render())
    sys.stdout.flush()


def summary(cwd: Path, folder: Path) -> dict[str, Any]:
    """The line a report keeps for one run folder; Refused when it holds no circuitpython-tool result."""
    path = folder / "result.json"
    try:
        if not path.is_file() or path.stat().st_size > 4 * 1024 * 1024:
            raise ValueError("missing")
        document = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(document, dict) or document.get("format") != FORMAT or document.get("kind") != KIND:
            raise ValueError("kind")
    except (OSError, ValueError) as error:
        raise Refused([problem("run-invalid", f"--run '{workspace.relative(cwd, folder)}' holds no circuitpython-tool result.json.")]) from error
    volume = document.get("volume") if isinstance(document.get("volume"), dict) else {}
    port = document.get("port") if isinstance(document.get("port"), dict) else {}
    firmware = document.get("firmware") if isinstance(document.get("firmware"), dict) else {}
    files = document.get("files") if isinstance(document.get("files"), list) else None
    return {
        "path": workspace.relative(cwd, folder),
        "runId": document.get("runId"),
        "operation": document.get("operation"),
        "status": document.get("status"),
        "identity": volume.get("identity") or port.get("identity"),
        "firmware": firmware.get("version"),
        "confirmed": None if files is None else sum(1 for item in files if isinstance(item, dict) and item.get("state") == "confirmed"),
        "librarySet": document.get("librarySet"),
        "errors": len(document.get("errors") or []),
    }
