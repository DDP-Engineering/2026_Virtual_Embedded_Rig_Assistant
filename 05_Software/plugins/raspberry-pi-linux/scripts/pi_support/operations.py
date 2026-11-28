"""pi-tool operations (spec REQ-DATA-44547a17 sections 2-6).

Every board operation connects as `ssh` does (a trusted host key, a key of the agent or of ~/.ssh), then asks the
board's helper for finite operations. Refusals that come before anything changed on the board are `blocked`; once the
board was changed the result says what is known about its state (`remote.state`), and an unconfirmed state is
`unknown`, never success.
"""

from __future__ import annotations

import asyncio
import base64
import json
import re
import shlex
import sys
import time
from pathlib import Path
from typing import Any

from . import ASYNCSSH, CANDIDATE_KIND, TOOL, VERSION, project, registry, remote, report, ssh, workspace
from .lifecycle import Lifecycle
from .report import Ended, refused

HANDLE = re.compile(r"[0-9a-f]{16}")
FINAL = ("exited", "budget-exceeded", "output-limit", "stopped", "start-failed", "supervisor-lost", "lost-by-reboot")
LOG_BYTES = 64 * 1024
SHOWN_CHARS = 4000
SETUP_BUDGET_S = 1800
EXEC_BUDGET_S = 120
MATRIX = {
    "boards": "Raspberry Pi running Raspberry Pi OS 12 (Bookworm) 64-bit; other Linux boards with Python 3.9+ and SSH are not claimed",
    "user": "an unprivileged login user; a command the user asks for with exec may use sudo",
    "host": "VERA on Windows x64 or Linux x64 connects to the board; VERA itself does not run on the board",
    "excluded": ["OS provisioning", "firmware or bootloader changes", "passwords and passphrases"],
}


def _board(args: Any) -> registry.Board:
    return registry.load().board(args.board)


def _board_doc(document: dict[str, Any], board: registry.Board, host_key: dict[str, Any] | None = None) -> None:
    document["board"] = board.summary(host_key.get("fingerprint") if host_key else None)


async def _session(board: registry.Board, document: dict[str, Any], lifecycle: Lifecycle) -> ssh.Session:
    session = await ssh.connect(board)
    _board_doc(document, board, session.host_key)
    if session.host_key.get("trust") == "first-use":
        document["warnings"].append({"code": "host-key-saved", "message": f"First connection to {board.alias}: its host key {session.host_key['fingerprint']} ({session.host_key['type']}) was saved. A different key will be refused from now on."})

    def installed(result: dict[str, Any]) -> None:
        document["warnings"].append({"code": "helper-installed", "message": f"VERA's helper {remote.HELPER_VERSION} was installed on the board ({result.get('path')})."})

    session.on_install = installed
    lifecycle.report("identified")
    return session


def capabilities(args: Any, document: dict[str, Any]) -> None:
    data, digest = remote.helper()
    document.update(
        {
            "versions": {"tool": f"{TOOL} {VERSION}", "asyncssh": ASYNCSSH},
            "helper": {"version": remote.HELPER_VERSION, "sha256": digest, "bytes": len(data), "path": remote.installed_path(), "python": ">=3.9 at /usr/bin/python3"},
            "matrix": MATRIX,
            "operations": [
                "capabilities", "check-host-key", "trust-host-key", "install-helper", "identify", "inspect-project", "compare", "deploy",
                "deploy-candidate", "apply-candidate", "run-task", "exec", "task-status", "stop-owned", "service-status", "service-start",
                "service-stop", "collect-logs", "fetch", "report",
            ],
            "limits": {"files": project.FILES, "fileBytes": project.FILE_BYTES, "totalBytes": project.TOTAL_BYTES, "budgetS": project.BUDGET_S, "defaultBudgetS": project.DEFAULT_BUDGET_S, "logLines": 2000, "fetchBytes": 8 * 1024 * 1024},
            "remoteCommands": "two constant commands (install, run); every argument travels on stdin",
        }
    )


async def check_host_key(args: Any, document: dict[str, Any], lifecycle: Lifecycle) -> None:
    board = _board(args)
    _board_doc(document, board)
    presented = await ssh.check_host_key(board)
    _board_doc(document, board, presented)
    document["hostKey"] = presented
    document["remote"] = {"state": "unchanged"}
    if presented["trust"] == "first-use":
        document["warnings"].append({"code": "host-key-new", "message": f"{board.alias} was not seen before; the first connection saves this key."})
    elif not presented["trusted"]:
        raise ssh.host_key_refusal(board, presented)


async def trust_host_key(args: Any, document: dict[str, Any], lifecycle: Lifecycle) -> None:
    board = _board(args)
    _board_doc(document, board)
    presented = await ssh.trust_host_key(board)
    _board_doc(document, board, presented)
    document["hostKey"] = presented
    document["remote"] = {"state": "unchanged"}


