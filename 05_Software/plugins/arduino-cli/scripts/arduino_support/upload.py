"""upload: the verified binary of a passing compile run, to a serial port (spec REQ-DATA-e444904d).

This module binds everything the compile's result.json records: the sketch copy and the binaries in the run folder
and the original sketch. The binaries are copied to staging, checked again and uploaded from there, so nothing
changed after the check reaches the board. Nothing is recompiled. The port is the call's, else sketch.yaml's default,
else the one port that fits; a board that cannot be identified is uploaded to with a warning. With --watch the
board's serial output after the upload is part of the result.
"""

from __future__ import annotations

import json
import os
import re
import shutil
from pathlib import Path
from typing import Any

from . import FORMAT, KIND, boards, report, sketch, workspace
from .compile import TOKEN, Redactor, board_details, interrupted, parse_fqbn
from .environment import Cli, Environment, ToolFailed, sha256_bytes, sha256_file
from .report import Refused, problem

PRIMARY = (".hex", ".bin", ".uf2", ".elf")
SHOWN = 4000
WATCH = (1, 120)
BAUD = 115200
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")
HOST = re.compile(r"[A-Za-z0-9\[][A-Za-z0-9.:_\[\]-]{0,254}")


def _load_build(cwd: Path, spelled: Path, raw: str) -> tuple[Path, dict, str]:
    try:
        path = workspace.regular_file(cwd, raw, "--build", spelled)
    except workspace.PathRefused as error:
        raise Refused([problem("build-invalid", str(error))]) from error
    try:
        if path.stat().st_size > 4 * 1024 * 1024:
            raise ValueError("too large")
        data = path.read_bytes()
        document = json.loads(data.decode("utf-8"))
    except (OSError, ValueError) as error:
        raise Refused([problem("build-invalid", f"--build '{raw[:120]}' is not a JSON result document.")]) from error
    if not isinstance(document, dict) or document.get("format") != FORMAT or document.get("kind") != KIND or document.get("operation") != "compile":
        raise Refused([problem("build-invalid", f"--build '{raw[:120]}' is not a format 1 arduino-tool compile result.")])
    if document.get("status") != "pass":
        raise Refused([problem("build-failed", f"--build '{raw[:120]}' records a compile with status {document.get('status')}; only a passing build is uploaded.")])
    source = document.get("source")
    binaries = document.get("binaries")
    if not isinstance(source, dict) or not isinstance(binaries, list) or not binaries or not isinstance(document.get("fqbn"), str):
        raise Refused([problem("build-invalid", f"--build '{raw[:120]}' lacks the sketch, binaries or FQBN of its compile.")])
    return path, document, sha256_bytes(data)


def _verify(cwd: Path, run: Path, document: dict) -> None:
    """Every recorded hash still holds: the sketch copy, the binaries and the original sketch. CONFLICT otherwise."""
    source = document["source"]
    name = source.get("name")
    if not isinstance(name, str) or not sketch.NAME.fullmatch(name):
        raise Refused([problem("build-invalid", "The compile result names no valid sketch.")])
    copy = run / "sketch" / name
    if sketch.current(copy) != source.get("sha256"):
        raise Refused([problem("conflict", f"The sketch copy in {workspace.relative(cwd, run)} changed after its compile.")])
    for item in document["binaries"]:
        relative = item.get("path") if isinstance(item, dict) else None
        if not isinstance(relative, str) or not relative.startswith("binary/") or "/" in relative[7:] or ".." in relative:
            raise Refused([problem("build-invalid", "The compile result names a binary outside its binary folder.")])
        path = run / relative
        if not path.is_file() or path.is_symlink() or sha256_file(path) != item.get("sha256"):
            raise Refused([problem("conflict", f"{workspace.relative(cwd, path)} changed or disappeared after its compile.", file=relative)])
    original = source.get("path")
    try:
        folder = workspace.confined(cwd, original, "source.path") if isinstance(original, str) else None
    except workspace.PathRefused:
        folder = None
    if folder is None or sketch.current(folder) != source.get("sha256"):
        raise Refused([problem("conflict", f"The sketch {original} changed or disappeared after this build; compile it again before uploading.")])


