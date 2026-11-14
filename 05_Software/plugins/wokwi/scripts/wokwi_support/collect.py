"""Results of a run-scenario folder: outcome, time, remote state and artifacts (spec REQ-DATA-d985bb3d sections 6-7;
REQ-FUNC-3c5b6470, REQ-FUNC-5576edcd)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from . import FORMAT, NOTE, RUN_KIND, workspace
from .outcome import derive
from .project import sha256_file
from .report import cell, problem, refused, stamp, write_json, write_text

ARTIFACTS = ("serial.log", "trace.vcd", "screenshot.png", "cli-stdout.log", "cli-stderr.log")
READ_LIMIT = 4 * 1024 * 1024 + 4096


def _read(path: Path) -> str:
    try:
        with path.open("rb") as handle:
            return handle.read(READ_LIMIT).decode("utf-8", "replace")
    except OSError:
        return ""


def artifacts(cwd: Path, folder: Path) -> list[dict[str, Any]]:
    found = []
    for name in ARTIFACTS:
        path = folder / name
        if path.is_file():
            found.append({"path": workspace.relative(cwd, path), "bytes": path.stat().st_size, "sha256": sha256_file(path)})
    return found


def markdown(document: dict[str, Any]) -> str:
    time = document.get("time") or {}
    virtual, real = time.get("virtual") or {}, time.get("real") or {}
    remote = document.get("remote") or {}
    board = document.get("board") or {}
    lines = [
        f"# wokwi-tool run-scenario: {document.get('status')} ({document.get('outcome')})",
        "",
        f"> {NOTE}",
        "",
        f"- Run: `{document.get('runId')}`, job `{(document.get('job') or {}).get('runId')}`",
        f"- Board: `{board.get('id')}` ({board.get('type')}); firmware `{(document.get('firmware') or {}).get('sha256')}`",
        f"- Virtual time: timeout {virtual.get('timeoutMs')} ms, reached {virtual.get('reachedNs')} ns",
        f"- Real time: budget {real.get('budgetS')} s, elapsed {real.get('elapsedS')} s ({real.get('startedAt')} to {real.get('endedAt')})",
        f"- Remote: {remote.get('state')} (confirmed {remote.get('confirmed')}, cancel {remote.get('cancel')}); attempts {document.get('attempts')}, CLI connection retries {document.get('connectRetries')}",
        f"- Wokwi API: {document.get('api')}",
        "",
    ]
    for item in document.get("errors") or []:
        lines.append(f"- {item.get('code')}: {cell(item.get('message', ''))}")
    for item in document.get("artifacts") or []:
        lines.append(f"- Artifact `{item['path']}` ({item['bytes']} bytes, `{item['sha256']}`)")
    return "\n".join(lines).rstrip() + "\n"


def finish(cwd: Path, folder: Path, document: dict[str, Any]) -> dict[str, Any]:
    """Derives the outcome from exit.json and the CLI logs and rewrites result.json and report.md."""
    try:
        exit_record = json.loads((folder / "exit.json").read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, ValueError):
        exit_record = None
    if exit_record is not None and not isinstance(exit_record, dict):
        exit_record = None
    limits = document.get("limits") or {}
    derived = derive(exit_record, _read(folder / "cli-stdout.log"), _read(folder / "cli-stderr.log"), int(limits.get("virtualTimeoutMs") or 0))
    real = document.setdefault("time", {}).setdefault("real", {})
    if exit_record is not None:
        real["endedAt"] = exit_record.get("endedAt")
        real["elapsedS"] = exit_record.get("elapsedS")
    document["time"].setdefault("virtual", {})["reachedNs"] = derived["reachedNs"]
    document.update({
        "status": derived["status"],
        "outcome": derived["outcome"],
        "remote": derived["remote"],
        "connectRetries": derived["connectRetries"],
        "api": derived["api"],
        "attempts": 1,
        "artifacts": artifacts(cwd, folder),
        "collectedAt": stamp(),
        "errors": [] if derived["status"] == "pass" else [problem(derived["outcome"], derived["message"])],
    })
    write_json(folder / "result.json", document)
    write_text(folder / "report.md", markdown(document))
    return document


def collect_results(args: Any, document: dict[str, Any], cwd: Path, spelled: Path) -> dict[str, Any]:
    try:
        folder = workspace.confined(cwd, args.run, "--run", spelled)
    except workspace.PathRefused as error:
        raise refused("path", str(error)) from error
    try:
        stored = json.loads((folder / "result.json").read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, ValueError) as error:
        raise refused("run-invalid", f"--run '{args.run[:120]}' holds no wokwi-tool run result.json.") from error
    if not isinstance(stored, dict) or stored.get("kind") != RUN_KIND or stored.get("format") != FORMAT:
        raise refused("run-invalid", f"--run '{args.run[:120]}' is not a wokwi-tool run-scenario folder.")
    return finish(cwd, folder, stored)
