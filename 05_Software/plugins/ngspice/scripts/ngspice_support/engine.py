"""Running ngspice (spec REQ-DATA-29b9a988 §2, §5, §6): locating the engine, the effective netlist with the helper's
own control block, the batch run under a deadline, the log classification and the series."""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .request import Problem, Refused, Request

MINIMUM = 42
_VERSION = re.compile(r"ngspice-(\d+)")
_PROBLEMS = (
    ("convergence", re.compile(r"no convergence|timestep too small|gmin stepping failed|source stepping failed", re.I)),
    ("singular", re.compile(r"singular matrix", re.I)),
    ("model", re.compile(r"could not find|can't find model|unknown model|unknown subckt", re.I)),
    ("vector", re.compile(r"no such vector|vector .* not found", re.I)),
    ("engine", re.compile(r"^\s*error\b|fatal error|simulation interrupted", re.I)),
)


@dataclass
class Engine:
    executable: str
    version: str


@dataclass
class Outcome:
    status: str  # ok | failed | timeout
    exit: int | None
    seconds: float
    problems: list[dict[str, str]] = field(default_factory=list)
    columns: list[str] = field(default_factory=list)
    rows: list[list[float]] = field(default_factory=list)


def locate() -> Engine:
    """The engine VERA resolved (VERA_PROGRAM_NGSPICE), else the usual places; version 42 or newer."""
    windows = sys.platform == "win32"
    candidates: list[str] = []
    given = os.environ.get("VERA_PROGRAM_NGSPICE")
    if given:
        candidates.append(given)
    else:
        names = ("ngspice_con.exe",) if windows else ("ngspice",)
        for folder in os.environ.get("PATH", "").split(os.pathsep):
            if folder and os.path.isabs(folder):
                candidates += [os.path.join(folder, name) for name in names]
        candidates += (["C:/Spice64/bin/ngspice_con.exe"] if windows else ["/usr/bin/ngspice", "/usr/local/bin/ngspice"])
    for candidate in candidates:
        if not os.path.isfile(candidate):
            continue
        try:
            done = subprocess.run([candidate, "-v"], capture_output=True, text=True, timeout=30, stdin=subprocess.DEVNULL,
                                  encoding="utf-8", errors="replace")
        except (OSError, subprocess.SubprocessError):
            continue
        match = _VERSION.search(done.stdout + done.stderr)
        if match:
            if int(match.group(1)) < MINIMUM:
                raise Refused([Problem("engine", "", f"{candidate} is ngspice-{match.group(1)}; ngspice-tool needs ngspice {MINIMUM} or newer.")])
            return Engine(candidate, match.group(1))
    searched = "VERA_PROGRAM_NGSPICE" if given else "PATH and the usual install folders"
    raise Refused([Problem("engine", "", f"No ngspice was found ({searched}). In VERA choose Install programs for the ngspice plugin; on Ubuntu run: sudo apt install ngspice.")])


def _number(value: float) -> str:
    return repr(float(value))


def analysis_line(analysis: dict[str, Any]) -> str:
    kind = analysis["kind"]
    if kind == "op":
        return "op"
    if kind == "dc":
        return f"dc {analysis['source']} {_number(analysis['start'].value)} {_number(analysis['stop'].value)} {_number(analysis['step'].value)}"
    if kind == "ac":
        return f"ac {analysis['sweep']} {analysis['points']} {_number(analysis['start'].value)} {_number(analysis['stop'].value)}"
    if kind == "noise":
        return f"noise {analysis['output']} {analysis['source']} {analysis['sweep']} {analysis['points']} {_number(analysis['start'].value)} {_number(analysis['stop'].value)}"
    line = f"tran {_number(analysis['step'].value)} {_number(analysis['stop'].value)} {_number(analysis['start'].value)}"
    if analysis.get("maxStep") is not None:
        line += f" {_number(analysis['maxStep'].value)}"
    return line


