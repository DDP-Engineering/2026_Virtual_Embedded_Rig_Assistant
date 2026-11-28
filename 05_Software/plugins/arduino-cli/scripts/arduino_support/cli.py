"""Command line of arduino-tool (spec REQ-DATA-e444904d).

inspect, boards list|details|search, cores list|search, libraries list|search, examples list|copy,
install index|core|library, attach, compile (with --upload and --watch: build, upload and read the board's serial
output in one call), upload (serial, or --network for OTA), report, clean, and cli -- <any other arduino-cli command>
in VERA's own Arduino environment. One JSON document on stdout; exit 0 pass, 2 refused before arduino-cli acted,
3 failed.
"""

from __future__ import annotations

import argparse
import sys
import urllib.parse
from pathlib import Path
from typing import Any

from . import TOOL, VERSION, boards, compile, extras, indexes, report, sketch, upload, workspace
from .environment import HTTPS_URL, Cli, Environment, ToolFailed, ToolMissing, Unusable
from .report import Refused, problem

QUERY_TIMEOUT = 300
LIST_LIMIT = 500


class Parser(argparse.ArgumentParser):
    """argparse that refuses with a JSON document instead of printing usage."""

    def error(self, message: str) -> None:  # type: ignore[override]
        raise Refused([problem("arguments", f"{self.prog}: {message}")])


