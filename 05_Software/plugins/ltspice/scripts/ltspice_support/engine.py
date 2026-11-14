"""LTspice as ltspice-tool runs it (spec REQ-DATA-0f9e36a3 §2, §5-§7, §9, §10): the user's LTspice 26 or newer, the
effective netlist's cards, `LTspice.exe -b` as a child of the helper with a deadline and a data watchdog, the log's
problems, and the series of the raw file under ngspice-tool's names."""

from __future__ import annotations

import math
import os
import re
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from . import netlist, raw, workspace
from .request import Problem, Refused

MINIMUM = 26
_VERSION = re.compile(r"^\s*(\d+)\.(\d+)(?:\.(\d+))?", re.M)
CREATE_NO_WINDOW = 0x08000000
HEADER_ALLOWANCE = 64 * 1024
ROW_LIMIT_OVERRIDE: int | None = None  # a test hook lowers the data limit
HINT = ("Install LTspice from https://www.analog.com/ltspice (LTspice64.msi, Windows 10/11 x64); if the per-user install "
        "fails with error 2503, install it for all users from an administrator prompt: msiexec /i LTspice64.msi ALLUSERS=1.")
_PROBLEMS = (
    ("model", re.compile(r"undefined model", re.I)),
    ("subckt", re.compile(r"sub-?circuit name is not defined|unknown subcircuit", re.I)),
    ("include", re.compile(r"file not found", re.I)),
    ("singular", re.compile(r"over-defined circuit matrix|singular matrix", re.I)),
    ("convergence", re.compile(r"time step too small|iteration limit reached|failed to find (the )?operating point|"
                               r"convergence failure|simulation failed", re.I)),
)
_LOCATED = re.compile(r"^.*\(\d+\): .+$")


@dataclass
class Engine:
    executable: str
    version: str
    install: str  # per-user | all-users | other


@dataclass
class Outcome:
    status: str  # ok | failed | timeout
    exit: int | None
    seconds: float
    problems: list[dict[str, str]] = field(default_factory=list)
    loaded: list[str] = field(default_factory=list)
    data: raw.Raw | None = None
    log_steps: list[str] = field(default_factory=list)


def _install_folders() -> tuple[Path | None, Path | None]:
    local, program_files = os.environ.get("LOCALAPPDATA"), os.environ.get("ProgramFiles")
    return (Path(local) / "Programs" / "ADI" / "LTspice" if local else None,
            Path(program_files) / "ADI" / "LTspice" if program_files else None)


def locate() -> Engine:
    """The engine VERA resolved (VERA_PROGRAM_LTSPICE), else the per-user or all-users install; version 26 or newer."""
    per_user, all_users = _install_folders()
    given = os.environ.get("VERA_PROGRAM_LTSPICE")
    candidates = [given] if given else [str(folder / "LTspice.exe") for folder in (per_user, all_users) if folder]
    for candidate in candidates:
        if not os.path.isfile(candidate):
            continue
        try:
            done = subprocess.run([candidate, "-version"], capture_output=True, text=True, timeout=30, stdin=subprocess.DEVNULL,
                                  encoding="utf-8", errors="replace", creationflags=CREATE_NO_WINDOW if sys.platform == "win32" else 0)
        except (OSError, subprocess.SubprocessError):
            continue
        match = _VERSION.search(done.stdout)
        if not match:
            continue
        version = ".".join(g for g in match.groups() if g is not None)
        if int(match.group(1)) < MINIMUM:
            raise Refused([Problem("engine", "", f"This LTspice is version {version}; ltspice-tool needs LTspice {MINIMUM} or newer. {HINT}")])
        place = os.path.normcase(os.path.dirname(os.path.realpath(candidate)))
        install = "other"
        for folder, kind in ((per_user, "per-user"), (all_users, "all-users")):
            if folder and place == os.path.normcase(os.path.realpath(folder)):
                install = kind
        return Engine(candidate, version, install)
    searched = "VERA_PROGRAM_LTSPICE" if given else "the per-user and all-users install folders"
    raise Refused([Problem("engine", "", f"LTspice is not installed ({searched}). {HINT}")])


def number(value: float) -> str:
    return f"{value:.12g}"


def analysis_card(analysis: dict[str, Any]) -> str:
    kind = analysis["kind"]
    if kind == "op":
        return ".op"
    if kind == "dc":
        return f".dc {analysis['source']} {number(analysis['start'].value)} {number(analysis['stop'].value)} {number(analysis['step'].value)}"
    if kind == "ac":
        return f".ac {analysis['sweep']} {analysis['points']} {number(analysis['start'].value)} {number(analysis['stop'].value)}"
    if kind == "noise":
        output = "V(" + analysis["output"][2:]
        return (f".noise {output} {analysis['source']} {analysis['sweep']} {analysis['points']} "
                f"{number(analysis['start'].value)} {number(analysis['stop'].value)}")
    card = f".tran {number(analysis['step'].value)} {number(analysis['stop'].value)}"
    if analysis.get("maxStep") is not None or analysis["start"].value:
        card += f" {number(analysis['start'].value)}"
    if analysis.get("maxStep") is not None:
        card += f" {number(analysis['maxStep'].value)}"
    return card


