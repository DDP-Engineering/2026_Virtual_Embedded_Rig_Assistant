"""The CircuitPython serial console: bounded capture and transcript parsing (spec REQ-DATA-8f309a53, capture-output).

REQ-FUNC-9845bd14 (capture-output), REQ-FUNC-3371a413 (the run an autoreload starts after a deploy). Nothing is sent
to the board except Ctrl-C and Ctrl-D for --reload.
"""

from __future__ import annotations

import re
import threading
import time
from pathlib import Path
from typing import Any

from . import workspace
from .report import Ended, Refused, problem

LIMIT = 1024 * 1024
_ESCAPES = re.compile(r"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[A-Za-z]")
_RUN = re.compile(r"^(\S+\.(?:py|txt)) output:$", re.M)
_TRACEBACK = "Traceback (most recent call last):"
_DONE = "Code done running."


def clean(data: bytes) -> str:
    """Console bytes as text: CR LF normalized, terminal title and colour sequences removed."""
    text = data.decode("utf-8", "replace").replace("\r\n", "\n").replace("\r", "\n")
    return _ESCAPES.sub("", text)


def parse(text: str) -> dict[str, Any]:
    """Autoreload state and the last run: {file, output, state finished|exception|running, traceback, exception}."""
    on, off = text.rfind("Auto-reload is on"), text.rfind("Auto-reload is off")
    autoreload = "unknown" if on < 0 and off < 0 else ("on" if on > off else "off")
    starts = list(_RUN.finditer(text))
    if not starts:
        return {"autoreload": autoreload, "run": None}
    last = starts[-1]
    body = text[last.end() :].lstrip("\n")
    done = body.find(_DONE)
    trace = body.find(_TRACEBACK)
    run: dict[str, Any] = {"file": last.group(1), "state": "running", "traceback": None, "exception": None}
    end = len(body)
    if trace >= 0 and (done < 0 or trace < done):
        end = trace
        block = body[trace : done if done >= 0 else len(body)].rstrip()
        lines = [line for line in block.split("\n") if line.strip()]
        run.update({"state": "exception", "traceback": block[-4000:], "exception": (lines[-1].strip() if len(lines) > 1 else None)})
    elif done >= 0:
        end = done
        run["state"] = "finished"
    run["output"] = body[:end].rstrip("\n")[-65536:]
    return {"autoreload": autoreload, "run": run}


class Reader:
    """Reads a serial port into memory on a thread until stopped (at most LIMIT bytes kept)."""

    def __init__(self, address: str) -> None:
        import serial

        try:
            self.port = serial.Serial(address, 115200, timeout=0.1)
        except (serial.SerialException, OSError) as error:
            raise Refused([problem("port-open-failed", f"{address} cannot be opened: {str(error)[:200]}")]) from error
        self.data = bytearray()
        self.dropped = 0
        self.lost: Exception | None = None
        self.stop_event = threading.Event()
        self.lock = threading.Lock()
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()

    def _run(self) -> None:
        while not self.stop_event.is_set():
            try:
                waiting = self.port.in_waiting
                chunk = self.port.read(waiting or 1)
            except Exception as error:  # noqa: BLE001 - a lost port ends the capture
                self.lost = error
                return
            if chunk:
                with self.lock:
                    room = LIMIT - len(self.data)
                    self.data.extend(chunk[:room])
                    self.dropped += max(0, len(chunk) - room)

    def send(self, data: bytes) -> None:
        self.port.write(data)

    def text(self) -> str:
        with self.lock:
            return clean(bytes(self.data))

    def mark(self) -> int:
        with self.lock:
            return len(self.data)

    def since(self, offset: int) -> str:
        with self.lock:
            return clean(bytes(self.data[offset:]))

    def close(self) -> bytes:
        self.stop_event.set()
        self.thread.join(timeout=2)
        try:
            self.port.close()
        except Exception:  # noqa: BLE001
            pass
        return bytes(self.data)


def reload(reader: Reader) -> None:
    """Ctrl-C ends the running code.py, Ctrl-D restarts it (CircuitPython's own reload keys)."""
    reader.send(b"\x03")
    time.sleep(0.5)
    reader.send(b"\x04")


def wait_for_run(reader: Reader, offset: int, seconds: float) -> None:
    """Reads until `seconds` pass or a run that started after `offset` has finished or raised."""
    end = time.monotonic() + seconds
    while time.monotonic() < end and reader.lost is None:
        seen = parse(reader.since(offset))["run"]
        if seen and seen["state"] in ("finished", "exception"):
            time.sleep(0.2)
            return
        time.sleep(0.05)


def record(cwd: Path, folder: Path, document: dict[str, Any], reader: Reader, offset: int = 0) -> dict[str, Any]:
    """Writes console.txt and puts autoreload, run and the console path into the document."""
    data = reader.close()
    local = folder / "console.txt"
    local.write_bytes(data)
    found = parse(clean(data[offset:]))
    whole = parse(clean(data))
    document["autoreload"] = whole["autoreload"] if found["autoreload"] == "unknown" else found["autoreload"]
    document["run"] = found["run"]
    document["consoleBytes"] = len(data)
    document["consoleTruncated"] = reader.dropped
    document["consolePath"] = workspace.relative(cwd, local)
    if reader.lost is not None:
        document["warnings"].append(problem("port-lost", f"The serial port stopped answering: {str(reader.lost)[:200]}"))
    return found


def capture(cwd: Path, folder: Path, document: dict[str, Any], address: str, duration: int, restart: bool) -> None:
    reader = Reader(address)
    try:
        offset = 0
        if restart:
            offset = reader.mark()
            reload(reader)
        time.sleep(duration) if not restart else wait_for_run(reader, offset, duration)
    except BaseException:
        reader.close()
        raise
    found = record(cwd, folder, document, reader, offset)
    document["application"] = "restarted" if restart else "unchanged"
    run = found["run"]
    if run and run["state"] == "exception":
        raise Ended("fail", "exception", f"{run['file']} raised {run['exception'] or 'an exception'}.")
