"""freerouting-tool's command line (spec REQ-FUNC-2a80da7f): route a saved kicad-layout candidate with Freerouting and
write a kicad-layout request. The candidate and the run's state.json are only read."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, NoReturn

from . import TOOL, VERSION
from . import ses as specctra

SCRIPTS = Path(__file__).resolve().parent.parent
MAX_OPERATIONS = 1024  # kicad-layout's limit per request
_RULE = re.compile(r"\(rule\s+(\"[^\"]*\"|[^\s()]+)")


class Stop(Exception):
    """A refusal (exit 2) or a failure (exit 3) with one problem."""

    def __init__(self, status: str, kind: str, where: str, message: str):
        super().__init__(message)
        self.status, self.kind, self.where, self.message = status, kind, where, message


def refuse(kind: str, where: str, message: str) -> Stop:
    return Stop("refused", kind, where, message)


def fail(kind: str, where: str, message: str) -> Stop:
    return Stop("failed", kind, where, message)


class Usage(Exception):
    pass


class _Parser(argparse.ArgumentParser):
    def error(self, message: str) -> NoReturn:  # noqa: D401 - argparse hook
        raise Usage(message)


def _parser() -> argparse.ArgumentParser:
    parser = _Parser(prog=TOOL, description="Autoroute a saved kicad-layout candidate with Freerouting, offline.",
                     formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    parser.add_argument("--version", action="version", version=f"{TOOL} {VERSION}")
    sub = parser.add_subparsers(dest="operation")
    route = sub.add_parser("route", help="route the candidate of a kicad-layout run folder")
    route.add_argument("--run", required=True, help="the kicad-layout run folder (electronics-results/<run-id>)")
    route.add_argument("--nets", help="comma-separated nets whose new routes go into the request (default: all)")
    route.add_argument("--max-passes", type=int, default=20, help="Freerouting's routing passes, 1-100 (default 20)")
    route.add_argument("--max-seconds", type=int, default=600, help="time budget for Freerouting, 1-3000 s (default 600)")
    route.add_argument("--allow-custom-rules", action="store_true",
                       help="route although the project has custom design rules the DSN does not carry")
    return parser


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _program(name: str) -> str:
    value = os.environ.get(f"VERA_PROGRAM_{name}")
    if not value or not Path(value).is_file():
        raise fail("setup", name.lower(), f"VERA did not pass the {name.lower().replace('_', '-')} program; install the freerouting plugin's programs.")
    return value


def _run_folder(cwd: Path, raw: str) -> tuple[Path, dict[str, Any], Path]:
    folder = (cwd / raw).resolve()
    if not folder.is_relative_to(cwd):
        raise refuse("run", "--run", "--run must name a run folder inside the working directory.")
    try:
        state = json.loads((folder / "state.json").read_text(encoding="utf-8"))
        if state.get("kind") != "kicad-layout-state":
            raise ValueError("not a kicad-layout state")
        candidate = (folder / state["candidate"]["path"]).resolve()
        if not candidate.is_relative_to(folder) or candidate.suffix != ".kicad_pcb" or not candidate.is_file():
            raise ValueError("no candidate board in the run folder")
    except (OSError, ValueError, KeyError, TypeError) as error:
        raise refuse("run", "--run", f"--run does not name a kicad-layout run folder ({error}); open one with kicad-layout-tool open.") from error
    if _sha(candidate) != state["candidate"]["sha256"]:
        raise refuse("changed", "candidate", "The candidate differs from its last save by kicad-layout-tool; open a new candidate.")
    return folder, state, candidate


def _custom_rules(candidate: Path) -> list[str]:
    rules = candidate.with_suffix(".kicad_dru")
    if not rules.is_file():
        return []
    return [name.strip('"') for name in _RULE.findall(rules.read_text(encoding="utf-8", errors="replace"))]


def _work_folder(folder: Path) -> Path:
    base = folder / "freerouting"
    base.mkdir(exist_ok=True)
    numbers = [int(p.name) for p in base.iterdir() if p.is_dir() and p.name.isdigit()]
    work = base / f"{max(numbers, default=0) + 1:03d}"
    work.mkdir()
    return work


def _kicad_python(kicad_cli: str) -> str:
    if sys.platform == "win32":
        found = Path(kicad_cli).parent / "python.exe"
        if found.is_file():
            return str(found)
        raise fail("kicad", "kicad-cli", f"KiCad's Python was not found next to kicad-cli ({found.name}).")
    return "/usr/bin/python3"  # the distribution's Python, which holds KiCad's pcbnew module


def _export(kicad_cli: str, candidate: Path, work: Path) -> Path:
    """The DSN of a copy of the candidate (with its project file, for the net classes)."""
    board_dir = work / "board"
    board_dir.mkdir()
    for suffix in (".kicad_pcb", ".kicad_pro", ".kicad_dru"):
        source = candidate.with_suffix(suffix)
        if source.is_file():
            shutil.copyfile(source, board_dir / source.name)
    dsn = work / "board.dsn"
    try:
        done = subprocess.run([_kicad_python(kicad_cli), "-I", str(SCRIPTS / "export_dsn.py"), str(board_dir / candidate.name), str(dsn)],
                              stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=300, cwd=work)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise fail("kicad", "export", f"KiCad's DSN export did not run: {type(error).__name__}.") from error
    if done.returncode != 0 or not dsn.is_file():
        tail = ((done.stderr or done.stdout or "").strip().splitlines()[-1:] or [""])[0]
        raise fail("kicad", "export", f"KiCad's DSN export failed (exit {done.returncode}): {tail[:200]}")
    shutil.rmtree(board_dir, ignore_errors=True)
    return dsn


def _route(java: str, jar: str, dsn: Path, work: Path, passes: int, seconds: int) -> tuple[Path, float, str]:
    """Freerouting's CLI entry, headless and offline: only localhost resolves, its settings and logs stay in work/."""
    hosts = work / "hosts"
    hosts.write_text("127.0.0.1 localhost\n", encoding="utf-8")
    (work / "home").mkdir()
    ses = work / "board.ses"
    command = [java, f"-Djdk.net.hosts.file={hosts}", f"-Duser.home={work / 'home'}", "-Djava.awt.headless=true",
               "-cp", jar, "app.freerouting.cli.FreeroutingCli", "-de", str(dsn), "-do", str(ses),
               f"--router.autorouter.max_passes={passes}", "-mt", "1", "--gui.enabled=false",
               "--usage_and_diagnostic_data.disable_analytics=true", "--api_server.enabled=false", "--mcp_server.enabled=false"]
    started = time.monotonic()
    with (work / "freerouting.log").open("wb") as log:
        # Freerouting prefers these over user.home for its settings and logs: without them they stay in work/home.
        own = {k: v for k, v in os.environ.items() if k.upper() not in ("APPDATA", "LOCALAPPDATA") and not k.upper().startswith("XDG_")}
        process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, cwd=work, env=own)
        try:
            process.wait(timeout=seconds)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
            ses.unlink(missing_ok=True)
            raise fail("router", "freerouting", f"Freerouting did not finish within {seconds} s; it was stopped. Give a larger --max-seconds or fewer --max-passes.") from None
    elapsed = time.monotonic() - started
    test_ses = os.environ.get("FREEROUTING_TEST_SES")  # test seam; VERA never passes it to programs
    if test_ses:
        shutil.copyfile(test_ses, ses)
    log_text = (work / "freerouting.log").read_text(encoding="utf-8", errors="replace")
    if not ses.is_file():
        tail = (log_text.strip().splitlines()[-1:] or [""])[0]
        raise fail("router", "freerouting", f"Freerouting wrote no session file (exit {process.returncode}): {tail[:200]}")
    return ses, elapsed, log_text