def _parser() -> Parser:
    parser = Parser(prog=TOOL, description="Native Arduino sketches with VERA's own arduino-cli environment.", allow_abbrev=False)
    parser.add_argument("--version", action="version", version=f"{TOOL} {VERSION}")
    operations = parser.add_subparsers(dest="operation", metavar="operation", required=True, parser_class=Parser)

    def results(command: argparse.ArgumentParser) -> None:
        command.add_argument("--run-id", metavar="ID")
        command.add_argument("--results-dir", default=report.DEFAULT_RESULTS, metavar="DIR")

    inspect = operations.add_parser("inspect", help="describe a sketch and VERA's Arduino environment", allow_abbrev=False)
    inspect.add_argument("--sketch", required=True, metavar="DIR")

    for group, actions in (("boards", ("list", "details", "search")), ("cores", ("list", "search")), ("libraries", ("list", "search"))):
        command = operations.add_parser(group, help=f"{group}: {', '.join(actions)} (offline; boards list reads the ports)", allow_abbrev=False)
        sub = command.add_subparsers(dest="action", metavar="action", required=True, parser_class=Parser)
        for action in actions:
            leaf = sub.add_parser(action, allow_abbrev=False)
            if action == "details":
                leaf.add_argument("--fqbn", required=True)
            elif action == "search":
                leaf.add_argument("text", nargs="?" if group == "boards" else None, default="")

    examples = operations.add_parser("examples", help="examples: list those of installed libraries, or copy one into the workbench as a new sketch", allow_abbrev=False)
    example = examples.add_subparsers(dest="action", metavar="action", required=True, parser_class=Parser)
    listing = example.add_parser("list", allow_abbrev=False)
    listing.add_argument("--library", metavar="NAME")
    listing.add_argument("--fqbn", help="also the libraries of this board's core (SPI, Wire, EEPROM ...)")
    copying = example.add_parser("copy", allow_abbrev=False)
    copying.add_argument("--library", required=True, metavar="NAME")
    copying.add_argument("--example", required=True, metavar="NAME")
    copying.add_argument("--to", metavar="DIR", help="the new sketch folder (default: the example's name)")
    copying.add_argument("--fqbn", help="the board, for an example of a library of its core")

    install = operations.add_parser("install", help="install an index, a core or libraries: the latest version unless one is named", allow_abbrev=False)
    kinds = install.add_subparsers(dest="kind", metavar="kind", required=True, parser_class=Parser)
    index = kinds.add_parser("index", allow_abbrev=False)
    index.add_argument("--index-url", action="append", default=[], metavar="URL")
    core = kinds.add_parser("core", allow_abbrev=False)
    core.add_argument("platform", metavar="VENDOR:ARCH[@VERSION]")
    library = kinds.add_parser("library", allow_abbrev=False)
    library.add_argument("library", nargs="+", metavar="NAME[@VERSION]")
    library.add_argument("--no-deps", action="store_true", help="leave the library's dependencies out")

    attach = operations.add_parser("attach", help="remember a sketch's board and port in its sketch.yaml", allow_abbrev=False)
    attach.add_argument("--sketch", required=True, metavar="DIR")
    attach.add_argument("--fqbn")
    attach.add_argument("--port")

    def sending(command: argparse.ArgumentParser) -> None:
        command.add_argument("--port", help="the board's serial port; found by itself when one port fits")
        command.add_argument("--identity", help="refuse when the port carries another USB identity")
        command.add_argument("--programmer")
        command.add_argument("--verify", action="store_true")
        command.add_argument("--watch", type=int, metavar="SECONDS", help="after the upload, read the board's serial output this long")
        command.add_argument("--baud", type=int, help="baud rate of --watch (default: sketch.yaml's, else 115200)")
        command.add_argument("--network", action="store_true", help="--port is the board's network address (OTA upload)")
        command.add_argument("--password-file", metavar="FILE", help="a workbench file whose first line is the board's OTA password")

    build = operations.add_parser("compile", help="compile a sketch into a new run folder; with --upload also send it to the board", allow_abbrev=False)
    build.add_argument("--sketch", required=True, metavar="DIR")
    build.add_argument("--fqbn", help="the board; default: sketch.yaml's default_fqbn, else the one identified board connected")
    build.add_argument("--core", metavar="VENDOR:ARCH@VERSION", help="refuse unless this core version is installed")
    build.add_argument("--library", action="append", metavar="NAME[@VERSION]", help="refuse unless this library (version) is installed")
    build.add_argument("--library-dir", action="append", metavar="DIR")
    build.add_argument("--warnings", choices=("none", "default", "more", "all"), default="default")
    build.add_argument("--define", action="append", metavar="NAME[=VALUE]", help="a preprocessor define for the sketch, its libraries and the core")
    build.add_argument("--build-property", action="append", metavar="KEY=VALUE", help="override a build property of the board's core")
    build.add_argument("--symbols", type=int, metavar="N", help="also report the N largest symbols in flash and in RAM")
    build.add_argument("--compile-commands", action="store_true", help="also keep the build's compile_commands.json in the run folder")
    build.add_argument("--clean", action="store_true", help="rebuild everything instead of only what changed")
    build.add_argument("--upload", action="store_true", help="upload the build when it passes")
    sending(build)
    results(build)

    send = operations.add_parser("upload", help="upload the verified binary of a compile run", allow_abbrev=False)
    send.add_argument("--build", required=True, metavar="RESULT_JSON")
    sending(send)
    results(send)

    summary = operations.add_parser("report", help="summarize compile and upload run folders", allow_abbrev=False)
    summary.add_argument("--run", action="append", required=True, metavar="DIR")
    summary.add_argument("--title")
    results(summary)

    cleaning = operations.add_parser("clean", help="remove VERA's build cache, kept build folders and ended staging folders; with --runs, old run folders of the workbench instead", allow_abbrev=False)
    cleaning.add_argument("--runs", action="store_true", help="remove arduino-tool's run folders from the results folder, except the newest")
    cleaning.add_argument("--keep", type=int, default=extras.RUNS_KEPT, metavar="N", help=f"how many of the newest run folders stay (default {extras.RUNS_KEPT})")
    cleaning.add_argument("--results-dir", default=report.DEFAULT_RESULTS, metavar="DIR")

    passed = operations.add_parser("cli", help="run any other arduino-cli command in VERA's own Arduino environment: cli [--online] -- COMMAND ...", allow_abbrev=False)
    passed.add_argument("--online", action="store_true", help="let the command reach the network")
    passed.add_argument("command", nargs=argparse.REMAINDER, metavar="-- COMMAND ...")
    return parser


_query = compile.query


def _search_text(text: str) -> str:
    """Search text that arduino-cli can never read as an option."""
    if text.startswith("-") or len(text) > 200 or not workspace.control_free(text):
        raise Refused([problem("arguments", "The search text must not start with '-', hold control characters or exceed 200 characters.")])
    return text


