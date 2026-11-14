"""kicad-cli calls (spec REQ-DATA-c32834e3 §2, §6 and §7).

Every command line comes from a builder below: the request never adds an option. Inputs are files of the work
copy and outputs lie in the work folder, so kicad-cli writes nothing into the working directory. `--save-board`,
`upgrade`, jobsets, project-variable overrides, variants and drawing-sheet overrides are never used, and neither
is `--exit-code-violations`: any exit code other than 0 is a failure, never a violation count.
"""

from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path

from .discovery import Kicad

TIMEOUT = 1500.0  # Seconds per call; VERA's rule timeout (1800 s) kills the whole tree after that.
TAIL = 2000  # Characters of kicad-cli's output a failure quotes.


@dataclass(frozen=True)
class CliResult:
    code: int
    output: str
    failure: str | None = None  # "timeout" or "start" when kicad-cli gave no exit code of its own.


class RunFailure(Exception):
    """kicad-cli failed, timed out or left out an expected file (exit 3, problem `run`)."""


def run_cli(executable: str, args: list[str], cwd: Path, timeout: float) -> CliResult:
    """Runs kicad-cli without a shell, stdin closed, stdout and stderr together; `failure` says when it did not run
    to an exit (timeout or start failure)."""
    try:
        done = subprocess.run(
            [executable, *args],
            cwd=cwd,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=timeout,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except subprocess.TimeoutExpired as error:
        output = error.output.decode("utf-8", "replace") if isinstance(error.output, bytes) else ""
        return CliResult(-1, output + f"\n[kicad-tool] kicad-cli did not finish within {timeout:.0f} s and was stopped.", "timeout")
    except OSError as error:
        return CliResult(-1, f"[kicad-tool] {error.strerror or error}", "start")
    return CliResult(done.returncode, done.stdout.decode("utf-8", "replace"))


def execute(kicad: Kicad, args: list[str], cwd: Path, expected: list[Path]) -> str:
    """Runs one built command and returns its output; RunFailure unless it exits 0 and writes `expected`."""
    result = run_cli(str(kicad.executable), args, cwd, TIMEOUT)
    command = " ".join(args[:3] if args[1:2] == ["export"] else args[:2])
    if result.failure is not None or result.code != 0:
        reason = {"timeout": "timed out", "start": "could not start"}.get(result.failure or "", f"exited with code {result.code}")
        raise RunFailure(f"kicad-cli {command} {reason}: {result.output.strip()[-TAIL:]}")
    for path in expected:
        try:
            if not path.exists() or (path.is_file() and path.stat().st_size == 0) or (path.is_dir() and not any(path.iterdir())):
                raise RunFailure(f"kicad-cli {command} wrote no {path.name}: {result.output.strip()[-TAIL:]}")
        except OSError as error:
            raise RunFailure(f"kicad-cli {command} output cannot be read: {error}") from error
    return result.output


def _layers(layers: list[str]) -> str:
    return ",".join(layers)


def erc(schematic: Path, output: Path) -> list[str]:
    return ["sch", "erc", "--format", "json", "--severity-all", "--units", "mm", "--output", str(output), str(schematic)]


def drc(board: Path, output: Path, parity: bool, refill: bool) -> list[str]:
    args = ["pcb", "drc", "--format", "json", "--severity-all", "--units", "mm"]
    if parity:
        args.append("--schematic-parity")
    if refill:
        args.append("--refill-zones")
    return [*args, "--output", str(output), str(board)]


def netlist(schematic: Path, output: Path) -> list[str]:
    return ["sch", "export", "netlist", "--format", "kicadsexpr", "--output", str(output), str(schematic)]


def stats(board: Path, output: Path) -> list[str]:
    return ["pcb", "export", "stats", "--format", "json", "--units", "mm", "--output", str(output), str(board)]


def sch_pdf(schematic: Path, output: Path) -> list[str]:
    return ["sch", "export", "pdf", "--output", str(output), str(schematic)]


def sch_svg(schematic: Path, folder: Path) -> list[str]:
    return ["sch", "export", "svg", "--output", str(folder), str(schematic)]


def pcb_pdf(board: Path, layers: list[str], output: Path) -> list[str]:
    return ["pcb", "export", "pdf", "--layers", _layers(layers), "--mode-multipage", "--output", str(output), str(board)]


def pcb_svg(board: Path, layers: list[str], folder: Path) -> list[str]:
    return ["pcb", "export", "svg", "--layers", _layers(layers), "--mode-multi", "--output", str(folder), str(board)]


GERBER_OPTIONS = {"x2": True, "netlistAttributes": True, "precision": 6, "protelExtensions": True}


def gerbers(board: Path, layers: list[str], folder: Path) -> list[str]:
    return ["pcb", "export", "gerbers", "--layers", _layers(layers), "--precision", "6", "--output", str(folder), str(board)]


DRILL_OPTIONS = {"format": "excellon", "units": "mm", "zeros": "decimal", "origin": "absolute", "separatePlated": True, "report": True}


def drill(board: Path, folder: Path) -> list[str]:
    return [
        "pcb", "export", "drill", "--format", "excellon", "--excellon-units", "mm", "--excellon-separate-th",
        "--generate-report", "--report-path", str(folder / "drill-report.txt"), "--output", str(folder), str(board),
    ]  # fmt: skip


POS_OPTIONS = {"format": "csv", "units": "mm", "side": "both"}


def pos(board: Path, output: Path) -> list[str]:
    return ["pcb", "export", "pos", "--format", "csv", "--units", "mm", "--side", "both", "--output", str(output), str(board)]
