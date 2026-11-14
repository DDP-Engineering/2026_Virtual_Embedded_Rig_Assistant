"""Live gdb-debug operations: one finite, supervised session per call (spec REQ-DATA-d7da2a71 sections 5-8).

validate (caller) -> run folder -> OpenOCD on 127.0.0.1 -> GDB/MI -> identity and ELF match -> operation -> snapshot ->
detach under OpenOCD's exit-policy event -> both processes stopped. Every failure after the folder exists is recorded
in the result; the exit sequence runs on every path (REQ-REL-d5f06a9b).
"""

from __future__ import annotations

import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from . import elf, faults, mi, symbols
from .errors import Problem
from .lifecycle import Lifecycle
from .openocd import OpenOcd, arguments, free_port
from .profiles import Profile
from .registry import Probe
from .report import Result
from .session import Closed, Events, Failure, Interrupted, Session, Timeout

STEP_TIMEOUT = 10.0
CHUNK = 4096
MATCH_LIMIT = 4 * 1024 * 1024
READ_LIMIT = 256
SHF_WRITE = 0x1
CORE = (
    *(f"r{n}" for n in range(13)),
    "sp",
    "lr",
    "pc",
    "xpsr",
    "msp",
    "psp",
    "primask",
    "basepri",
    "faultmask",
    "control",
    "fpscr",
)
ADDRESS = re.compile(r"0x[0-9a-fA-F]+")
SCALAR = re.compile(
    r"(?:(?:unsigned|signed)\s+)?(?:char|short|int|long|long long|long int|short int|_Bool|bool)"
    r"|u?int(?:8|16|32|64)_t|size_t|uintptr_t|intptr_t"
)
NOT_SIGNED = re.compile(r"^(?:unsigned\b|u|size_t|_Bool|bool)")
LIMITS = [
    "No RTOS awareness: threads of an RTOS are not decoded (every profile declares rtos none).",
    "Peripheral registers and memory outside the profile's flash, RAM and System Control Block fault registers are "
    "never read.",
]


@dataclass(frozen=True)
class Request:
    operation: str
    probe: Probe
    profile: Profile
    elf_path: Path
    elf_shown: str
    image: elf.Elf
    reads: tuple[str, ...]
    frames: int
    location: str | None
    timeout: int | None
    count: int | None
    instruction: bool
    firmware_effect: str
    on_exit: str
    gdb: str
    openocd: str


class Stopped(Problem):
    def __init__(self) -> None:
        super().__init__("stopped", "Stopped by VERA (Stop, timeout or close); the exit policy was applied.", "incomplete")


def _int(value: Any) -> int | None:
    try:
        return int(str(value), 0)
    except ValueError:
        return None