def _with_cli(environment: Environment, run_id: str, action, online: bool = False, urls: list[str] | None = None) -> Any:
    stage = environment.stage(run_id)
    try:
        return action(Cli(stage, online, urls), stage)
    finally:
        stage.remove()


def _platforms(document: dict) -> list[dict]:
    return [
        {"id": item.get("id"), "installed": item.get("installed_version") or None, "latest": item.get("latest_version") or None}
        for item in document.get("platforms") or []
        if isinstance(item, dict)
    ][:LIST_LIMIT]


def _installed_libraries(document: dict, stage) -> list[dict]:
    found = []
    for item in document.get("installed_libraries") or []:
        library = item.get("library") if isinstance(item, dict) else None
        if isinstance(library, dict):
            found.append({"name": library.get("name"), "version": library.get("version"), "location": compile.LOCATIONS.get(str(library.get("location")), "other")})
    return found[:LIST_LIMIT]


def _inspect(cwd: Path, spelled: Path, environment: Environment, args, document: dict) -> int:
    the_sketch = sketch.load(cwd, spelled, args.sketch)
    document["sketch"] = {"path": the_sketch.path, "main": the_sketch.main, "sha256": the_sketch.sha256, "excluded": the_sketch.excluded, "ignored": the_sketch.ignored}
    document["files"] = the_sketch.files
    document["sketch"]["defaults"] = the_sketch.defaults
    if sketch.unused(the_sketch):
        document["warnings"].append(problem("sketch-profile-unused", "sketch.yaml's profiles are not used: VERA builds with the installed core and libraries and records their versions in the result.", keys=sketch.unused(the_sketch)))

    def environment_state(cli: Cli, stage) -> dict:
        version = compile.tool_version(cli)
        cores = _query(cli, ["core", "list"])
        libraries = _query(cli, ["lib", "list"])
        return {"present": True, "version": version, "platforms": _platforms(cores), "libraries": _installed_libraries(libraries, stage)}

    try:
        state = _with_cli(environment, report.new_run_id("inspect"), environment_state)
    except ToolMissing:
        state = {"present": False}
        document["warnings"].append(problem("tool-missing", "arduino-cli is not installed; choose Install programs for the arduino-cli plugin."))
    document["arduinoCli"] = {"present": state["present"], "version": state.get("version")}
    document["platforms"] = state.get("platforms", [])
    document["libraries"] = state.get("libraries", [])
    return 0


def _boards(environment: Environment, args, document: dict) -> int:
    def act(cli: Cli, stage) -> None:
        if args.action == "list":
            listed = _query(cli, ["board", "list"])
            document["ports"], document["ignored"] = boards.ports(listed)
            if boards.network(listed):
                document["network"] = boards.network(listed)
        elif args.action == "details":
            vendor, arch, board, _ = compile.parse_fqbn(args.fqbn)
            details = compile.board_details(cli, vendor, arch, board)
            document["board"] = {
                "fqbn": f"{vendor}:{arch}:{board}",
                "name": details.get("name"),
                "platform": f"{vendor}:{arch}",
                "options": [
                    {"option": item.get("option"), "label": item.get("option_label"), "values": [value.get("value") for value in item.get("values") or []], "default": next((value.get("value") for value in item.get("values") or [] if value.get("selected")), None)}
                    for item in details.get("config_options") or []
                ],
                "programmers": [{"id": item.get("id"), "name": item.get("name")} for item in details.get("programmers") or []],
            }
        else:
            result = _query(cli, ["board", "listall", *([_search_text(args.text)] if args.text else [])])
            document["boards"] = [
                {"name": item.get("name"), "fqbn": item.get("fqbn"), "platform": ((item.get("platform") or {}).get("metadata") or {}).get("id"), "version": ((item.get("platform") or {}).get("release") or {}).get("version")}
                for item in result.get("boards") or []
                if isinstance(item, dict)
            ][:LIST_LIMIT]

    _with_cli(environment, report.new_run_id("boards"), act)
    return 0


