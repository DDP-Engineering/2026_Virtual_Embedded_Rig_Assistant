"""run, capture-uart and test on the engine (spec REQ-DATA-8a943977 sections 5-7).

Virtual time advances in the profile's fixed slices, so every line time, stimulus and observation falls on the same
virtual instant on every run of the same inputs (REQ-REL-a663fd2d). The run's real budget is the helper's own wall-clock
deadline (REQ-REL-884979c1); the virtual budgets bound the run, each case and each step (REQ-FUNC-9431b520).
"""

from __future__ import annotations

import re
import shutil
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from . import engine as engine_mod
from .engine import LogWatch, RealTimeout, Session, UartWatch, monitor_path, timespan, virtual_seconds
from .errors import EngineError
from .profiles import Profile
from .result import LINES_KEPT, Run
from .testsets import TestSet


@dataclass
class Plan:
    """What one engine operation runs: the virtual budget, the real deadline and the UART it records."""

    profile: Profile
    firmware: Path
    validation: dict[str, Any]
    uart: str
    virtual_budget: float
    real_deadline: float
    until: re.Pattern[str] | None = None
    testset: TestSet | None = None
    lines_seen: list[str] = field(default_factory=list)


class PathUnsafe(Exception):
    """The run folder's path holds characters a monitor @path token cannot carry."""


class Simulation:
    """One engine session over the run folder, advanced slice by slice."""

    def __init__(self, run: Run, plan: Plan, executable: Path) -> None:
        self.run = run
        self.plan = plan
        self.executable = executable
        folder = run.folder
        assert folder is not None
        self.folder = folder
        self.slice = plan.profile.slice
        self.slices = 0
        base = monitor_path(folder)
        if base is None:
            raise PathUnsafe(folder.as_posix())
        self.base = base
        self.monitor = open(folder / "monitor.log", "w", encoding="utf-8", newline="\n")  # noqa: SIM115
        self.session = Session(executable, folder, plan.real_deadline, self._transcript, f"{base}/renode.config")
        self.uart = UartWatch(folder, plan.uart)
        self.log = LogWatch(folder / "engine.log")

    def _transcript(self, text: str) -> None:
        try:
            self.monitor.write(text)
            self.monitor.flush()
        except OSError:
            pass

    @property
    def virtual(self) -> float:
        return round(self.slices * self.slice, 9)

    def start(self) -> None:
        """Starts the engine and sends the session's commands: log file, approved profile commands, firmware, UART file."""
        base = self.base
        self.session.start()
        send = self.session.command
        send(f"logFile @{base}/engine.log true")
        for command in self.plan.profile.commands:
            kind = command[0]
            if kind == "using-sysbus":
                send("using sysbus")
            elif kind == "mach-create":
                send(f'mach create "{self.plan.profile.id}"')
            elif kind == "load-platform":
                send(f"machine LoadPlatformDescription @{base}/profile/{self.plan.profile.data['repl']}")
            elif kind == "mips":
                send(f"sysbus.cpu PerformanceInMips {command[1]}")
            elif kind == "quantum":
                send(f'emulation SetGlobalQuantum "{command[1]}"')
        send(f"sysbus LoadELF @{base}/firmware.elf")
        send(f"sysbus.cpu VectorTableOffset {self.plan.profile.boot:#010x}")
        self.target = self.plan.profile.data["uarts"][self.plan.uart]
        self._open_segment()

    def _open_segment(self) -> None:
        self.session.command(f"{self.target} CreateFileBackend @{self.base}/{self.uart.part.name} true")

    def _collect(self, final: bool = False) -> None:
        """Closes a grown UART segment, reads it and opens the next one (the final call opens none)."""
        if not self.uart.grown() and not final:
            return
        self.session.command(f"{self.target} CloseFileBackend @{self.base}/{self.uart.part.name}")
        self.uart.take(self.virtual, final)
        if not final:
            self._open_segment()

    def advance(self) -> None:
        """One virtual slice, then the new UART lines and engine-log findings; the heartbeat keeps result.json current."""
        if time.monotonic() >= self.plan.real_deadline:
            raise RealTimeout()
        remaining = self.plan.real_deadline - time.monotonic()
        self.session.command(f'emulation RunFor "{timespan(self.slice)}"', seconds=max(1.0, remaining))
        self.slices += 1
        self._collect()
        self.log.poll(self.virtual)
        if self.log.errors:
            raise EngineError(f"The engine logged an error: {self.log.errors[0]}")
        self.run["time"]["virtualSeconds"] = self.virtual
        self.run["unmodeled"] = self.log.entries()
        self._record_uart()
        self.run.write()

    def _record_uart(self) -> None:
        lines = self.uart.lines
        self.run["uart"] = {
            "name": self.plan.uart,
            "log": f"uart-{self.plan.uart}.log",
            "lines": [{"t": t, "text": text[:400]} for t, text in lines[:LINES_KEPT]],
            "total": self.uart.total,
            "truncated": self.uart.total > LINES_KEPT,
        }

    def read_state(self, target: str) -> bool:
        answer = self.session.command(f"{target} State", answer=True)
        word = answer.strip().split("\n")[-1].strip()
        if word.lower() not in ("true", "false"):
            raise EngineError(f"{target} State answered {answer[:80]!r}, not True or False.")
        return word.lower() == "true"

    def stimulus(self, step: dict[str, Any]) -> str:
        if step["kind"] == "button":
            self.session.command(f"{step['target']} {'Press' if step['action'] == 'press' else 'Release'}")
            return f"{step['name']} {step['action']}"
        for byte in step["text"].encode("ascii"):
            self.session.command(f"{step['target']} WriteChar {byte:#04x}")
        return f"{step['name']} wrote {len(step['text'])} characters"

    def stop(self) -> None:
        """Reads the engine's own virtual time and quits it; the final UART bytes and log lines are read after."""
        self._collect(final=True)
        try:
            answer = self.session.command("emulation GetTimeSourceInfo", seconds=10, answer=True)
            self.run["time"]["engineVirtual"] = virtual_seconds(answer)
        except (EngineError, RealTimeout):
            pass
        self.session.close()
        self.log.poll(self.virtual)
        self.run["unmodeled"] = self.log.entries()
        self._record_uart()
        self.monitor.close()

    def kill(self) -> None:
        self.session.kill()
        process = self.session.process
        if process is None or process.poll() is not None:
            # The engine is gone, so its open segment can be read now.
            try:
                self.uart.take(self.virtual, final=True)
            except EngineError as error:
                self._transcript(f"[uart] {error.message}\n")
                self.run.set_status("error", "engine", error.message)
        else:
            reason = "The engine did not end after the kill; its last UART segment could not be read."
            self._transcript(f"[uart] {reason}\n")
            self.run.set_status("error", "engine", reason)
        self.log.poll(self.virtual)
        self.run["unmodeled"] = self.log.entries()
        self._record_uart()
        try:
            self.monitor.close()
        except OSError:
            pass


