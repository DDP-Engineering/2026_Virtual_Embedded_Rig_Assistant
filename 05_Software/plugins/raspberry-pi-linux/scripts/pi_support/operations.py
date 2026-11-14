"""pi-tool operations (spec REQ-DATA-44547a17 sections 2-6).

Every board operation connects with a pinned host key and an agent key, then asks the installed remote helper for
finite operations. Refusals that come before anything changed on the board are `blocked`; once the board was changed
the result says what is known about its state (`remote.state`), and an unconfirmed state is `unknown`, never success.
"""

from __future__ import annotations

import asyncio
import json
import re
import time
from pathlib import Path
from typing import Any

from . import ASYNCSSH, CANDIDATE_KIND, TOOL, VERSION, project, registry, remote, report, ssh, workspace
from .lifecycle import Lifecycle
from .report import Ended, refused

HANDLE = re.compile(r"[0-9a-f]{16}")
FINAL = ("exited", "budget-exceeded", "output-limit", "stopped", "start-failed", "supervisor-lost", "lost-by-reboot")
LOG_BYTES = 64 * 1024
MATRIX = {
    "boards": "Raspberry Pi running Raspberry Pi OS 12 (Bookworm) 64-bit, one board identified by serial or machine id",
    "user": "an unprivileged login user with a systemd user manager; never root, never sudo",
    "host": "VERA on Windows x64 or Linux x64 connects to the board; VERA itself does not run on the board",
    "excluded": ["raw GPIO, I2C or SPI access", "OS provisioning", "firmware or bootloader changes", "reboot or shutdown", "system services"],
}


def _board(args: Any) -> registry.Board:
    return registry.load().board(args.board)


def _board_doc(document: dict[str, Any], board: registry.Board, host_key: dict[str, Any] | None = None) -> None:
    document["board"] = board.summary(host_key.get("fingerprint") if host_key else None)


async def _session(board: registry.Board, document: dict[str, Any], lifecycle: Lifecycle) -> ssh.Session:
    session = await ssh.connect(board)
    _board_doc(document, board, session.host_key)
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
                "capabilities", "check-host-key", "install-helper", "identify", "inspect-project", "deploy-candidate", "apply-candidate",
                "run-task", "task-status", "stop-owned", "service-status", "service-start", "service-stop", "collect-logs", "report",
            ],
            "limits": {"files": project.FILES, "fileBytes": project.FILE_BYTES, "totalBytes": project.TOTAL_BYTES, "budgetS": project.BUDGET_S, "logLines": 2000},
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
    if not presented["pinned"]:
        raise ssh._host_key_refusal(board, presented)


async def install_helper(args: Any, document: dict[str, Any], lifecycle: Lifecycle) -> None:
    board = _board(args)
    _board_doc(document, board)
    session = await _session(board, document, lifecycle)
    try:
        lifecycle.report("acting", "pending")
        installed = await session.install()
        lifecycle.physical = "confirmed"
        _, digest = remote.helper()
        document["helper"] = {"version": remote.HELPER_VERSION, "sha256": digest, **installed}
        document["remote"] = {"state": "changed" if installed.get("state") != "already-installed" else "unchanged"}
        found = await session.call("identify")
        document["identity"] = found["facts"]
        document["rootCheck"] = found["root"]
    finally:
        session.close()


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
    document["helper"] = {"version": remote.HELPER_VERSION, "sha256": digest}
    document["rootCheck"] = found["root"]
    document["remote"] = {"state": "unchanged"}
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


async def deploy_candidate(args: Any, document: dict[str, Any], lifecycle: Lifecycle, folder: Path, cwd: Path, spelled: Path) -> None:
    loaded = project.load(cwd, spelled, args.project)
    board = _board(args)
    _board_doc(document, board)
    document["project"] = loaded.summary()
    payload = b"".join(item.absolute.read_bytes() for item in loaded.files)
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
    if any(shown.get(key) != value for key, value in (("alias", board.alias), ("host", board.host), ("port", board.port), ("user", board.user), ("root", board.root))):
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