def _cores(environment: Environment, args, document: dict) -> int:
    if args.action == "search":
        _search_text(args.text)
        try:
            found = indexes.search_platforms(environment.data, args.text)
        except indexes.IndexMissing as error:
            raise Refused([problem("index-missing", "The package index is not downloaded yet; run: arduino-tool install index")]) from error

    def act(cli: Cli, stage) -> None:
        installed = _platforms(_query(cli, ["core", "list"]))
        if args.action == "list":
            document["platforms"] = installed
            return
        versions = {item["id"]: item["installed"] for item in installed}
        document["platforms"] = [{**item, "installed": versions.get(item["id"])} for item in found]

    try:
        _with_cli(environment, report.new_run_id("cores"), act)
    except ToolMissing:
        if args.action == "list":
            raise
        # A search answers from the index alone; without arduino-cli nothing is installed.
        document["platforms"] = [{**item, "installed": None} for item in found]
    return 0


def _libraries(environment: Environment, args, document: dict) -> int:
    if args.action == "search":
        _search_text(args.text)
        try:
            document["libraries"] = indexes.search_libraries(environment.data, args.text)
        except indexes.IndexMissing as error:
            raise Refused([problem("index-missing", "The library index is not downloaded yet; run: arduino-tool install index")]) from error
        return 0

    def act(cli: Cli, stage) -> None:
        document["libraries"] = _installed_libraries(_query(cli, ["lib", "list"]), stage)

    _with_cli(environment, report.new_run_id("libraries"), act)
    return 0


def _examples(cwd: Path, spelled: Path, environment: Environment, args, document: dict) -> int:
    def act(cli: Cli, stage) -> None:
        if args.action == "list":
            extras.list_examples(cli, args.library, args.fqbn, document)
        else:
            extras.copy_example(cwd, spelled, cli, args, document)

    _with_cli(environment, report.new_run_id("examples"), act)
    return 0


def _update_indexes(cli: Cli, stage, document: dict) -> bool:
    outcomes = []
    for command in (["core", "update-index"], ["lib", "update-index"]):
        code, result, stderr = cli.run(command)
        outcomes.append({"command": " ".join(command), "ok": code == 0, "message": None if code == 0 else stage.redact(str((result or {}).get("error") if isinstance(result, dict) else stderr).strip())[:300]})
    document["indexes"] = outcomes
    if all(item["ok"] for item in outcomes):
        return True
    document["status"] = "fail"
    document["errors"].append(problem("install-failed", "An index could not be updated; see indexes."))
    return False


def _attach(cwd: Path, spelled: Path, environment: Environment, args, document: dict) -> int:
    """Writes the sketch's board and port into its sketch.yaml with arduino-cli's own `board attach`."""
    the_sketch = sketch.load(cwd, spelled, args.sketch)
    if not args.fqbn and not args.port:
        raise Refused([problem("arguments", "attach needs --fqbn, --port or both.")])
    if args.port and (len(args.port) > 256 or not workspace.control_free(args.port) or args.port.startswith("-")):
        raise Refused([problem("arguments", "--port needs a port name such as COM5 or /dev/ttyACM0.")])

    def act(cli: Cli, stage) -> None:
        argv = ["board", "attach"]
        if args.fqbn:
            vendor, arch, board, options = compile.parse_fqbn(args.fqbn)
            compile.check_options(compile.board_details(cli, vendor, arch, board), options)
            argv += ["--fqbn", args.fqbn]
        if args.port:
            argv += ["--port", args.port, "--protocol", "serial"]
        code, result, stderr = cli.run([*argv, str(the_sketch.folder)], timeout=QUERY_TIMEOUT)
        if code != 0:
            raise ToolFailed(f"arduino-cli board attach failed: {stage.redact(str((result or {}).get('error') if isinstance(result, dict) else stderr).strip())[:300]}")

    _with_cli(environment, report.new_run_id("attach"), act)
    after = sketch.load(cwd, spelled, args.sketch)
    document["sketch"] = {"path": after.path, "defaults": after.defaults}
    return 0