async def install_helper(args: Any, document: dict[str, Any], lifecycle: Lifecycle) -> None:
    board = _board(args)
    _board_doc(document, board)
    session = await _session(board, document, lifecycle)
    try:
        lifecycle.report("acting", "pending")
        installed = await session.install()
        session.installed = installed
        lifecycle.physical = "confirmed"
        _, digest = remote.helper()
        document["helper"] = {"version": remote.HELPER_VERSION, "sha256": digest, **installed}
        document["remote"] = {"state": "changed" if installed.get("state") != "already-installed" else "unchanged"}
        found = await session.call("identify")
        document["identity"] = found["facts"]
        document["rootCheck"] = found["root"]
    finally:
        session.close()


def _health_warnings(document: dict[str, Any], health: dict[str, Any]) -> None:
    throttled = health.get("throttled") or {}
    if "under-voltage" in (throttled.get("now") or []):
        document["warnings"].append({"code": "under-voltage", "message": "The board reports under-voltage right now: its power supply or cable is too weak. Expect crashes and corrupted SD cards until that is fixed."})
    elif "under-voltage" in (throttled.get("sinceBoot") or []):
        document["warnings"].append({"code": "under-voltage", "message": "The board saw under-voltage since it booted: its power supply or cable is marginal."})
    temperature = health.get("temperatureC")
    if isinstance(temperature, (int, float)) and temperature >= 80:
        document["warnings"].append({"code": "hot", "message": f"The processor is at {temperature} C and is slowed down above 80 C; it needs cooling."})
    free = health.get("diskFreeMB")
    if isinstance(free, (int, float)) and free < 200:
        document["warnings"].append({"code": "disk-low", "message": f"Only {free} MB are free on the board's disk."})


async def identify(args: Any, document: dict[str, Any], lifecycle: Lifecycle) -> None:
    board = _board(args)
    _board_doc(document, board)
    session = await _session(board, document, lifecycle)
    try:
        found = await session.call("identify")
    finally:
        session.close()
    _, digest = remote.helper()
    document["identity"] = found["facts"]
    document["health"] = found.get("health") or {}
    document["helper"] = {"version": remote.HELPER_VERSION, "sha256": digest}
    document["rootCheck"] = found["root"]
    document["remote"] = {"state": "changed" if session.installed else "unchanged"}
    _health_warnings(document, document["health"])
    if not found["root"].get("ok"):
        raise refused("root-invalid", str(found["root"].get("message")), identity=found["facts"], rootCheck=found["root"])


def inspect_project(args: Any, document: dict[str, Any], cwd: Path, spelled: Path) -> None:
    loaded = project.load(cwd, spelled, args.project)
    document["project"] = loaded.summary()
    document["files"] = [item.entry() for item in loaded.files]
    document["totalBytes"] = sum(item.size for item in loaded.files)
    document["tasks"] = [{"name": name, **task} for name, task in loaded.tasks.items()]
    document["services"] = [{"unit": unit, **service} for unit, service in loaded.services.items()]
    document["hardware"] = loaded.hardware
    document["requirements"] = loaded.requirements.path if loaded.requirements else None
    _line_end_warning(document, loaded)


def _line_end_warning(document: dict[str, Any], loaded: project.Project, only: list[str] | None = None) -> None:
    """Said when the project is inspected and when such a file is sent, not at every run."""
    converted = [item.path for item in loaded.files if item.unix_line_ends and (only is None or item.path in only)]
    if converted:
        document["warnings"].append({"code": "line-ends", "message": f"Scripts with a #! line and Windows line ends are deployed with Unix line ends, or they would not start: {', '.join(converted[:8])}."})