def _task_doc(name: str, task: dict[str, Any], status: dict[str, Any], argv: list[str]) -> dict[str, Any]:
    return {
        "name": name,
        "handle": status.get("handle"),
        "pid": status.get("pid"),
        "argv": argv,
        "budgetS": task["budgetS"],
        "outputLimitBytes": task["outputLimitBytes"],
        "actuates": task["actuates"],
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


async def run_task(args: Any, document: dict[str, Any], lifecycle: Lifecycle, folder: Path, cwd: Path, spelled: Path) -> None:
    loaded = project.load(cwd, spelled, args.project)
    task = loaded.tasks.get(args.task)
    if task is None:
        raise refused("task-unknown", f"The project declares no task {args.task!r}; it declares {', '.join(loaded.tasks) or 'none'}.")
    if args.arg and not task["extraArgs"]:
        raise refused("usage", f"Task {args.task} takes no --arg; declare extraArgs: true in vera-pi.json to allow arguments.")
    if len(args.arg) > 16 or any(not value or len(value) > 1024 or "\x00" in value for value in args.arg):
        raise refused("usage", "--arg takes at most 16 values of 1 to 1024 characters.")
    argv = [*task["argv"], *args.arg]
    board = _board(args)
    _board_doc(document, board)
    document["project"] = loaded.summary()
    document["hardware"] = loaded.hardware
    session = await _session(board, document, lifecycle)
    status: dict[str, Any] = {}
    try:
        lifecycle.report("acting", "pending")
        document["remote"] = {"state": "unknown"}
        status = await session.call("task-start", project={"name": loaded.name}, task={"name": args.task, "argv": argv, "budgetS": task["budgetS"], "outputLimitBytes": task["outputLimitBytes"]}, runId=document.get("runId"))
        handle = str(status["handle"])
        lifecycle.physical = "unknown"
        document["task"] = _task_doc(args.task, task, status, argv)
        document["remote"] = {"state": "running"}
        deadline = time.monotonic() + task["budgetS"] + 30
        while status.get("state") not in FINAL:
            # A lost supervisor no longer enforces the budget on the board: VERA ends the owned group itself.
            lost = bool(status.get("supervisorLost"))
            if lost or lifecycle.stop_requested() or time.monotonic() > deadline:
                stopped = await session.call("task-stop", handle=handle, timeout=30)
                document["task"] = _task_doc(args.task, task, {"handle": handle, **stopped}, argv)
                document["task"]["stdout"], document["task"]["stderr"] = {}, {}
                confirmed = bool(stopped.get("confirmed"))
                lifecycle.physical = "confirmed" if confirmed else "unknown"
                document["remote"] = {"state": "confirmed" if confirmed else "unknown"}
                try:
                    await _logs(session, handle, folder, "", LOG_BYTES)
                except (report.Refused, Ended):
                    pass
                why = "the task's supervisor on the board ended" if lost else "VERA requested a stop" if lifecycle.stopped else "the local deadline passed"
                raise Ended("incomplete", "supervisor-lost" if lost else "stopped", f"{why}; the task {'was stopped and no process of it runs' if confirmed else 'could not be confirmed stopped'} on the board.")
            status = await session.call("task-wait", handle=handle, waitS=1, timeout=30)
            document["task"] = _task_doc(args.task, task, {"handle": handle, **status}, argv)
        logs = await _logs(session, handle, folder, "", LOG_BYTES)
    except Ended as end:
        if end.problem["code"] in ("connection-lost", "timeout"):
            lifecycle.physical = "unknown"
            document["remote"] = {"state": "unknown", "note": "The task may still run on the board under its supervisor and budget; VERA's cleanup (stop-owned) or task-status settles it."}
        raise
    finally:
        session.close()
    state = status.get("state")
    document["task"]["stdout"] = {"bytes": logs["stdout"]["bytes"], "file": "stdout.log", "truncated": logs["stdout"]["truncated"], "text": logs["stdout"]["text"][-2000:]}
    document["task"]["stderr"] = {"bytes": logs["stderr"]["bytes"], "file": "stderr.log", "truncated": logs["stderr"]["truncated"], "text": logs["stderr"]["text"][-2000:]}
    lifecycle.physical = "confirmed"
    document["remote"] = {"state": "confirmed"}
    if state == "exited" and status.get("exitCode") == 0:
        return
    if state in ("supervisor-lost", "lost-by-reboot"):
        raise Ended("incomplete", state, f"The task's outcome is unknown: {status.get('note', state)}")
    if state == "start-failed":
        raise Ended("fail", "task-failed", f"The task could not start on the board: {status.get('error')}")
    detail = {"exited": f"exited with code {status.get('exitCode')}" if status.get("exitCode") is not None else f"ended by signal {status.get('signal')}", "budget-exceeded": f"exceeded its budget of {task['budgetS']} s and was ended", "output-limit": f"exceeded its output limit of {task['outputLimitBytes']} bytes and was ended", "stopped": "was stopped"}
    raise Ended("fail", "task-failed", f"The task {args.task} {detail.get(str(state), state)}.")


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
        "keepRunning": declared["keepRunning"],
        "actuates": declared["actuates"],
    }


