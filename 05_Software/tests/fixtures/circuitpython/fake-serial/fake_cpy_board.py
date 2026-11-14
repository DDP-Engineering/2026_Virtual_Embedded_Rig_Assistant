"""A simulated CircuitPython console behind the fake pyserial (offline evidence only, never proof of a real board).

$FAKE_CPY_BENCH names the JSON bench the helper also reads as $VERA_CIRCUITPYTHON_FAKE_BENCH: `ports` [{device, vid?,
pid?, serial_number?, description?, manufacturer?, volume?, autoreload?, codeTimeout?}]. A port with `volume` is the
console of the board whose CIRCUITPY drive is that host folder. Like CircuitPython it reruns the startup file
(code.txt, code.py, main.txt, main.py) after the drive's files stop changing for 0.3 s when autoreload is on, and on
Ctrl-D; the file runs in CPython (cwd = the drive, lib/ on the path, at most `codeTimeout` seconds, default 2) and its
output is framed by CircuitPython's console lines. $FAKE_CPY_LOG receives one line per event (open, write, reload, close).
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

STARTUP = ("code.txt", "code.py", "main.txt", "main.py")
SETTLE = 0.3


def log(line: str) -> None:
    path = os.environ.get("FAKE_CPY_LOG")
    if path:
        with open(path, "a", encoding="utf-8", newline="\n") as handle:
            handle.write(line[:200] + "\n")


def ports() -> list[dict]:
    with open(os.environ["FAKE_CPY_BENCH"], encoding="utf-8") as handle:
        return json.load(handle).get("ports", [])


def same(left: str, right: str) -> bool:
    return left.casefold() == right.casefold() if os.name == "nt" else left == right


class Board:
    def __init__(self, entry: dict) -> None:
        self.device = entry["device"]
        self.volume = Path(entry["volume"]) if entry.get("volume") else None
        self.autoreload = entry.get("autoreload", True)
        self.timeout = float(entry.get("codeTimeout", 2))
        self.buffer = bytearray()
        self.closed = False
        self.snapshot = self._snap()
        self.changed_at: float | None = None

    def _snap(self) -> dict:
        found = {}
        if self.volume is None or not self.volume.exists():
            return found
        for root, folders, files in os.walk(self.volume):
            folders[:] = [name for name in folders if name != "__pycache__"]
            for name in files:
                path = os.path.join(root, name)
                try:
                    stat = os.stat(path)
                except OSError:
                    continue
                found[os.path.relpath(path, self.volume)] = (stat.st_size, stat.st_mtime_ns)
        return found

    def poll(self) -> None:
        snap = self._snap()
        if snap != self.snapshot:
            self.snapshot = snap
            self.changed_at = time.monotonic()
        if self.changed_at is not None and self.autoreload and time.monotonic() - self.changed_at >= SETTLE:
            self.changed_at = None
            self.buffer.extend(b"\r\nCode stopped by auto-reload. Reloading soon.\r\n")
            self.reload()

    def reload(self) -> None:
        log(f"reload {self.device}")
        text = "\x1b]0;\U0001f40ecode.py | 9.2.1\x1b\\soft reboot\r\n\r\n"
        text += "Auto-reload is on. Simply save files over USB to run them or enter REPL to disable.\r\n" if self.autoreload else "Auto-reload is off.\r\n"
        start = next((name for name in STARTUP if self.volume and (self.volume / name).is_file()), None)
        if start is None:
            text += "code.py output:\r\nNo code.py found.\r\n\r\nCode done running.\r\n"
        else:
            env = {key: value for key, value in os.environ.items() if not key.startswith(("FAKE_", "VERA_"))}
            env.update({"PYTHONPATH": str(self.volume / "lib"), "PYTHONDONTWRITEBYTECODE": "1", "PYTHONUTF8": "1"})
            text += f"{start} output:\r\n"
            try:
                done = subprocess.run([sys.executable, "-B", "-u", start], cwd=self.volume, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=self.timeout)
                text += done.stdout.decode("utf-8", "replace").replace("\n", "\r\n")
                text += "\r\nCode done running.\r\n\r\nPress any key to enter the REPL. Use CTRL-D to reload.\r\n"
            except subprocess.TimeoutExpired as running:
                text += (running.output or b"").decode("utf-8", "replace").replace("\n", "\r\n")
        self.snapshot = self._snap()
        self.buffer.extend(text.encode("utf-8"))

    def feed(self, data: bytes) -> None:
        log(f"write {self.device} {data.hex()}")
        for byte in data:
            if byte == 0x03:
                self.buffer.extend(b"\r\nKeyboardInterrupt: \r\n\r\nCode done running.\r\n")
            elif byte == 0x04:
                self.reload()

    def take(self, size: int, timeout: float | None) -> bytes:
        end = time.monotonic() + (timeout if timeout is not None else 1.0)
        while True:
            self.poll()
            if self.buffer or time.monotonic() >= end:
                break
            time.sleep(0.02)
        chunk = bytes(self.buffer[:size])
        del self.buffer[:size]
        return chunk

    def pending(self) -> int:
        self.poll()
        return len(self.buffer)