class Steps:
    """The step interpreter of test sets, also used by capture-uart (one uart step)."""

    def __init__(self, sim: Simulation, run_end: float) -> None:
        self.sim = sim
        self.cursor = 0
        self.run_end = run_end

    def _deadline(self, within: float, case_end: float) -> float:
        return min(self.sim.virtual + within, case_end, self.run_end)

    def uart(self, step: dict[str, Any], case_end: float) -> tuple[str, str | None, str]:
        deadline = self._deadline(step["within"], case_end)
        while True:
            lines = self.sim.uart.lines
            while self.cursor < len(lines):
                t, text = lines[self.cursor]
                self.cursor += 1
                if step["pattern"].search(text):
                    return "pass", None, f"matched {text[:200]!r} at virtual {t:.6f} s"
                if step["fail"] is not None and step["fail"].search(text):
                    return "fail", "assertion", f"line {text[:200]!r} at virtual {t:.6f} s matched the failure pattern"
            if self.sim.virtual >= deadline - 1e-9:
                return "timeout", "virtual-timeout", f"no line matched {step['pattern'].pattern[:120]!r} by virtual {deadline:.6f} s"
            self.sim.advance()

    def count(self, step: dict[str, Any], case_end: float) -> tuple[str, str | None, str]:
        start = self.sim.virtual
        end = start + step["over"]
        if end > min(case_end, self.run_end) + 1e-9:
            return "timeout", "virtual-timeout", f"counting {step['over']} s does not fit the remaining virtual budget"
        while self.sim.virtual < end - 1e-9:
            self.sim.advance()
        lines = self.sim.uart.lines
        counted = sum(1 for t, text in lines[self.cursor:] if start < t <= end + 1e-9 and step["pattern"].search(text))
        self.cursor = len(lines)
        detail = f"{counted} lines matched {step['pattern'].pattern[:80]!r} in virtual {start:.6f}-{end:.6f} s"
        if step["min"] <= counted <= step["max"]:
            return "pass", None, detail
        return "fail", "assertion", detail + f", expected {step['min']}-{step['max']}"

    def observe(self, step: dict[str, Any], case_end: float) -> tuple[str, str | None, str]:
        deadline = self._deadline(step["within"], case_end)
        wanted = self.sim.virtual + step["within"]
        while True:
            value = self.sim.read_state(step["target"])
            if value == step["equals"]:
                return "pass", None, f"{step['name']} was {value} at virtual {self.sim.virtual:.6f} s"
            if self.sim.virtual >= deadline - 1e-9:
                if deadline < wanted - 1e-9:
                    return "timeout", "virtual-timeout", f"{step['name']} was {value}; the virtual budget ended at {deadline:.6f} s"
                return "fail", "assertion", f"{step['name']} was {value}, not {step['equals']}, by virtual {deadline:.6f} s"
            self.sim.advance()

    def run_for(self, step: dict[str, Any], case_end: float) -> tuple[str, str | None, str]:
        end = self.sim.virtual + step["for"]
        limit = min(case_end, self.run_end)
        while self.sim.virtual < min(end, limit) - 1e-9:
            self.sim.advance()
        if end > limit + 1e-9:
            return "timeout", "virtual-timeout", f"running {step['for']} s exceeded the virtual budget"
        return "pass", None, f"ran to virtual {self.sim.virtual:.6f} s"

    def step(self, step: dict[str, Any], case_end: float) -> tuple[str, str | None, str]:
        kind = step["do"]
        if kind == "uart":
            return self.uart(step, case_end)
        if kind == "count":
            return self.count(step, case_end)
        if kind == "observe":
            return self.observe(step, case_end)
        if kind == "run":
            return self.run_for(step, case_end)
        return "pass", None, self.sim.stimulus(step)


