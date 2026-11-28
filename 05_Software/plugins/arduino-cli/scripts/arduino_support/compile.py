"""compile: checks before arduino-cli acts, then a compile of a copy into a new run folder (spec REQ-DATA-e444904d).

Nothing is installed here: a missing core is a refusal naming the install command, and a missing header names the
libraries that provide it. The board is the call's --fqbn, else sketch.yaml's default, else the one identified board
that is connected; an unknown board or option is refused with candidates, never replaced. The sources are compiled
from a copy in a build folder VERA keeps per sketch and board, so a later compile rebuilds only what changed.
"""

from __future__ import annotations

import difflib
import json
import os
import re
import shutil
from pathlib import Path
from typing import Any, Callable

from . import boards, extras, indexes, report, sketch, workspace
from .environment import Cli, Environment, Stage, ToolFailed, sha256_bytes, sha256_file
from .report import Refused, problem

TOKEN = r"[A-Za-z0-9][A-Za-z0-9_.-]*"
FQBN = re.compile(rf"({TOKEN}):({TOKEN}):({TOKEN})(?::(.+))?")
OPTION = re.compile(rf"({TOKEN})=({TOKEN})")
VERSION = re.compile(r"\d+(?:\.\d+){0,3}(?:-[0-9A-Za-z.-]+)?")
CORE = re.compile(rf"({TOKEN}):({TOKEN})(?:@(.+))?")
LIBRARY = re.compile(r"([^@\x00-\x1f\x7f-][^@\x00-\x1f\x7f]{0,127})(?:@(.+))?")
MISSING_HEADER = re.compile(r"fatal error: ([A-Za-z0-9_./+-]{1,128}\.h(?:pp)?): No such file or directory")
DIAGNOSTIC = re.compile(r"^(?P<file>.+?):(?P<line>\d+):(?:(?P<column>\d+):)? (?P<severity>fatal error|error|warning|note): (?P<message>.*)$")
DEFINE = re.compile(r"([A-Za-z_][A-Za-z0-9_]*)(?:=(.*))?", re.S)
PLAIN = re.compile(r"[A-Za-z0-9_.+:/-]*")
PROPERTY = re.compile(r"([A-Za-z0-9][A-Za-z0-9_.-]*)=(.*)", re.S)
SYMBOLS = (1, 50)
TOO_BIG = "exceeds available space"
USED = (("text", re.compile(r"Sketch uses (\d+) bytes .*?Maximum is (\d+) bytes")), ("data", re.compile(r"Global variables use (\d+) bytes .*?Maximum is (\d+) bytes")))
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


def parse_core(text: str) -> tuple[str, str, str | None]:
    """VENDOR:ARCH with an optional exact version; without one the latest is meant."""
    match = CORE.fullmatch(text or "")
    if not match or (match.group(3) and not VERSION.fullmatch(match.group(3))):
        raise Refused([problem("version-invalid", f"'{text[:120]}' must be VENDOR:ARCH or VENDOR:ARCH@VERSION, such as arduino:avr or arduino:avr@1.8.8.")])
    return match.group(1), match.group(2), match.group(3)


def parse_library(text: str) -> tuple[str, str | None]:
    """NAME with an optional exact version; without one the latest is meant."""
    match = LIBRARY.fullmatch(text or "")
    if not match or (match.group(2) and not VERSION.fullmatch(match.group(2))) or match.group(1).strip() != match.group(1):
        raise Refused([problem("version-invalid", f"'{text[:120]}' must be NAME or NAME@VERSION, such as Servo or Servo@1.2.2.")])
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


def choose_board(cli: Cli, args: Any, the_sketch: sketch.Sketch) -> tuple[str, str]:
    """The board of a compile and where it came from: --fqbn, sketch.yaml's default, or the one identified board."""
    if args.fqbn:
        return args.fqbn, "argument"
    if the_sketch.defaults.get("fqbn"):
        return the_sketch.defaults["fqbn"], "sketch.yaml"
    code, listed, _ = cli.run(["board", "list"], timeout=120)
    records = boards.ports(listed)[0] if code == 0 and isinstance(listed, dict) else []
    connected = sorted({item["fqbn"] for record in records if record["identified"] for item in record["boards"]})
    if len(connected) == 1:
        return connected[0], "connected board"
    raise Refused(
        [
            problem(
                "fqbn-required",
                "Name the board with --fqbn VENDOR:ARCH:BOARD (find it with: arduino-tool boards search NAME), or attach it to the sketch once with: arduino-tool attach --sketch "
                + the_sketch.path
                + " --fqbn VENDOR:ARCH:BOARD."
                + (f" Connected boards: {', '.join(connected)}." if connected else " No connected board identifies itself."),
                connected=connected,
            )
        ]
    )