async def _deploy(session: ssh.Session, loaded: project.Project, document: dict[str, Any], lifecycle: Lifecycle, overwrite: list[str], dry: bool = False) -> dict[str, Any]:
    """Brings the board's copy up to date: sends only new and changed files and replaces them. A file edited on
    the board since VERA last applied it (a conflict) stays unless `overwrite` names it. Returns the state of the
    project's virtual environment."""
    entries = [item.entry() for item in loaded.files]
    planned = await session.call("plan", project={"name": loaded.name}, files=entries)
    plan = {step["path"]: step for step in planned["plan"]}
    conflicts = [path for path, step in plan.items() if step["action"] == "conflict"]
    unknown = [path for path in overwrite if path not in conflicts]
    if unknown:
        raise refused("usage", f"--overwrite names {unknown[0][:120]!r}, which was not edited on the board; edited there: {', '.join(conflicts) or 'none'}.")
    needed = [item for item in loaded.files if plan[item.path]["action"] in ("new", "changed") or item.path in overwrite]
    applied: list[str] = []
    mode_fixed: list[str] = []
    venv = planned["venv"]
    if not dry and (needed or any(step.get("modeDiffers") for step in plan.values())):
        lifecycle.report("acting", "pending")
        sent = {item.path for item in needed}
        deployed = await session.call(
            "deploy", b"".join(item.read() for item in needed), timeout=600, project={"name": loaded.name},
            files=[{**entry, "sent": entry["path"] in sent} for entry in entries], overwrite=list(overwrite),
        )
        lifecycle.physical = "confirmed"
        applied, mode_fixed, venv = deployed["applied"], deployed.get("modeFixed", []), deployed["venv"]
        plan = {step["path"]: step for step in deployed["plan"]}
        if deployed.get("stagingLeft"):
            document["warnings"].append({"code": "staging-left", "message": f"Staging entries could not be removed: {', '.join(deployed['stagingLeft'][:8])}."})
    left = [path for path, step in plan.items() if step["action"] == "conflict" and path not in applied]
    counts = {action: sum(1 for step in plan.values() if step["action"] == action) for action in ("new", "changed", "unchanged", "conflict")}
    document["deploy"] = {
        "remoteDir": planned["remoteDir"], "counts": counts, "applied": applied, "modeFixed": mode_fixed, "conflicts": left,
        "files": [{**entry, "action": plan[entry["path"]]["action"]} for entry in entries if plan[entry["path"]]["action"] != "unchanged"],
        "remoteOnly": planned["remoteOnly"],
    }
    if left:
        document["warnings"].append({"code": "conflict", "message": f"Edited on the board since VERA last applied them, and left as they are there: {', '.join(left[:8])}. `deploy --overwrite <path>` replaces one with this computer's copy; `fetch` brings the board's copy here first."})
    _line_end_warning(document, loaded, applied)
    return venv


async def _venv(session: ssh.Session, loaded: project.Project, venv: dict[str, Any], document: dict[str, Any], lifecycle: Lifecycle, folder: Path) -> None:
    """Creates the project's virtual environment and installs its requirements when they are new or changed."""
    wanted = loaded.requirements
    if wanted is None or (venv.get("exists") and venv.get("requirements") == wanted.sha256):
        return
    # --system-site-packages: on a Raspberry Pi the camera and GPIO libraries come from apt, not from pip.
    command = (
        "{ [ -x .venv/bin/python ] || python3 -m venv --system-site-packages .venv; } && "
        f".venv/bin/python -m pip install --disable-pip-version-check -r {shlex.quote(wanted.path)} && "
        f"printf %s {wanted.sha256} > .venv/.vera-requirements"
    )
    spec = {"name": "setup", "shell": command, "budgetS": SETUP_BUDGET_S, "outputLimitBytes": 4 * 1024 * 1024}
    status = await _supervise(session, document, lifecycle, folder, "setup", spec, loaded.name, {"actuates": False}, "setup-")
    if status.get("state") != "exited" or status.get("exitCode") != 0:
        raise Ended("fail", "setup-failed", f"Installing {wanted.path} into the project's virtual environment failed ({_ending(status, spec)}); the task was not started. The output is in setup.stderr and setup.stdout.")


async def compare(args: Any, document: dict[str, Any], lifecycle: Lifecycle, cwd: Path, spelled: Path) -> None:
    loaded = project.load(cwd, spelled, args.project)
    board = _board(args)
    _board_doc(document, board)
    document["project"] = loaded.summary()
    session = await _session(board, document, lifecycle)
    try:
        await _deploy(session, loaded, document, lifecycle, [], dry=True)
    finally:
        session.close()
    document["remote"] = {"state": "changed" if session.installed else "unchanged"}


async def deploy(args: Any, document: dict[str, Any], lifecycle: Lifecycle, folder: Path, cwd: Path, spelled: Path) -> None:
    loaded = project.load(cwd, spelled, args.project)
    board = _board(args)
    _board_doc(document, board)
    document["project"] = loaded.summary()
    session = await _session(board, document, lifecycle)
    try:
        venv = await _deploy(session, loaded, document, lifecycle, list(args.overwrite))
        document["remote"] = {"state": "changed" if document["deploy"]["applied"] or document["deploy"]["modeFixed"] else "unchanged"}
        await _venv(session, loaded, venv, document, lifecycle, folder)
    finally:
        session.close()