def _parts(vector: str) -> tuple[str, list[str]]:
    function, _, inside = vector.partition("(")
    return function.lower(), [n.strip() for n in inside.rstrip(")").split(",")]


def raw_vectors(vectors: list[str]) -> list[str]:
    """The raw-file vectors the requested ones need, in order: V(n) for every node, I(X) for currents."""
    out: list[str] = []
    for vector in vectors:
        function, names = _parts(vector)
        needed = [f"I({names[0]})"] if function == "i" else [f"V({n})" for n in names if n.lower() not in ("0", "gnd")]
        for item in needed:
            if item.lower() not in [o.lower() for o in out]:
                out.append(item)
    return out


def data_limit(rows: int, vectors: int, complex_data: bool) -> int:
    """Bytes a raw file may reach: the header allowance and `rows` records of the axis and the saved vectors."""
    record = (16 if complex_data else 8) * (1 + max(vectors, 1))
    return HEADER_ALLOWANCE + (ROW_LIMIT_OVERRIDE if ROW_LIMIT_OVERRIDE is not None else rows) * record


def redact(text: str, cwd: Path, run_dir: Path) -> str:
    """Absolute paths of an engine line in the forms of spec §9: the run folder and the working directory relative to
    the working directory, the LTspice library as `<LTspice library>`, anything else by its file name."""
    out = text
    root = netlist.library_root()
    replacements = [(run_dir, workspace.relative(cwd, run_dir)), (cwd, ".")]
    if root is not None:
        replacements.insert(0, (root, netlist.LIBRARY))
    for folder, shown in replacements:
        for spelled in {str(folder), str(folder).replace("\\", "/"), os.path.realpath(folder)}:
            pattern = re.compile(re.escape(spelled) + r"([\\/][^\"<>|\r\n]*?)?(?=\(\d+\):|[\"<>|]|$)", re.I | re.M)
            out = pattern.sub(lambda m: shown + (m.group(1) or "").replace("\\", "/"), out)
    return netlist.scrub(out)


def _kill(process: subprocess.Popen[bytes]) -> None:
    try:
        process.kill()
    except OSError:
        pass
    try:
        process.wait(timeout=30)
    except subprocess.TimeoutExpired:
        pass


def run(engine: Engine, cwd: Path, run_dir: Path, name: str, time_limit: float, limit_bytes: int,
        expected_steps: int | None = None) -> Outcome:
    """Runs `LTspice.exe -b <run folder>/<name>` there. The absolute netlist path names the run folder on LTspice's
    command line; LTspice writes the .raw and .log next to it."""
    target = run_dir / name
    raw_path, log_path = target.with_suffix(".raw"), target.with_suffix(".log")
    started = time.monotonic()
    process = subprocess.Popen([engine.executable, "-b", str(target)], cwd=run_dir, stdin=subprocess.DEVNULL,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                               creationflags=CREATE_NO_WINDOW if sys.platform == "win32" else 0)
    stopped = None
    code: int | None = None
    while True:
        try:
            code = process.wait(timeout=0.2)
            break
        except subprocess.TimeoutExpired:
            pass
        if time.monotonic() - started > time_limit:
            stopped = "timeout"
        else:
            try:
                if raw_path.stat().st_size > limit_bytes:
                    stopped = "limit"
            except OSError:
                pass
        if stopped:
            _kill(process)
            code = process.returncode
            break
    seconds = time.monotonic() - started
    try:
        log = log_path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        log = ""
    lines = [line.rstrip() for line in log.splitlines()]
    outcome = Outcome("ok", code, seconds, loaded=_loaded(lines, cwd, run_dir),
                      log_steps=[line for line in lines if line.lower().startswith(".step ")])
    if stopped == "timeout":
        outcome.status = "timeout"
        outcome.problems.append({"kind": "timeout", "line": f"LTspice was stopped after the time limit of {time_limit:.0f} s."})
        return outcome
    if stopped == "limit":
        outcome.status = "failed"
        outcome.problems.append({"kind": "limit", "line": "LTspice was stopped: the raw file grew beyond the profile's data limit."})
        return outcome
    if code != 0:
        outcome.status = "failed"
        crashed = code in (3221225477, -1073741819)  # 0xC0000005, access violation
        reason = (" LTspice crashed (access violation); a '%' in a folder or file name is a known cause." if crashed else "")
        outcome.problems = _classify(lines, cwd, run_dir) or [{"kind": "engine", "line": f"LTspice exited with code {code}.{reason}"}]
        return outcome
    if not any(line.lower().startswith("total elapsed time") for line in lines):
        outcome.status = "failed"
        outcome.problems.append({"kind": "partial", "line": "The LTspice log has no 'Total elapsed time': the run did not finish."})
        return outcome
    try:
        outcome.data = raw.read(raw_path)
    except OSError:
        outcome.status = "failed"
        outcome.problems.append({"kind": "partial", "line": "LTspice wrote no raw file."})
        return outcome
    except raw.RawError as error:
        outcome.status = "failed"
        outcome.problems.append({"kind": error.kind, "line": str(error)})
        return outcome
    if expected_steps is not None and len(outcome.data.steps) != expected_steps:
        outcome.status = "failed"
        outcome.problems.append({"kind": "corrupt", "line": f"The raw file holds {len(outcome.data.steps)} steps; the run asked for {expected_steps}."})
    return outcome