def _install(environment: Environment, args, document: dict) -> int:
    if args.kind == "index":
        for url in args.index_url:
            parsed = urllib.parse.urlsplit(url)
            if not HTTPS_URL.fullmatch(url) or parsed.scheme != "https" or len(url) > 2048 or parsed.username or parsed.password:
                raise Refused([problem("index-url", f"--index-url '{url[:120]}' must be an https URL without credentials.")])
        urls = list(dict.fromkeys([*environment.index_urls(), *args.index_url]))

        def update(cli: Cli, stage) -> None:
            document["indexUrls"] = urls
            if _update_indexes(cli, stage, document):
                environment.save_index_urls(urls)

        _with_cli(environment, report.new_run_id("install"), update, online=True, urls=urls)
        return report.EXIT[document["status"]]
    if args.kind == "core":
        vendor, arch, version = compile.parse_core(args.platform)
        items = [f"{vendor}:{arch}" + (f"@{version}" if version else "")]
        command = ["core", "install", *items, "--skip-post-install"]
    else:
        parsed = [compile.parse_library(item) for item in args.library]
        items = [name + (f"@{version}" if version else "") for name, version in parsed]
        command = ["lib", "install", *items, *(["--no-deps"] if args.no_deps else [])]
    index = environment.data / ("package_index.json" if args.kind == "core" else "library_index.json")

    def act(cli: Cli, stage) -> None:
        # The first install fetches the indexes by itself.
        if not index.is_file() and not _update_indexes(cli, stage, document):
            return
        listed = compile.installed_platforms if args.kind == "core" else compile.installed_libraries
        before = listed(cli)
        code, result, stderr = cli.run(command)
        after = listed(cli)
        key = "id" if args.kind == "core" else "name"
        document["installed"] = [{key: name, "version": version, **({"replaced": before[name]} if name in before else {})} for name, version in sorted(after.items()) if before.get(name) != version]
        if code != 0:
            document["status"] = "fail"
            message = (result or {}).get("error") if isinstance(result, dict) else stderr
            document["errors"].append(problem("install-failed", stage.redact(str(message or "The install failed.")).strip()[:500]))
            return
        if args.kind == "library" and args.no_deps:
            for item in items:
                code, deps, _ = cli.run(["lib", "deps", item], timeout=QUERY_TIMEOUT)
                for dependency in (deps or {}).get("dependencies") or [] if code == 0 and isinstance(deps, dict) else []:
                    if isinstance(dependency, dict) and dependency.get("name") not in after and not dependency.get("version_installed"):
                        document["warnings"].append(problem("dependency-missing", f"{item} depends on {dependency.get('name')} {dependency.get('version_required') or ''}, which is not installed.".replace("  ", " ")))

    _with_cli(environment, report.new_run_id("install"), act, online=True)
    return report.EXIT[document["status"]]


def _compile(cwd: Path, spelled: Path, environment: Environment, args, document: dict) -> int:
    """compile, and with --upload the upload of that build (and the board's serial output) in the same call."""
    if not args.upload and any(value not in (None, False) for value in (args.port, args.identity, args.programmer, args.verify, args.watch, args.baud, args.network, args.password_file)):
        raise Refused([problem("arguments", "--port, --identity, --programmer, --verify, --watch, --baud, --network and --password-file belong to an upload; add --upload.")])
    code = compile.run(cwd, spelled, environment, args, document)
    if code != 0 or not args.upload:
        return code
    sent = report.header("upload", None, report.stamp())
    request = argparse.Namespace(
        build=f"{args.results_dir}/{document['runId']}/result.json",
        port=args.port,
        identity=args.identity,
        programmer=args.programmer,
        verify=args.verify,
        watch=args.watch,
        baud=args.baud,
        network=args.network,
        password_file=args.password_file,
        run_id=None,
        results_dir=args.results_dir,
    )
    try:
        code = upload.run(cwd, spelled, environment, request, sent)
    except Refused as refusal:
        sent["status"], sent["errors"], code = "blocked", refusal.problems, 2
    except ToolFailed as error:
        sent["status"], sent["errors"], code = "error", [problem("tool-failed", str(error))], 3
    sent.setdefault("finishedAt", report.stamp())
    document["upload"] = {key: sent[key] for key in ("status", "runId", "port", "identity", "board", "binary", "verified", "programmer", "serial", "log") if key in sent}
    # The build stands as compiled; the call's outcome is the upload's.
    document["status"] = sent["status"]
    document["errors"] += sent["errors"]
    document["warnings"] += sent["warnings"]
    return code