async def deploy_candidate(args: Any, document: dict[str, Any], lifecycle: Lifecycle, folder: Path, cwd: Path, spelled: Path) -> None:
    loaded = project.load(cwd, spelled, args.project)
    board = _board(args)
    _board_doc(document, board)
    document["project"] = loaded.summary()
    payload = b"".join(item.read() for item in loaded.files)
    entries = [item.entry() for item in loaded.files]
    session = await _session(board, document, lifecycle)
    try:
        lifecycle.report("acting", "pending")
        staged = await session.call("stage", payload, project={"name": loaded.name}, files=entries)
    finally:
        session.close()
    lifecycle.physical = "confirmed"
    plan = {item["path"]: item for item in staged["plan"]}
    files = [{**entry, "action": plan[entry["path"]]["action"], "base": plan[entry["path"]]["base"], "lastApplied": plan[entry["path"]]["lastApplied"]} for entry in entries]
    candidate = {
        "format": 1,
        "kind": CANDIDATE_KIND,
        "candidateId": staged["candidateId"],
        "createdAt": report.stamp(),
        "board": document["board"],
        "project": loaded.summary(),
        "remoteDir": staged["remoteDir"],
        "files": files,
        "remoteOnly": staged["remoteOnly"],
        "remoteOnlyTruncated": staged["remoteOnlyTruncated"],
    }
    report.write_json(folder / "candidate.json", candidate)
    counts = {action: sum(1 for item in files if item["action"] == action) for action in ("new", "changed", "unchanged", "conflict")}
    document["candidate"] = {"path": workspace.relative(cwd, folder / "candidate.json"), "candidateId": staged["candidateId"], "remoteDir": staged["remoteDir"], "counts": counts, "files": files, "remoteOnly": staged["remoteOnly"], "pruned": staged.get("prunedCandidates", [])}
    document["remote"] = {"state": "changed", "note": "Files are staged below the remote root's .vera-pi folder; no project file was changed."}
    if counts["conflict"]:
        document["warnings"].append({"code": "conflict", "message": f"{counts['conflict']} file(s) changed on the board since VERA last applied them; apply-candidate leaves them unless named with --overwrite."})


def _candidate(cwd: Path, spelled: Path, raw: str, board: registry.Board) -> tuple[dict[str, Any], Path]:
    try:
        path = workspace.regular_file(cwd, raw, "--candidate", spelled)
        document = json.loads(path.read_text(encoding="utf-8"))
    except workspace.PathRefused as error:
        raise refused("path", str(error)) from error
    except (OSError, ValueError) as error:
        raise refused("candidate-invalid", f"{raw[:120]} is not a readable candidate.json.") from error
    if not isinstance(document, dict) or document.get("format") != 1 or document.get("kind") != CANDIDATE_KIND:
        raise refused("candidate-invalid", f"{raw[:120]} is not a {CANDIDATE_KIND} document.")
    shown = document.get("board") or {}
    if any(shown.get(key) != board.summary()[key] for key in ("alias", "host", "port", "user", "root")):
        raise refused("candidate-invalid", f"The candidate was staged for {shown.get('alias')} ({shown.get('user')}@{shown.get('host')}:{shown.get('port')} {shown.get('root')}), not for this board entry.")
    files = document.get("files")
    if not isinstance(files, list) or not files or not isinstance(document.get("candidateId"), str) or not isinstance(document.get("project"), dict):
        raise refused("candidate-invalid", "The candidate lacks its id, project or files.")
    for item in files:
        if not isinstance(item, dict):
            raise refused("candidate-invalid", "A candidate file must be an object.")
        project.check_path(item.get("path"), "A candidate file")
    return document, path


async def apply_candidate(args: Any, document: dict[str, Any], lifecycle: Lifecycle, cwd: Path, spelled: Path) -> None:
    board = _board(args)
    _board_doc(document, board)
    candidate, candidate_path = _candidate(cwd, spelled, args.candidate, board)
    document["project"] = candidate["project"]
    files = candidate["files"]
    conflicts = {item["path"] for item in files if item.get("action") == "conflict"}
    unknown = [path for path in args.overwrite if path not in conflicts]
    if unknown:
        raise refused("candidate-invalid", f"--overwrite names {unknown[0][:120]!r}, which is not a conflict of this candidate.")
    session = await _session(board, document, lifecycle)
    try:
        lifecycle.report("acting", "pending")
        applied = await session.call(
            "apply",
            project={"name": candidate["project"].get("name")},
            candidateId=candidate["candidateId"],
            files=[{key: item.get(key) for key in ("path", "size", "sha256", "mode")} for item in files],
            plan=[{"path": item["path"], "action": item.get("action"), "base": item.get("base")} for item in files],
            overwrite=list(args.overwrite),
        )
    finally:
        session.close()
    lifecycle.physical = "confirmed"
    document["candidate"] = {"path": workspace.relative(cwd, candidate_path), "candidateId": candidate["candidateId"]}
    document["applied"] = applied
    document["remote"] = {"state": "changed" if applied["applied"] else "unchanged"}
    if applied.get("stagingLeft"):
        document["warnings"].append({"code": "staging-left", "message": f"Staging entries could not be removed: {', '.join(applied['stagingLeft'][:8])}."})


def _task_doc(spec: dict[str, Any], declared: dict[str, Any], status: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": spec["name"],
        "handle": status.get("handle"),
        "pid": status.get("pid"),
        **({"command": spec["shell"]} if "shell" in spec else {"argv": spec["argv"]}),
        "budgetS": spec["budgetS"],
        "outputLimitBytes": spec["outputLimitBytes"],
        "actuates": declared.get("actuates", False),
        "state": status.get("state"),
        "exitCode": status.get("exitCode"),
        "signal": status.get("signal"),
        "durationS": status.get("durationS"),
        "bootId": status.get("bootId"),
    }