def build_properties(args: Any) -> list[str]:
    """The build properties of a compile: the call's own, and its --define values as flags of the C and C++ compilers
    (the properties every core leaves empty for this)."""
    flags = []
    for text in args.define or []:
        match = DEFINE.fullmatch(text)
        value = match.group(2) if match else None
        if not match or (value is not None and (not workspace.control_free(value) or "'" in value or len(value) > 500)):
            raise Refused([problem("define-invalid", f"--define '{text[:120]}' must be NAME or NAME=VALUE, without control characters or single quotes.")])
        flag = f"-D{text}"
        # arduino-cli splits a property like a command line: single quotes keep spaces and double quotes as they are.
        flags.append(flag if value is None or PLAIN.fullmatch(value) else f"'{flag}'")
    properties = []
    for text in args.build_property or []:
        match = PROPERTY.fullmatch(text)
        if not match or not workspace.control_free(text) or len(text) > 2000:
            raise Refused([problem("property-invalid", f"--build-property '{text[:120]}' must be KEY=VALUE without control characters.")])
        if flags and match.group(1) in ("compiler.c.extra_flags", "compiler.cpp.extra_flags"):
            raise Refused([problem("property-invalid", f"--build-property {match.group(1)} cannot be combined with --define, which sets it.")])
        properties.append(text)
    if flags:
        properties += [f"compiler.c.extra_flags={' '.join(flags)}", f"compiler.cpp.extra_flags={' '.join(flags)}"]
    return properties


def missing_headers(text: str, data: Path) -> list[dict]:
    """One problem per header the compiler did not find, naming the index libraries that provide it."""
    problems = []
    for header in dict.fromkeys(MISSING_HEADER.findall(text)):
        name = Path(header).name
        try:
            found = indexes.providers(data, name)
        except Exception:  # noqa: BLE001 - a hint must never fail the report of the compile
            found = []
        if found:
            hint = f"Libraries that provide it: {', '.join(item['name'] for item in found)}. Install one with: arduino-tool install library \"{found[0]['name']}\"."
        else:
            hint = f"No index library is known for it; search with: arduino-tool libraries search {Path(name).stem}."
        problems.append(problem("header-missing", f"{header} is not in the sketch, the core or an installed library. {hint}", header=header, libraries=found))
    return problems


