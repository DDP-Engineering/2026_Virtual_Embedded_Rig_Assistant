"""What goes beyond build and upload (spec REQ-DATA-e444904d): the examples of installed libraries, the largest
symbols of a build, any other arduino-cli command in VERA's own Arduino environment, and the removal of old run
folders from the workbench.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any

from . import FORMAT, KIND, sketch, workspace
from .environment import Cli
from .report import Refused, problem

SYMBOL = re.compile(r"^[0-9A-Fa-f]+ ([0-9A-Fa-f]+) (\S) (.+)$")
# The section nm names for a symbol: text (code and tables kept in flash) and rodata take flash, data takes flash
# and RAM, bss takes RAM only.
KINDS = {**dict.fromkeys("TtWwVv", "text"), **dict.fromkeys("Rr", "rodata"), **dict.fromkeys("DdGg", "data"), **dict.fromkeys("BbCSs", "bss")}
EXAMPLES_SHOWN = 300
PASSED_SHOWN = 8000
RUNS_KEPT = 5
REFUSED_COMMANDS = {"daemon": "it never ends", "--config-file": "VERA's own configuration is the point of this command", "--config-dir": "VERA's own configuration is the point of this command"}


def symbol_tool(properties: list[str]) -> Path | None:
    """The toolchain's nm, found next to the size tool the core's recipes name."""
    values = dict(item.split("=", 1) for item in properties if "=" in item)
    folder = values.get("compiler.path", "")
    size = re.split(r"[\\/]", values.get("compiler.size.cmd", ""))[-1]
    if not folder or "size" not in size:
        return None
    name = "nm".join(size.rsplit("size", 1))
    stem = name[:-4] if name.lower().endswith(".exe") else name
    for extension in ("", ".exe", ".cmd", ".bat") if os.name == "nt" else ("",):
        candidate = Path(folder) / (stem + extension)
        if candidate.is_file():
            return candidate
    return None


def symbols(properties: list[str], elf: Path, limit: int) -> dict[str, list[dict]] | None:
    """The largest symbols of a build by what they take: flash (code, constants, initial values) and RAM. None when
    the toolchain's nm or the linked program is not there."""
    tool = symbol_tool(properties)
    if tool is None or not elf.is_file():
        return None
    try:
        done = subprocess.run([str(tool), "--size-sort", "--print-size", "--reverse-sort", "--demangle", str(elf)], stdin=subprocess.DEVNULL, capture_output=True, timeout=120)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if done.returncode != 0:
        return None
    flash: list[dict] = []
    ram: list[dict] = []
    for line in done.stdout.decode("utf-8", "replace").splitlines():
        match = SYMBOL.match(line.strip())
        kind = KINDS.get(match.group(2)) if match else None
        if not match or not kind:
            continue
        entry = {"name": match.group(3)[:120], "bytes": int(match.group(1), 16), "kind": kind}
        if kind != "bss" and len(flash) < limit:
            flash.append(entry)
        if kind in ("data", "bss") and len(ram) < limit:
            ram.append(entry)
        if len(flash) >= limit and len(ram) >= limit:
            break
    return {"flash": flash, "ram": ram}


def _below(path: Path, base: Path) -> str | None:
    """`path` relative to `base` when it lies below it; arduino-cli spells one folder in more than one case on Windows."""
    left, right = path.parts, base.parts
    fold = (lambda text: text.casefold()) if os.name == "nt" else (lambda text: text)
    if len(left) > len(right) and all(fold(one) == fold(other) for one, other in zip(left, right)):
        return "/".join(left[len(right) :])
    return None


def example_sets(cli: Cli, library: str | None, fqbn: str | None) -> list[dict]:
    """Installed libraries with their example sketches: name relative to the library's examples folder, and folder."""
    from . import compile as build

    args = ["lib", "examples"]
    if library:
        args.append(build.parse_library(library)[0])
    if fqbn:
        build.parse_fqbn(fqbn)
        args += ["--fqbn", fqbn]
    found = []
    for item in build.query(cli, args).get("examples") or []:
        described = item.get("library") if isinstance(item, dict) else None
        if not isinstance(described, dict):
            continue
        base = Path(str(described.get("install_dir") or ""))
        folders: dict[str, Path] = {}
        for raw in item.get("examples") or []:
            if isinstance(raw, str) and raw:
                path = Path(raw)
                folders[_below(path, base / "examples") or _below(path, base) or path.name] = path
        if folders:
            found.append({"library": str(described.get("name", "")), "version": str(described.get("version", "")), "location": build.LOCATIONS.get(str(described.get("location")), "other"), "folders": folders})
    return found


def list_examples(cli: Cli, library: str | None, fqbn: str | None, document: dict) -> None:
    sets = example_sets(cli, library, fqbn)
    if library and not sets:
        raise Refused([problem("example-unknown", f"No installed library named '{library[:120]}' has examples; see: arduino-tool libraries list" + ("" if fqbn else " (a library of a core needs --fqbn)") + ".")])
    left = EXAMPLES_SHOWN
    document["examples"] = []
    for item in sets:
        names = sorted(item["folders"])
        document["examples"].append({"library": item["library"], "version": item["version"], "location": item["location"], "examples": names[:left], **({"more": len(names) - left} if len(names) > left else {})})
        left = max(0, left - len(names))


