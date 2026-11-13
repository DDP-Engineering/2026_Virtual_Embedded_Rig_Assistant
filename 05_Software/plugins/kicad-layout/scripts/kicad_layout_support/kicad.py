"""The KiCad side of kicad-layout-tool (spec REQ-DATA-891d5b5d §2): the PCB editor process, the IPC API connection
with its busy retries and error mapping, and the binding of an operation to the candidate's open document.

kicad-python (kipy) is imported here only; the offline refusals of the helper never load this module."""

from __future__ import annotations

import hashlib
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Callable, TypeVar

from kipy import KiCad
from kipy.board import Board
from kipy.errors import ApiError
from kipy.errors import ConnectionError as KiConnectionError
from kipy.proto.common.types import base_types_pb2

from .request import Failed, Refused, fail, refuse

T = TypeVar("T")
WINDOWS = os.name == "nt"
BUSY_SECONDS = 30.0
REQUEST_MS = 30_000
API_PREFERENCE = "Enable the KiCad API in KiCad's Preferences > Plugins (the API server), close other KiCad windows, and try again."


def wait_seconds(default: float) -> float:
    """The connection wait; KICAD_LAYOUT_WAIT_SECONDS shortens it for tests (VERA never passes it to programs)."""
    try:
        return max(0.5, min(default, float(os.environ.get("KICAD_LAYOUT_WAIT_SECONDS", default))))
    except ValueError:
        return default


def socket_path() -> str:
    if WINDOWS:
        return f"ipc://{Path(tempfile.gettempdir()) / 'kicad' / 'api.sock'}"
    return "ipc:///tmp/kicad/api.sock"


def _same(a: Path | str, b: Path | str) -> bool:
    return os.path.normcase(os.path.realpath(a)) == os.path.normcase(os.path.realpath(b))


class Api:
    """One API client: one operation, one KiCad token (a KiCad restart inside the operation is refused by KiCad)."""

    def __init__(self, timeout_ms: int = REQUEST_MS):
        self.kicad = KiCad(socket_path=socket_path(), client_name=f"kicad-layout-tool-{os.getpid()}", timeout_ms=timeout_ms)

    def call(self, function: Callable[..., T], *args: Any) -> T:
        """Runs one API request, retrying while KiCad is busy; lost connections and refusals become Failed."""
        start = time.monotonic()
        while True:
            try:
                return function(*args)
            except KiConnectionError as error:
                raise fail("connection", "kicad", f"The KiCad API connection was lost ({str(error)[:200]}).") from error
            except ApiError as error:
                text = str(error)
                lowered = text.lower()
                if ("busy" in lowered or "not ready" in lowered) and time.monotonic() - start < BUSY_SECONDS:
                    time.sleep(0.5)
                    continue
                if "token" in lowered:
                    raise fail("connection", "kicad", "KiCad restarted during the operation (its API token changed).") from error
                if "busy" in lowered or "not ready" in lowered:
                    raise fail("connection", "kicad", f"KiCad stayed busy for {BUSY_SECONDS:g} s (a dialog may be open in its window).") from error
                raise fail("kicad", "kicad", f"KiCad refused a request: {text[:300]}") from error

    def documents(self) -> list[Any]:
        return list(self.call(self.kicad.get_open_documents, base_types_pb2.DocumentType.DOCTYPE_PCB))

    def version(self) -> str:
        version = self.call(self.kicad.get_version)
        return f"{version.major}.{version.minor}.{version.patch}"

    def board(self, candidate: Path) -> Board:
        """The candidate's open document (binding, spec §2), or Refused naming what the API has open."""
        documents = self.documents()
        for document in documents:
            if document.board_filename and _same(Path(document.project.path) / document.board_filename, candidate):
                return Board(self.kicad._client, document)  # noqa: SLF001 - kipy has no public constructor by document
        names = ", ".join(sorted(document.board_filename for document in documents if document.board_filename)) or "no board"
        raise refuse("binding", "kicad", f"The KiCad window that holds the API has {names} open, not this run's candidate. Close that window (or open the candidate there) and try again.")