async def service(args: Any, document: dict[str, Any], lifecycle: Lifecycle, cwd: Path, spelled: Path, action: str) -> None:
    loaded = project.load(cwd, spelled, args.project)
    declared = loaded.services.get(args.service)
    if declared is None:
        raise refused("service-not-allowed", f"{args.service[:120]!r} is not a user service the project lists; listed: {', '.join(loaded.services) or 'none'}. System services and sudo are never used.")
    board = _board(args)
    _board_doc(document, board)
    document["project"] = loaded.summary()
    allowed = list(loaded.services)
    session = await _session(board, document, lifecycle)
    try:
        if action != "status":
            lifecycle.report("acting", "pending")
        reply = await session.call("service", unit=args.service, action=action, allowed=allowed, timeout=90)
        if action != "status":
            lifecycle.physical = "unknown"
        wanted = {"start": ("active",), "stop": ("inactive", "failed")}.get(action)
        end = time.monotonic() + 10
        while wanted and (reply.get("properties") or {}).get("ActiveState") not in wanted + ("failed",) and time.monotonic() < end:
            await asyncio.sleep(0.3)
            reply = await session.call("service", unit=args.service, action="status", allowed=allowed)
    finally:
        session.close()
    document["service"] = _service_doc(args.service, declared, reply)
    if reply.get("command"):
        document["service"]["command"] = reply["command"]
    state = document["service"]["activeState"]
    lifecycle.physical = "confirmed" if action != "status" else "unchanged"
    document["remote"] = {"state": "unchanged" if action == "status" else "changed"}
    document["service"]["linger"] = reply.get("linger")
    if action == "start" and declared["keepRunning"] and state == "active":
        if reply.get("linger"):
            document["warnings"].append({"code": "keeps-running", "message": f"{args.service} is declared to stay running after this run; Stop does not end it. Use service-stop."})
        else:
            document["warnings"].append({"code": "no-linger", "message": f"{args.service} is declared to stay running, but lingering is off for {board.user}: systemd stops the user's services shortly after VERA's SSH session ends. The user enables it on the board with `loginctl enable-linger {board.user}`; VERA never changes it."})
    if document["service"]["loadState"] == "not-found":
        raise Ended("fail", "service-failed", f"{args.service} is not installed as a user unit on the board.")
    if action == "start" and state != "active":
        raise Ended("fail", "service-failed", f"{args.service} did not become active (state {state}, result {document['service']['result']}).")
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