def _prepare_folder(run: Run, plan: Plan) -> Path:
    """Copies the firmware and the profile files into the run folder; the engine reads only these copies."""
    folder = run.folder
    assert folder is not None
    copy = folder / "firmware.elf"
    shutil.copyfile(plan.firmware, copy)
    profile_copy = folder / "profile"
    profile_copy.mkdir()
    for name in plan.profile.files:
        shutil.copyfile(plan.profile.folder / name, profile_copy / name)
    if plan.testset is not None:
        (folder / "testset.json").write_bytes(plan.testset.raw)
    return copy


def _not_run(plan: Plan, cases: list[dict[str, Any]], reason: str) -> None:
    if plan.testset is None:
        return
    done = {case["id"] for case in cases}
    for case in plan.testset.cases:
        if case["id"] not in done:
            cases.append({"id": case["id"], "requirement": case["requirement"], "hil": case["hil"],
                          "status": "incomplete", "code": "not-run", "reason": f"not run: {reason}",
                          "virtualSeconds": 0.0, "realSeconds": 0.0, "steps": []})


def _check_start(run: Run, plan: Plan, sim: Simulation) -> None:
    """The engine must have started the firmware from the validated vector table (a silent setup failure is an error)."""
    if sim.slices == 0 or run["status"] in ("error", "blocked"):
        return
    vector = plan.validation["vectorTable"]
    expected = (int(vector["reset"], 16) & ~1, int(vector["initialSp"], 16))
    initial = sim.log.initial
    if initial is None:
        run.set_status("error", "engine", "The engine log does not show the firmware starting (no initial PC and SP).")
    elif (initial[0] & ~1, initial[1]) != expected:
        run.set_status("error", "engine", f"The engine started at PC {initial[0]:#010x}, SP {initial[1]:#010x}, not the "
                       f"validated vector table ({expected[0] | 1:#010x}, {expected[1]:#010x}).")
    engine_virtual = run["time"].get("engineVirtual")
    if engine_virtual is not None and abs(engine_virtual - sim.virtual) > sim.slice / 2:
        run.set_status("error", "engine", f"The engine reports {engine_virtual} virtual seconds, not the {sim.virtual} "
                       "renode-sim advanced.")