def answering() -> list[str] | None:
    """The board file names an already running KiCad API has open, or None when no API answers."""
    try:
        api = Api(timeout_ms=1500)
        documents = api.kicad.get_open_documents(base_types_pb2.DocumentType.DOCTYPE_PCB)
    except KiConnectionError:
        return None
    except ApiError:
        return []  # It answers, busy or not.
    return [document.board_filename for document in documents if document.board_filename]


def connect(seconds: float) -> Api:
    """A client whose API answers within `seconds`; Failed (connection) otherwise."""
    deadline = time.monotonic() + seconds
    last = ""
    while True:
        try:
            api = Api()
            api.kicad.get_open_documents(base_types_pb2.DocumentType.DOCTYPE_PCB)
            return api
        except KiConnectionError as error:
            last = str(error)
        except ApiError as error:
            last = str(error)
            if not ("busy" in last.lower() or "not ready" in last.lower()):
                raise fail("kicad", "kicad", f"KiCad refused a request: {last[:300]}") from error
        if time.monotonic() >= deadline:
            raise fail("connection", "kicad", f"No KiCad API answered within {seconds:g} s ({last[:120]}). {API_PREFERENCE}")
        time.sleep(0.5)


def bind(api: Api, candidate: Path, seconds: float) -> Board:
    """The candidate's document once the API has it open (an editor may still be loading it)."""
    deadline = time.monotonic() + seconds
    while True:
        try:
            return api.board(candidate)
        except Refused:
            if not api.documents() and time.monotonic() < deadline:
                time.sleep(0.5)
                continue
            raise


def memory_hash(api: Api, board: Board) -> str:
    """SHA-256 of KiCad's in-memory board text: it differs from the file, but changes with any edit."""
    return hashlib.sha256(api.call(board.get_as_string).encode("utf-8")).hexdigest()


def reload(api: Api, board: Board) -> None:
    """Reloads the board from its file (KiCad's revert), so the in-memory text is that of a fresh load."""
    api.call(board.revert)


def editor_executable(kicad_cli: Path) -> Path:
    return kicad_cli.parent / ("pcbnew.exe" if WINDOWS else "pcbnew")


def launch(kicad_cli: Path, board: Path) -> subprocess.Popen[bytes]:
    """Starts KiCad's PCB editor on the candidate, detached from the helper's output (the runner reads it to EOF).
    KICAD_LAYOUT_TEST_EDITOR names a Python stub for tests (VERA never passes it to programs)."""
    stub = os.environ.get("KICAD_LAYOUT_TEST_EDITOR")
    command = [sys.executable, stub, str(board)] if stub else [str(editor_executable(kicad_cli)), str(board)]
    if not stub and not editor_executable(kicad_cli).is_file():
        raise fail("kicad", "kicad", f"KiCad's PCB editor ({editor_executable(kicad_cli).name}) was not found next to kicad-cli.")
    return subprocess.Popen(
        command,
        cwd=str(board.parent),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        close_fds=True,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if WINDOWS else 0,
    )


def editor_running(pid: int) -> bool:
    """Whether `pid` is still a KiCad PCB editor process (a reused PID of another program is not)."""
    if pid <= 0:
        return False
    if WINDOWS:
        listed = subprocess.run(
            ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
            capture_output=True, text=True, check=False, creationflags=0x08000000,
        ).stdout.lower()
        return '"pcbnew.exe"' in listed
    try:
        return Path(f"/proc/{pid}/comm").read_text(encoding="utf-8").strip() == "pcbnew"
    except OSError:
        return False


def stop(pid: int) -> None:
    """Ends a process and its children."""
    if WINDOWS:
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True, check=False, creationflags=0x08000000)
        return
    try:
        os.kill(pid, 15)
        for _ in range(50):
            os.kill(pid, 0)
            time.sleep(0.1)
        os.kill(pid, 9)
    except OSError:
        pass


def stop_process(process: subprocess.Popen[bytes]) -> None:
    stop(process.pid)
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()


__all__ = ["Api", "Failed", "Refused", "answering", "bind", "connect", "editor_running", "launch", "memory_hash",
           "reload", "stop", "stop_process", "wait_seconds"]