def _classify(lines: list[str], cwd: Path, run_dir: Path) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for line in lines:
        text = line.strip()
        kind = next((k for k, pattern in _PROBLEMS if pattern.search(text)), None)
        if kind is None and _LOCATED.match(text):
            kind = "netlist"
        if kind and len(out) < 20:
            out.append({"kind": kind, "line": redact(text, cwd, run_dir)[:400]})
    return out


def _loaded(lines: list[str], cwd: Path, run_dir: Path) -> list[str]:
    out: list[str] = []
    if "Files loaded:" not in lines:
        return out
    for line in lines[lines.index("Files loaded:") + 1:]:
        if not line.strip():
            break
        out.append(redact(line.strip(), cwd, run_dir))
    return out[:100]


def series(data: raw.Raw, start: int, end: int, vectors: list[str], kind: str, source: str = "") -> tuple[list[str], list[list[float]]]:
    """One step's series under ngspice-tool's names (spec §6); raises KeyError naming a vector the raw file lacks."""
    index = {name.casefold(): position for position, name in enumerate(data.names)}

    def column(name: str) -> list[float] | list[complex]:
        if name.casefold() not in index:
            raise KeyError(name)
        return data.columns[index[name.casefold()]][start:end]

    def node(name: str) -> list[float] | list[complex]:
        return [0.0] * (end - start) if name.lower() in ("0", "gnd") else column(f"V({name})")

    columns: list[str] = []
    values: list[list[float]] = []
    if data.has_axis:
        axis_name = {"tran": "time", "ac": "frequency", "noise": "frequency"}.get(kind) or ("i-sweep" if source[:1].lower() == "i" else "v-sweep")
        columns.append(axis_name)
        values.append([x.real if isinstance(x, complex) else x for x in data.columns[0][start:end]])
    if kind == "noise":
        for name, raw_name in (("onoise_spectrum", "V(onoise)"), ("inoise_spectrum", "V(inoise)")):
            columns.append(name)
            values.append([abs(x) for x in column(raw_name)])
    else:
        for vector in vectors:
            function, names = _parts(vector)
            if function == "i":
                points = column(f"I({names[0]})")
            else:
                points = node(names[0])
                if len(names) == 2:
                    other = node(names[1])
                    points = [a - b for a, b in zip(points, other)]
            complex_data = data.is_complex
            if function in ("v", "i") and complex_data:
                columns += [f"{vector} re", f"{vector} im"]
                values += [[complex(x).real for x in points], [complex(x).imag for x in points]]
                continue
            converted = {"v": lambda x: complex(x).real, "i": lambda x: complex(x).real, "vm": abs, "vr": lambda x: complex(x).real,
                         "vi": lambda x: complex(x).imag, "vp": lambda x: math.atan2(complex(x).imag, complex(x).real),
                         "vdb": lambda x: 20 * math.log10(abs(x)) if abs(x) > 0 else -math.inf}[function]
            columns.append(vector)
            values.append([converted(x) for x in points])
    rows = [list(row) for row in zip(*values)]
    return columns, rows


def copy_inputs(chain: netlist.Chain, run_dir: Path, overrides: dict[str, str]) -> None:
    """input/<rel> for every workbench file (the main netlist untouched for reference) with includes rewritten."""
    for position, source in enumerate(chain.files):
        target = run_dir / netlist.copy_target(source.rel)
        target.parent.mkdir(parents=True, exist_ok=True)
        if position == 0:
            if source.role != "converted":
                target.write_bytes(source.data)
            continue
        with open(target, "x", encoding="utf-8", newline="\n") as handle:
            handle.write(netlist.transformed(chain, position, overrides))


def remove(path: Path) -> None:
    shutil.rmtree(path, ignore_errors=True)