class Live:
    def __init__(self, request: Request, result: Result, lifecycle: Lifecycle) -> None:
        self.request = request
        self.result = result
        self.lifecycle = lifecycle
        self.events = Events()
        self.session: Session | None = None
        self.server: OpenOcd | None = None
        self.match = "unchecked"
        self.compared = 0
        self.scratch: Path | None = None
        self.table = symbols.Symbols(request.image)
        self.limits: list[str] = list(LIMITS)
        self.target: dict[str, Any] = {"core": request.profile.core, "state": "unknown"}

    # -- helpers ---------------------------------------------------------------------------------------------------
    @property
    def trusted(self) -> bool:
        """Symbols are named only for an ELF whose flash was compared: all equal, or some bytes equal and none
        different (`unchecked` with a stated limit)."""
        return self.match == "matched" or (self.match == "unchecked" and self.compared > 0)

    def _command(self, text: str, timeout: float = 10.0, interruptible: bool = True) -> tuple[mi.Record, str]:
        assert self.session is not None
        return self.session.command(text, timeout, interruptible)

    def _console(self, text: str) -> str:
        return self._command(f"-interpreter-exec console {mi.quote(text)}")[1]

    def _read(self, address: int, size: int) -> bytes:
        record, _console = self._command(f"-data-read-memory-bytes 0x{address:x} {size}")
        blocks = record.results.get("memory") or []
        data = bytearray()
        for block in sorted(blocks, key=lambda b: _int(b.get("begin")) or 0):
            data += bytes.fromhex(str(block.get("contents", "")))
        if len(data) != size:
            raise Failure(f"GDB returned {len(data)} of {size} bytes at 0x{address:08x}.")
        return bytes(data)

    def _interrupt(self, seconds: float = 5) -> mi.Record:
        assert self.session is not None
        index = len(self.session.stops)
        self._command("-exec-interrupt", seconds, interruptible=False)
        stop = self.session.wait_stop(index, seconds, lambda: False)
        if not isinstance(stop, mi.Record):
            self.session.state = "unknown"
            raise Timeout("The core did not stop after an interrupt.")
        return stop

    # -- session ---------------------------------------------------------------------------------------------------
    def run(self) -> int:
        result = self.result
        folder = result.folder
        assert folder is not None
        self.lifecycle.report("start")
        try:
            self._connect(folder)
            self._identify()
            self._compare()
            self._operate()
        except Problem as problem:
            result.fail(problem)
        except Timeout as error:
            self.target["state"] = "unknown"
            result.problem("timeout", str(error), "error")
        except Interrupted:
            self.target["state"] = "unknown"
            result.fail(Stopped())
        except Closed as error:
            connected = self.session is not None and self.session.connected
            self.target["state"] = "disconnected" if connected else "unknown"
            result.problem("disconnected" if connected else "gdb", str(error), "error")
        except Failure as error:
            result.problem("gdb", error.message, "error")
        except Exception as error:  # noqa: BLE001 - the run must end with a result and its exit sequence
            result.problem("internal", f"{type(error).__name__}: {str(error)[:300]}", "error")
        finally:
            self._finish()
        result["limits"] = self.limits
        return 0 if result["status"] == "pass" else 3

    def _connect(self, folder: Path) -> None:
        request = self.request
        port = free_port()
        log = folder / "openocd.log"
        # OpenOCD resolves -f scripts against its working folder first: a fresh empty folder outside the workbench.
        self.scratch = Path(tempfile.mkdtemp(prefix="vera-openocd-"))
        self.server = OpenOcd(
            arguments(request.openocd, request.profile, request.probe, port, request.on_exit), self.scratch, log
        )
        self.result.keep(log)
        try:
            self.server.start()
        except OSError as error:
            raise Problem("openocd", f"OpenOCD could not be started: {error.strerror or error}.") from error
        self.result["server"] = {"address": "127.0.0.1", "port": port, "pid": self.server.pid}
        ready = self.server.wait_ready(20, self.lifecycle.stop_requested)
        if ready == "stop":
            raise Stopped()
        if ready != "ready" or self.server.port != port:
            raise Problem("openocd", f"OpenOCD did not open its GDB port 127.0.0.1:{port} ({ready}); see openocd.log.")
        mi_log = folder / "mi.log"
        self.session = Session(request.gdb, folder / "gdb", mi_log, self.events, self.lifecycle.stop_requested)
        self.result.keep(mi_log)
        try:
            self.session.start()
        except OSError as error:
            raise Problem("gdb", f"GDB could not be started: {error.strerror or error}.") from error
        try:
            self._command(f"-gdb-set architecture {request.profile.architecture}")
        except Failure as error:
            raise Problem(
                "architecture",
                f"This GDB does not support {request.profile.architecture}: {error.message}",
                "blocked",
            ) from error
        self._command(f"-file-exec-and-symbols {mi.quote(request.elf_path.as_posix())}")
        for start, size in request.profile.flash:
            self._console(f"mem 0x{start:08x} 0x{start + size:08x} ro")
        for start, size in request.profile.ram:  # Read-only for GDB too: no fixed command writes target memory.
            self._console(f"mem 0x{start:08x} 0x{start + size:08x} ro")
        scb = 4 if request.profile.faults == "v6m" else faults.SCB_LENGTH
        self._console(f"mem 0x{faults.SCB_BASE:08x} 0x{faults.SCB_BASE + scb:08x} ro")
        self._console("set mem inaccessible-by-default on")
        if self.lifecycle.stop_requested():
            raise Stopped()
        self.lifecycle.report("start", "pending")
        assert self.session is not None
        self.session.connected = True  # From here the core may be halted (OpenOCD's gdb-attach event).
        self._command(f"-target-select remote 127.0.0.1:{port}", 20)
        self.session.state = "halted"

    def _identify(self) -> None:
        profile = self.request.profile
        cpuid = int.from_bytes(self._read(faults.SCB_BASE, 4), "little")
        number, name = faults.part(cpuid)
        self.target.update({"cpuid": f"0x{cpuid:08x}", "partno": number, "detected": name})
        if (cpuid >> 4) & 0xFFF != profile.partno:
            raise Problem(
                "identity",
                f"The target's CPUID part {number} ({name}) is not the profile's core {profile.core} "
                f"(0x{profile.partno:03x}); nothing else was read.",
                "blocked",
            )
        self.lifecycle.report("identified", "pending")

    def _compare(self) -> None:
        image, profile = self.request.image, self.request.profile
        sections = [
            s
            for s in image.sections
            if s.type in (1, 7) and s.flags & elf.SHF_ALLOC and not s.flags & SHF_WRITE and s.size > 0
        ]
        report: list[dict[str, Any]] = []
        notes: list[str] = []
        budget = MATCH_LIMIT
        status = "matched"
        first: int | None = None
        for section in sections:
            entry: dict[str, Any] = {"name": section.name, "addr": f"0x{section.addr:08x}", "size": section.size}
            report.append(entry)
            if not any(start <= section.addr and section.addr + section.size <= start + size for start, size in profile.flash):
                entry["status"] = "unchecked"
                notes.append(f"{section.name} lies outside the profile's flash.")
                continue
            if section.size > budget:
                entry["status"] = "unchecked"
                notes.append(f"{section.name} exceeds the 4 MiB comparison bound.")
                continue
            budget -= section.size
            expected = image.contents(section)
            compared = 0
            entry["status"] = "matched"
            for offset in range(0, section.size, CHUNK):
                if self.lifecycle.stop_requested():
                    raise Stopped()
                size = min(CHUNK, section.size - offset)
                try:
                    actual = self._read(section.addr + offset, size)
                except Failure as error:
                    entry["status"] = "unchecked"
                    notes.append(f"{section.name} could not be read: {error.message}")
                    break
                if actual != expected[offset : offset + size]:
                    entry["status"] = "mismatched"
                    index = next(i for i in range(size) if actual[i] != expected[offset + i])
                    first = first if first is not None else section.addr + offset + index
                    break
                compared += size
            self.compared += compared
            if entry["status"] == "mismatched":
                status = "mismatched"
            elif entry["status"] == "unchecked" and status == "matched":
                status = "unchecked"
        if not sections:
            status = "unchecked"
            notes.append("The ELF has no read-only allocated section to compare.")
        self.match = status
        block = self.result["elf"]
        block.update({"match": status, "sections": report})
        if first is not None:
            block["firstDifference"] = f"0x{first:08x}"
        if notes:
            block["matchNote"] = " ".join(notes)[:400]
        block["compared"] = self.compared
        if status == "mismatched":
            self.result.problem(
                "elf-mismatch",
                "The ELF does not match the target's flash; symbols, sources and variables are withheld.",
                "incomplete",
            )
        elif status == "unchecked" and self.compared:
            self.result.problem(
                "elf-unchecked",
                f"Only {self.compared} bytes of the ELF were compared with the flash (all equal); symbols, sources and "
                "variables are reported but not fully verified.",
            )
            self.limits.append("The ELF match is unchecked for part of the image: attributions are not fully verified.")
        elif status == "unchecked":
            self.result.problem(
                "elf-unchecked",
                "No byte of the ELF could be compared with the flash; symbols, sources and variables are withheld.",
            )
            self.limits.append("The ELF could not be compared with the flash: no address is attributed to a symbol.")

    def _operate(self) -> None:
        request = self.request
        self.lifecycle.report("acting")
        if request.operation == "break":
            self._break()
        elif request.operation == "step":
            self._step()
        if self.lifecycle.stop_requested():
            raise Stopped()
        self.result["snapshot"] = self._snapshot()

    def _break(self) -> None:
        assert self.session is not None and self.request.location is not None
        record, _ = self._command(f"-break-insert -h {self.request.location}")
        bkpt = record.results.get("bkpt") or {}
        number = str(bkpt.get("number", ""))
        info: dict[str, Any] = {
            "location": self.request.location,
            "number": number,
            "address": bkpt.get("addr"),
            "hit": False,
            "reason": None,
        }
        self.result["breakpoint"] = info
        try:
            index = len(self.session.stops)
            self._command("-exec-continue")
            self.session.state = "running"
            outcome = self.session.wait_stop(index, float(self.request.timeout or 1), self.lifecycle.stop_requested)
            if outcome == "stop":
                self._interrupt()
                raise Stopped()
            if outcome is None:
                self._interrupt()
                info["reason"] = "timeout"
                self.result.problem("not-hit", f"The breakpoint was not hit within {self.request.timeout} s.", "incomplete")
                return
            assert isinstance(outcome, mi.Record)
            reason = str(outcome.results.get("reason", "unknown"))
            info["reason"] = reason
            info["hit"] = reason == "breakpoint-hit" and str(outcome.results.get("bkptno")) == number
            self.target["stopReason"] = reason
            if not info["hit"]:
                self.result.problem(
                    "unexpected-stop",
                    f"The core stopped for {reason} (breakpoint {outcome.results.get('bkptno', '-')}), "
                    "not at the requested breakpoint.",
                    "incomplete",
                )
        finally:
            if self.session.responsive and not self.session.closed and self.session.state == "halted" and number:
                try:
                    self._command(f"-break-delete {number}", 5, interruptible=False)
                except Failure:
                    pass

    def _step(self) -> None:
        assert self.session is not None
        steps: list[dict[str, Any]] = []
        self.result["steps"] = steps
        command = "-exec-step-instruction" if self.request.instruction else "-exec-step"
        for number in range(1, (self.request.count or 1) + 1):
            if self.lifecycle.stop_requested():
                raise Stopped()
            index = len(self.session.stops)
            self._command(command)
            self.session.state = "running"
            outcome = self.session.wait_stop(index, STEP_TIMEOUT, self.lifecycle.stop_requested)
            if outcome == "stop":
                self._interrupt()
                raise Stopped()
            if outcome is None:
                self._interrupt()
                steps.append({"index": number, "reason": "timeout"})
                self.result.problem("step-timeout", f"Step {number} did not end within {STEP_TIMEOUT:g} s.", "incomplete")
                return
            assert isinstance(outcome, mi.Record)
            reason = str(outcome.results.get("reason", "unknown"))
            frame = outcome.results.get("frame") or {}
            entry: dict[str, Any] = {"index": number, "reason": reason, "addr": frame.get("addr")}
            if self.trusted:
                for key in ("func", "file", "line"):
                    if key in frame:
                        entry[key] = frame[key]
            steps.append(entry)
            self.target["stopReason"] = reason
            if reason != "end-stepping-range":
                self.result.problem("unexpected-stop", f"Step {number} ended with {reason}.", "incomplete")
                return

    # -- snapshot --------------------------------------------------------------------------------------------------
    def _registers(self) -> dict[str, str]:
        names = self._command("-data-list-register-names")[0].results.get("register-names") or []
        values = self._command("-data-list-register-values --skip-unavailable x")[0].results.get("register-values") or []
        out: dict[str, str] = {}
        for item in values:
            number = _int(item.get("number"))
            if number is not None and 0 <= number < len(names) and names[number] in CORE:
                out[names[number]] = str(item.get("value"))
        return out

    def _frames(self) -> tuple[list[dict[str, Any]], bool]:
        limit = self.request.frames
        try:
            depth = _int(self._command(f"-stack-info-depth {limit + 1}")[0].results.get("depth")) or 0
            stack = self._command(f"-stack-list-frames 0 {limit - 1}")[0].results.get("stack") or []
        except Failure as error:
            self.limits.append(f"No backtrace: {error.message[:200]}")
            return [], False
        frames = []
        for frame in stack[:limit]:
            entry: dict[str, Any] = {"level": _int(frame.get("level")), "addr": frame.get("addr")}
            if self.trusted:
                for key in ("func", "file", "line"):
                    if key in frame:
                        entry[key] = frame[key]
                if "file" not in frame:
                    self.limits.append(f"Frame {entry['level']} ({frame.get('func', '??')}) has no source line information.")
            frames.append(entry)
        return frames, depth > limit

    def _locals(self) -> list[dict[str, Any]]:
        try:
            variables = self._command("-stack-list-variables --simple-values")[0].results.get("variables") or []
        except Failure as error:
            self.limits.append(f"No local variables: {error.message[:200]}")
            return []
        out = []
        for item in variables[:64]:
            value = item.get("value")
            entry = {"name": item.get("name"), "arg": item.get("arg") == "1", "type": item.get("type")}
            if value is not None:
                entry["value"] = str(value)[:120]
                if "<optimized out>" in str(value):
                    self.limits.append(f"{item.get('name')} is optimised out at this point.")
            out.append(entry)
        return out

    def _variable(self, name: str) -> dict[str, Any]:
        entry: dict[str, Any] = {"name": name}
        try:
            size = _int(self._command(f"-data-evaluate-expression {mi.quote(f'sizeof({name})')}")[0].results.get("value"))
            found = ADDRESS.search(
                str(self._command(f"-data-evaluate-expression {mi.quote(f'&({name})')}")[0].results.get("value", ""))
            )
            kind = self._console(f"whatis {name}").strip()
        except Failure as error:
            entry["error"] = error.message[:200]
            return entry
        entry["type"] = kind.removeprefix("type = ").strip()
        if size is None or found is None:
            entry["error"] = "GDB gave no size or address."
            return entry
        address = int(found.group(0), 16)
        entry.update({"address": f"0x{address:08x}", "size": size})
        if size > READ_LIMIT:
            entry["refused"] = f"larger than {READ_LIMIT} bytes"
            return entry
        if not self.request.profile.in_ram(address, size):
            entry["refused"] = "outside the profile's RAM"
            return entry
        try:
            data = self._read(address, size)
        except Failure as error:
            entry["error"] = error.message[:200]
            return entry
        entry["bytes"] = data.hex()
        base = re.sub(r"\b(?:volatile|const|static|register)\b", "", entry["type"]).strip()
        if size in (1, 2, 4, 8) and SCALAR.fullmatch(base):
            entry["value"] = int.from_bytes(data, "little", signed=not NOT_SIGNED.match(base))
        return entry

    def _snapshot(self) -> dict[str, Any]:
        assert self.session is not None
        profile = self.request.profile
        if self.session.state != "halted":
            raise Problem("state", f"The core is {self.session.state}; no snapshot was taken.")
        registers = self._registers()
        numbers = {name: value for name, text in registers.items() if (value := _int(text)) is not None}
        snapshot: dict[str, Any] = {"registers": registers}
        frames, truncated = self._frames()
        snapshot["frames"] = frames
        snapshot["depthTruncated"] = truncated
        if self.trusted:
            snapshot["locals"] = self._locals()
            snapshot["reads"] = [self._variable(name) for name in self.request.reads]
        else:
            snapshot["locals"] = []
            snapshot["reads"] = [
                {"name": name, "refused": "the ELF is not verified against the target"} for name in self.request.reads
            ]
        scb = None if profile.faults == "v6m" else self._read(faults.SCB_BASE, faults.SCB_LENGTH)
        if scb is not None:
            snapshot["scb"] = scb.hex()
        frame = None
        where = faults.stacked_address(numbers)
        if where is not None and profile.in_ram(where, 32):
            try:
                raw = self._read(where, 32)
                frame = [int.from_bytes(raw[i : i + 4], "little") for i in range(0, 32, 4)]
            except Failure as error:
                self.limits.append(f"The stacked exception frame at 0x{where:08x} could not be read: {error.message[:160]}")
        fault = faults.decode(profile.faults, numbers, scb, frame)
        sites = [symbols.site(self.table, "pc", numbers.get("pc"), self.trusted)]
        lr = numbers.get("lr")
        if lr is not None and lr >> 24 != 0xFF:
            sites.append(symbols.site(self.table, "lr", lr, self.trusted))
        if frame is not None:
            sites.append(symbols.site(self.table, "stacked-pc", frame[6], self.trusted))
            sites.append(symbols.site(self.table, "stacked-lr", frame[5], self.trusted))
        fault["sites"] = sites
        snapshot["fault"] = fault
        self.limits.extend(fault.pop("limits", []))
        return snapshot

    # -- exit ------------------------------------------------------------------------------------------------------
    def _finish(self) -> None:
        self.lifecycle.report("cleaning")
        session, server = self.session, self.server
        connected = session is not None and session.connected
        if session is not None:
            self.target["state"] = session.state if self.target["state"] == "unknown" else self.target["state"]
            if session.alive() and session.responsive and not session.closed:
                # Bounded: interrupt 3+3, detach 3, exit 2, wait 2, kill <= 5 s, then marker 3 s and OpenOCD stop up to
                # 7 s: at most about 28 s, inside the manifest's 30 s grace.
                try:
                    if connected and session.state == "running":
                        self._interrupt(3)
                    if connected:
                        self._command("-target-detach", 3, interruptible=False)
                except (Timeout, Closed, Failure) as error:
                    self.events.add("exit", f"detach: {error}")
                try:
                    if session.alive() and session.responsive and not session.closed:
                        self._command("-gdb-exit", 2, interruptible=False)
                except (Timeout, Closed, Failure):
                    pass
                try:
                    if session.process is not None:
                        session.process.wait(2)
                except subprocess.TimeoutExpired:
                    pass
            session.drain(0.2)
            session.kill()
        marker = server.wait_marker(3) if server is not None and connected else None
        if server is not None:
            server.stop()
        if self.scratch is not None:
            shutil.rmtree(self.scratch, ignore_errors=True)
        expected = "halted" if self.request.on_exit == "halted" else "running"
        if not connected:
            physical = "unchanged"
        elif marker == expected:
            physical = "confirmed"
        else:
            physical = "unknown"
        self.target["after"] = marker or "unknown"
        self.result["target"] = self.target
        self.result["events"] = self.events.items
        if self.events.dropped:
            self.result["eventsDropped"] = self.events.dropped
        self.lifecycle.report("released", physical)
        self.result["lifecycle"] = {"phases": self.lifecycle.phases, "physical": physical}
        if connected and physical == "unknown":
            self.result.problem(
                "exit-unconfirmed",
                f"OpenOCD did not confirm the core {expected} after the detach; its state is unknown.",
            )