def _report(cwd: Path, spelled: Path, args, document: dict) -> int:
    runs = []
    for raw in args.run:
        try:
            folder = workspace.confined(cwd, raw, "--run", spelled)
        except workspace.PathRefused as error:
            raise Refused([problem("path", str(error))]) from error
        runs.append(report.summary(cwd, folder))
    run_id = args.run_id or report.new_run_id("report")
    folder = report.run_folder(cwd, spelled, args.results_dir, run_id)
    document["runId"] = run_id
    document["title"] = (args.title or "Arduino runs")[:200]
    document["runs"] = runs
    document["finishedAt"] = report.stamp()
    report.write(folder, document)
    return 0


def main(argv: list[str]) -> int:
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8", errors="backslashreplace", newline="\n")  # type: ignore[union-attr]
    started = report.stamp()
    operation = next((value for value in argv if not value.startswith("-")), "arguments")
    document = report.header(operation if operation in {"inspect", "boards", "cores", "libraries", "examples", "install", "attach", "compile", "upload", "report", "clean", "cli"} else "arguments", None, started)
    try:
        args = _parser().parse_args(argv)
        if getattr(args, "run_id", None) and not workspace.valid_run_id(args.run_id):
            raise Refused([problem("arguments", "--run-id takes 1-64 letters, digits, '.', '_' or '-', starting and ending with a letter or digit.")])
        cwd = Path(workspace.entered_directory()).resolve()
        spelled = workspace.entered_directory()
        environment = Environment()
        if args.operation == "inspect":
            code = _inspect(cwd, spelled, environment, args, document)
        elif args.operation == "boards":
            code = _boards(environment, args, document)
        elif args.operation == "cores":
            code = _cores(environment, args, document)
        elif args.operation == "libraries":
            code = _libraries(environment, args, document)
        elif args.operation == "examples":
            code = _examples(cwd, spelled, environment, args, document)
        elif args.operation == "cli":
            code = _with_cli(environment, report.new_run_id("cli"), lambda cli, stage: extras.passthrough(cwd, cli, args.command, document), online=args.online)
        elif args.operation == "install":
            code = _install(environment, args, document)
        elif args.operation == "attach":
            code = _attach(cwd, spelled, environment, args, document)
        elif args.operation == "compile":
            code = _compile(cwd, spelled, environment, args, document)
        elif args.operation == "upload":
            code = upload.run(cwd, spelled, environment, args, document)
        elif args.operation == "report":
            code = _report(cwd, spelled, args, document)
        elif args.runs:
            if args.keep < 0:
                raise Refused([problem("arguments", "--keep takes 0 or more.")])
            document["clean"] = {"runs": extras.prune_runs(cwd, spelled, args.results_dir, args.keep)}
            code = 0
        else:
            document["clean"] = environment.clean()
            code = 0
    except Refused as refusal:
        document["status"] = "blocked"
        document["errors"] = refusal.problems
        code = 2
    except sketch.SketchInvalid as error:
        document["status"] = "blocked"
        document["errors"] = [problem("sketch-invalid", str(error))]
        code = 2
    except ToolMissing:
        document["status"] = "blocked"
        document["errors"] = [problem("tool-missing", "arduino-cli is not installed; choose Install programs for the arduino-cli plugin.")]
        code = 2
    except Unusable as error:
        document["status"] = "blocked"
        document["errors"] = [problem("environment", str(error))]
        code = 2
    except ToolFailed as error:
        document["status"] = "error"
        document["errors"] = [problem("tool-failed", str(error))]
        code = 3
    except SystemExit as exit_:
        # --version and --help print their text and exit 0.
        return int(exit_.code or 0)
    except Exception as error:  # noqa: BLE001 - one JSON document on every path
        document["status"] = "error"
        document["errors"] = [problem("internal", f"{type(error).__name__}: {str(error)[:300]}")]
        code = 3
    document.setdefault("finishedAt", report.stamp())
    report.emit(document)
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