def _java_version(java: str) -> str | None:
    try:
        done = subprocess.run([java, "-version"], stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired):
        return None
    found = re.search(r'version "([^"]+)"', done.stderr + done.stdout)
    return found.group(1) if found else None


def _markdown(doc: dict[str, Any]) -> str:
    lines = [f"# freerouting-tool route {doc['runId']}", "", f"Status: {doc['status']}"]
    for p in doc.get("problems", []):
        lines.append(f"- {p['kind']} ({p['where']}): {p['message']}")
    if doc["status"] == "completed":
        lines += ["", f"Freerouting {doc['freerouting']['version']} on Java {doc['freerouting']['java']}, "
                      f"{doc['budget']['passes']} passes / {doc['budget']['seconds']} s budget, {doc['elapsedSeconds']} s used.",
                  f"Unrouted connections reported by Freerouting: {doc['freerouting']['unrouted']}.",
                  f"New tracks: {doc['operations']['tracks']} ({doc['operations']['trackLength']} mm), new vias: {doc['operations']['vias']}.",
                  f"Nets: {', '.join(doc['nets']) or 'none'}.", "", f"Apply on the candidate: `{doc['next']}`"]
        for warning in doc.get("warnings", []):
            lines.append(f"- Warning: {warning}")
    return "\n".join(lines) + "\n"


