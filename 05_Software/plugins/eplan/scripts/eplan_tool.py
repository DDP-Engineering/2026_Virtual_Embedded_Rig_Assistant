# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""EPLAN Electric P8 2025 exchange helper for VERA (program `eplan-tool` of the eplan plugin).

Finite operations over EPLAN's documented command line (EPLAN API 2025, eplan.help: "Command line parameters",
ProjectAction, devicelist, XMActionDCCommonExport, projectmanagement, reports):

  plan export|import ...   print the EPLAN command lines of an operation; starts nothing
  export --profile P --out DIR [--outcome IMPORT_OUTCOME]
                           export the device list (XDLCsvImporterExporter) and the profile's scheme tables from the
                           profile's project, opened read-only, or from the copy an earlier import created
  import --profile P --candidate CSV --sha256 HEX --copy C:\\...\\NEW.elk --out DIR
                           create a snapshot copy of the project, import the candidate device list into the COPY
                           (opened exclusively), regenerate its reports and export it again into DIR

The project named by the profile is never changed: imports go into a new copy. EPLAN is never attached to (no
Remoting), no script is run (no ExecuteScript) and every command names its project. Success is "every step exited 0
and produced its file"; whether the data arrived is VERA's eplan_check, which compares the re-export. Exit codes:
0 completed, 1 failed or interrupted (outcome.json written), 2 refused (nothing started, nothing written).
Standard library only. NOT VERIFIED against a real EPLAN installation: see the plugin README.
"""

import hashlib
import json
import os
import re
import signal
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.dont_write_bytecode = True

VERSION = "0.1.0"
TOOL = f"eplan-tool {VERSION}"
STEP_TIMEOUT = 600
PREFIX = '/Variant:"Electric P8" /NoRemoting /Quiet:1 /NoLicenseDialog /NoUserRightsDialog /Auto'
LINK = re.compile(r'^[A-Za-z]:\\(?:[^\\/:*?"<>|\s]+\\)*[^\\/:*?"<>|\s]+\.elk$')
SCHEME = re.compile(r"^[A-Za-z0-9_.-]{1,64}$")
LANGUAGE = re.compile(r"^[a-z]{2}_[A-Z]{2}$")
SHA = re.compile(r"^[0-9a-f]{64}$")
UNSAFE = re.compile(r'[\s"]')
HELP = __doc__


class Refused(Exception):
    def __init__(self, reason: str, message: str):
        super().__init__(message)
        self.reason = reason
        self.message = message


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def emit(document: dict) -> None:
    sys.stdout.write(json.dumps(document, ensure_ascii=False, indent=2) + "\n")
    sys.stdout.flush()


def refused(operation: str, error: Refused) -> int:
    emit(
        {
            "kind": "vera-eplan-outcome",
            "format": 1,
            "tool": TOOL,
            "operation": operation,
            "status": "refused",
            "reason": f"{error.reason}: {error.message}",
            "profile": None,
            "project": None,
            "copy": None,
            "candidate": None,
            "eplan": None,
            "steps": [],
            "files": [],
            "startedAt": now(),
            "finishedAt": now(),
        }
    )
    return 2


# ---------------------------------------------------------------------------------------------------------------
# Inputs


def options(args: list[str], allowed: set[str], required: set[str]) -> dict[str, str]:
    out: dict[str, str] = {}
    i = 0
    while i < len(args):
        name = args[i]
        if name not in allowed:
            raise Refused("usage", f"unknown argument {name}; see eplan-tool --help")
        if i + 1 >= len(args):
            raise Refused("usage", f"{name} needs a value")
        if name in out:
            raise Refused("usage", f"{name} is given twice")
        out[name] = args[i + 1]
        i += 2
    missing = sorted(required - out.keys())
    if missing:
        raise Refused("usage", f"missing {', '.join(missing)}")
    return out


def inside(path: str, what: str) -> Path:
    """A path below the working folder (the workbench), resolved; refuses anything outside."""
    root = Path.cwd().resolve()
    target = (root / path).resolve()
    if target != root and root not in target.parents:
        raise Refused("out-outside" if what == "output folder" else "path", f"the {what} {path} is outside the working folder")
    if UNSAFE.search(str(target)):
        raise Refused("path", f"the {what} {target} contains spaces or quotes, which EPLAN's command line form cannot carry here")
    return target


def read_profile(path: str) -> tuple[dict, Path, str]:
    file = inside(path, "profile")
    if not file.is_file():
        raise Refused("profile", f"the profile {path} does not exist")
    try:
        profile = json.loads(file.read_text(encoding="utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise Refused("profile", f"the profile {path} is not UTF-8 JSON ({error})") from None
    problems = []
    if not isinstance(profile, dict) or profile.get("kind") != "vera-eplan-profile" or profile.get("format") != 1:
        raise Refused("profile", f"{path} is not a vera-eplan-profile of format 1")

    def entry(value, key):
        return value.get(key) if isinstance(value, dict) else None

    target = profile.get("target")
    if target != {"product": "EPLAN Electric P8", "version": "2025", "platform": "windows-x64"}:
        problems.append("target must be EPLAN Electric P8 2025 on windows-x64")
    link = entry(profile.get("project"), "link")
    if not isinstance(link, str) or not LINK.match(link) or len(link) > 240:
        problems.append("project.link must be an absolute Windows .elk path without spaces or quotes")
    tables = profile.get("tables")
    if not isinstance(entry(entry(entry(tables, "devices"), "columns"), "tag"), str):
        problems.append("tables.devices.columns.tag is missing")
    for name in ("terminals", "connections"):
        table = entry(tables, name)
        if table is None:
            continue
        if not isinstance(table, dict):
            problems.append(f"tables.{name} must be an object")
            continue
        if not SCHEME.match(str(table.get("scheme", ""))):
            problems.append(f"tables.{name}.scheme must be 1 to 64 letters, digits, _ . or -")
        if not LANGUAGE.match(str(table.get("language", ""))):
            problems.append(f"tables.{name}.language must look like en_US")
    if problems:
        raise Refused("profile", f"{path}: " + "; ".join(problems))
    return profile, file, sha256(file)


def beside(copy: str, link: str) -> bool:
    """True when the copy's link file sits in the same folder as the project's (compared case-insensitively)."""
    return copy.rsplit("\\", 1)[0].lower() == link.rsplit("\\", 1)[0].lower()


def new_out(path: str) -> Path:
    out = inside(path, "output folder")
    if out.exists():
        raise Refused("out-exists", f"the output folder {path} exists: name a new one")
    return out


def find_eplan() -> Path:
    """The highest EPLAN 2025 EPLAN.exe in the default install folder, <SystemDrive>\\Program Files\\EPLAN\\Platform."""
    drive = os.environ.get("SystemRoot", "C:\\Windows")[:2]
    base = Path(f"{drive}\\Program Files\\EPLAN\\Platform")
    found = sorted(base.glob("2025*/Bin/EPLAN.exe"))
    if not found:
        raise Refused("eplan-missing", f"no EPLAN.exe under {base}\\2025*\\Bin, the default install folder of EPLAN 2025")
    return found[-1]


# ---------------------------------------------------------------------------------------------------------------
# Plans


def export_steps(profile: dict, project: str, out: Path) -> list[dict]:
    steps = [
        {
            "name": "export-devices",
            "action": f"ProjectAction /PROJECTNAME:{project} /OpenMode:ReadOnly /Action:devicelist /TYPE:EXPORT"
            f" /EXPORTFILE:{out}\\devices.csv /FORMAT:XDLCsvImporterExporter",
            "file": out / "devices.csv",
            "table": "devices",
        }
    ]
    for table in ("terminals", "connections"):
        spec = profile["tables"].get(table)
        if spec is None:
            continue
        steps.append(
            {
                "name": f"export-{table}",
                "action": f"ProjectAction /PROJECTNAME:{project} /OpenMode:ReadOnly /Action:XMActionDCCommonExport"
                f" /CONFIGSCHEME:{spec['scheme']} /COMPLETEPROJECT:1 /LANGUAGE:{spec['language']}"
                f" /DESTINATION:{out}\\{table}.txt /EXECUTIONMODE:0",
                "file": out / f"{table}.txt",
                "table": table,
            }
        )
    return steps


def import_steps(profile: dict, copy: str, candidate: Path, out: Path) -> list[dict]:
    link = profile["project"]["link"]
    return [
        {
            "name": "snapshot",
            "action": f"projectmanagement /TYPE:CREATESNAPSHOTCOPY /PROJECTNAME:{link} /FILENAME:{copy}",
            "file": Path(copy),
            "table": None,
        },
        {
            "name": "import",
            "action": f"ProjectAction /PROJECTNAME:{copy} /OpenMode:Exclusive /Action:devicelist /TYPE:IMPORT"
            f" /IMPORTFILE:{candidate} /FORMAT:XDLCsvImporterExporter",
            "file": None,
            "table": None,
        },
        {
            "name": "reports",
            "action": f"ProjectAction /PROJECTNAME:{copy} /OpenMode:Exclusive /Action:reports /TYPE:PROJECT",
            "file": None,
            "table": None,
        },
        *export_steps(profile, copy, out),
    ]


def prepare(operation: str, args: list[str]) -> dict:
    """Checks every input and builds the plan; raises Refused before anything starts."""
    if operation == "export":
        given = options(args, {"--profile", "--out", "--outcome"}, {"--profile", "--out"})
    elif operation == "import":
        given = options(
            args, {"--profile", "--candidate", "--sha256", "--copy", "--out"}, {"--profile", "--candidate", "--sha256", "--copy", "--out"}
        )
    else:
        raise Refused("usage", f"unknown operation {operation}; use export or import")
    profile, _file, profile_sha = read_profile(given["--profile"])
    link = profile["project"]["link"]
    plan = {
        "operation": operation,
        "profile": {"path": given["--profile"].replace("\\", "/"), "sha256": profile_sha},
        "project": link,
        "copy": None,
        "candidate": None,
    }
    if operation == "export":
        project = link
        if "--outcome" in given:
            file = inside(given["--outcome"], "outcome")
            try:
                previous = json.loads(file.read_text(encoding="utf-8"))
            except (OSError, UnicodeDecodeError, json.JSONDecodeError):
                raise Refused("outcome", f"{given['--outcome']} is not a readable eplan-tool outcome") from None
            steps = previous.get("steps") if isinstance(previous, dict) else None
            snapshot = next(
                (step for step in (steps if isinstance(steps, list) else []) if isinstance(step, dict) and step.get("name") == "snapshot"),
                None,
            )
            copy = previous.get("copy") if isinstance(previous, dict) else None
            if (
                previous.get("kind") != "vera-eplan-outcome"
                or previous.get("operation") != "import"
                or previous.get("project") != link
                or not isinstance(copy, str)
                or not LINK.match(copy)
                or not beside(copy, link)
                or not snapshot
                or snapshot.get("exit") != 0
            ):
                raise Refused("outcome", f"{given['--outcome']} is not an import of {link} whose snapshot copy was created")
            project = copy
            plan["copy"] = copy
        if not Path(project).is_file():
            raise Refused("project-missing", f"the project link file {project} does not exist")
        out = new_out(given["--out"])
        plan["steps"] = export_steps(profile, project, out)
    else:
        copy = given["--copy"]
        if not LINK.match(copy) or len(copy) > 240:
            raise Refused("path", "--copy must be an absolute Windows .elk path without spaces or quotes")
        if copy.lower() == link.lower():
            raise Refused("copy-is-link", "--copy names the project itself; an import goes into a new copy only")
        if not beside(copy, link):
            raise Refused("copy-folder", f"--copy must be a new project file in the project's folder {link.rsplit(chr(92), 1)[0]}")
        if not Path(link).is_file():
            raise Refused("project-missing", f"the project link file {link} does not exist")
        if Path(copy).exists():
            raise Refused("copy-exists", f"the copy {copy} exists: name a new project file")
        if not SHA.match(given["--sha256"]):
            raise Refused("usage", "--sha256 must be a lower-case sha256")
        candidate = inside(given["--candidate"], "candidate")
        if not candidate.is_file():
            raise Refused("path", f"the candidate {given['--candidate']} does not exist")
        actual = sha256(candidate)
        if actual != given["--sha256"]:
            raise Refused("conflict", f"the candidate's sha256 is {actual}, not {given['--sha256']}: it changed after it was approved")
        out = new_out(given["--out"])
        plan["copy"] = copy
        plan["candidate"] = {"path": given["--candidate"].replace("\\", "/"), "sha256": actual}
        plan["steps"] = import_steps(profile, copy, candidate, out)
    plan["out"] = out
    return plan


def command(eplan: str, step: dict) -> str:
    return f'"{eplan}" {PREFIX} {step["action"]}'


# ---------------------------------------------------------------------------------------------------------------
# Running


class Stopped(Exception):
    pass


def end_tree(process: subprocess.Popen) -> None:
    root = os.environ.get("SystemRoot", "C:\\Windows")
    subprocess.run(
        [os.path.join(root, "System32", "taskkill.exe"), "/T", "/F", "/PID", str(process.pid)],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )


def on_signal(_number, _frame) -> None:
    raise Stopped()


def execute(plan: dict, eplan: Path) -> int:
    out: Path = plan["out"]
    out.mkdir(parents=True)
    root = Path.cwd().resolve()
    outcome = {
        "kind": "vera-eplan-outcome",
        "format": 1,
        "tool": TOOL,
        "operation": plan["operation"],
        "status": "interrupted",
        "reason": "the run ended before it finished (stopped or killed)",
        "profile": plan["profile"],
        "project": plan["project"],
        "copy": plan["copy"],
        "candidate": plan["candidate"],
        "eplan": str(eplan),
        "steps": [],
        "files": [],
        "startedAt": now(),
        "finishedAt": None,
    }

    def save() -> None:
        (out / "outcome.json").write_text(json.dumps(outcome, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    save()
    for name in ("SIGINT", "SIGTERM", "SIGBREAK"):
        if hasattr(signal, name):
            signal.signal(getattr(signal, name), on_signal)
    status, reason = "completed", None
    process: subprocess.Popen | None = None
    try:
        for step in plan["steps"]:
            line = command(str(eplan), step)
            record = {"name": step["name"], "command": line, "exit": None, "seconds": 0.0, "file": None}
            outcome["steps"].append(record)
            save()
            started = time.monotonic()
            process = subprocess.Popen(  # noqa: S603 - one documented EPLAN command line, no shell
                line,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
            )
            # Wait in short slices: a signal handler runs only between them on Windows.
            code = None
            while code is None and time.monotonic() - started < STEP_TIMEOUT:
                try:
                    code = process.wait(timeout=1)
                except subprocess.TimeoutExpired:
                    code = None
            record["seconds"] = round(time.monotonic() - started, 1)
            if code is None:
                end_tree(process)
                status, reason = "failed", f"timeout:{step['name']} after {STEP_TIMEOUT} s"
                break
            process = None
            record["exit"] = code
            record["seconds"] = round(time.monotonic() - started, 1)
            if code != 0:
                status, reason = "failed", f"step-failed:{step['name']} exit {code}"
                break
            file: Path | None = step["file"]
            if file is not None:
                if not file.is_file():
                    status, reason = "failed", f"no-file:{step['name']} {file}"
                    break
                record["file"] = str(file) if step["table"] is None else file.relative_to(root).as_posix()
                if step["table"]:
                    outcome["files"].append({"table": step["table"], "path": record["file"], "sha256": sha256(file)})
            save()
    except (Stopped, KeyboardInterrupt):
        if process is not None and process.poll() is None:
            end_tree(process)
        status, reason = "interrupted", "stopped"
    outcome["status"] = status
    outcome["reason"] = reason
    outcome["finishedAt"] = now()
    save()
    emit(outcome)
    return 0 if status == "completed" else 1


def main(argv: list[str]) -> int:
    if argv in (["--version"],):
        print(TOOL)
        return 0
    if not argv or argv[0] in ("--help", "-h"):
        print(HELP)
        return 0
    if argv[0] == "plan":
        operation = argv[1] if len(argv) > 1 else ""
        try:
            plan = prepare(operation, argv[2:])
        except Refused as error:
            return refused(operation or "plan", error)
        try:
            eplan = str(find_eplan())
        except Refused:
            eplan = "<EPLAN.exe>"
        emit(
            {
                "tool": TOOL,
                "operation": operation,
                "project": plan["project"],
                "copy": plan["copy"],
                "steps": [{"name": step["name"], "command": command(eplan, step)} for step in plan["steps"]],
            }
        )
        return 0
    operation = argv[0]
    try:
        if operation in ("export", "import") and os.name != "nt":
            raise Refused("platform", "EPLAN Electric P8 runs on Windows only")
        plan = prepare(operation, argv[1:])
        eplan = find_eplan()
    except Refused as error:
        return refused(operation if operation in ("export", "import") else "export", error)
    return execute(plan, eplan)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
