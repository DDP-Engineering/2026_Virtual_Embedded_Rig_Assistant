"""run-scenario: one wokwi-cli run of a verified job (spec REQ-DATA-d985bb3d section 6).

Order: job checks (REQ-SEC-450de6ab), account (REQ-SEC-fa87b102), CLI version, then the stdin token, then the run
folder with result.json `incomplete/running`, then wokwi-cli on the job's send/ folder (REQ-SEC-11ca382d) with the
token only in its environment (REQ-SEC-3ab66bb9). A watch loop bounds real time and output and forwards a stop
(REQ-REL-fb090330, REQ-REL-88c06ac8, REQ-REL-6d7d4558); the run is never repeated (REQ-REL-01c5b557).
"""

from __future__ import annotations

import os
import signal
import subprocess
import threading
import time
from pathlib import Path
from typing import IO, Any

from . import CLI_SHA, CLI_VERSION, ENDPOINT, FORMAT, NOTE, RUN_KIND, TOOL, VERSION, credential, diagram, engine, job as jobs, workspace
from .collect import finish
from .redact import Redactor, scrub_file
from .report import check_run_id, new_run_id, refused, run_folder, stamp, write_json

SERIAL_LIMIT = 16 * 1024 * 1024
STREAM_LIMIT = 4 * 1024 * 1024
POLL_S = 0.2
STOP_GRACE_S = 5.0
TIMEOUT_EXIT = 42
WINDOWS = os.name == "nt"


class Stop:
    requested = False


STOP = Stop()


def _on_signal(_signum: int, _frame: Any) -> None:
    STOP.requested = True


def install_signals() -> None:
    """SIGTERM (VERA's Stop on Linux), SIGINT and, on Windows, SIGBREAK end the run at the next watch step."""
    for name in ("SIGTERM", "SIGINT", "SIGBREAK"):
        number = getattr(signal, name, None)
        if number is not None:
            try:
                signal.signal(number, _on_signal)
            except (OSError, ValueError):
                pass


class Capture(threading.Thread):
    """Copies one output pipe of wokwi-cli into a file through the redactor, up to `limit` bytes; drains the rest."""

    def __init__(self, pipe: IO[bytes], path: Path, secret: str, limit: int) -> None:
        super().__init__(daemon=True)
        self.pipe, self.path, self.limit = pipe, path, limit
        self.redactor = Redactor(secret)
        self.total = 0
        self.exceeded = False

    def run(self) -> None:
        with self.path.open("wb") as out:
            while True:
                try:
                    chunk = os.read(self.pipe.fileno(), 65536)
                except OSError:
                    break
                if not chunk:
                    break
                room = self.limit - self.total
                self.total += len(chunk)
                if room > 0:
                    out.write(self.redactor.feed(chunk[:room]))
                if self.total > self.limit and not self.exceeded:
                    # The held-back tail may be the start of the token: it is dropped, never written.
                    self.exceeded = True
                    out.write(b"\n[output limit reached; the rest was discarded]\n")
                out.flush()
            if not self.exceeded:
                out.write(self.redactor.flush())


def argv(cli: str, job: dict[str, Any], folder: Path) -> list[str]:
    """The one wokwi-cli command line of a job; the token is never in it."""
    limits, assertions, outputs = job["limits"], job["assertions"], job["outputs"]
    command = [
        cli,
        jobs.SEND,
        "--timeout", str(limits["virtualTimeoutMs"]),
        "--timeout-exit-code", str(TIMEOUT_EXIT),
        "--serial-log-file", str(folder / "serial.log"),
        "--no-sdcard",
    ]
    if assertions.get("scenario"):
        command += ["--scenario", "scenario.yaml"]
    elif assertions.get("expectText"):
        command.append(f"--expect-text={assertions['expectText']}")
    if assertions.get("failText"):
        command.append(f"--fail-text={assertions['failText']}")
    if outputs.get("vcd"):
        command += ["--vcd-file", str(folder / "trace.vcd")]
    screenshot = outputs.get("screenshot")
    if isinstance(screenshot, dict):
        command += [f"--screenshot-part={screenshot['part']}", "--screenshot-time", str(screenshot["ms"]), "--screenshot-file", str(folder / "screenshot.png")]
    return command


def _ask_to_stop(process: subprocess.Popen[bytes]) -> None:
    """The CLI closes its WebSocket on SIGBREAK (Windows, its own process group) or SIGTERM: the only end it can send."""
    try:
        if WINDOWS:
            process.send_signal(signal.CTRL_BREAK_EVENT)  # type: ignore[attr-defined]
        else:
            process.send_signal(signal.SIGTERM)
    except OSError:
        pass


