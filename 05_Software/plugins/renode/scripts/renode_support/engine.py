"""The Renode engine session (spec REQ-DATA-8a943977 sections 5 and 9, REQ-SEC-01fae096, REQ-REL-b66cb484).

renode-sim starts the pinned engine headless with fixed options and drives its monitor through the console on
stdin/stdout - no socket, no GUI, no Robot server. Every command it sends is composed here from fixed templates and
the values of an approved profile; UARTs go to file backends in the run folder. The engine stays in the helper's
process group (POSIX) or process tree (Windows), so VERA's Stop and timeout kills reach it, and the helper kills it
itself when a session ends or a real budget runs out.
"""

from __future__ import annotations

import os
import queue
import re
import signal
import subprocess
import threading
import time
from collections.abc import Callable
from pathlib import Path

from .errors import EngineError

# Headless console session (Renode 1.17.0 options): no GUI, the monitor on stdio, no colours, log lines only in the
# run's log file, the engine's configuration file in the run folder. No telnet port, no Robot server.
OPTIONS = ["--disable-gui", "--console", "--plain", "--hide-log"]
# The whole last line of the console is the prompt: `(monitor) ` or `(<machine>) `.
PROMPT = re.compile(r"\((?:monitor|[A-Za-z0-9_-]{1,48})\) ?")
VERSION = re.compile(r"Renode v?([0-9]+\.[0-9]+\.[0-9]+)")
VIRTUAL = re.compile(r"Elapsed Virtual Time:\s*([0-9]+):([0-9]+):([0-9]+(?:\.[0-9]+)?)")
# Renode 1.17.0: "WriteDoubleWord to non existing peripheral at 0x40007400, value 0x1." and, where an SVD file names
# the register, "WriteDoubleWord of value 0x1 to an unimplemented register DAC:CR (0x40007400) generated from SVD".
UNMODELED = re.compile(
    r"(Read|Write)(Byte|Word|DoubleWord|QuadWord)(?: of value 0x[0-9A-Fa-f]+)? (?:from|to) "
    r"(?:non existing peripheral at |an unimplemented register \S+ \()(0x[0-9A-Fa-f]+)"
)
INITIAL = re.compile(r"Setting initial values: PC = (0x[0-9A-Fa-f]+), SP = (0x[0-9A-Fa-f]+)")
LOG_ERROR = re.compile(r"\[ERROR\]\s*(.*)")
# Characters a monitor `@path` token carries unchanged: the tokenizer splits at whitespace and refuses quotes.
SAFE_PATH = re.compile(r"[A-Za-z0-9_./:~+-]+")
UNHANDLED = re.compile(r"(sysbus\.[A-Za-z0-9_.]+): Unhandled (read|write) (?:from|to) offset (0x[0-9A-Fa-f]+)")
QUIT_SECONDS = 10
SAFE_ENV = ("PATH", "SYSTEMROOT", "SystemRoot", "WINDIR", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "LANG",
            "LC_ALL", "XDG_RUNTIME_DIR", "LOCALAPPDATA", "APPDATA", "PROGRAMDATA", "COMSPEC", "PATHEXT", "NUMBER_OF_PROCESSORS",
            "PROCESSOR_ARCHITECTURE", "DOTNET_ROOT")


class RealTimeout(Exception):
    """The real-time budget of the run ended while the engine worked."""


def timespan(seconds: float) -> str:
    """A virtual duration as the monitor's TimeInterval text, hh:mm:ss.ffffff."""
    micro = round(seconds * 1_000_000)
    hours, rest = divmod(micro, 3_600_000_000)
    minutes, rest = divmod(rest, 60_000_000)
    whole, fraction = divmod(rest, 1_000_000)
    return f"{hours:02d}:{minutes:02d}:{whole:02d}.{fraction:06d}"