def execute(run: Run, plan: Plan, executable: Path, operation: str) -> None:
    """Runs one engine operation into the run folder; sets the statuses and leaves no engine process."""
    copy = _prepare_folder(run, plan)
    plan.firmware = copy
    try:
        sim = Simulation(run, plan, executable)
    except PathUnsafe as error:
        run.set_status("blocked", "run-path", f"The run folder {error} holds spaces or characters the Renode monitor "
                       "cannot take in a path; use a workbench or --results-dir path without them.")
        _not_run(plan, run["cases"] if isinstance(run["cases"], list) else [], "the run folder path cannot be used")
        return
    cases: list[dict[str, Any]] = []
    run["cases"] = cases
    current: dict[str, Any] | None = None
    try:
        try:
            sim.start()
        except EngineError as error:
            if sim.session.process is not None and run["engine"]:
                run["engine"]["pid"] = sim.session.process.pid
            run.set_status("error", "engine", error.message)
            sim.kill()
            _not_run(plan, cases, "the engine could not be set up")
            return
        if sim.session.process is not None and run["engine"]:
            run["engine"]["pid"] = sim.session.process.pid
        run.write(force=True)
        steps = Steps(sim, plan.virtual_budget)
        if operation == "run":
            while sim.virtual < plan.virtual_budget - 1e-9:
                sim.advance()
        elif operation == "capture-uart":
            assert plan.until is not None
            status, code, detail = steps.uart({"pattern": plan.until, "fail": None, "within": plan.virtual_budget}, plan.virtual_budget)
            run["capture"] = {"status": status, "detail": detail}
            if status != "pass":
                run.set_status(status, code, detail)
        else:
            assert plan.testset is not None
            pending = list(plan.testset.cases)
            for case in plan.testset.cases:
                pending.pop(0)
                started_v, started_r = sim.virtual, time.monotonic()
                current = {"id": case["id"], "requirement": case["requirement"], "hil": case["hil"], "status": "running",
                           "code": None, "reason": None, "virtualSeconds": 0.0, "realSeconds": 0.0, "steps": [],
                           "startVirtual": started_v}
                cases.append(current)
                run.write(force=True)
                before = sim.log.events
                if sim.virtual >= plan.virtual_budget - 1e-9:
                    current.update(status="timeout", code="virtual-timeout", reason="the run's virtual budget was used")
                else:
                    case_end = min(started_v + case["budget"], plan.virtual_budget)
                    for index, step in enumerate(case["steps"]):
                        step_v, step_r = sim.virtual, time.monotonic()
                        status, code, detail = steps.step(step, case_end)
                        current["steps"].append({
                            "index": index + 1, "do": step["do"], "status": status, "virtual": round(sim.virtual, 6),
                            "virtualSeconds": round(sim.virtual - step_v, 6), "realSeconds": round(time.monotonic() - step_r, 3),
                            "detail": detail,
                        })
                        if status != "pass":
                            current.update(status=status, code=code, reason=detail)
                            break
                if current["status"] == "running":
                    current["status"] = "pass"
                if current["status"] == "pass" and sim.log.events > before:
                    current.update(status="incomplete", code="unmodeled-peripheral",
                                   reason="the firmware accessed a peripheral or register the model does not implement")
                current["virtualSeconds"] = round(sim.virtual - started_v, 6)
                current["realSeconds"] = round(time.monotonic() - started_r, 3)
                current = None
                run.write(force=True)
            for case in cases:
                if case["status"] != "pass":
                    run.set_status(case["status"], case["code"], f"case {case['id']}: {case['reason']}")
        sim.stop()
        _check_start(run, plan, sim)
    except RealTimeout:
        sim.kill()
        reason = "the real-time budget ended; the engine was stopped"
        run.set_status("timeout", "real-timeout", reason)
        if current is not None:
            current.update(status="timeout", code="real-timeout", reason=reason)
        _not_run(plan, cases, "the real-time budget ended")
    except EngineError as error:
        sim.kill()
        run.set_status("error", "engine", error.message)
        if current is not None:
            current.update(status="error", code="engine", reason=error.message)
        _not_run(plan, cases, "the engine failed")
    except BaseException:
        sim.kill()
        raise
    finally:
        if run["unmodeled"]:
            run.set_status("incomplete", "unmodeled-peripheral",
                           f"{len(run['unmodeled'])} access(es) to addresses or registers the model does not implement")
        run["time"]["virtualSeconds"] = sim.virtual
        if sim.session.process is not None:
            engine_mod.kill_tree(sim.session.process)
