"""Result documents, run folders, stdout output and Markdown reports of ble-tool (spec REQ-DATA-e8502710 section 8)."""

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
    """Blocked before the radio was used for the operation: `{code, message}` problems."""

    def __init__(self, problems: list[dict[str, Any]], **fields: Any) -> None:
        super().__init__(problems[0]["message"] if problems else "refused")
        self.problems = problems
        self.fields = fields


class Ended(Exception):
    """An operation that ended with `status` (fail, blocked, incomplete or error) after it used the radio."""

    def __init__(self, status: str, code: str, message: str, **fields: Any) -> None:
        super().__init__(message)
        self.status = status
        self.problem = problem(code, message)
        self.fields = fields


def problem(code: str, message: str, **extra: Any) -> dict[str, Any]:
    return {"code": code, "message": message, **extra}


def refused(code: str, message: str) -> Refused:
    return Refused([problem(code, message)])


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
        raise refused("path", str(error)) from error
    folder = results / run_id
    if folder.exists():
        raise refused("run-exists", f"The run folder {workspace.relative(cwd, folder)} exists already; choose another --run-id.")
    results.mkdir(parents=True, exist_ok=True)
    try:
        folder.mkdir()
    except FileExistsError as error:
        raise refused("run-exists", f"The run folder {workspace.relative(cwd, folder)} exists already.") from error
    if not workspace.allowed_output(cwd, folder):
        folder.rmdir()
        raise refused("path", "--results-dir resolves outside the working directory or into .vera.")
    return folder


def write_json(path: Path, document: dict[str, Any]) -> None:
    """Written aside and renamed, so a killed helper never leaves half a document."""
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    os.replace(temporary, path)


def _cell(value: Any) -> str:
    return str(value).replace("|", "\\|").replace("\n", " ")


def _value(item: dict[str, Any]) -> str:
    if item.get("value") is None:
        return f"invalid ({item.get('decodeError')})"
    text = f"{item.get('value')} {item.get('unit') or ''}".strip()
    return text if item.get("valid", True) else f"{text} (invalid: {item.get('decodeError')})"


def markdown(document: dict[str, Any]) -> str:
    lines = [f"# ble-tool {document.get('operation', '')}: {document.get('status', '')}", ""]
    for key, label in (("runId", "Run"), ("startedAt", "Started"), ("finishedAt", "Finished")):
        if document.get(key):
            lines.append(f"- {label}: `{document[key]}`")
    device = document.get("device")
    if isinstance(device, dict):
        lines.append(
            f"- Device: `{device.get('alias')}` at `{device.get('address')}` ({device.get('addressType')}), profile `{device.get('profile')}`, identity {device.get('identity')}"
        )
    link = document.get("link")
    if isinstance(link, dict):
        lines.append(f"- Link: connected {link.get('connected')}, disconnected by {link.get('disconnectedBy')}, subscription {link.get('subscription')}")
    write = document.get("write")
    if isinstance(write, dict):
        lines.append(
            f"- Write `{write.get('name')}` ({write.get('class')}) data `{write.get('data')}`: delivery {write.get('delivery')}, retried {write.get('retried')}, effect {write.get('effect')}"
        )
    capture = document.get("notifications")
    if isinstance(capture, dict):
        lines.append(
            f"- Notifications: {capture.get('count')} in `{capture.get('file')}` ({capture.get('bytes')} bytes, dropped {capture.get('dropped')}), ended by {capture.get('endedBy')}"
        )
    lines.append("")
    if document.get("advertisers"):
        lines += ["| Address | Names | RSSI min/max | Services | Count | Registry | Candidate | Ambiguous name |", "|---|---|---|---|---|---|---|---|"]
        lines += [
            f"| `{item.get('address')}` | {_cell(', '.join(item.get('names') or []))} | {item.get('rssiMin')}/{item.get('rssiMax')} | {_cell(', '.join(item.get('serviceUuids') or []))} | {item.get('count')} | {item.get('registryAlias') or ''} | {item.get('candidate')} | {item.get('ambiguousName')} |"
            for item in document["advertisers"]
        ]
        lines.append("")
    if document.get("reads"):
        lines += ["| # | Characteristic | Raw | Value | Received |", "|---|---|---|---|---|"]
        lines += [f"| {item.get('index')} | {item.get('characteristic')} | `{item.get('raw')}` | {_cell(_value(item))} | {item.get('receivedAt')} |" for item in document["reads"]]
        lines.append("")
    if document.get("services"):
        lines += ["| Service | Characteristic | Handle | Properties |", "|---|---|---|---|"]
        for service in document["services"]:
            for char in service.get("characteristics") or []:
                lines.append(f"| `{service.get('uuid')}` | `{char.get('uuid')}` | {char.get('handle')} | {', '.join(char.get('properties') or [])} |")
        lines.append("")
    if document.get("runs"):
        lines += ["| Run | Operation | Status | Device | Characteristic | Physical |", "|---|---|---|---|---|---|"]
        lines += [
            f"| `{_cell(item.get('path'))}` | {item.get('operation')} | {item.get('status')} | {item.get('device') or ''} | {item.get('characteristic') or ''} | {item.get('physical') or ''} |"
            for item in document["runs"]
        ]
        lines.append("")
    for key, title in (("errors", "Errors"), ("warnings", "Warnings")):
        items = document.get(key) or []
        if items:
            lines += [f"## {title}", ""] + [f"- {item.get('code')}: {_cell(item.get('message', ''))}" for item in items] + [""]
    return "\n".join(lines).rstrip() + "\n"


def write(folder: Path, document: dict[str, Any]) -> None:
    write_json(folder / "result.json", document)
    (folder / "report.md").write_text(markdown(document), encoding="utf-8", newline="\n")


def emit(document: dict[str, Any]) -> None:
    """One JSON document on stdout, long lists cut until it fits OUTPUT_LIMIT UTF-16 units."""
    shown = json.loads(json.dumps(document))

    def render() -> str:
        return json.dumps(shown, ensure_ascii=False, indent=2) + "\n"

    def size() -> int:
        return len(render().encode("utf-16-le")) // 2

    for key in ("advertisers", "services", "reads", "samples", "runs", "warnings", "errors"):
        items = shown.get(key)
        while isinstance(items, list) and items and size() > OUTPUT_LIMIT:
            shown.setdefault("omittedFromOutput", {})[key] = shown.get("omittedFromOutput", {}).get(key, 0) + 1
            items.pop()
    sys.stdout.write(render())
    sys.stdout.flush()


def summary(cwd: Path, folder: Path) -> dict[str, Any]:
    """The line a report keeps for one run folder; Refused when it holds no ble-tool result."""
    path = folder / "result.json"
    try:
        if not path.is_file() or path.stat().st_size > 4 * 1024 * 1024:
            raise ValueError("missing")
        document = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(document, dict) or document.get("format") != FORMAT or document.get("kind") != KIND:
            raise ValueError("kind")
    except (OSError, ValueError) as error:
        raise refused("run-invalid", f"--run '{workspace.relative(cwd, folder)}' holds no ble-tool result.json.") from error
    device: dict[str, Any] = document["device"] if isinstance(document.get("device"), dict) else {}
    lifecycle: dict[str, Any] = document["lifecycle"] if isinstance(document.get("lifecycle"), dict) else {}
    return {
        "path": workspace.relative(cwd, folder),
        "runId": document.get("runId"),
        "operation": document.get("operation"),
        "status": document.get("status"),
        "device": device.get("alias"),
        "characteristic": document.get("characteristic"),
        "physical": lifecycle.get("physical"),
        "errors": len(document.get("errors") or []),
    }