def run(cwd: Path, spelled: Path, environment: Environment, args: Any, document: dict) -> int:
    core = parse_core(args.core) if args.core else None
    declared: dict[str, str | None] = {}
    for text in args.library or []:
        name, version = parse_library(text)
        if name in declared:
            raise Refused([problem("library-repeated", f"--library {name} is given more than once.")])
        declared[name] = version
    local = [_library_folder(cwd, spelled, raw) for raw in args.library_dir or []]
    names = [folder.name for folder in local]
    if len(set(names)) != len(names):
        raise Refused([problem("library-invalid", "Two --library-dir folders have the same name.")])
    given = build_properties(args)
    if args.symbols is not None and not SYMBOLS[0] <= args.symbols <= SYMBOLS[1]:
        raise Refused([problem("arguments", f"--symbols takes {SYMBOLS[0]} to {SYMBOLS[1]}.")])
    the_sketch = sketch.load(cwd, spelled, args.sketch)
    run_id = args.run_id or report.new_run_id("compile")
    stage = environment.stage(run_id)
    kept: Path | None = None
    try:
        cli = Cli(stage)
        fqbn, fqbn_from = choose_board(cli, args, the_sketch)
        vendor, arch, board, options = parse_fqbn(fqbn)
        if core and (core[0], core[1]) != (vendor, arch):
            raise Refused([problem("core-mismatch", f"--core {args.core} is not the platform of the board {vendor}:{arch}.")])
        problems: list[dict] = []
        platforms = installed_platforms(cli)
        platform_id = f"{vendor}:{arch}"
        installed = platforms.get(platform_id)
        if not installed:
            pinned = f"{platform_id}@{core[2]}" if core and core[2] else platform_id
            raise Refused([problem("core-missing", f"Core {platform_id} is not installed in VERA's Arduino environment; install it with: arduino-tool install core {pinned}")])
        if core and core[2] and installed != core[2]:
            raise Refused([problem("core-version", f"Core {platform_id} {installed} is installed, not {core[2]}; install the version you need with: arduino-tool install core {platform_id}@{core[2]}")])
        folder = environment.platform_folder(vendor, arch, installed)
        overrides = [name for name in ("platform.local.txt", "boards.local.txt") if (folder / name).exists()]
        if overrides:
            document["warnings"].append(problem("local-override", f"The installed core {platform_id} {installed} holds {', '.join(overrides)}, which changes its recipes or boards from what its index published."))
        details = board_details(cli, vendor, arch, board)
        check_options(details, options)
        libraries = installed_libraries(cli) if declared else {}
        for name, version in declared.items():
            wanted = f"{name}@{version}" if version else name
            if name not in libraries:
                problems.append(problem("library-missing", f"Library {name} is not installed; install it with: arduino-tool install library \"{wanted}\""))
            elif version and libraries[name] != version:
                problems.append(problem("library-version", f"Library {name} {libraries[name]} is installed, not {version}; install it with: arduino-tool install library \"{wanted}\""))
        if problems:
            raise Refused(problems)

        run_folder = report.run_folder(cwd, spelled, args.results_dir, run_id)
        document["runId"] = run_id
        # The run folder keeps the sources as they were compiled; arduino-cli reads them from the kept build folder,
        # where unchanged files keep their times. While another run holds that folder, this one builds afresh.
        sketch.copy(the_sketch, run_folder / "sketch" / the_sketch.name)
        # Other defines or properties are another build: each keeps its own folder and stays incremental.
        kept = environment.build(the_sketch.name, "|".join([str(the_sketch.folder), fqbn, *given]))
        work = kept if kept is not None else stage.folder
        if kept is not None and args.clean:
            shutil.rmtree(kept / "build", ignore_errors=True)
        copy = work / "sketch" / the_sketch.name
        sketch.sync(the_sketch.files, the_sketch.folder, copy)
        library_copies: dict[str, Path] = {}
        library_hashes: dict[str, str] = {}
        for source in local:
            files, _, _ = sketch.scan(source, "--library-dir")
            target = work / "libraries" / source.name
            sketch.sync(files, source, target)
            library_copies[source.name] = target
            library_hashes[source.name] = sketch.combined(files)
        redact = Redactor(cwd, run_folder, stage)
        argv = ["compile", "--fqbn", fqbn, "--build-path", str(work / "build"), "--output-dir", str(run_folder / "binary"), "--warnings", args.warnings, "--dump-profile"]
        for item in given:
            argv += ["--build-property", item]
        for target in library_copies.values():
            argv += ["--library", str(target)]
        argv.append(str(copy))
        document.update({"fqbn": fqbn, "source": {"path": the_sketch.path, "name": the_sketch.name, "sha256": the_sketch.sha256}})
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
                "fqbn": fqbn,
                "fqbnFrom": fqbn_from,
                "incremental": kept is not None and not args.clean,
                "board": details.get("name"),
                "options": options,
                **({"defines": list(args.define)} if args.define else {}),
                **({"buildProperties": list(args.build_property)} if args.build_property else {}),
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
        if sketch.unused(the_sketch):
            document["warnings"].append(problem("sketch-profile-unused", "sketch.yaml's profiles are not used: VERA builds with the installed core and libraries and records their versions in the result.", keys=sketch.unused(the_sketch)))
        for item in builder.get("used_libraries") or []:
            if not isinstance(item, dict):
                continue
            location = LOCATIONS.get(str(item.get("location")), "other")
            name, version = str(item.get("name", "")), str(item.get("version", ""))
            entry: dict[str, Any] = {"name": name, "version": version, "location": location}
            if location == "platform":
                entry["platform"] = item.get("container_platform")
            elif location == "local":
                entry["sha256"] = library_hashes.get(Path(str(item.get("install_dir", ""))).name)
            document["libraries"].append(entry)
        if "Multiple libraries were found" in compiler_out + compiler_err:
            document["warnings"].append(problem("library-ambiguous", "arduino-cli found several libraries for one header and chose one; see compile.log, then keep only the one you want installed or pass it with --library-dir."))
        for item in builder.get("executable_sections_size") or []:
            if isinstance(item, dict):
                document["sizes"].append({"section": item.get("name"), "bytes": item.get("size"), "maxBytes": item.get("max_size")})
        if not document["sizes"]:
            # A build that does not fit reports its sizes only in the text it prints.
            for section, pattern in USED:
                match = pattern.search(compiler_out)
                if match:
                    document["sizes"].append({"section": section, "bytes": int(match.group(1)), "maxBytes": int(match.group(2))})
        too_big = isinstance(result, dict) and TOO_BIG in str(result.get("error") or "")
        if args.symbols or too_big:
            largest = extras.symbols(properties, work / "build" / f"{the_sketch.name}.ino.elf", args.symbols or 15)
            if largest:
                document["symbols"] = largest
            elif args.symbols:
                document["warnings"].append(problem("symbols-unavailable", "The largest symbols could not be read: the build linked no program, or its toolchain has no nm next to its size tool."))
        if args.compile_commands:
            database = work / "build" / "compile_commands.json"
            if database.is_file():
                shutil.copyfile(database, run_folder / "compile_commands.json")
                document["compileCommands"] = workspace.relative(cwd, run_folder / "compile_commands.json")
            else:
                document["warnings"].append(problem("compile-commands-missing", "arduino-cli wrote no compile_commands.json for this build."))
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
            document["errors"] += missing_headers(compiler_err + "\n" + compiler_out, environment.data)
        elif isinstance(result.get("profile_out"), str) and result["profile_out"].strip():
            # The versions this build used, as the profile arduino-cli itself would pin them with.
            document["profile"] = result["profile_out"].strip()
            (run_folder / "profile.yaml").write_text(document["profile"] + "\n", encoding="utf-8", newline="\n")
        if success and not document["binaries"]:
            document["status"] = "error"
            document["errors"].append(problem("binary-missing", "arduino-cli reported success but exported no binary."))
        document["finishedAt"] = report.stamp()
        report.write(run_folder, document)
        return report.EXIT[document["status"]]
    finally:
        stage.remove()
        if kept is not None:
            environment.release(kept)


def tool_version(cli: Cli) -> str | None:
    code, document, _ = cli.run(["version"], timeout=60)
    return document.get("VersionString") if code == 0 and isinstance(document, dict) else None