async def _logs(session: ssh.Session, handle: str, folder: Path, prefix: str, limit: int) -> dict[str, Any]:
    logs = await session.call("task-logs", handle=handle, maxBytes=limit)
    for stream in ("stdout", "stderr"):
        (folder / f"{prefix}{stream}.log").write_text(logs[stream]["text"], encoding="utf-8", newline="")
    return logs


def _shown(log: dict[str, Any], file: str) -> str:
    """What the result prints of a log: all of a short one, else its beginning and its end."""
    text = log["text"]
    if not log["truncated"] and len(text) <= SHOWN_CHARS:
        return text
    head = (log.get("head") or text)[:1200]
    return f"{head}\n[... {log['bytes']} bytes in all; the last 64 KiB are in {file} ...]\n{text[-2500:]}"


def _live(output: dict[str, Any] | None, offsets: dict[str, int]) -> bool:
    """Passes on what the task wrote since the last look (to stderr: stdout carries the one result document)."""
    wrote = False
    for stream in ("stdout", "stderr"):
        part = (output or {}).get(stream) or {}
        offsets[stream] = int(part.get("next", offsets[stream]))
        if part.get("text"):
            sys.stderr.buffer.write(part["text"].encode("utf-8", "replace"))
            wrote = True
    if wrote:
        sys.stderr.buffer.flush()
    return wrote


def _ending(status: dict[str, Any], spec: dict[str, Any]) -> str:
    state = status.get("state")
    detail = {
        "exited": f"exited with code {status.get('exitCode')}" if status.get("exitCode") is not None else f"ended by signal {status.get('signal')}",
        "budget-exceeded": f"exceeded its budget of {spec['budgetS']} s and was ended",
        "output-limit": f"exceeded its output limit of {spec['outputLimitBytes']} bytes and was ended",
        "stopped": "was stopped",
        "start-failed": f"could not start: {status.get('error')}",
    }
    return detail.get(str(state), str(state))


async def _supervise(session: ssh.Session, document: dict[str, Any], lifecycle: Lifecycle, folder: Path, key: str, spec: dict[str, Any], project_name: str | None, declared: dict[str, Any], prefix: str = "") -> dict[str, Any]:
    """Starts `spec` (a declared argv or a shell command) under the board's supervisor, passes its output on while
    it runs and waits for its end; VERA's Stop ends it and confirms that. Returns the final status."""
    status: dict[str, Any] = {}
    offsets = {"stdout": 0, "stderr": 0}
    try:
        lifecycle.report("acting", "pending")
        document["remote"] = {"state": "unknown"}
        status = await session.call("task-start", **({"project": {"name": project_name}} if project_name else {}), task=spec, runId=document.get("runId"))
        handle = str(status["handle"])
        lifecycle.physical = "unknown"
        document[key] = _task_doc(spec, declared, status)
        document["remote"] = {"state": "running"}
        deadline = time.monotonic() + spec["budgetS"] + 30
        while status.get("state") not in FINAL:
            # A lost supervisor no longer enforces the budget on the board: VERA ends the owned group itself.
            lost = bool(status.get("supervisorLost"))
            if lost or lifecycle.stop_requested() or time.monotonic() > deadline:
                stopped = await session.call("task-stop", handle=handle, timeout=30)
                document[key] = _task_doc(spec, declared, {"handle": handle, **stopped})
                document[key]["stdout"], document[key]["stderr"] = {}, {}
                confirmed = bool(stopped.get("confirmed"))
                lifecycle.physical = "confirmed" if confirmed else "unknown"
                document["remote"] = {"state": "confirmed" if confirmed else "unknown"}
                try:
                    logs = await _logs(session, handle, folder, prefix, LOG_BYTES)
                    for stream in ("stdout", "stderr"):
                        document[key][stream] = {"bytes": logs[stream]["bytes"], "file": f"{prefix}{stream}.log", "truncated": logs[stream]["truncated"], "text": _shown(logs[stream], f"{prefix}{stream}.log")}
                except (report.Refused, Ended):
                    pass
                why = "the task's supervisor on the board ended" if lost else "VERA requested a stop" if lifecycle.stopped else "the local deadline passed"
                raise Ended("incomplete", "supervisor-lost" if lost else "stopped", f"{why}; the task {'was stopped and no process of it runs' if confirmed else 'could not be confirmed stopped'} on the board.")
            status = await session.call("task-wait", handle=handle, waitS=1, offsets=offsets, timeout=30)
            _live(status.pop("output", None), offsets)
            document[key] = _task_doc(spec, declared, {"handle": handle, **status})
        for _ in range(64):
            rest = await session.call("task-wait", handle=handle, waitS=0, offsets=offsets, timeout=30)
            if not _live(rest.get("output"), offsets):
                break
        logs = await _logs(session, handle, folder, prefix, LOG_BYTES)
    except Ended as end:
        if end.problem["code"] in ("connection-lost", "timeout"):
            lifecycle.physical = "unknown"
            document["remote"] = {"state": "unknown", "note": "The task may still run on the board under its supervisor and budget; VERA's cleanup (stop-owned) or task-status settles it."}
        raise
    for stream in ("stdout", "stderr"):
        document[key][stream] = {"bytes": logs[stream]["bytes"], "file": f"{prefix}{stream}.log", "truncated": logs[stream]["truncated"], "text": _shown(logs[stream], f"{prefix}{stream}.log")}
    lifecycle.physical = "confirmed"
    document["remote"] = {"state": "confirmed"}
    return status