def choose_port(records: list[dict], port: str | None, identity: str | None, fqbn: str, default: str | None) -> tuple[dict, list[dict]]:
    """The port of an upload and what to warn about: the call's --port (checked against --identity when given), the
    port that carries --identity, sketch.yaml's default port, the one port whose board is the build's, or the one
    USB port. A board that is not the build's, or that cannot be identified, is a warning: the user knows the board."""
    windows = os.name == "nt"
    listed = ", ".join(f"{item['address']} ({item['boards'][0]['name'] if item['boards'] else item.get('bridge') or 'unidentified'})" for item in records) or "none"
    record = None
    if port:
        record = next((item for item in records if boards.same_address(item["address"], port, windows)), None)
        if record is None:
            elsewhere = [item["address"] for item in records if identity and item["identity"] == identity]
            raise Refused([problem("port-missing", f"Port {port} is not connected." + (f" The identity is on {', '.join(elsewhere)} now." if elsewhere else f" Connected: {listed}."), now=elsewhere)])
        if identity and record["identity"] != identity:
            elsewhere = [item["address"] for item in records if item["identity"] == identity]
            raise Refused([problem("identity-mismatch", f"Port {port} carries {record['identity']}, not {identity}." + (f" {identity} is on {', '.join(elsewhere)} now." if elsewhere else ""), now=elsewhere)])
    elif identity:
        carrying = [item for item in records if item["identity"] == identity]
        if len(carrying) != 1:
            raise Refused([problem("identity-ambiguous" if carrying else "port-missing", f"{identity} is on " + (f"{', '.join(item['address'] for item in carrying)}; name one with --port." if carrying else f"no port. Connected: {listed}."), ports=[item["address"] for item in carrying])])
        record = carrying[0]
    else:
        target = boards.base_fqbn(fqbn)
        named = [item for item in records if default and boards.same_address(item["address"], default, windows)]
        matching = [item for item in records if item["identified"] and target in [boards.base_fqbn(board["fqbn"]) for board in item["boards"]]]
        usb = [item for item in records if item["vid"]]
        for candidates in (named, matching, usb, records):
            if len(candidates) == 1:
                record = candidates[0]
                break
        if record is None:
            raise Refused([problem("port-required", f"Name the board's port with --port: {listed}.", ports=[item["address"] for item in records])])
    warnings: list[dict] = []
    target = boards.base_fqbn(fqbn)
    if record["identified"]:
        if target not in [boards.base_fqbn(item["fqbn"]) for item in record["boards"]]:
            names = ", ".join(f"{item['name']} ({item['fqbn']})" for item in record["boards"])
            warnings.append(problem("board-mismatch", f"Port {record['address']} identifies as {names}, and the build is for {target}."))
    else:
        why = f"a {record['bridge']} USB bridge" if record.get("bridge") else "no board that identifies itself"
        warnings.append(problem("board-unverified", f"Port {record['address']} shows {why}, so the board model was not checked against the build ({target})."))
    return record, warnings


def _shown(text: str) -> str:
    """All of a short text, else its beginning and end."""
    if len(text) <= SHOWN:
        return text
    return f"{text[:1200]}\n[... {len(text) - 3700} characters left out, all of them in serial.log ...]\n{text[-2500:]}"


def _list(cli: Cli) -> list[dict]:
    code, document, stderr = cli.run(["board", "list"], timeout=120)
    if code != 0 or not isinstance(document, dict):
        raise ToolFailed(f"arduino-cli board list failed: {cli.stage.redact(stderr.strip())[:300] or 'no output'}")
    return boards.ports(document)[0]


def _stage_sketch(run: Path, source: dict, target: Path) -> None:
    """Copies exactly the recorded sketch files to staging and checks them again: a file added to the run folder's
    copy afterwards (a sketch.yaml with a profile or programmer) never reaches arduino-cli."""
    for item in source.get("files") or []:
        relative = item.get("path") if isinstance(item, dict) else None
        if not isinstance(relative, str) or relative.startswith(("/", "\\")) or ".." in Path(relative).parts or (os.name == "nt" and ":" in relative):
            raise Refused([problem("build-invalid", "The compile result names a sketch file outside its sketch.")])
        destination = target / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(run / "sketch" / source["name"] / relative, destination)
        if sha256_file(destination) != item.get("sha256"):
            raise Refused([problem("conflict", f"The sketch copy's {relative} changed after its compile.", file=relative)])


