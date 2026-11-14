"""The run's side of VERA's supervision (spec REQ-DATA-f2cbfc23 section 6).

VERA gives a supervised run a control folder ($VERA_RUN_CONTROL): the helper reports its phase and the resource's
physical state in `state.json` and stops at the next safe point when VERA creates `stop` there. $VERA_RESOURCE_STATE
names resources whose physical state VERA recorded as unknown.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

PHASES = ("start", "identified", "acting", "cleaning", "released")
PHYSICAL = ("unchanged", "pending", "confirmed", "unknown")
POLL = 0.1


class Lifecycle:
    def __init__(self) -> None:
        folder = os.environ.get("VERA_RUN_CONTROL")
        self.folder = Path(folder) if folder else None
        self.phases: list[str] = []
        self.physical = "unchanged"
        self.stopped = False
        try:
            self.states = json.loads(os.environ.get("VERA_RESOURCE_STATE") or "{}")
            if not isinstance(self.states, dict):
                self.states = {}
        except json.JSONDecodeError:
            self.states = {}

    def report(self, phase: str, physical: str | None = None) -> None:
        if physical is not None:
            self.physical = physical
        self.phases.append(phase)
        if self.folder is None:
            return
        target = self.folder / "state.json"
        temporary = self.folder / "state.json.tmp"
        try:
            temporary.write_text(json.dumps({"format": 1, "phase": phase, "physical": self.physical}), encoding="utf-8")
            os.replace(temporary, target)
        except OSError:
            pass

    def stop_requested(self) -> bool:
        if not self.stopped and self.folder is not None and (self.folder / "stop").exists():
            self.stopped = True
        return self.stopped

    def wait(self, seconds: float) -> bool:
        """Sleeps up to `seconds`; True as soon as a stop is requested."""
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            if self.stop_requested():
                return True
            time.sleep(min(POLL, max(0.0, end - time.monotonic())))
        return self.stop_requested()

    def unknown(self, alias: str) -> dict | None:
        state = self.states.get(alias)
        return state if isinstance(state, dict) and state.get("state") == "unknown" else None
