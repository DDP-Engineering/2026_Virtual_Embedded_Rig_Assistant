"""compile: checks before arduino-cli acts, then a compile of a copy into a new run folder (spec REQ-DATA-e444904d).

Nothing is installed here: a missing or different core or library is a refusal naming the install command. The FQBN is
taken as written; an unknown board or option is refused with candidates, never replaced.
"""

from __future__ import annotations

import difflib
import json
import os
import re
import shutil
from pathlib import Path
from typing import Any, Callable

from . import report, sketch, workspace
from .environment import Cli, Environment, Stage, ToolFailed, sha256_bytes, sha256_file
from .report import Refused, problem

TOKEN = r"[A-Za-z0-9][A-Za-z0-9_.-]*"
FQBN = re.compile(rf"({TOKEN}):({TOKEN}):({TOKEN})(?::(.+))?")
OPTION = re.compile(rf"({TOKEN})=({TOKEN})")
VERSION = re.compile(r"\d+(?:\.\d+){0,3}(?:-[0-9A-Za-z.-]+)?")
CORE = re.compile(rf"({TOKEN}):({TOKEN})@(.+)")
LIBRARY = re.compile(r"([^@\x00-\x1f\x7f-][^@\x00-\x1f\x7f]{0,127})@(.+)")
DIAGNOSTIC = re.compile(r"^(?P<file>.+?):(?P<line>\d+):(?:(?P<column>\d+):)? (?P<severity>fatal error|error|warning|note): (?P<message>.*)$")
LOCATIONS = {"platform": "platform", "ref-platform": "platform", "user": "index", "unmanaged": "local"}


def parse_fqbn(text: str) -> tuple[str, str, str, dict[str, str]]:
    match = FQBN.fullmatch(text or "")
    if not match:
        raise Refused([problem("fqbn-invalid", f"--fqbn '{text[:120]}' is not VENDOR:ARCH:BOARD[:KEY=VALUE,...].")])
    vendor, arch, board, rest = match.groups()
    options: dict[str, str] = {}
    for pair in (rest.split(",") if rest else []):
        option = OPTION.fullmatch(pair)
        if not option or option.group(1) in options:
            raise Refused([problem("fqbn-invalid", f"--fqbn option '{pair[:60]}' is not KEY=VALUE or repeats a key.")])
        options[option.group(1)] = option.group(2)
    return vendor, arch, board, options


def parse_core(text: str) -> tuple[str, str, str]:
    match = CORE.fullmatch(text or "")
    if not match or not VERSION.fullmatch(match.group(3)):
        raise Refused([problem("version-required", f"'{text[:120]}' must be VENDOR:ARCH@VERSION with an exact version such as arduino:avr@1.8.8.")])
    return match.group(1), match.group(2), match.group(3)


def parse_library(text: str) -> tuple[str, str]:
    match = LIBRARY.fullmatch(text or "")
    if not match or not VERSION.fullmatch(match.group(2)) or match.group(1).strip() != match.group(1):
        raise Refused([problem("version-required", f"'{text[:120]}' must be NAME@VERSION with an exact version such as Servo@1.2.2.")])
    return match.group(1), match.group(2)


def query(cli: Cli, args: list[str]) -> Any:
    """The JSON answer of an arduino-cli query; ToolFailed (exit 3) when it ran and failed."""
    exit_code, document, stderr = cli.run(args, timeout=300)
    if exit_code != 0 or not isinstance(document, dict):
        message = document.get("error") if isinstance(document, dict) else None
        text = cli.stage.redact(str(message or stderr or "no output").strip())[:300]
        raise ToolFailed(f"arduino-cli {' '.join(args[:2])} failed: {text}")
    return document


def interrupted(folder: Path, document: dict, message: str) -> None:
    """The record a run folder keeps while arduino-cli acts: a Stop, timeout or crash leaves it `incomplete`."""
    record = json.loads(json.dumps(document))
    record["status"] = "incomplete"
    record["errors"] = [problem("interrupted", message)]
    report.write(folder, record)


def installed_platforms(cli: Cli) -> dict[str, str]:
    document = query(cli, ["core", "list"])
    return {item["id"]: item.get("installed_version", "") for item in document.get("platforms") or [] if isinstance(item, dict) and item.get("id")}