def control_block(request: Request, series: str, parameters: dict[str, float], temperature: float | None) -> str:
    """The only control block of the effective netlist; it sets no solver option."""
    lines = [".control", "set wr_singlescale", "set wr_vecnames", "set numdgt=10"]
    for name, value in parameters.items():
        lines.append(f"alterparam {name}={_number(value)}")
    if parameters:
        lines.append("reset")
    if temperature is not None:
        lines.append(f"option temp={_number(temperature)}")
    lines.append(analysis_line(request.analysis))
    if request.analysis["kind"] == "noise":
        lines += ["setplot noise1", f"wrdata {series} onoise_spectrum inoise_spectrum"]
    else:
        lines.append(f"wrdata {series} {' '.join(request.vectors)}")
    lines += ["quit", ".endc", ".end"]
    return "\n".join(lines) + "\n"


def run(engine: Engine, cwd: Path, effective: str, series: str, log: str, time_limit: float) -> Outcome:
    """Runs `ngspice -b -n effective` in `cwd`; on the deadline the engine is killed and the run is `timeout`."""
    started = time.monotonic()
    with open(cwd / log, "wb") as handle:
        flags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0  # type: ignore[attr-defined]
        process = subprocess.Popen([engine.executable, "-b", "-n", effective], cwd=cwd, stdin=subprocess.DEVNULL,
                                   stdout=handle, stderr=subprocess.STDOUT, creationflags=flags)
        try:
            code = process.wait(timeout=time_limit)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
            return Outcome("timeout", None, time.monotonic() - started,
                           [{"kind": "timeout", "line": f"The engine ran longer than {time_limit:g} s and was stopped."}])
    seconds = time.monotonic() - started
    text = (cwd / log).read_text(encoding="utf-8", errors="replace")
    problems: list[dict[str, str]] = []
    for line in text.splitlines():
        # The circuit's own name is echoed as "Circuit: ..."; its words are not engine messages.
        if line.lstrip().lower().startswith("circuit:"):
            continue
        for kind, pattern in _PROBLEMS:
            if pattern.search(line):
                entry = {"kind": kind, "line": line.strip()[:300]}
                if entry not in problems and len(problems) < 20:
                    problems.append(entry)
                break
    path = cwd / series
    if code != 0 or problems or not path.is_file():
        if not path.is_file() and not problems:
            problems.append({"kind": "engine", "line": "The engine wrote no series."})
        return Outcome("failed", code, seconds, problems)
    columns, rows = parse_series(path)
    if not rows:
        return Outcome("failed", code, seconds, [{"kind": "engine", "line": "The engine wrote an empty series."}])
    return Outcome("ok", code, seconds, [], columns, rows)


def parse_series(path: Path) -> tuple[list[str], list[list[float]]]:
    """wrdata with wr_singlescale and wr_vecnames: a header of names (scale first) and rows of numbers. A complex
    vector takes two columns under one name; they become `<name> re` and `<name> im`."""
    lines = [line for line in path.read_text(encoding="utf-8", errors="replace").splitlines() if line.strip()]
    if not lines:
        return [], []
    names = lines[0].split()
    rows = []
    for line in lines[1:]:
        try:
            rows.append([float(value) for value in line.split()])
        except ValueError:
            continue
    columns: list[str] = []
    for position, name in enumerate(names):
        if position > 0 and names.count(name) == 2:
            columns.append(f"{name} {'re' if names.index(name) == position else 'im'}")
        else:
            columns.append(name)
    rows = [row for row in rows if len(row) == len(columns)]
    return columns, rows


def copy_inputs(chain: Any, run_dir: Path, transform: Any, copy_target: Any) -> None:
    for index, source in enumerate(chain.files):
        target = run_dir / copy_target(source.rel)
        target.parent.mkdir(parents=True, exist_ok=True)
        with open(target, "x", encoding="utf-8", newline="\n") as handle:
            handle.write(transform(chain, index))


def remove(path: Path) -> None:
    shutil.rmtree(path, ignore_errors=True)