def _primary(binaries: list[dict]) -> dict:
    for extension in PRIMARY:
        for item in binaries:
            if item["path"].endswith(extension) and "with_bootloader" not in item["path"]:
                return item
    return binaries[0]


def run(cwd: Path, spelled: Path, environment: Environment, args: Any, document: dict) -> int:
    for value, option in ((args.port, "--port"), (args.identity, "--identity")):
        if value is not None and (not value or len(value) > 256 or _CONTROL.search(value)):
            raise Refused([problem("arguments", f"{option} needs a value of at most 256 characters without control characters.")])
    if args.watch is not None and not WATCH[0] <= args.watch <= WATCH[1]:
        raise Refused([problem("arguments", f"--watch takes {WATCH[0]} to {WATCH[1]} seconds.")])
    if args.baud is not None and not 300 <= args.baud <= 4_000_000:
        raise Refused([problem("arguments", "--baud takes 300 to 4000000.")])
    if args.programmer and not re.fullmatch(TOKEN, args.programmer):
        raise Refused([problem("arguments", "--programmer takes a programmer id such as arduinoasisp.")])
    password = ""
    if args.network:
        if not args.port or not HOST.fullmatch(args.port) or args.identity or args.programmer or args.watch:
            raise Refused([problem("arguments", "--network needs --port with the board's network address and takes no --identity, --programmer or --watch.")])
        if args.password_file:
            try:
                password = workspace.regular_file(cwd, args.password_file, "--password-file", spelled).read_text(encoding="utf-8", errors="replace")[:1024].splitlines()[0].strip()
            except (workspace.PathRefused, OSError, IndexError) as error:
                raise Refused([problem("arguments", f"--password-file must name a file of the workbench whose first line is the board's OTA password: {error}")]) from error
    elif args.password_file:
        raise Refused([problem("arguments", "--password-file belongs to a network upload; add --network.")])
    build_path, build, build_sha = _load_build(cwd, spelled, args.build)
    run = build_path.parent
    _verify(cwd, run, build)
    fqbn = build["fqbn"]
    vendor, arch, board, _ = parse_fqbn(fqbn)
    # sketch.yaml of the sketch as it is now: its default port and baud rate.
    try:
        defaults = sketch.defaults((workspace.confined(cwd, build["source"].get("path"), "source.path") / "sketch.yaml").read_text(encoding="utf-8", errors="replace"))
    except (OSError, TypeError, workspace.PathRefused):
        defaults = {}
    run_id = args.run_id or report.new_run_id("upload")
    stage = environment.stage(run_id)
    try:
        cli = Cli(stage)
        if args.network:
            # A board on the network is named by its address; no serial port is looked for.
            record, port_warnings = {"address": args.port, "identity": f"network:{args.port}", "identified": False, "boards": []}, []
        else:
            record, port_warnings = choose_port(_list(cli), args.port, args.identity, fqbn, defaults.get("port"))
        document["warnings"] += port_warnings
        identity = record["identity"]
        if args.programmer:
            details = board_details(cli, vendor, arch, board)
            known = [item.get("id") for item in details.get("programmers") or [] if isinstance(item, dict)]
            if args.programmer not in known:
                raise Refused([problem("programmer-unknown", f"{fqbn} has no programmer {args.programmer}.", declared=known)])
        staged = stage.folder / "binary"
        staged.mkdir()
        for item in build["binaries"]:
            shutil.copyfile(run / item["path"], staged / Path(item["path"]).name)
        for item in build["binaries"]:
            if sha256_file(staged / Path(item["path"]).name) != item["sha256"]:
                raise Refused([problem("conflict", f"{item['path']} changed while it was copied for the upload.", file=item["path"])])
        staged_sketch = stage.folder / "sketch" / build["source"]["name"]
        _stage_sketch(run, build["source"], staged_sketch)
        run_folder = report.run_folder(cwd, spelled, args.results_dir, run_id)
        document["runId"] = run_id
        redact = Redactor(cwd, run_folder, stage)
        argv = ["upload", "--fqbn", fqbn, "--port", record["address"], "--protocol", "network" if args.network else "serial"]
        if args.network:
            argv += ["--upload-field", f"password={password}"]
        if args.programmer:
            argv += ["--programmer", args.programmer]
        if args.verify:
            argv.append("--verify")
        argv += ["--input-dir", str(staged), str(staged_sketch)]
        document.update({"fqbn": fqbn, "identity": identity, "port": {"before": record["address"], "after": None}})
        interrupted(run_folder, document, "The run ended while arduino-cli was uploading (Stop, timeout or crash); the board's flash may be partly written and its state is unknown.")
        code, result, stderr = cli.run(argv)
        output = ""
        if isinstance(result, dict):
            output = "".join(str(result.get(key) or "") for key in ("stdout", "stderr", "error"))
        if password:
            redact = (lambda inner: lambda text: inner(text).replace(password, "<password>"))(redact)
        (run_folder / "upload.log").write_text(redact(output + (("\n" + stderr) if stderr.strip() else "")), encoding="utf-8", newline="\n")
        primary = _primary(build["binaries"])
        document.update(
            {
                "build": {"path": workspace.relative(cwd, build_path), "sha256": build_sha, "runId": build.get("runId")},
                "fqbn": fqbn,
                "binary": {"path": workspace.relative(cwd, run / primary["path"]), "sha256": primary["sha256"]},
                "identity": identity,
                "board": {"identified": record["identified"], "names": [item["name"] for item in record["boards"]], **({"bridge": record["bridge"]} if record.get("bridge") else {})},
                "port": {"before": record["address"], "after": None},
                "verified": False,
                "log": workspace.relative(cwd, run_folder / "upload.log"),
            }
        )
        if args.programmer:
            document["programmer"] = args.programmer
        if args.network:
            document["port"]["protocol"] = "network"
        success = code == 0 and isinstance(result, dict) and not result.get("error")
        if not success:
            document["status"] = "fail" if isinstance(result, dict) else "error"
            document["errors"].append(problem("upload-failed", redact((str(result.get("error")) if isinstance(result, dict) and result.get("error") else stderr.strip()) or "The upload failed.")[:500]))
        else:
            document["verified"] = bool(args.verify)
        listed = True
        try:
            # A network address is the board's identity: there is no port to look for again.
            after = [record["address"]] if args.network else [item["address"] for item in _list(cli) if item["identity"] == identity]
        except (Refused, ToolFailed):
            # The upload's outcome stands; only the port it returned on stays unknown.
            listed, after = False, []
        updated = (result or {}).get("updated_upload_port") if isinstance(result, dict) else None
        if isinstance(updated, dict) and updated.get("address"):
            document["port"]["reported"] = updated.get("address")
        if not listed:
            document["warnings"].append(problem("ports-unlisted", "The ports could not be listed after the upload; the port the board is on now is unknown."))
        elif len(after) == 1:
            document["port"]["after"] = after[0]
        elif record["address"] in after:
            # Several ports share this identity (two boards behind the same bridge chip): the board stayed where it was.
            document["port"]["after"] = record["address"]
        else:
            document["warnings"].append(
                problem("identity-not-found" if not after else "identity-ambiguous", f"After the upload {identity} is " + ("on no port." if not after else f"on {', '.join(after)}."), ports=after)
            )
        if success and args.watch:
            # Opening the port restarts most boards, so the sketch's first lines are in what arrives.
            port = document["port"]["after"] or record["address"]
            baud = args.baud or defaults.get("baud") or BAUD
            received, complaint = cli.watch(port, baud, float(args.watch))
            (run_folder / "serial.log").write_text(received, encoding="utf-8", newline="")
            document["serial"] = {"port": port, "baud": baud, "seconds": args.watch, "characters": len(received), "text": _shown(received.replace("\r\n", "\n")), "log": workspace.relative(cwd, run_folder / "serial.log")}
            if not received:
                reason = redact(complaint.strip())[:300]
                document["warnings"].append(
                    problem("serial-silent", f"Nothing arrived on {port} at {baud} baud in {args.watch} s." + (f" arduino-cli said: {reason}" if reason else " Check the baud rate the sketch uses (--baud).")),
                )
        document["finishedAt"] = report.stamp()
        report.write(run_folder, document)
        return report.EXIT[document["status"]]
    finally:
        stage.remove()