def installed_libraries(cli: Cli) -> dict[str, str]:
    document = query(cli, ["lib", "list"])
    found: dict[str, str] = {}
    for item in document.get("installed_libraries") or []:
        library = item.get("library") if isinstance(item, dict) else None
        if isinstance(library, dict) and library.get("name") and library.get("location") == "user":
            found[library["name"]] = library.get("version", "")
    return found


def _candidates(cli: Cli, vendor: str, arch: str, board: str) -> list[str]:
    code, document, _ = cli.run(["board", "listall"], timeout=300)
    boards = document.get("boards") if code == 0 and isinstance(document, dict) else None
    prefix = f"{vendor}:{arch}:"
    ids = sorted({item["fqbn"] for item in boards or [] if isinstance(item, dict) and str(item.get("fqbn", "")).startswith(prefix)})
    close = difflib.get_close_matches(f"{prefix}{board}", ids, n=10, cutoff=0)
    return close


def board_details(cli: Cli, vendor: str, arch: str, board: str) -> dict:
    fqbn = f"{vendor}:{arch}:{board}"
    code, document, stderr = cli.run(["board", "details", "--fqbn", fqbn], timeout=300)
    if code != 0 or not isinstance(document, dict) or "config_options" not in document and "name" not in document:
        candidates = _candidates(cli, vendor, arch, board)
        raise Refused([problem("fqbn-unknown", f"No installed board is {fqbn}; VERA does not pick another one.", candidates=candidates)])
    return document


def check_options(details: dict, options: dict[str, str]) -> None:
    declared = {item.get("option"): [value.get("value") for value in item.get("values") or []] for item in details.get("config_options") or []}
    problems = []
    for key, value in options.items():
        if key not in declared:
            problems.append(problem("fqbn-option", f"The board has no option '{key}'.", declared=sorted(k for k in declared if k)))
        elif value not in declared[key]:
            problems.append(problem("fqbn-option", f"Option {key} has no value '{value}'.", declared=declared[key]))
    if problems:
        raise Refused(problems)


def _library_folder(cwd: Path, spelled: Path, raw: str) -> Path:
    try:
        folder = workspace.confined(cwd, raw, "--library-dir", spelled)
    except workspace.PathRefused as error:
        raise Refused([problem("path", str(error))]) from error
    if not folder.is_dir() or not ((folder / "library.properties").is_file() or any(folder.glob("*.h")) or (folder / "src").is_dir()):
        raise Refused([problem("library-invalid", f"--library-dir '{raw[:120]}' is not an Arduino library folder (library.properties, src/ or a header).")])
    return folder


class Redactor:
    def __init__(self, cwd: Path, run: Path, stage: Stage) -> None:
        self.pairs = [(str(run), workspace.relative(cwd, run)), (run.as_posix(), workspace.relative(cwd, run)), (str(cwd), "."), (cwd.as_posix(), ".")]
        self.stage = stage

    def __call__(self, text: str) -> str:
        text = self.stage.redact(text)
        for source, target in self.pairs:
            text = re.sub(re.escape(source), lambda _match, target=target: target, text, flags=re.IGNORECASE if os.name == "nt" else 0)
        return text


def _relative_to(path: Path, root: Path) -> str | None:
    try:
        rel = os.path.relpath(path, root)
    except ValueError:
        return None
    return None if rel.startswith("..") or os.path.isabs(rel) else Path(rel).as_posix()


def diagnostics(text: str, copy: Path, libraries: dict[str, Path], redact: Callable[[str], str]) -> list[dict]:
    found: list[dict] = []
    for line in text.replace("\r\n", "\n").split("\n"):
        match = DIAGNOSTIC.match(line)
        if not match:
            continue
        raw = match.group("file")
        path = Path(raw)
        shown = None
        if path.is_absolute():
            shown = _relative_to(path, copy)
            for name, folder in libraries.items():
                inner = _relative_to(path, folder) if shown is None else None
                if inner is not None:
                    shown = f"libraries/{name}/{inner}"
        found.append(
            {
                "severity": match.group("severity"),
                "file": shown if shown is not None else redact(raw),
                "line": int(match.group("line")),
                "column": int(match.group("column")) if match.group("column") else None,
                "message": redact(match.group("message")).strip()[:500],
            }
        )
        if len(found) >= 200:
            break
    return found