def _kill(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    if WINDOWS:
        system = os.environ.get("SystemRoot", r"C:\Windows")
        subprocess.run([os.path.join(system, "System32", "taskkill.exe"), "/T", "/F", "/PID", str(process.pid)], capture_output=True, check=False)
    else:
        try:
            process.kill()
        except OSError:
            pass


def _serial_size(folder: Path) -> int:
    try:
        return (folder / "serial.log").stat().st_size
    except OSError:
        return 0


def run_scenario(args: Any, document: dict[str, Any], cwd: Path, spelled: Path) -> dict[str, Any]:
    check_run_id(args.run_id)
    job_path, job, job_sha = jobs.load(cwd, spelled, args.job)
    send = jobs.verify(job_path, job)
    jobs.revalidate(cwd, spelled, send, job)
    if args.credential != job["account"]:
        raise refused("credential-mismatch", f"The job was prepared for the account {job['account'][:64]}; run it with --credential {job['account'][:64]}.")
    cli = engine.executable()
    version = engine.check_version(cli)
    linted = diagram.validate(cwd, send / "diagram.json", cli)
    if linted["errors"]:
        raise refused("job-invalid", f"The job's diagram has {linted['errors']} lint error(s); prepare a new job.")
    token = credential.read(job["account"]).value
    if STOP.requested:
        raise refused("stopped", "The run was stopped before wokwi-cli started; nothing was sent.")
    run_id = args.run_id or new_run_id("run-scenario")
    folder = run_folder(cwd, spelled, args.results_dir, run_id)
    started = stamp()
    scenario = job["assertions"].get("scenario")
    result: dict[str, Any] = {
        "format": FORMAT,
        "kind": RUN_KIND,
        "tool": f"{TOOL} {VERSION}",
        "operation": "run-scenario",
        "runId": run_id,
        "startedAt": started,
        "status": "incomplete",
        "outcome": "running",
        "errors": [],
        "warnings": [],
        "note": NOTE,
        "job": {"runId": job.get("runId"), "path": workspace.relative(cwd, job_path), "sha256": job_sha},
        "scenario": scenario.get("name") if isinstance(scenario, dict) else None,
        "account": job["account"],
        "board": job["board"],
        "firmware": job.get("firmware"),
        "cli": {"version": version["version"], "sha": version["sha"], "pinned": {"version": CLI_VERSION, "sha": CLI_SHA}},
        "endpoint": ENDPOINT,
        "limits": job["limits"],
        "outputs": job["outputs"],
        "attempts": 1,
        "time": {"virtual": {"timeoutMs": job["limits"]["virtualTimeoutMs"], "reachedNs": None}, "real": {"budgetS": job["limits"]["realBudgetS"], "startedAt": started, "endedAt": None, "elapsedS": None}},
        "remote": {"state": "unknown", "confirmed": False, "cancel": "not-requested"},
        "resultPath": workspace.relative(cwd, folder / "result.json"),
    }
    write_json(folder / "result.json", result)
    command = argv(cli, job, folder)
    environment = engine.child_environment(token)
    flags = subprocess.CREATE_NEW_PROCESS_GROUP if WINDOWS else 0  # type: ignore[attr-defined]
    begun = time.monotonic()
    reason = "exited"
    try:
        process = subprocess.Popen(command, cwd=send.parent, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=environment, creationflags=flags)
    except OSError as error:
        write_json(folder / "exit.json", {"format": FORMAT, "exitCode": None, "endedAt": stamp(), "reason": "not-started", "elapsedS": 0, "attempts": 1})
        (folder / "cli-stderr.log").write_bytes(f"Error: wokwi-cli cannot be started: {error.strerror or error}\n".encode())
        return finish(cwd, folder, result)
    del environment
    outputs = [Capture(process.stdout, folder / "cli-stdout.log", token, STREAM_LIMIT), Capture(process.stderr, folder / "cli-stderr.log", token, STREAM_LIMIT)]  # type: ignore[arg-type]
    code: int | None = None
    try:
        for capture in outputs:
            capture.start()
        stop_at: float | None = None
        while process.poll() is None:
            time.sleep(POLL_S)
            if stop_at is None:
                if STOP.requested:
                    reason = "stopped"
                elif time.monotonic() - begun > job["limits"]["realBudgetS"]:
                    reason = "real-budget"
                elif _serial_size(folder) > SERIAL_LIMIT or any(capture.exceeded for capture in outputs):
                    reason = "output-limit"
                if reason != "exited":
                    _ask_to_stop(process)
                    stop_at = time.monotonic() + STOP_GRACE_S
            elif time.monotonic() > stop_at:
                _kill(process)
                break
        # A stop signal that arrived while the CLI was ending (VERA signals the whole group on Linux) is a stop.
        if reason == "exited" and STOP.requested:
            reason = "stopped"
        try:
            code = process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            _kill(process)
    finally:
        # Whatever happened above, no wokwi-cli is left running with the token.
        _kill(process)
    for capture in outputs:
        capture.join(timeout=10)
    scrub_file(folder / "serial.log", token)
    elapsed = round(time.monotonic() - begun, 3)
    write_json(folder / "exit.json", {"format": FORMAT, "exitCode": code, "endedAt": stamp(), "reason": reason, "elapsedS": elapsed, "attempts": 1})
    return finish(cwd, folder, result)