def copy_example(cwd: Path, spelled: Path, cli: Cli, args: Any, document: dict) -> None:
    """Copies one example of an installed library into the workbench as a new sketch; nothing is overwritten."""
    sets = example_sets(cli, args.library, args.fqbn)
    wanted = args.example.replace("\\", "/").strip("/").casefold()
    exact = [(item, name) for item in sets for name in item["folders"] if name.casefold() == wanted]
    loose = [(item, name) for item in sets for name in item["folders"] if name.casefold().rsplit("/", 1)[-1] == wanted]
    chosen = exact or loose
    if len(chosen) != 1:
        known = [name for item in sets for name in sorted(item["folders"])][:40]
        raise Refused([problem("example-ambiguous" if chosen else "example-unknown", f"'{args.example[:120]}' is " + ("more than one example; give its whole name." if chosen else f"no example of {args.library}."), examples=known)])
    item, name = chosen[0]
    source = item["folders"][name]
    try:
        destination = workspace.confined(cwd, args.to or source.name, "--to", spelled)
    except workspace.PathRefused as error:
        raise Refused([problem("path", str(error))]) from error
    if not sketch.NAME.fullmatch(destination.name) or not workspace.allowed_output(cwd, destination):
        raise Refused([problem("path", "--to names the new sketch folder: 1-63 letters, digits, '_', '.' or '-', starting with a letter or digit, outside .vera.")])
    if destination.exists():
        raise Refused([problem("exists", f"{workspace.relative(cwd, destination)} exists already; name another folder with --to.")])
    files, _, _ = sketch.scan(source, "--example")
    sketch.sync(files, source, destination)
    # A sketch's main file is named after its folder.
    main = destination / f"{source.name}.ino"
    if destination.name != source.name and main.is_file():
        main.rename(destination / f"{destination.name}.ino")
    document["example"] = {"library": item["library"], "version": item["version"], "name": name}
    document["sketch"] = {"path": workspace.relative(cwd, destination), "main": f"{destination.name}.ino", "files": len(files)}


def passthrough(cwd: Path, cli: Cli, args: list[str], document: dict) -> int:
    """Any other arduino-cli command, with VERA's own configuration, run in the working directory."""
    args = args[1:] if args[:1] == ["--"] else args
    if not args:
        raise Refused([problem("arguments", "cli needs the arduino-cli command after '--', for example: arduino-tool cli -- lib deps Servo")])
    for value in args:
        reason = REFUSED_COMMANDS.get(value.split("=", 1)[0])
        if reason and (value.startswith("--") or value == args[0]):
            raise Refused([problem("arguments", f"arduino-cli {value.split('=', 1)[0]} is not run here: {reason}.")])
    try:
        done = subprocess.run([cli.executable, "--config-file", str(cli.path), *args], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, cwd=cwd)
    except OSError as error:
        raise Refused([problem("tool-missing", f"arduino-cli could not be started: {error.strerror or error}.")]) from error
    text = cli.stage.redact(done.stdout.decode("utf-8", "replace")).replace("\r\n", "\n")
    document["command"] = ["arduino-cli", *args]
    document["exitCode"] = done.returncode
    document["output"] = text if len(text) <= PASSED_SHOWN else f"[... {len(text) - PASSED_SHOWN} characters left out ...]\n{text[-PASSED_SHOWN:]}"
    if done.returncode != 0:
        document["status"] = "fail"
        document["errors"].append(problem("command-failed", f"arduino-cli {' '.join(args[:2])} ended with exit code {done.returncode}; see output."))
    return 0 if done.returncode == 0 else 3


def _folder_bytes(folder: Path) -> int:
    total = 0
    for current, _, names in os.walk(folder, followlinks=False):
        for name in names:
            try:
                total += os.lstat(os.path.join(current, name)).st_size
            except OSError:
                pass
    return total


def prune_runs(cwd: Path, spelled: Path, results_dir: str, keep: int) -> dict[str, Any]:
    """Removes arduino-tool's run folders from the results folder, except the newest `keep`; folders of other tools
    and anything that is not a run folder stay."""
    try:
        results = workspace.results_directory(cwd, results_dir, spelled)
    except workspace.PathRefused as error:
        raise Refused([problem("path", str(error))]) from error
    runs: list[tuple[str, Path]] = []
    for entry in sorted(results.iterdir()) if results.is_dir() else []:
        record = entry / "result.json"
        try:
            if entry.is_symlink() or not entry.is_dir() or not record.is_file() or record.stat().st_size > 4 * 1024 * 1024:
                continue
            described = json.loads(record.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if isinstance(described, dict) and described.get("format") == FORMAT and described.get("kind") == KIND:
            runs.append((str(described.get("startedAt") or ""), entry))
    runs.sort(key=lambda item: (item[0], item[1].name), reverse=True)
    removed, freed, failed = [], 0, []
    for _, entry in runs[keep:]:
        size = _folder_bytes(entry)
        shutil.rmtree(entry, ignore_errors=True)
        if entry.exists():
            failed.append(entry.name)
        else:
            removed.append(entry.name)
            freed += size
    return {"folder": workspace.relative(cwd, results), "kept": min(len(runs), keep), "removed": len(removed), "bytesFreed": freed, "failed": failed}
