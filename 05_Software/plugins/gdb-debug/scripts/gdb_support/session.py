"""The supervised GDB/MI session (spec REQ-DATA-d7da2a71 section 5; REQ-SEC-b50cb2e8, REQ-FUNC-74347f3b,
REQ-REL-afd24ad4).

The helper owns GDB's stdin and stdout. Each command carries a numeric token and is matched only to the result record
with that token; a result for an abandoned (timed-out) token or without a token is recorded as an event and never
taken as the answer to another command. Async records (`*running`, `*stopped`, `=...`) are events that update the
target state; `*stopped` records are kept in order so an operation can wait for the first stop after its own command.
"""

from __future__ import annotations

import os
import queue
import subprocess
import threading
import time
from pathlib import Path
from typing import Any, Callable

from . import mi

DISCONNECTED = ("remote communication error", "remote connection closed", "connection timed out", "target disconnected")
GDB_OPTIONS = [
    "--interpreter=mi3",
    "-nx",
    "-q",
    "-iex",
    "set auto-load off",
    "-iex",
    "set debuginfod enabled off",
    "-iex",
    "set history save off",
    "-iex",
    "set confirm off",
    "-iex",
    "set pagination off",
    "-iex",
    "set width 0",
    "-iex",
    "set height 0",
    "-iex",
    "set mi-async on",
    "-iex",
    "set trust-readonly-sections off",
    # No expression may run target code: an overloaded C++ operator[] or operator& would otherwise be called.
    "-iex",
    "set may-call-functions off",
    "-iex",
    "set remotetimeout 10",
]
EVENT_LIMIT = 400
TEXT_LIMIT = 300


class Closed(Exception):
    """GDB exited or closed its output."""


class Timeout(Exception):
    """A command got no result in time; the target state is unknown from now on."""


class Interrupted(Exception):
    """VERA asked the run to stop while a command waited; GDB is treated as unresponsive from now on."""


class Failure(Exception):
    """GDB answered ^error."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class Events:
    """The run's event list: strictly increasing milliseconds since the start, bounded."""

    def __init__(self) -> None:
        self.started = time.monotonic()
        self.items: list[dict[str, Any]] = []
        self.dropped = 0
        self._last = -1
        self._lock = threading.Lock()

    def add(self, kind: str, text: str) -> None:
        with self._lock:
            t = max(int((time.monotonic() - self.started) * 1000), self._last + 1)
            self._last = t
            if len(self.items) >= EVENT_LIMIT:
                self.dropped += 1
                return
            self.items.append({"t": t, "kind": kind, "text": text[:TEXT_LIMIT]})


def environment() -> dict[str, str]:
    """GDB's environment: the run's own, without Python settings that could steer GDB's embedded interpreter."""
    env = dict(os.environ)
    for name in list(env):
        if name.upper() in ("PYTHONPATH", "PYTHONHOME", "PYTHONSTARTUP", "PYTHONUSERBASE", "GDBHISTFILE"):
            del env[name]
    return env