def environment() -> dict[str, str]:
    """The engine's environment: the system variables it needs, nothing of VERA's (no tokens, no run control)."""
    env = {key: value for key, value in os.environ.items() if key in SAFE_ENV}
    env["DOTNET_CLI_TELEMETRY_OPTOUT"] = "1"
    # No .NET diagnostics IPC endpoint (a named pipe on Windows, a Unix socket on Linux).
    env["DOTNET_EnableDiagnostics"] = "0"
    return env


def _children(pid: int) -> list[int]:
    """The descendants of a POSIX process, from /proc."""
    parents: dict[int, list[int]] = {}
    try:
        entries = os.listdir("/proc")
    except OSError:
        return []
    for entry in entries:
        if not entry.isdigit():
            continue
        try:
            with open(f"/proc/{entry}/stat", encoding="utf-8", errors="replace") as handle:
                fields = handle.read().rsplit(")", 1)[1].split()
            parents.setdefault(int(fields[1]), []).append(int(entry))
        except (OSError, IndexError, ValueError):
            continue
    found: list[int] = []
    pending = [pid]
    while pending:
        current = pending.pop()
        for child in parents.get(current, []):
            found.append(child)
            pending.append(child)
    return found


def kill_tree(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True, check=False)
    else:
        for pid in [*reversed(_children(process.pid)), process.pid]:
            try:
                os.kill(pid, signal.SIGKILL)
            except OSError:
                pass
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        pass


def monitor_path(path: Path) -> str | None:
    """An absolute path as a monitor `@` token can carry it, or None: Renode 1.17.0 resolves relative write paths
    against its own folder and cannot quote a path. On Windows a path with spaces is retried in its 8.3 short form."""
    text = path.resolve().as_posix()
    if SAFE_PATH.fullmatch(text):
        return text
    if os.name == "nt":
        import ctypes  # noqa: PLC0415

        buffer = ctypes.create_unicode_buffer(32768)
        if ctypes.windll.kernel32.GetShortPathNameW(str(path.resolve()), buffer, len(buffer)):  # type: ignore[attr-defined]
            short = Path(buffer.value).as_posix()
            if SAFE_PATH.fullmatch(short):
                return short
    return None