def _route_operation(args: argparse.Namespace, cwd: Path, started: str) -> dict[str, Any]:
    if not 1 <= args.max_passes <= 100:
        raise refuse("usage", "--max-passes", "--max-passes must be 1-100.")
    if not 1 <= args.max_seconds <= 3000:
        raise refuse("usage", "--max-seconds", "--max-seconds must be 1-3000.")
    nets = {n.strip() for n in args.nets.split(",") if n.strip()} if args.nets else None
    folder, state, candidate = _run_folder(cwd, args.run)
    rules = _custom_rules(candidate)
    if rules and not args.allow_custom_rules:
        raise refuse("rules", "kicad_dru", f"The project has custom design rules the DSN does not carry ({', '.join(rules[:10])}); Freerouting "
                                           "would ignore them. Route without them by giving --allow-custom-rules (DRC after the edit still checks them), or route by hand.")
    java, jar, kicad_cli = _program("JAVA"), _program("FREEROUTING"), _program("KICAD_CLI")
    work = _work_folder(folder)
    run_id = f"{folder.name}/freerouting/{work.name}"
    try:
        dsn = _export(kicad_cli, candidate, work)
        protected_text, protected = specctra.protect_wiring(dsn.read_text(encoding="utf-8"))
        dsn.write_text(protected_text, encoding="utf-8", newline="\n")
        ses, elapsed, log_text = _route(java, jar, dsn, work, args.max_passes, args.max_seconds)
        try:
            operations, routed = specctra.routes(ses.read_text(encoding="utf-8", errors="replace"), nets)
        except specctra.SesError as error:
            raise fail("ses", "board.ses", f"Freerouting's session file cannot be read: {error}") from error
        if len(operations) > MAX_OPERATIONS:
            raise fail("router", "request", f"The routes need {len(operations)} operations, more than kicad-layout's {MAX_OPERATIONS}; route fewer nets with --nets.")
        if _sha(candidate) != state["candidate"]["sha256"]:
            raise fail("router", "candidate", "The candidate changed while routing; nothing was written for it.")
        request = {"format": 1, "candidate": state["candidate"]["sha256"], "units": "mm", "operations": operations}
        # Compact: kicad-layout reads at most 1 MiB per request.
        (work / "request.json").write_text(json.dumps(request, separators=(",", ":")) + "\n", encoding="utf-8", newline="\n")
        unrouted = re.findall(r"\((\d+) unrouted and \d+ violations\)", log_text)
        rel = lambda p: p.relative_to(cwd).as_posix()  # noqa: E731
        tracks = [o for o in operations if o["op"] == "track"]
        length = sum(((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2) ** 0.5 for t in tracks for a, b in zip(t["points"], t["points"][1:]))
        warnings = [f"Custom design rules not carried by the DSN: {', '.join(rules[:10])}."] if rules else []
        doc = {
            "format": 1, "kind": "freerouting-result", "tool": TOOL, "toolVersion": VERSION, "operation": "route", "runId": run_id,
            "started": started, "status": "completed", "problems": [],
            "candidate": {"path": rel(candidate), "sha256": state["candidate"]["sha256"]},
            "freerouting": {"version": (re.search(r"(\d+\.\d+\.\d+)", Path(jar).name) or [None, None])[1],
                            "java": _java_version(java), "unrouted": int(unrouted[-1]) if unrouted else None},
            "budget": {"passes": args.max_passes, "seconds": args.max_seconds}, "elapsedSeconds": round(elapsed, 1),
            "protected": protected, "nets": routed,
            "operations": {"tracks": len(tracks), "vias": len(operations) - len(tracks), "trackLength": round(length, 3)},
            "request": rel(work / "request.json"),
            "artifacts": [rel(work / name) for name in ("board.dsn", "board.ses", "freerouting.log", "request.json", "result.json", "report.md")],
            "warnings": warnings,
            "next": f"kicad-layout-tool edit --run {rel(folder)} --request {rel(work / 'request.json')}",
            "ended": _now(),
        }
        (work / "result.json").write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8", newline="\n")
        (work / "report.md").write_text(_markdown(doc), encoding="utf-8", newline="\n")
        return doc
    except Stop as stop:
        (work / "request.json").unlink(missing_ok=True)
        doc = _problems(run_id, started, stop)
        (work / "result.json").write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8", newline="\n")
        (work / "report.md").write_text(_markdown(doc), encoding="utf-8", newline="\n")
        raise


def _problems(run_id: str | None, started: str, stop: Stop) -> dict[str, Any]:
    return {"format": 1, "kind": "freerouting-result", "tool": TOOL, "toolVersion": VERSION, "operation": "route", "runId": run_id,
            "started": started, "ended": _now(), "status": stop.status,
            "problems": [{"kind": stop.kind, "where": stop.where, "message": stop.message}]}


def main(argv: list[str]) -> int:
    started = _now()
    try:
        args = _parser().parse_args(argv)
        if args.operation != "route":
            raise Usage("Name the operation: route (see --help).")
    except Usage as error:
        print(json.dumps(_problems(None, started, refuse("usage", "arguments", str(error)))))
        return 2
    try:
        doc = _route_operation(args, Path(os.getcwd()).resolve(), started)
    except Stop as stop:
        print(json.dumps(_problems(None, started, stop)))
        return 2 if stop.status == "refused" else 3
    except OSError as error:
        print(json.dumps(_problems(None, started, fail("output", "run", f"A file could not be written or read: {error.strerror or error}."))))
        return 3
    print(json.dumps(doc))
    return 0
