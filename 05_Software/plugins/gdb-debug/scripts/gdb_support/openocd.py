"""The supervised OpenOCD server (spec REQ-DATA-d7da2a71 section 5; REQ-SEC-593220cf, REQ-REL-d5f06a9b).

OpenOCD runs only from the package profile's interface and target scripts, for the declared probe serial, with its
GDB port bound to 127.0.0.1 on a port the helper chose and its telnet and Tcl ports off. Its gdb-attach event halts
the core; its gdb-detach event applies the declared exit policy and prints the core state it left, which the helper
reads as the confirmation of the physical state.
"""

from __future__ import annotations

import re
import socket
import subprocess
import threading
import time
from pathlib import Path

from .profiles import Profile
from .registry import Probe

READY = re.compile(r"Listening on port (\d+) for gdb connections")
MARKER = re.compile(r"VERA-DETACH (\w[\w-]*)")


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def arguments(executable: str, profile: Profile, probe: Probe, port: int, policy: str) -> list[str]:
    action = "halt" if policy == "halted" else "resume"
    args = [executable, "-f", profile.interface, "-c", f"adapter serial {probe.serial}"]
    if profile.speed is not None:
        args += ["-c", f"adapter speed {profile.speed}"]
    args += [
        "-f",
        profile.target,
        "-c",
        "bindto 127.0.0.1",
        "-c",
        f"gdb_port {port}",
        "-c",
        "telnet_port disabled",
        "-c",
        "tcl_port disabled",
        "-c",
        "gdb_memory_map enable",
        "-c",
        "gdb_flash_program disable",
        "-c",
        "gdb_breakpoint_override hard",
        "-c",
        "[target current] configure -event gdb-attach { halt }",
        "-c",
        f'[target current] configure -event gdb-detach {{ catch {{{action}}}; echo "VERA-DETACH [[target current] curstate]" }}',
    ]
    return args


class OpenOcd:
    def __init__(self, args: list[str], cwd: Path, log: Path) -> None:
        """`cwd` is an empty folder outside the workbench: OpenOCD looks for `-f` scripts there first."""
        self.args = args
        self.cwd = cwd
        self.log = open(log, "x", encoding="utf-8", newline="\n")
        self.process: subprocess.Popen[bytes] | None = None
        self.ready = threading.Event()
        self.exited = threading.Event()
        self.marker: str | None = None
        self.marked = threading.Event()
        self.port: int | None = None
        self._lock = threading.Lock()

    @property
    def pid(self) -> int | None:
        return self.process.pid if self.process else None

    def start(self) -> None:
        self.process = subprocess.Popen(
            self.args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, cwd=self.cwd
        )
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self) -> None:
        assert self.process is not None and self.process.stdout is not None
        for raw in self.process.stdout:
            line = raw.decode("utf-8", "replace").rstrip("\r\n")
            with self._lock:
                if not self.log.closed:
                    self.log.write(line + "\n")
            found = READY.search(line)
            if found:
                self.port = int(found.group(1))
                self.ready.set()
            found = MARKER.search(line)
            if found:
                self.marker = found.group(1)
                self.marked.set()
        self.exited.set()

    def wait_ready(self, timeout: float, stop_requested) -> str:
        """"ready", "exited", "stop" or "timeout"."""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.ready.wait(0.1):
                return "ready"
            if self.exited.is_set():
                return "exited"
            if stop_requested():
                return "stop"
        return "timeout"

    def wait_marker(self, timeout: float) -> str | None:
        self.marked.wait(timeout)
        return self.marker

    def stop(self) -> None:
        if self.process is not None and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(3)
            except subprocess.TimeoutExpired:
                self.process.kill()
                try:
                    self.process.wait(3)
                except subprocess.TimeoutExpired:
                    pass
        self.exited.wait(1)
        with self._lock:
            if not self.log.closed:
                self.log.close()