def probe_version(executable: Path, timeout: float = 30) -> tuple[str, str]:
    """The engine's `--version` line and version (`tools`, and the check before every session)."""
    try:
        done = subprocess.run(
            [str(executable), "--version"], capture_output=True, timeout=timeout, env=environment(), stdin=subprocess.DEVNULL,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise EngineError(f"The engine at {executable} did not report its version: {error}.") from error
    text = (done.stdout + done.stderr).decode("utf-8", errors="replace")
    match = VERSION.search(text)
    if not match:
        raise EngineError(f"The engine at {executable} printed no Renode version: {text.strip()[:200]!r}.")
    line = next((line.strip() for line in text.splitlines() if VERSION.search(line)), match.group(0))
    return line[:200], match.group(1)


class Session:
    """One headless engine process and its monitor console."""

    def __init__(self, executable: Path, folder: Path, deadline: float, transcript: Callable[[str], None],
                 config: str) -> None:
        self.executable = executable
        self.folder = folder
        self.config = config
        self.deadline = deadline
        self.transcript = transcript
        self.process: subprocess.Popen[bytes] | None = None
        self.output: queue.Queue[bytes | None] = queue.Queue()
        self.buffer = ""

    def start(self) -> None:
        argv = [str(self.executable), *OPTIONS, "--config", self.config]
        try:
            self.process = subprocess.Popen(
                argv,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                cwd=self.folder,
                env=environment(),
            )
        except OSError as error:
            raise EngineError(f"The engine could not start: {error.strerror or error}.") from error
        threading.Thread(target=self._pump, daemon=True).start()
        self.transcript(f"[start] {' '.join(argv)}\n")
        self._until_prompt(60)

    def _pump(self) -> None:
        assert self.process is not None and self.process.stdout is not None
        stream = self.process.stdout
        while True:
            chunk = stream.read1(65536) if hasattr(stream, "read1") else stream.read(1)
            if not chunk:
                self.output.put(None)
                return
            self.output.put(chunk)

    def _until_prompt(self, seconds: float) -> str:
        """Reads the console until a prompt ends the output; returns the text before it."""
        limit = min(time.monotonic() + seconds, self.deadline)
        while True:
            lines = self.buffer.replace("\r", "").split("\n")
            if PROMPT.fullmatch(lines[-1]):
                text = "\n".join(lines[:-1])
                self.buffer = ""
                return text
            remaining = limit - time.monotonic()
            if remaining <= 0:
                if time.monotonic() >= self.deadline:
                    raise RealTimeout()
                raise EngineError("The engine's monitor did not answer in time.")
            try:
                chunk = self.output.get(timeout=min(remaining, 0.5))
            except queue.Empty:
                continue
            if chunk is None:
                code = self.process.poll() if self.process else None
                raise EngineError(f"The engine ended unexpectedly (exit code {code}).")
            text = chunk.decode("utf-8", errors="replace")
            self.buffer += text

    def command(self, text: str, seconds: float = 60, answer: bool = False) -> str:
        """Sends one monitor command composed by renode-sim and returns its answer.

        With --hide-log every setup, run and stimulus command of Renode 1.17.0 answers nothing: any text is an error
        (wording varies: "There was an error ...", "Could not tokenize here", "No such command or device"). Queries
        (`answer=True`) return their text for the caller to parse."""
        if self.process is None or self.process.stdin is None:
            raise EngineError("The engine is not running.")
        if "\n" in text or "\r" in text:
            raise EngineError("A monitor command must be one line.")
        self.transcript(f"> {text}\n")
        try:
            self.process.stdin.write((text + "\n").encode("utf-8"))
            self.process.stdin.flush()
        except OSError as error:
            raise EngineError(f"The engine's console is closed: {error}.") from error
        reply = self._until_prompt(seconds)
        lines = reply.split("\n")
        if lines and lines[0].strip() == text:
            lines = lines[1:]
        reply = "\n".join(lines).strip()
        if reply:
            self.transcript(reply + "\n")
        if reply and not answer:
            raise EngineError(f"The engine refused {' '.join(text.split(' ')[:2])!r}: {' '.join(reply.split())[:300]}")
        return reply

    def close(self) -> int | None:
        """Quits the engine and kills its tree when it does not end within 10 s; returns the exit code."""
        process = self.process
        if process is None:
            return None
        if process.poll() is None:
            try:
                assert process.stdin is not None
                process.stdin.write(b"quit\n")
                process.stdin.flush()
                process.stdin.close()
            except OSError:
                pass
            try:
                process.wait(timeout=QUIT_SECONDS)
            except subprocess.TimeoutExpired:
                self.transcript("[kill] the engine did not quit within 10 s\n")
        kill_tree(process)
        self.transcript(f"[exit] {process.poll()}\n")
        return process.poll()

    def kill(self) -> None:
        if self.process is not None:
            kill_tree(self.process)
            self.transcript(f"[kill] {self.process.poll()}\n")


def virtual_seconds(answer: str) -> float | None:
    match = VIRTUAL.search(answer)
    if not match:
        return None
    hours, minutes, seconds = match.groups()
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


class LogWatch:
    """Reads the engine log file incrementally and collects unmodeled accesses (REQ-REL-b66cb484)."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.offset = 0
        self.rest = ""
        self.found: dict[tuple[str, str], dict[str, object]] = {}
        self.events = 0
        self.initial: tuple[int, int] | None = None
        self.errors: list[str] = []

    def poll(self, virtual: float) -> None:
        try:
            with open(self.path, "rb") as handle:
                handle.seek(self.offset)
                data = handle.read(4 * 1024 * 1024)
        except OSError:
            return
        self.offset += len(data)
        text = self.rest + data.decode("utf-8", errors="replace")
        lines = text.split("\n")
        self.rest = lines.pop()
        for line in lines:
            match = INITIAL.search(line)
            if match:
                self.initial = (int(match.group(1), 16), int(match.group(2), 16))
                continue
            match = LOG_ERROR.search(line)
            if match and len(self.errors) < 20:
                self.errors.append(match.group(1).strip()[:300])
            match = UNMODELED.search(line)
            if match:
                key = (match.group(3).lower(), match.group(1).lower())
                self._add(key, {"address": f"{int(match.group(3), 16):#010x}", "access": match.group(1).lower(),
                                "width": match.group(2)}, virtual)
                continue
            match = UNHANDLED.search(line)
            if match:
                key = (f"{match.group(1)}+{match.group(3).lower()}", match.group(2))
                self._add(key, {"peripheral": match.group(1), "offset": match.group(3).lower(), "access": match.group(2),
                                "kind": "unhandled-register"}, virtual)

    def _add(self, key: tuple[str, str], entry: dict[str, object], virtual: float) -> None:
        self.events += 1
        if key in self.found:
            self.found[key]["count"] = int(self.found[key]["count"]) + 1  # type: ignore[arg-type]
        elif len(self.found) < 200:
            self.found[key] = {**entry, "count": 1, "firstVirtual": round(virtual, 6)}

    def entries(self) -> list[dict[str, object]]:
        return list(self.found.values())


class UartWatch:
    """The UART output of a run in closed segments (Renode 1.17.0 opens a file backend exclusively on Windows).

    The engine writes each segment `uart-<name>.<n>.part`; when one has grown, renode-sim closes it with
    CloseFileBackend (emulation is paused between slices, so no byte is lost), appends it to `uart-<name>.log` and
    opens the next one. Every complete line gets the virtual time of the slice it ended in.
    """

    LIMIT = 200_000

    def __init__(self, folder: Path, name: str) -> None:
        self.folder = folder
        self.name = name
        self.path = folder / f"uart-{name}.log"
        self.index = 0
        self.rest = ""
        self.lines: list[tuple[float, str]] = []
        self.total = 0
        self.bytes = 0
        self.path.write_bytes(b"")

    @property
    def part(self) -> Path:
        return self.folder / f"uart-{self.name}.{self.index:05d}.part"

    def grown(self) -> bool:
        try:
            return self.part.stat().st_size > 0
        except OSError:
            return False

    def take(self, virtual: float, final: bool = False) -> None:
        """Appends the closed current segment to the run's UART log and splits it into lines.

        A segment that exists but cannot be read (a scanner may hold a just-closed file for a moment) is retried and
        then raises: UART bytes are never dropped silently. A missing segment holds no bytes."""
        part = self.part
        data = b""
        for attempt in range(10):
            try:
                data = part.read_bytes()
                break
            except FileNotFoundError:
                break
            except OSError as error:
                if attempt == 9:
                    raise EngineError(f"The UART segment {part.name} cannot be read: {error.strerror or error}.") from error
                time.sleep(0.05)
        self.index += 1
        try:
            part.unlink()
        except OSError:
            pass  # The bytes are in uart-<name>.log; a leftover .part file is only clutter.
        self.feed(data, virtual, final)

    def feed(self, data: bytes, virtual: float, final: bool = False) -> None:
        if data:
            self.bytes += len(data)
            with open(self.path, "ab") as handle:
                handle.write(data)
        text = self.rest + data.decode("utf-8", errors="replace")
        parts = text.split("\n")
        self.rest = parts.pop()
        if final and self.rest:
            parts.append(self.rest)
            self.rest = ""
        for part in parts:
            line = part.rstrip("\r")
            self.total += 1
            if len(self.lines) < self.LIMIT:
                self.lines.append((round(virtual, 6), line))