def run(cwd: Path, spelled: Path, environment: Environment, args: Any, document: dict) -> int:
    vendor, arch, board, options = parse_fqbn(args.fqbn)
    core = parse_core(args.core) if args.core else None
    if core and (core[0], core[1]) != (vendor, arch):
        raise Refused([problem("core-mismatch", f"--core {args.core} is not the platform of --fqbn {vendor}:{arch}.")])
    declared: dict[str, str] = {}
    for text in args.library or []:
        name, version = parse_library(text)
        if name in declared:
            raise Refused([problem("library-repeated", f"--library {name} is given more than once.")])
        declared[name] = version
    local = [_library_folder(cwd, spelled, raw) for raw in args.library_dir or []]
    names = [folder.name for folder in local]
    if len(set(names)) != len(names):
        raise Refused([problem("library-invalid", "Two --library-dir folders have the same name.")])
    the_sketch = sketch.load(cwd, spelled, args.sketch)
    run_id = args.run_id or report.new_run_id("compile")
    stage = environment.stage(run_id)
    try:
        cli = Cli(stage)
        problems: list[dict] = []
        platforms = installed_platforms(cli)
        platform_id = f"{vendor}:{arch}"
        installed = platforms.get(platform_id)
        if not installed:
            pinned = f"{platform_id}@{core[2]}" if core else f"{platform_id}@VERSION"
            raise Refused([problem("core-missing", f"Core {platform_id} is not installed in VERA's Arduino environment; install it with: arduino-tool install core {pinned}")])
        if core and installed != core[2]:
            raise Refused([problem("core-version", f"Core {platform_id} {installed} is installed, not {core[2]}; install the version you need with: arduino-tool install core {platform_id}@{core[2]}")])
        folder = environment.platform_folder(vendor, arch, installed)
        overrides = [name for name in ("platform.local.txt", "boards.local.txt") if (folder / name).exists()]
        if overrides:
            raise Refused([problem("local-override", f"The installed core {platform_id} {installed} holds {', '.join(overrides)}, which changes its recipes outside its index; VERA refuses to build with it.")])
        details = board_details(cli, vendor, arch, board)
        check_options(details, options)
        libraries = installed_libraries(cli) if declared else {}
        for name, version in declared.items():
            if name not in libraries:
                problems.append(problem("library-missing", f"Library {name} is not installed; install it with: arduino-tool install library {name}@{version}"))
            elif libraries[name] != version:
                problems.append(problem("library-version", f"Library {name} {libraries[name]} is installed, not {version}; install it with: arduino-tool install library {name}@{version}"))
        if problems:
            raise Refused(problems)

        run_folder = report.run_folder(cwd, spelled, args.results_dir, run_id)
        document["runId"] = run_id
        copy = run_folder / "sketch" / the_sketch.name
        sketch.copy(the_sketch, copy)
        library_copies: dict[str, Path] = {}
        library_hashes: dict[str, str] = {}
        for source in local:
            files, _, _ = sketch.scan(source, "--library-dir")
            target = run_folder / "libraries" / source.name
            for item in files:
                destination = target / item["path"]
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source / item["path"], destination)
            library_copies[source.name] = target
            library_hashes[source.name] = sketch.combined(files)
        redact = Redactor(cwd, run_folder, stage)
        argv = ["compile", "--fqbn", args.fqbn, "--build-path", str(stage.folder / "build"), "--output-dir", str(run_folder / "binary"), "--warnings", args.warnings]
        for target in library_copies.values():
            argv += ["--library", str(target)]
        argv.append(str(copy))
        document.update({"fqbn": args.fqbn, "source": {"path": the_sketch.path, "name": the_sketch.name, "sha256": the_sketch.sha256}})
        interrupted(run_folder, document, "The run ended while arduino-cli was compiling (Stop, timeout or crash); no binary is valid.")
        code, result, stderr = cli.run(argv)
        compiler_out = str((result or {}).get("compiler_out") or "") if isinstance(result, dict) else ""
        compiler_err = str((result or {}).get("compiler_err") or "") if isinstance(result, dict) else ""
        (run_folder / "compile.log").write_text(
            redact(compiler_out + ("\n" if compiler_out and compiler_err else "") + compiler_err + (("\n" + stderr) if stderr.strip() else "")),
            encoding="utf-8",
            newline="\n",
        )
        raw_builder = result.get("builder_result") if isinstance(result, dict) else None
        builder: dict[str, Any] = raw_builder if isinstance(raw_builder, dict) else {}
        properties = [str(item) for item in builder.get("build_properties") or []]
        raw_platform = builder.get("board_platform")
        platform: dict[str, Any] = raw_platform if isinstance(raw_platform, dict) else {}
        recipes = sorted(stage.redact(item) for item in properties if item.startswith("recipe."))
        document.update(
            {
                "fqbn": args.fqbn,
                "board": details.get("name"),
                "options": options,
                "platform": {
                    "id": platform.get("id") or platform_id,
                    "version": platform.get("version") or installed,
                    "recipesSha256": sha256_bytes("\n".join(recipes).encode("utf-8")) if recipes else None,
                    "hooks": [redact(item) for item in properties if item.startswith("recipe.hooks.")],
                },
                "arduinoCli": {"version": tool_version(cli)},
                "configSha256": cli.config_sha256,
                "source": {"path": the_sketch.path, "name": the_sketch.name, "sha256": the_sketch.sha256, "files": the_sketch.files, "excluded": the_sketch.excluded, "ignored": the_sketch.ignored},
                "libraries": [],
                "sizes": [],
                "binaries": [],
                "diagnostics": diagnostics(compiler_err + "\n" + compiler_out, copy, library_copies, redact),
                "log": workspace.relative(cwd, run_folder / "compile.log"),
            }
        )
        if the_sketch.ignored:
            document["warnings"].append(problem("sketch-yaml-ignored", "sketch.yaml/sketch.json stay out of the build: VERA uses the request's FQBN, core and libraries, not their defaults or profiles.", files=the_sketch.ignored))
        for item in builder.get("used_libraries") or []:
            if not isinstance(item, dict):
                continue
            location = LOCATIONS.get(str(item.get("location")), "other")
            name, version = str(item.get("name", "")), str(item.get("version", ""))
            entry: dict[str, Any] = {"name": name, "version": version, "location": location}
            if location == "platform":
                entry["declared"] = True
                entry["platform"] = item.get("container_platform")
            elif location == "local":
                folder_name = Path(str(item.get("install_dir", ""))).name
                entry["declared"] = folder_name in library_hashes
                entry["sha256"] = library_hashes.get(folder_name)
            else:
                entry["declared"] = declared.get(name) == version
            if not entry["declared"]:
                document["errors"].append(problem("undeclared-library", f"The build used library {name} {version} ({location}) that the request did not declare; add --library {name}@{version}."))
            document["libraries"].append(entry)
        if "Multiple libraries were found" in compiler_out + compiler_err:
            document["warnings"].append(problem("library-ambiguous", "arduino-cli found several libraries for one header and chose one; see compile.log and declare the one you want."))
        for item in builder.get("executable_sections_size") or []:
            if isinstance(item, dict):
                document["sizes"].append({"section": item.get("name"), "bytes": item.get("size"), "maxBytes": item.get("max_size")})
        success = isinstance(result, dict) and result.get("success") is True and code == 0
        binary_folder = run_folder / "binary"
        if success:
            for path in sorted(binary_folder.iterdir()) if binary_folder.is_dir() else []:
                if path.is_file():
                    document["binaries"].append({"path": f"binary/{path.name}", "sha256": sha256_file(path), "bytes": path.stat().st_size})
        elif binary_folder.exists():
            shutil.rmtree(binary_folder, ignore_errors=True)
        if not isinstance(result, dict):
            document["status"] = "error"
            document["errors"].append(problem("tool-failed", f"arduino-cli compile gave no result (exit {code}): {redact(stderr.strip())[:300]}"))
        elif not success:
            document["status"] = "fail"
            document["errors"].append(problem("compile-failed", redact(str(result.get("error") or "The compile failed."))[:500]))
        elif document["errors"]:
            document["status"] = "fail"
        if success and not document["binaries"]:
            document["status"] = "error"
            document["errors"].append(problem("binary-missing", "arduino-cli reported success but exported no binary."))
        document["finishedAt"] = report.stamp()
        report.write(run_folder, document)
        return report.EXIT[document["status"]]
    finally:
        stage.remove()


def tool_version(cli: Cli) -> str | None:
    code, document, _ = cli.run(["version"], timeout=60)
    return document.get("VersionString") if code == 0 and isinstance(document, dict) else None