def _verdict(label: str, status: dict[str, Any], spec: dict[str, Any]) -> None:
    state = status.get("state")
    if state == "exited" and status.get("exitCode") == 0:
        return
    if state in ("supervisor-lost", "lost-by-reboot"):
        raise Ended("incomplete", str(state), f"The outcome of {label} is unknown: {status.get('note', state)}")
    raise Ended("fail", "task-failed", f"{label} {_ending(status, spec)}.")


async def run_task(args: Any, document: dict[str, Any], lifecycle: Lifecycle, folder: Path, cwd: Path, spelled: Path) -> None:
    loaded = project.load(cwd, spelled, args.project)
    task = loaded.tasks.get(args.task)
    if task is None:
        raise refused("task-unknown", f"The project declares no task {args.task!r}; it declares {', '.join(loaded.tasks) or 'none'}.")
    if args.arg and not task["extraArgs"]:
        raise refused("usage", f"Task {args.task} takes no --arg; declare extraArgs: true in vera-pi.json to allow arguments.")
    if len(args.arg) > 16 or any(not value or len(value) > 1024 or "\x00" in value for value in args.arg):
        raise refused("usage", "--arg takes at most 16 values of 1 to 1024 characters.")
    spec = {"name": args.task, "argv": [*task["argv"], *args.arg], "budgetS": task["budgetS"], "outputLimitBytes": task["outputLimitBytes"]}
    board = _board(args)
    _board_doc(document, board)
    document["project"] = loaded.summary()
    document["hardware"] = loaded.hardware
    session = await _session(board, document, lifecycle)
    try:
        # The task runs what this computer holds: changed files go to the board first.
        venv = await _deploy(session, loaded, document, lifecycle, [])
        await _venv(session, loaded, venv, document, lifecycle, folder)
        status = await _supervise(session, document, lifecycle, folder, "task", spec, loaded.name, task)
    finally:
        session.close()
    _verdict(f"The task {args.task}", status, spec)


async def exec_command(args: Any, document: dict[str, Any], lifecycle: Lifecycle, folder: Path, cwd: Path, spelled: Path) -> None:
    """One command line on the board, in a shell: in the project's folder with its virtual environment when
    --project is given, else in the home folder."""
    if not 1 <= args.budget <= project.BUDGET_S:
        raise refused("usage", f"--budget is 1 to {project.BUDGET_S} seconds.")
    if not args.command.strip() or len(args.command) > 8192 or "\x00" in args.command:
        raise refused("usage", "--command is a command line of 1 to 8192 characters.")
    loaded = project.load(cwd, spelled, args.project) if args.project else None
    board = _board(args)
    _board_doc(document, board)
    if loaded is not None:
        document["project"] = loaded.summary()
    spec = {"name": "exec", "shell": args.command, "budgetS": args.budget, "outputLimitBytes": 4 * 1024 * 1024}
    session = await _session(board, document, lifecycle)
    try:
        status = await _supervise(session, document, lifecycle, folder, "task", spec, loaded.name if loaded else None, {"actuates": False})
    finally:
        session.close()
    _verdict("The command", status, spec)


async def fetch(args: Any, document: dict[str, Any], lifecycle: Lifecycle, folder: Path, cwd: Path, spelled: Path) -> None:
    """Copies one file of the board into the run folder."""
    loaded = project.load(cwd, spelled, args.project) if args.project else None
    board = _board(args)
    _board_doc(document, board)
    session = await _session(board, document, lifecycle)
    try:
        found = await session.call("read-file", path=args.path, timeout=300, **({"project": {"name": loaded.name}} if loaded else {}))
    finally:
        session.close()
    data = base64.b64decode(found["data"])
    name = re.sub(r"[^A-Za-z0-9._-]", "_", found["path"].rsplit("/", 1)[-1])[:100] or "file"
    if name in ("result.json", "report.md") or workspace.is_device(name):
        name = f"fetched-{name}"
    (folder / name).write_bytes(data)
    document["file"] = {"remote": found["path"], "path": workspace.relative(cwd, folder / name), "size": found["size"], "sha256": found["sha256"]}
    try:
        document["file"]["preview"] = data[:8192].decode("utf-8")[:2000] if b"\x00" not in data[:8192] else None
    except UnicodeDecodeError:
        document["file"]["preview"] = None
    document["remote"] = {"state": "changed" if session.installed else "unchanged"}


