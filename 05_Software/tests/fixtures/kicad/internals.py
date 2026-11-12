"""In-process seams of kicad-tool for kicad.test.ts (states no command line can arrange reliably).

Usage: python internals.py <scripts folder> <command> [arguments]

- `locate`: prints the KiCad the helper finds ({executable, version}) or null.
- `discover <root>`: builds fake PATH and Program Files folders under <root> and prints which kicad-cli the
  search picks with and without the PATH entry.
- `version <none|X.Y.Z> <helper arguments>`: runs the helper with discovery finding nothing, or a kicad-cli
  that reports version X.Y.Z.
- `fail <exit|nooutput|truncate|nojob> <helper arguments>`: the first kicad-cli call fails with exit 3 and
  "Failed to load board", or exits 0 and writes nothing, or runs and then cuts the first Gerber file in half
  (truncate) or deletes the Gerber job file (nojob); exit and nooutput need no KiCad.
- `fail missingexe <helper arguments>`: discovery reports a kicad-cli 10 that does not exist, so it cannot start.
- `limit <bytes> <helper arguments>`: runs the helper with that parse limit per file instead of 64 MiB.
- `linkout <relative path> <outside file> <helper arguments>`: `os.path.realpath` resolves the relative path
  (from the working directory) to the outside file, as a file link would.
- `change <helper arguments>`: appends a byte to the --project file during the first kicad-cli call.
- `slow <helper arguments>`: runs the first kicad-cli call, then prints "kicad-cli started" to stderr and
  sleeps 60 s, so a test can stop the process tree after KiCad wrote into the work copy.
- `calls <file> <helper arguments>`: runs the helper and writes every kicad-cli argument list to <file>.
- `fit`: hands the document fitter oversized documents and prints what it printed.
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, sys.argv[1])

from kicad_support import cli, discovery, document, kicad, project  # noqa: E402

COMMAND = sys.argv[2]
REST = sys.argv[3:]
ORIGINAL = kicad.run_cli


def fake_kicad(version: str) -> None:
    executable = Path(sys.argv[1]) / ("fake-kicad-cli.exe" if sys.platform == "win32" else "fake-kicad-cli")
    discovery.search = lambda: (executable, ["fake"])  # type: ignore[assignment]
    discovery.probe_version = lambda path: version  # type: ignore[assignment]


def option(arguments: list[str], name: str) -> str:
    return arguments[arguments.index(name) + 1]


if COMMAND == "locate":
    try:
        found = discovery.find_kicad()
        print(json.dumps({"executable": str(found.executable), "version": found.version}))
    except discovery.KicadMissing:
        print("null")
    sys.exit(0)

if COMMAND == "discover":
    root = Path(REST[0])
    windows = sys.platform == "win32"
    name = "kicad-cli.exe" if windows else "kicad-cli"
    on_path = root / "path-entry"
    files = root / "Program Files"
    for folder in (on_path, files / "KiCad" / "9.0" / "bin", files / "KiCad" / "10.0" / "bin"):
        folder.mkdir(parents=True, exist_ok=True)
        (folder / name).write_bytes(b"")
        (folder / name).chmod(0o755)
    first = discovery.locate([str(root / "empty"), str(on_path)], files, windows)
    second = discovery.locate([str(root / "empty")], files, windows)
    os.chdir(root)  # A relative PATH entry would name a folder of the working directory: it is skipped.
    third = discovery.locate(["path-entry"], files, windows)
    print(json.dumps({"withPath": str(first), "withoutPath": str(second), "relativeEntry": str(third)}))
    sys.exit(0)

if COMMAND == "version":
    if REST[0] == "none":
        discovery.search = lambda: (None, ["PATH", "C:/Program Files/KiCad/*/bin"])  # type: ignore[assignment]
    else:
        fake_kicad(REST[0])
    sys.exit(cli.main(REST[1:]))

if COMMAND == "fail":
    mode, arguments = REST[0], REST[1:]
    if mode in ("exit", "nooutput", "missingexe"):
        fake_kicad("10.0.8")
    if mode == "missingexe":
        sys.exit(cli.main(arguments))

    def failing(executable: str, args: list[str], cwd: Path, timeout: float) -> kicad.CliResult:
        if args[:1] == ["version"]:
            return kicad.CliResult(0, "10.0.8\n")
        if mode == "exit":
            return kicad.CliResult(3, "Loading board\nFailed to load board: Expecting ')' in 'x.kicad_pcb', line 2\n")
        if mode == "nooutput":
            return kicad.CliResult(0, "Done.\n")
        result = ORIGINAL(executable, args, cwd, timeout)
        if args[:3] == ["pcb", "export", "gerbers"]:
            output = Path(args[args.index("--output") + 1])
            if mode == "nojob":
                for path in output.glob("*.gbrjob"):
                    path.unlink()
            else:
                first = sorted(path for path in output.iterdir() if path.suffix != ".gbrjob")[0]
                data = first.read_bytes()
                first.write_bytes(data[: len(data) // 2])
        return result

    kicad.run_cli = failing  # type: ignore[assignment]
    sys.exit(cli.main(arguments))

if COMMAND == "change":
    target = Path(option(REST, "--project"))
    changed: list[bool] = []

    def changing(executable: str, args: list[str], cwd: Path, timeout: float) -> kicad.CliResult:
        if not changed and args[:1] != ["version"]:
            target.write_bytes(target.read_bytes() + b"\n")
            changed.append(True)
        return ORIGINAL(executable, args, cwd, timeout)

    kicad.run_cli = changing  # type: ignore[assignment]
    sys.exit(cli.main(REST))

if COMMAND == "slow":

    def slow(executable: str, args: list[str], cwd: Path, timeout: float) -> kicad.CliResult:
        result = ORIGINAL(executable, args, cwd, timeout)
        print("kicad-cli started", file=sys.stderr, flush=True)
        time.sleep(60)
        return result

    kicad.run_cli = slow  # type: ignore[assignment]
    sys.exit(cli.main(REST))

if COMMAND == "limit":
    project.PARSE_LIMIT = int(REST[0])
    sys.exit(cli.main(REST[1:]))

if COMMAND == "linkout":
    source = os.path.normcase(os.path.abspath(REST[0]))
    outside = REST[1]
    real = os.path.realpath

    def redirected(path, *args, **kwargs):  # type: ignore[no-untyped-def]
        if os.path.normcase(os.path.abspath(path)) == source:
            return outside
        return real(path, *args, **kwargs)

    os.path.realpath = redirected  # type: ignore[assignment]
    sys.exit(cli.main(REST[2:]))

if COMMAND == "calls":
    record = Path(REST[0])
    seen: list[dict] = []

    def recording(executable: str, args: list[str], cwd: Path, timeout: float) -> kicad.CliResult:
        seen.append({"args": list(args), "cwd": str(cwd)})
        return ORIGINAL(executable, args, cwd, timeout)

    kicad.run_cli = recording  # type: ignore[assignment]
    code = cli.main(REST[1:])
    record.write_text(json.dumps(seen), encoding="utf-8")
    sys.exit(code)

if COMMAND == "fit":
    wide = "\U0001f50c"  # A character beyond the Basic Multilingual Plane: two UTF-16 units.
    big = document.base("erc", "fit-1")
    big["summary"] = {
        "counts": {"error": 5000},
        "violations": [{"type": "pin_not_connected", "severity": "error", "description": f"{wide} {'x' * 200} {n}"} for n in range(5000)],
    }
    small = document.base("erc", "fit-2")
    small["summary"] = {"counts": {"error": 1}, "violations": [{"type": "pin_not_connected", "description": "one"}]}
    review = document.base("review-report", "fit-3")
    review["summary"] = {
        "counts": {"sheets": 1, "instances": 400, "nets": 400, "footprints": 0},
        "erc": {
            "counts": {"error": 3, "warning": 1, "exclusion": 0},
            "types": {"pin_not_connected": 3, "x": 1},
            "violations": [{"type": "x", "description": "d" * 300}] * 50,
            "duplicateReferences": [{"reference": f"R{n}", "unit": 1, "count": 2, "sheets": ["/" * 40] * 2} for n in range(300)],
            "duplicateCount": 300,
        },
        "drc": {"counts": {"violations": {"error": 2, "warning": 0, "exclusion": 0}, "unconnected": 1, "parity": 0}, "types": {}, "violations": [], "unconnected": [], "parity": []},
        "facts": {"powerNets": [], "singleNodeNets": [f"unconnected-(U1-PadA{n})" for n in range(400)], "withoutFootprint": [], "dnp": []},
        "hierarchy": [{"path": "/"}],
        "instances": [{"reference": f"R{n}", "fields": {"x": "y" * 50}} for n in range(400)],
        "nets": [{"name": f"N{n}", "nodes": []} for n in range(400)],
        "board": None,
    }
    out = {}
    text = document.fitted(review)
    parsed = json.loads(text)
    out["review"] = {
        "units": len(text.encode("utf-16-le")) // 2,
        "truncated": parsed["truncated"],
        "erc": parsed["summary"]["erc"]["counts"],
        "drc": parsed["summary"]["drc"]["counts"],
        "duplicateCount": parsed["summary"]["erc"].get("duplicateCount"),
        "counts": parsed["summary"]["counts"],
    }
    for name, doc in (("big", big), ("small", small)):
        text = document.fitted(doc)
        parsed = json.loads(text)
        out[name] = {
            "units": len(text.encode("utf-16-le")) // 2,
            "truncated": parsed["truncated"],
            "violations": len(parsed["summary"]["violations"]),
            "counts": parsed["summary"]["counts"],
        }
    print(json.dumps(out))
    sys.exit(0)

raise SystemExit(f"unknown command {COMMAND}")
