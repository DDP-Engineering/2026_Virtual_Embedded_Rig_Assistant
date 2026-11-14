"""Result documents, run folders, stdout output and Markdown reports of mqtt-tool (spec REQ-DATA-96d18686 sections 5-6)."""

from __future__ import annotations

import json
import os
import secrets
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import FORMAT, KIND, NOTE, TOOL, VERSION, workspace

OUTPUT_LIMIT = 11000
DEFAULT_RESULTS = "arduino-iot-results"
EXIT = {"pass": 0, "fail": 1, "blocked": 2, "incomplete": 3, "error": 3}


class Refused(Exception):
    """Blocked before any packet reached the broker: `{code, message}` problems."""

    def __init__(self, problems: list[dict[str, Any]], **fields: Any) -> None:
        super().__init__(problems[0]["message"] if problems else "refused")
        self.problems = problems
        self.fields = fields


class Ended(Exception):
    """An operation that ended with `status` (fail, incomplete or error) after it started talking to the broker."""

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
        "note": NOTE,
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
    return str(value).replace("|", "\\|").replace("\n", " ").replace("`", "'")


def markdown(document: dict[str, Any]) -> str:
    lines = [f"# mqtt-tool {document.get('operation', '')}: {document.get('status', '')}", "", f"> {NOTE}", ""]
    for key, label in (("runId", "Run"), ("startedAt", "Started"), ("finishedAt", "Finished")):
        if document.get(key):
            lines.append(f"- {label}: `{document[key]}`")
    broker = document.get("broker")
    if isinstance(broker, dict):
        tls = broker.get("tls") or {}
        lines.append(f"- Broker: `{broker.get('host')}:{broker.get('port')}`, TLS {tls.get('enabled')}, verified {tls.get('verified')}")
    client = document.get("client")
    if isinstance(client, dict):
        lines.append(f"- Client: `{client.get('id')}`, MQTT {client.get('protocol')}, clean session {client.get('cleanSession')}")
    will = document.get("will")
    lines.append(f"- Last Will: {_cell(json.dumps(will)) if will else 'none'}")
    capture = document.get("capture")
    if isinstance(capture, dict):
        lines.append(f"- Capture: {capture.get('messages')} messages, {capture.get('bytes')} bytes, ended by {capture.get('endReason')}, events {_cell(json.dumps(capture.get('events'), sort_keys=True))}, file `{capture.get('file')}`")
    published = document.get("publish")
    if isinstance(published, dict):
        lines.append(f"- Publish `{_cell(published.get('topic'))}` ({published.get('kind')}, QoS {published.get('qos')}, retain {published.get('retain')}): delivery {published.get('delivery')}, retried {published.get('retried')}, physical {published.get('physical')}")
    request = document.get("request")
    if isinstance(request, dict):
        lines.append(f"- Request correlation `{request.get('correlation')}`: response {'received' if request.get('response') else 'none'}, uncorrelated {len(request.get('uncorrelated') or [])}")
    if document.get("gaps"):
        lines += ["", "| Lost at | Reconnected at | Reason |", "|---|---|---|"]
        lines += [f"| {gap.get('lostAt')} | {gap.get('reconnectedAt') or ''} | {_cell(gap.get('reason'))} |" for gap in document["gaps"]]
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

    def omitted(key: str) -> None:
        shown.setdefault("omittedFromOutput", {})[key] = shown.get("omittedFromOutput", {}).get(key, 0) + 1

    request = shown.get("request") if isinstance(shown.get("request"), dict) else {}
    for holder, key in ((request, "uncorrelated"), (shown, "gaps"), (shown, "warnings"), (shown, "errors")):
        items = holder.get(key)
        while isinstance(items, list) and items and size() > OUTPUT_LIMIT:
            omitted(key)
            items.pop()
    # Payloads stay whole in the run folder; stdout shortens them, then drops the effective profile, to keep the bound.
    lines = [request.get("response")] if isinstance(request.get("response"), dict) else []
    for line in lines:
        if size() > OUTPUT_LIMIT and "payloadBase64" in line:
            del line["payloadBase64"]
            omitted("payloadBase64")
        if size() > OUTPUT_LIMIT and isinstance(line.get("text"), str) and len(line["text"]) > 2000:
            line["text"] = line["text"][:2000]
            omitted("text")
    if size() > OUTPUT_LIMIT and "effective" in shown:
        shown["effective"] = None
        omitted("effective")
    sys.stdout.write(render())
    sys.stdout.flush()