async def task_status(args: Any, document: dict[str, Any], lifecycle: Lifecycle) -> None:
    if not HANDLE.fullmatch(args.handle):
        raise refused("usage", "--handle is the 16 hex characters run-task reported.")
    board = _board(args)
    _board_doc(document, board)
    session = await _session(board, document, lifecycle)
    try:
        status = await session.call("task-status", handle=args.handle)
    finally:
        session.close()
    request = status.pop("request", None) or {}
    document["task"] = {"handle": args.handle, "name": request.get("name"), "project": request.get("project"), "pid": status.get("pid"), "state": status.get("state"), "exitCode": status.get("exitCode"), "signal": status.get("signal"), "durationS": status.get("durationS"), "supervisorLost": status.get("supervisorLost", False), "note": status.get("note")}
    document["remote"] = {"state": "running" if status.get("state") in ("running", "starting") else "confirmed"}


async def stop_owned(args: Any, document: dict[str, Any], lifecycle: Lifecycle) -> None:
    board = _board(args)
    _board_doc(document, board)
    if lifecycle.unknown(args.board):
        document["warnings"].append({"code": "resource-unknown", "message": "VERA recorded this board's state as unknown after an earlier run; stop-owned settles it."})
    # The cleanup after a lost connection: the board may need a moment to be reachable again.
    for attempt in range(4):
        try:
            session = await _session(board, document, lifecycle)
            break
        except report.Refused as refusal:
            if attempt == 3 or refusal.problems[0]["code"] not in ("unreachable", "timeout"):
                raise
            document["warnings"].append({"code": "retry", "message": f"{board.alias} was not reachable; trying again in 3 s."})
            await asyncio.sleep(3)
    try:
        lifecycle.report("acting", "pending")
        stopped = await session.call("stop-owned", timeout=60)
    finally:
        session.close()
    document["tasks"] = stopped["tasks"]
    if stopped["confirmed"]:
        lifecycle.physical = "confirmed"
        document["remote"] = {"state": "confirmed"}
        return
    lifecycle.physical = "unknown"
    document["remote"] = {"state": "unknown"}
    raise Ended("incomplete", "stop-unconfirmed", "A VERA task on the board could not be confirmed stopped; its state is unknown.")


def _service_doc(unit: str, declared: dict[str, Any], reply: dict[str, Any]) -> dict[str, Any]:
    values = reply.get("properties") or {}
    pid = values.get("MainPID")
    return {
        "unit": unit,
        "loadState": values.get("LoadState"),
        "activeState": values.get("ActiveState"),
        "subState": values.get("SubState"),
        "mainPid": int(pid) if isinstance(pid, str) and pid.isdigit() and pid != "0" else None,
        "unitFileState": values.get("UnitFileState") or None,
        "result": values.get("Result"),
        "file": declared["file"],
        "keepRunning": declared["keepRunning"],
        "actuates": declared["actuates"],
    }


async def service(args: Any, document: dict[str, Any], lifecycle: Lifecycle, folder: Path | None, cwd: Path, spelled: Path, action: str) -> None:
    loaded = project.load(cwd, spelled, args.project)
    declared = loaded.services.get(args.service)
    if declared is None:
        raise refused("service-not-allowed", f"{args.service[:120]!r} is not a user service the project lists; listed: {', '.join(loaded.services) or 'none'}. Add it to services in vera-pi.json.")
    board = _board(args)
    _board_doc(document, board)
    document["project"] = loaded.summary()
    allowed = list(loaded.services)
    session = await _session(board, document, lifecycle)

    def exited(reply: dict[str, Any]) -> bool:
        """A oneshot unit that ran and ended well is not active afterwards."""
        values = reply.get("properties") or {}
        return action == "start" and (reply.get("command") or {}).get("exit") == 0 and values.get("ActiveState") == "inactive" and values.get("Result") == "success"

    try:
        if action == "start" and folder is not None:
            # The service runs what this computer holds, its unit file included.
            venv = await _deploy(session, loaded, document, lifecycle, [])
            await _venv(session, loaded, venv, document, lifecycle, folder)
        if action != "status":
            lifecycle.report("acting", "pending")
        fields = {"unit": args.service, "allowed": allowed, "project": {"name": loaded.name}, "keepRunning": declared["keepRunning"], **({"unitFile": declared["file"]} if declared["file"] else {})}
        reply = await session.call("service", action=action, timeout=120, **fields)
        if action != "status":
            lifecycle.physical = "unknown"
        wanted = {"start": ("active",), "stop": ("inactive", "failed")}.get(action)
        end = time.monotonic() + 10
        while wanted and time.monotonic() < end:
            values = reply.get("properties") or {}
            if values.get("ActiveState") in wanted + ("failed",) or values.get("LoadState") == "not-found" or exited(reply):
                break
            await asyncio.sleep(0.3)
            reply = {**reply, **{key: value for key, value in (await session.call("service", action="status", **fields)).items() if key in ("properties", "showExit", "stderr")}}
    finally:
        session.close()
    document["service"] = _service_doc(args.service, declared, reply)
    if reply.get("command"):
        document["service"]["command"] = reply["command"]
    state = document["service"]["activeState"]
    lifecycle.physical = "confirmed" if action != "status" else "unchanged"
    document["remote"] = {"state": "unchanged" if action == "status" else "changed"}
    document["service"]["linger"] = reply.get("linger")
    document["service"]["installed"] = reply.get("installed")
    if document["service"]["loadState"] is None:
        raise Ended("fail", "service-failed", f"The board's systemd user manager did not answer (systemctl --user exit {reply.get('showExit')}): {str(reply.get('stderr') or '').strip()[-300:]}")
    if action == "start" and declared["keepRunning"] and state == "active":
        if reply.get("linger"):
            document["warnings"].append({"code": "keeps-running", "message": f"{args.service} is declared to stay running after this run; Stop does not end it. Use service-stop."})
        else:
            document["warnings"].append({"code": "no-linger", "message": f"{args.service} is declared to stay running, but lingering could not be turned on for {board.user}: systemd stops the user's services shortly after VERA's SSH session ends. Turn it on with exec: `sudo loginctl enable-linger {board.user}`."})
    if document["service"]["loadState"] == "not-found":
        hint = "" if declared["file"] else ' Name its unit file in vera-pi.json (services: {"<unit>": {"file": "<unit file of the project>"}}) and VERA installs it.'
        raise Ended("fail", "service-failed", f"{args.service} is not installed as a user unit on the board.{hint}")
    if action == "start" and exited(reply):
        document["warnings"].append({"code": "exited", "message": f"{args.service} ran and ended with success (a oneshot unit); it is not active now."})
    elif action == "start" and state != "active":
        raise Ended("fail", "service-failed", f"{args.service} did not become active (state {state}, result {document['service']['result']}); collect-logs shows why.")
    if action == "stop" and state not in ("inactive", "failed"):
        lifecycle.physical = "unknown"
        raise Ended("incomplete", "service-failed", f"{args.service} is still {state} after the stop request.")


