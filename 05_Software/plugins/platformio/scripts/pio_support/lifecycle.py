"""The run's side of VERA's supervision (copy of gdb-debug's; spec REQ-DATA-f2cbfc23 section 6).

VERA gives a supervised run a control folder ($VERA_RUN_CONTROL): the helper reports its phase and the target's
physical state in `state.json` and stops at the next safe point when VERA creates `stop` there.
"""

from __future__ import annotations

import json
import os
from pathlib import Path


class Lifecycle:
    def __init__(self) -> None:
        folder = os.environ.get("VERA_RUN_CONTROL")
        self.folder = Path(folder) if folder else None
        self.phases: list[str] = []
        self.physical = "unchanged"
        self.stopped = False

    def report(self, phase: str, physical: str | None = None) -> None:
        if physical is not None:
            self.physical = physical
        if not self.phases or self.phases[-1] != phase:
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