class Session:
    def __init__(
        self, executable: str, cwd: Path, log: Path, events: Events, stop_requested: Callable[[], bool] = lambda: False
    ) -> None:
        self.executable = executable
        self.stop_requested = stop_requested
        self.cwd = cwd
        self.events = events
        self.log = open(log, "x", encoding="utf-8", newline="\n")
        self.process: subprocess.Popen[bytes] | None = None
        self.lines: queue.Queue[str | None] = queue.Queue()
        self.token = 0
        self.abandoned: set[int] = set()
        self.state = "unknown"
        self.stops: list[mi.Record] = []
        self.responsive = True
        self.closed = False
        self.connected = False
        self._log_lock = threading.Lock()

    # -- process -------------------------------------------------------------------------------------------------
    def start(self, timeout: float = 20.0) -> None:
        self.cwd.mkdir(exist_ok=True)
        self.process = subprocess.Popen(
            [self.executable, *GDB_OPTIONS],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=self.cwd,
            env=environment(),
        )
        threading.Thread(target=self._read_stdout, daemon=True).start()
        threading.Thread(target=self._read_stderr, daemon=True).start()
        deadline = time.monotonic() + timeout
        while True:  # GDB announces itself with a prompt.
            record = self._next(deadline)
            if record is None:
                raise Timeout("GDB did not start within the time limit.")
            if record.kind == "prompt":
                return
            self._event(record)

    def alive(self) -> bool:
        return self.process is not None and self.process.poll() is None

    def kill(self) -> None:
        if self.process is not None and self.process.poll() is None:
            self.process.kill()
            try:
                self.process.wait(5)
            except subprocess.TimeoutExpired:
                pass
        self.close_log()

    def close_log(self) -> None:
        with self._log_lock:
            if not self.log.closed:
                self.log.close()

    def _write_log(self, prefix: str, text: str) -> None:
        with self._log_lock:
            if not self.log.closed:
                self.log.write(f"{int((time.monotonic() - self.events.started) * 1000):>8} {prefix} {text}\n")

    def _read_stdout(self) -> None:
        assert self.process is not None and self.process.stdout is not None
        for raw in self.process.stdout:
            line = raw.decode("utf-8", "replace").rstrip("\r\n")
            self._write_log("<<", line)
            self.lines.put(line)
        self.lines.put(None)

    def _read_stderr(self) -> None:
        assert self.process is not None and self.process.stderr is not None
        for raw in self.process.stderr:
            line = raw.decode("utf-8", "replace").rstrip("\r\n")
            if line:
                self._write_log("!!", line)
                self.events.add("stderr", line)

    # -- records -------------------------------------------------------------------------------------------------
    def _next(self, deadline: float) -> mi.Record | None:
        """The next parsed record, or None at the deadline. Raises Closed at end of output."""
        if self.closed:
            raise Closed("GDB has exited.")
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return None
        try:
            line = self.lines.get(timeout=min(remaining, 0.1))
        except queue.Empty:
            return mi.Record("idle")
        if line is None:
            self.closed = True
            if self.connected:
                self.state = "disconnected"
            raise Closed("GDB has exited.")
        try:
            return mi.parse(line)
        except mi.MiSyntax:
            self.events.add("unparsed", line)
            return mi.Record("idle")

    def _event(self, record: mi.Record) -> None:
        """Async and stream records: update the state and record them."""
        if record.kind in ("idle", "prompt"):
            return
        if record.kind == "exec":
            if record.cls == "running":
                self.state = "running"
            elif record.cls == "stopped":
                self.state = "halted"
                self.stops.append(record)
            self.events.add("async", record.line)
            return
        if record.kind in ("notify", "status"):
            if record.cls == "thread-group-exited":
                self.state = "disconnected"
            self.events.add("async", record.line)
            return
        if record.kind in ("console", "target", "log"):
            if any(marker in record.text.lower() for marker in DISCONNECTED):
                self.state = "disconnected"
            if record.kind != "console":
                self.events.add("stream", record.text.strip())
            return
        if record.kind == "result":
            self.events.add("stale" if record.token is not None else "untokened", record.line)

    def command(self, text: str, timeout: float = 10.0, interruptible: bool = True) -> tuple[mi.Record, str]:
        """Sends one MI command; returns its result record and the console text that came with it. A stop request
        while it waits (when `interruptible`) abandons the command like a timeout and raises Interrupted."""
        if not self.responsive:
            raise Timeout("GDB stopped answering earlier in this run.")
        if self.process is None or self.process.stdin is None or self.closed:
            raise Closed("GDB is not running.")
        self.token += 1
        token = self.token
        line = f"{token}{text}"
        self._write_log(">>", line)
        try:
            self.process.stdin.write((line + "\n").encode("utf-8"))
            self.process.stdin.flush()
        except OSError as error:
            self.closed = True
            raise Closed("GDB closed its input.") from error
        console: list[str] = []
        deadline = time.monotonic() + timeout
        stopping = False
        while True:
            if interruptible and not stopping and self.stop_requested():
                # A short command may still finish: one more second, then it is abandoned.
                stopping = True
                deadline = min(deadline, time.monotonic() + 1.0)
            record = None if stopping and time.monotonic() >= deadline else self._next(deadline)
            if record is None and stopping:
                self.abandoned.add(token)
                self.responsive = False
                self.state = "unknown"
                self.events.add("stopped", line)
                raise Interrupted(f"Stopped while waiting for {text.split(' ')[0]}.")
            if record is None:
                self.abandoned.add(token)
                self.responsive = False
                self.state = "unknown"
                self.events.add("timeout", line)
                raise Timeout(f"GDB gave no result for {text.split(' ')[0]} within {timeout:g} s.")
            if record.kind == "result" and record.token == token:
                if stopping:
                    self.events.add("stopped", f"{line} finished after the stop request")
                if record.cls == "error":
                    message = str(record.results.get("msg", "error"))
                    if any(marker in message.lower() for marker in DISCONNECTED):
                        self.state = "disconnected"
                    raise Failure(message)
                return record, "".join(console)
            if record.kind == "console":
                console.append(record.text)
            self._event(record)

    def wait_stop(self, since: int, timeout: float, stop_requested: Callable[[], bool]) -> mi.Record | str | None:
        """The first `*stopped` after index `since`; "stop" when VERA asks to stop, None at the timeout."""
        deadline = time.monotonic() + timeout
        while True:
            if len(self.stops) > since:
                return self.stops[since]
            if stop_requested():
                return "stop"
            if self.state == "disconnected":
                raise Closed("The target connection was lost.")
            record = self._next(deadline)
            if record is None:
                return None
            self._event(record)

    def drain(self, seconds: float) -> None:
        """Reads what GDB still prints for a moment (late results become stale events)."""
        deadline = time.monotonic() + seconds
        try:
            while time.monotonic() < deadline:
                record = self._next(deadline)
                if record is None:
                    return
                self._event(record)
        except Closed:
            return