async def collect_logs(args: Any, document: dict[str, Any], lifecycle: Lifecycle, folder: Path, cwd: Path, spelled: Path) -> None:
    loaded = project.load(cwd, spelled, args.project)
    if not 1 <= args.lines <= 2000:
        raise refused("usage", "--lines is 1 to 2000.")
    for unit in args.service:
        if unit not in loaded.services:
            raise refused("service-not-allowed", f"{unit[:120]!r} is not a user service the project lists.")
    for handle in args.handle:
        if not HANDLE.fullmatch(handle):
            raise refused("usage", "--handle is the 16 hex characters run-task reported.")
    if not args.service and not args.handle:
        raise refused("usage", "Name at least one --service or --handle.")
    board = _board(args)
    _board_doc(document, board)
    document["project"] = loaded.summary()
    logs: list[dict[str, Any]] = []
    session = await _session(board, document, lifecycle)
    try:
        for unit in args.service:
            journal = await session.call("journal", unit=unit, lines=args.lines, allowed=list(loaded.services))
            name = f"journal-{unit}.jsonl"
            with (folder / name).open("w", encoding="utf-8", newline="\n") as handle_file:
                for entry in journal["entries"]:
                    handle_file.write(json.dumps(entry, ensure_ascii=False) + "\n")
            logs.append({"kind": "service", "unit": unit, "file": name, "entries": len(journal["entries"])})
            if not journal["entries"]:
                detail = str(journal.get("stderr") or "").strip()[-200:]
                document["warnings"].append({"code": "journal-empty", "message": f"The journal holds no line of {unit} that {board.user} may read{': ' + detail if detail else ''}. Raspberry Pi OS keeps the journal in memory: the user reads it as a member of the adm or systemd-journal group, and it is empty after a reboot."})
        for handle in args.handle:
            got = await _logs(session, handle, folder, f"task-{handle}-", 1024 * 1024)
            logs.append({"kind": "task", "handle": handle, "files": [f"task-{handle}-stdout.log", f"task-{handle}-stderr.log"], "bytes": {s: got[s]["bytes"] for s in ("stdout", "stderr")}, "truncated": any(got[s]["truncated"] for s in ("stdout", "stderr"))})
    finally:
        session.close()
    document["logs"] = logs
    document["remote"] = {"state": "unchanged"}


def report_runs(args: Any, document: dict[str, Any], cwd: Path, spelled: Path) -> list[dict[str, Any]]:
    runs = []
    for raw in args.run:
        try:
            folder = workspace.confined(cwd, raw, "--run", spelled)
        except workspace.PathRefused as error:
            raise refused("path", str(error)) from error
        runs.append(report.summary(cwd, folder))
    document["runs"] = runs
    statuses = {item["status"] for item in runs}
    document["counts"] = {status: sum(1 for item in runs if item["status"] == status) for status in sorted(statuses)}
    return runs
