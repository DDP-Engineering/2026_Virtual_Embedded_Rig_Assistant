"""VERA's remote helper on a Linux board (raspberry-pi-linux plugin; spec REQ-DATA-44547a17 sections 4-5).

pi-tool installs this file once per version with `install-helper`; the run stub of the same version executes it only
when its SHA-256 equals the bundled copy. It reads one request line (JSON) and `payloadBytes` raw bytes from stdin,
performs one finite operation below the declared remote root and writes one JSON response. It never runs a shell:
every child is started from an argv list. Standard library only, Python >= 3.9, Linux only.
"""

from __future__ import annotations

import hashlib
import json
import os
import pwd
import re
import secrets
import selectors
import signal
import stat
import subprocess
import sys
import time

VERSION = "0.2.0"
PYTHON = "/usr/bin/python3"
STATE = ".vera-pi"
REQUEST_LIMIT = 1024 * 1024
FILE_LIMIT = 16 * 1024 * 1024
TOTAL_LIMIT = 64 * 1024 * 1024
LISTED = 512
FINAL = ("exited", "budget-exceeded", "output-limit", "stopped", "start-failed", "supervisor-lost", "lost-by-reboot")
TERM_GRACE = 3.0
SEGMENT = re.compile(r"[^/\\\x00-\x1f\x7f]{1,128}")
UNIT = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.@-]{0,118}\.service")
NAME = re.compile(r"[a-z0-9][a-z0-9-]{0,63}")
HANDLE = re.compile(r"[0-9a-f]{16}")
TOOLS = {"systemctl": ("/usr/bin/systemctl", "/bin/systemctl"), "journalctl": ("/usr/bin/journalctl", "/bin/journalctl")}
SUPERVISE_STUB = (
    "import sys\n"
    "s=sys.stdin.buffer.read()\n"
    "g={\"__name__\":\"__vera_pi_supervisor__\",\"__vera_source__\":s}\n"
    "exec(compile(s,\"vera_pi_remote.py\",\"exec\"),g)\n"
    "g[\"supervise\"](sys.argv[1])\n"
)


class Refusal(Exception):
    def __init__(self, code: str, message: str, **fields: object) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.fields = fields


# --- facts -------------------------------------------------------------------------------------------------------


def _read(path: str, limit: int = 4096) -> str | None:
    try:
        with open(path, "rb") as handle:
            return handle.read(limit).decode("utf-8", "replace").replace("\x00", "").strip()
    except OSError:
        return None


def boot_id() -> str | None:
    return _read("/proc/sys/kernel/random/boot_id")


def start_ticks(pid: int) -> int | None:
    """Field 22 of /proc/<pid>/stat (start time in clock ticks since boot); None when the process is gone."""
    text = _read(f"/proc/{pid}/stat", 8192)
    if not text or ")" not in text:
        return None
    fields = text.rsplit(")", 1)[1].split()
    try:
        return int(fields[19])
    except (IndexError, ValueError):
        return None


def same_process(pid: object, ticks: object, boot: object) -> bool:
    """Whether the recorded process still runs: same PID, start time and boot."""
    if not isinstance(pid, int) or pid <= 1 or not isinstance(ticks, int):
        return False
    return boot == boot_id() and start_ticks(pid) == ticks


def _os_release() -> dict[str, str]:
    values: dict[str, str] = {}
    for path in ("/etc/os-release", "/usr/lib/os-release"):
        text = _read(path, 16384)
        if text is None:
            continue
        for line in text.splitlines():
            key, sep, value = line.partition("=")
            if sep and key in ("ID", "VERSION_ID", "VERSION_CODENAME", "PRETTY_NAME"):
                values[key] = value.strip().strip('"')
        break
    return values


def facts() -> dict[str, object]:
    account = pwd.getpwuid(os.getuid())
    uname = os.uname()
    serial = _read("/proc/device-tree/serial-number") or _read("/sys/firmware/devicetree/base/serial-number")
    model = _read("/proc/device-tree/model") or _read("/sys/firmware/devicetree/base/model")
    return {
        "model": model,
        "serial": serial,
        "machineId": _read("/etc/machine-id"),
        "os": _os_release(),
        "machine": uname.machine,
        "kernel": uname.release,
        "python": ".".join(str(part) for part in sys.version_info[:3]),
        "user": account.pw_name,
        "uid": os.getuid(),
        "home": account.pw_dir,
        "bootId": boot_id(),
        "helper": VERSION,
    }


def check_identity(request: dict, found: dict) -> None:
    expect = request.get("expect") or {}
    if found["uid"] == 0:
        raise Refusal("identity-mismatch", "The login user is root; VERA works only as an unprivileged user.")
    if expect.get("user") != found["user"]:
        raise Refusal("identity-mismatch", f"The login user is {found['user']}, not {expect.get('user')}.")
    for key, label in (("serial", "serial number"), ("machineId", "machine id"), ("model", "model")):
        wanted = expect.get(key)
        if wanted is None:
            continue
        value = found.get(key)
        same = isinstance(value, str) and (value.lower() == wanted.lower() if key != "model" else value == wanted)
        if not same:
            raise Refusal("identity-mismatch", f"The board's {label} is {value!r}, not {wanted!r} as lab/resources.json declares.")


def check_root(request: dict) -> str:
    root = request.get("root")
    if not isinstance(root, str) or not root.startswith("/") or any(part in ("", ".", "..") for part in root.split("/")[1:]):
        raise Refusal("root-invalid", "The remote root must be an absolute path without . or .. segments.")
    try:
        info = os.lstat(root)
    except FileNotFoundError:
        raise Refusal("root-invalid", f"The remote root {root} does not exist; create it on the board first.") from None
    except OSError as error:
        raise Refusal("root-invalid", f"The remote root {root} cannot be read: {error.strerror}.") from None
    if stat.S_ISLNK(info.st_mode) or os.path.realpath(root) != root:
        raise Refusal("root-invalid", f"The remote root {root} is a link or lies below one.")
    if not stat.S_ISDIR(info.st_mode):
        raise Refusal("root-invalid", f"The remote root {root} is not a folder.")
    if info.st_uid != os.getuid():
        raise Refusal("root-invalid", f"The remote root {root} is not owned by the login user.")
    if info.st_mode & 0o022:
        raise Refusal("root-invalid", f"The remote root {root} is writable by group or others.")
    return root


# --- paths -------------------------------------------------------------------------------------------------------


def check_relative(path: object) -> list[str]:
    if not isinstance(path, str) or not path or len(path) > 1024:
        raise Refusal("path", "A project path must be a relative path of at most 1024 characters.")
    segments = path.split("/")
    if len(segments) > 8 or any(not SEGMENT.fullmatch(part) or part in (".", "..") for part in segments):
        raise Refusal("path", f"The project path {path!r} has an empty, '.', '..' or invalid segment.")
    if segments[0].startswith(STATE):
        raise Refusal("path", f"The project path {path!r} would lie in VERA's state folder.")
    return segments


def ensure_dir(path: str, mode: int) -> None:
    """Creates a missing folder; an existing one must be a real folder, not a link."""
    try:
        info = os.lstat(path)
    except FileNotFoundError:
        os.mkdir(path, mode)
        return
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
        raise Refusal("path", f"{path} is not a plain folder (a link or a file is in the way).")


def ensure_parents(base: str, segments: list[str]) -> str:
    current = base
    for part in segments[:-1]:
        current = os.path.join(current, part)
        ensure_dir(current, 0o755)
    return os.path.join(current, segments[-1])


def state_dir(root: str, *parts: str) -> str:
    current = os.path.join(root, STATE)
    ensure_dir(current, 0o700)
    for part in parts:
        current = os.path.join(current, part)
        ensure_dir(current, 0o700)
    return current


def file_hash(path: str) -> str | None:
    """SHA-256 of a regular file that is not a link; None when absent; 'not-a-file' for anything else."""
    try:
        info = os.lstat(path)
    except FileNotFoundError:
        return None
    if not stat.S_ISREG(info.st_mode):
        return "not-a-file"
    digest = hashlib.sha256()
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def write_json(path: str, document: object) -> None:
    temporary = f"{path}.tmp-{os.getpid()}"
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(document, handle)
    os.replace(temporary, path)


def read_json(path: str) -> dict | None:
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, "rb") as handle:
            value = json.loads(handle.read(4 * 1024 * 1024).decode("utf-8"))
        return value if isinstance(value, dict) else None
    except (OSError, ValueError):
        return None


def project_dir(root: str, request: dict) -> tuple[str, str]:
    name = (request.get("project") or {}).get("name")
    if not isinstance(name, str) or not NAME.fullmatch(name):
        raise Refusal("manifest", "The project name must match [a-z0-9][a-z0-9-]{0,63}.")
    return name, os.path.join(root, name)


# --- deploy ------------------------------------------------------------------------------------------------------


def _files(request: dict) -> list[dict]:
    files = request.get("files")
    if not isinstance(files, list) or not 1 <= len(files) <= LISTED:
        raise Refusal("candidate-invalid", f"A candidate holds 1 to {LISTED} files.")
    seen: set[str] = set()
    total = 0
    for item in files:
        if not isinstance(item, dict):
            raise Refusal("candidate-invalid", "A candidate file must be an object.")
        check_relative(item.get("path"))
        if item["path"] in seen:
            raise Refusal("candidate-invalid", f"{item['path']} is listed twice.")
        seen.add(item["path"])
        size, digest, mode = item.get("size"), item.get("sha256"), item.get("mode")
        if not isinstance(size, int) or not 0 <= size <= FILE_LIMIT or not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise Refusal("candidate-invalid", f"{item['path']} needs a size of at most 16 MiB and a SHA-256.")
        if mode not in ("0644", "0755"):
            raise Refusal("candidate-invalid", f"{item['path']} needs the mode 0644 or 0755.")
        total += size
    if total > TOTAL_LIMIT:
        raise Refusal("candidate-invalid", "A candidate holds at most 64 MiB.")
    return files


def _remote_only(folder: str, listed: set[str]) -> tuple[list[str], bool]:
    found: list[str] = []
    if not os.path.isdir(folder) or os.path.islink(folder):
        return found, False
    for current, dirs, names in os.walk(folder, followlinks=False):
        dirs.sort()
        for name in sorted(names):
            relative = os.path.relpath(os.path.join(current, name), folder).replace(os.sep, "/")
            if relative not in listed and not relative.startswith(STATE):
                if len(found) >= LISTED:
                    return found, True
                found.append(relative)
    return found, False


def op_stage(request: dict, payload: bytes) -> dict:
    root = check_root(request)
    name, folder = project_dir(root, request)
    files = _files(request)
    if sum(item["size"] for item in files) != len(payload):
        raise Refusal("candidate-invalid", "The transferred bytes do not match the file sizes.")
    candidates = state_dir(root, "candidates")
    candidate_id = secrets.token_hex(8)
    base = os.path.join(candidates, candidate_id)
    os.mkdir(base, 0o700)
    staged = os.path.join(base, "files")
    os.mkdir(staged, 0o700)
    offset = 0
    written: list[dict] = []
    try:
        for item in files:
            data = payload[offset : offset + item["size"]]
            offset += item["size"]
            if hashlib.sha256(data).hexdigest() != item["sha256"]:
                raise Refusal("candidate-changed", f"{item['path']} arrived with another SHA-256.")
            target = ensure_parents(staged, item["path"].split("/"))
            fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            written.append(item)
            with os.fdopen(fd, "wb") as handle:
                handle.write(data)
    except BaseException:
        # A staging that did not finish leaves nothing behind: only the files it wrote, then its empty folders.
        _remove_staging(base, written)
        raise
    applied = (read_json(os.path.join(state_dir(root, "projects"), f"{name}.json")) or {}).get("files") or {}
    plan = []
    for item in files:
        current = file_hash(os.path.join(folder, *item["path"].split("/")))
        last = applied.get(item["path"]) if isinstance(applied, dict) else None
        if current is None:
            action = "new"
        elif current == item["sha256"]:
            action = "unchanged"
        elif current != "not-a-file" and current == last:
            action = "changed"
        else:
            action = "conflict"
        plan.append({"path": item["path"], "action": action, "base": current, "lastApplied": last})
    write_json(os.path.join(base, "candidate.json"), {"format": 1, "project": name, "files": files, "plan": plan, "createdAt": time.time()})
    # Only once the new candidate is complete do the project's earlier candidates go.
    pruned = _prune_candidates(candidates, name, candidate_id)
    remote_only, truncated = _remote_only(folder, {item["path"] for item in files})
    return {"candidateId": candidate_id, "remoteDir": folder, "plan": plan, "remoteOnly": remote_only, "remoteOnlyTruncated": truncated, "prunedCandidates": pruned}


def _prune_candidates(candidates: str, name: str, keep: str) -> list[str]:
    """Removes the earlier staged candidates of the same project: only the newest one can still be applied."""
    pruned = []
    for entry in sorted(os.listdir(candidates)):
        base = os.path.join(candidates, entry)
        record = read_json(os.path.join(base, "candidate.json")) if HANDLE.fullmatch(entry) and entry != keep else None
        if record is not None and record.get("project") == name and isinstance(record.get("files"), list):
            _remove_staging(base, [item for item in record["files"] if isinstance(item, dict) and isinstance(item.get("path"), str)])
            pruned.append(entry)
    return pruned


def _remove_staging(base: str, files: list[dict]) -> list[str]:
    """Unlinks the staged files this candidate listed, then its now empty folders; never a recursive delete."""
    left: list[str] = []
    staged = os.path.join(base, "files")
    folders: set[str] = set()
    for item in files:
        segments = item["path"].split("/")
        path = os.path.join(staged, *segments)
        for depth in range(1, len(segments)):
            folders.add(os.path.join(staged, *segments[:depth]))
        try:
            os.unlink(path)
        except FileNotFoundError:
            pass
        except OSError:
            left.append(item["path"])
    for folder in sorted(folders, key=len, reverse=True) + [staged]:
        try:
            os.rmdir(folder)
        except OSError:
            left.append(os.path.relpath(folder, base))
    for name in ("candidate.json",):
        try:
            os.unlink(os.path.join(base, name))
        except OSError:
            pass
    try:
        os.rmdir(base)
    except OSError:
        left.append(".")
    return left


def _plain_parents(folder: str, path: str) -> bool:
    """Whether every existing parent folder of a project file is a plain folder (no link, no file in the way), so
    applying never stops halfway on a parent."""
    if os.path.lexists(folder) and (os.path.islink(folder) or not os.path.isdir(folder)):
        return False
    current = folder
    for part in path.split("/")[:-1]:
        current = os.path.join(current, part)
        if os.path.lexists(current) and (os.path.islink(current) or not os.path.isdir(current)):
            return False
    return True


def op_apply(request: dict, payload: bytes) -> dict:
    root = check_root(request)
    name, folder = project_dir(root, request)
    candidate_id = request.get("candidateId")
    if not isinstance(candidate_id, str) or not HANDLE.fullmatch(candidate_id):
        raise Refusal("candidate-invalid", "The candidate id is malformed.")
    base = os.path.join(root, STATE, "candidates", candidate_id)
    record = read_json(os.path.join(base, "candidate.json"))
    if record is None or record.get("project") != name:
        raise Refusal("candidate-invalid", f"Candidate {candidate_id} is not staged on the board for project {name}.")
    files = _files(request)
    by_path = {item["path"]: item for item in record.get("files") or []}
    for item in files:
        staged = by_path.get(item["path"])
        if staged is None or any(staged.get(key) != item.get(key) for key in ("sha256", "size", "mode")):
            raise Refusal("candidate-invalid", f"{item['path']} differs from the staged candidate.")
    if len(by_path) != len(files):
        raise Refusal("candidate-invalid", "The request does not list the staged candidate's files.")
    overwrite = set(request.get("overwrite") or [])
    # The board's own plan of this candidate decides; the approved request must repeat it.
    plan = {item.get("path"): item for item in record.get("plan") or []}
    asked = {item.get("path"): (item.get("action"), item.get("base")) for item in request.get("plan") or []}
    if asked != {path: (item.get("action"), item.get("base")) for path, item in plan.items()}:
        raise Refusal("candidate-invalid", "The candidate's plan differs from the one staged on the board.")
    if not overwrite <= {path for path, item in plan.items() if item.get("action") == "conflict"}:
        raise Refusal("candidate-invalid", "--overwrite names a file that is not a conflict of this candidate.")
    changed: list[str] = []
    conflicts: list[dict] = []
    chosen = []
    for item in files:
        step = plan.get(item["path"]) or {}
        action = step.get("action")
        if action == "unchanged" or (action == "conflict" and item["path"] not in overwrite):
            continue
        if action not in ("new", "changed", "conflict"):
            raise Refusal("candidate-invalid", f"{item['path']} has no valid plan action.")
        if file_hash(os.path.join(base, "files", *item["path"].split("/"))) != item["sha256"]:
            changed.append(item["path"])
        current = file_hash(os.path.join(folder, *item["path"].split("/")))
        if current != step.get("base") or current == "not-a-file" or not _plain_parents(folder, item["path"]):
            conflicts.append({"path": item["path"], "base": step.get("base"), "now": current})
        chosen.append(item)
    if changed:
        raise Refusal("candidate-changed", f"Staged files changed on the board: {', '.join(changed[:8])}.", files=changed)
    if conflicts:
        raise Refusal("conflict", f"Project files changed on the board since staging: {', '.join(c['path'] for c in conflicts[:8])}.", conflicts=conflicts)
    ensure_dir(folder, 0o755)
    applied = []
    for item in chosen:
        segments = item["path"].split("/")
        source = os.path.join(base, "files", *segments)
        target = ensure_parents(folder, segments)
        os.chmod(source, int(item["mode"], 8))
        os.replace(source, target)
        applied.append(item["path"])
    records = state_dir(root, "projects")
    previous = (read_json(os.path.join(records, f"{name}.json")) or {}).get("files") or {}
    previous = previous if isinstance(previous, dict) else {}
    for item in files:
        if item["path"] in applied or (plan.get(item["path"]) or {}).get("action") == "unchanged":
            previous[item["path"]] = item["sha256"]
    write_json(os.path.join(records, f"{name}.json"), {"format": 1, "project": name, "candidateId": candidate_id, "appliedAt": time.time(), "files": previous})
    left = _remove_staging(base, files)
    skipped = [{"path": item["path"], "action": (plan.get(item["path"]) or {}).get("action")} for item in files if item["path"] not in applied]
    return {"remoteDir": folder, "applied": applied, "skipped": skipped, "stagingLeft": left}


# --- tasks -------------------------------------------------------------------------------------------------------


def _task_dir(root: str, handle: object) -> str:
    if not isinstance(handle, str) or not HANDLE.fullmatch(handle):
        raise Refusal("task-unknown", "The task handle is malformed.")
    folder = os.path.join(root, STATE, "tasks", handle)
    if not os.path.isdir(folder) or os.path.islink(folder):
        raise Refusal("task-unknown", f"No VERA task {handle} exists below the remote root.")
    return folder


def _environment() -> dict[str, str]:
    account = pwd.getpwuid(os.getuid())
    env = {"HOME": account.pw_dir, "USER": account.pw_name, "LOGNAME": account.pw_name, "PATH": "/usr/local/bin:/usr/bin:/bin", "LANG": os.environ.get("LANG", "C.UTF-8")}
    runtime = os.environ.get("XDG_RUNTIME_DIR") or f"/run/user/{os.getuid()}"
    if os.path.isdir(runtime):
        env["XDG_RUNTIME_DIR"] = runtime
    return env


def op_task_start(request: dict, payload: bytes, source: bytes) -> dict:
    root = check_root(request)
    name, folder = project_dir(root, request)
    task = request.get("task") or {}
    argv = task.get("argv")
    if not isinstance(argv, list) or not 1 <= len(argv) <= 48 or not all(isinstance(a, str) and 0 < len(a) <= 1024 and "\x00" not in a for a in argv):
        raise Refusal("command-not-allowed", "A task command is 1 to 48 arguments of 1 to 1024 characters.")
    budget, limit = task.get("budgetS"), task.get("outputLimitBytes")
    if not isinstance(budget, int) or not 1 <= budget <= 3500 or not isinstance(limit, int) or not 1024 <= limit <= FILE_LIMIT:
        raise Refusal("manifest", "A task needs a budget of 1 to 3500 s and an output limit of 1 KiB to 16 MiB.")
    program = argv[0]
    if program == "python3":
        executable = PYTHON
    else:
        segments = check_relative(program)
        executable = os.path.join(folder, *segments)
        try:
            info = os.lstat(executable)
        except OSError:
            raise Refusal("command-not-allowed", f"The task program {program} is not a deployed project file.") from None
        if not stat.S_ISREG(info.st_mode) or not info.st_mode & 0o100:
            raise Refusal("command-not-allowed", f"The task program {program} is not an executable regular file.")
    if not os.path.isdir(folder) or os.path.islink(folder):
        raise Refusal("command-not-allowed", f"The project {name} is not deployed below the remote root.")
    handle = secrets.token_hex(8)
    tasks = state_dir(root, "tasks")
    directory = os.path.join(tasks, handle)
    os.mkdir(directory, 0o700)
    write_json(os.path.join(directory, "request.json"), {"format": 1, "name": task.get("name"), "project": name, "cwd": folder, "argv": [executable, *argv[1:]], "budgetS": budget, "outputLimitBytes": limit, "runId": request.get("runId")})
    status_path = os.path.join(directory, "status.json")
    write_json(status_path, {"state": "starting", "bootId": boot_id(), "handle": handle})
    try:
        supervisor = subprocess.Popen(
            [PYTHON, "-I", "-c", SUPERVISE_STUB, directory],
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            cwd=directory,
            close_fds=True,
            start_new_session=True,
            env=_environment(),
        )
    except OSError as error:
        write_json(status_path, {"state": "start-failed", "error": f"the supervisor could not start: {error}"[:300], "bootId": boot_id(), "handle": handle, "endedAt": time.time()})
        return {"handle": handle, **derive(directory)}
    starting = read_json(status_path) or {}
    if starting.get("state") == "starting":
        write_json(status_path, {**starting, "supervisor": {"pid": supervisor.pid, "startTicks": start_ticks(supervisor.pid)}})
    assert supervisor.stdin is not None
    supervisor.stdin.write(source)
    supervisor.stdin.close()
    end = time.monotonic() + 5
    status = derive(directory)
    while status.get("state") == "starting" and time.monotonic() < end:
        time.sleep(0.05)
        status = derive(directory)
    return {"handle": handle, **status}


def supervise(directory: str) -> None:
    """The detached owner of one task: starts it in its own process group, copies its output into the logs up to
    the limit, ends it at the budget, the limit or a stop request, and records its end."""
    signal.signal(signal.SIGHUP, signal.SIG_IGN)
    request = read_json(os.path.join(directory, "request.json")) or {}
    status_path = os.path.join(directory, "status.json")
    boot = boot_id()
    me = {"pid": os.getpid(), "startTicks": start_ticks(os.getpid())}
    started = time.time()
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
    logs = {name: os.fdopen(os.open(os.path.join(directory, f"{name}.log"), flags, 0o600), "wb") for name in ("stdout", "stderr")}
    try:
        child = subprocess.Popen(request["argv"], cwd=request["cwd"], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, close_fds=True, start_new_session=True, env={**_environment(), "VERA_TASK_HANDLE": os.path.basename(directory)})
    except (OSError, KeyError, TypeError) as error:
        write_json(status_path, {"state": "start-failed", "error": str(error)[:300], "bootId": boot, "supervisor": me, "startedAt": started, "endedAt": time.time()})
        return
    pid = child.pid
    running = {"state": "running", "pid": pid, "pgid": pid, "startTicks": start_ticks(pid), "bootId": boot, "supervisor": me, "startedAt": started, "budgetS": request["budgetS"], "outputLimitBytes": request["outputLimitBytes"]}
    write_json(status_path, running)
    selector = selectors.DefaultSelector()
    for name, stream in (("stdout", child.stdout), ("stderr", child.stderr)):
        assert stream is not None
        os.set_blocking(stream.fileno(), False)
        selector.register(stream, selectors.EVENT_READ, name)
    room = request["outputLimitBytes"]
    reason = "exited"
    deadline = time.monotonic() + request["budgetS"]
    while child.poll() is None:
        for key, _ in selector.select(0.1):
            try:
                data = os.read(key.fileobj.fileno(), 65536)  # type: ignore[union-attr]
            except BlockingIOError:
                continue
            if not data:
                selector.unregister(key.fileobj)
                continue
            kept = data[: max(room, 0)]
            logs[key.data].write(kept)
            logs[key.data].flush()
            room -= len(data)
        if room < 0:
            reason = "output-limit"
        elif time.monotonic() >= deadline:
            reason = "budget-exceeded"
        elif os.path.exists(os.path.join(directory, "stop")):
            reason = "stopped"
        if reason != "exited":
            _end_group(pid, child)
            break
    code = child.wait()
    _end_group(pid, None)
    # What the task wrote before it ended, still within the limit; never wait for a pipe a stray process holds.
    for key in list(selector.get_map().values()):
        try:
            data = os.read(key.fileobj.fileno(), 1024 * 1024)  # type: ignore[union-attr]
        except (BlockingIOError, OSError):
            data = b""
        if room > 0 and data:
            logs[key.data].write(data[:room])
            room -= len(data)
    for log in logs.values():
        log.close()
    final = {**running, "state": reason, "endedAt": time.time(), "durationS": round(time.time() - started, 3)}
    if code >= 0:
        final["exitCode"] = code
    else:
        try:
            final["signal"] = signal.Signals(-code).name
        except ValueError:
            final["signal"] = -code
    write_json(status_path, final)


def _group_exists(pgid: int) -> bool:
    try:
        os.killpg(pgid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def _end_group(pgid: int, child: subprocess.Popen | None) -> None:
    """SIGTERM to the task's own process group, SIGKILL after the grace; members left behind are ended too."""
    if not _group_exists(pgid):
        return
    try:
        os.killpg(pgid, signal.SIGTERM)
    except ProcessLookupError:
        return
    end = time.monotonic() + TERM_GRACE
    while time.monotonic() < end:
        if child is not None:
            child.poll()
        if not _group_exists(pgid):
            return
        time.sleep(0.05)
    try:
        os.killpg(pgid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def _members(pgid: object, ticks: object, handle: str) -> list[int]:
    """Processes of the task's process group started no earlier than the task whose environment carries the task's
    VERA_TASK_HANDLE (its own children included): a later group that reuses the number is never taken for the task."""
    if not isinstance(pgid, int) or pgid <= 1 or not isinstance(ticks, int) or not HANDLE.fullmatch(handle):
        return []
    marker = b"VERA_TASK_HANDLE=" + handle.encode("ascii")
    found = []
    try:
        names = os.listdir("/proc")
    except OSError:
        return []
    for name in names:
        if not name.isdigit():
            continue
        text = _read(f"/proc/{name}/stat", 8192)
        if not text or ")" not in text:
            continue
        fields = text.rsplit(")", 1)[1].split()
        try:
            if int(fields[2]) != pgid or int(fields[19]) < ticks or fields[0] == "Z":
                continue
        except (IndexError, ValueError):
            continue
        try:
            with open(f"/proc/{name}/environ", "rb") as handle_file:
                environment = handle_file.read(1024 * 1024).split(b"\x00")
        except OSError:
            continue
        if marker in environment:
            found.append(int(name))
    return found


def derive(directory: str) -> dict:
    """The task's status as recorded, corrected by what runs now (supervisor, task identity, boot)."""
    status = read_json(os.path.join(directory, "status.json")) or {"state": "unknown"}
    state = status.get("state")
    if state in FINAL:
        return status
    if status.get("bootId") != boot_id():
        return {**status, "state": "lost-by-reboot", "note": "The board booted again since the task started; its outcome is unknown and nothing was signalled."}
    supervisor = status.get("supervisor") or {}
    if state == "starting":
        if not supervisor or same_process(supervisor.get("pid"), supervisor.get("startTicks"), status.get("bootId")):
            return status
        again = read_json(os.path.join(directory, "status.json")) or status
        if again.get("state") != "starting":
            return derive(directory)
        return {**status, "state": "start-failed", "note": "The supervisor ended before it started the task; nothing runs."}
    if same_process(supervisor.get("pid"), supervisor.get("startTicks"), status.get("bootId")):
        return status
    if same_process(status.get("pid"), status.get("startTicks"), status.get("bootId")) or _members(status.get("pgid"), status.get("startTicks"), os.path.basename(directory)):
        return {**status, "state": "running", "supervisorLost": True}
    # The supervisor may have written the final status just now.
    again = read_json(os.path.join(directory, "status.json")) or status
    if again.get("state") in FINAL:
        return again
    # Recorded as final, so no later look at /proc can take another process for this task.
    lost = {**status, "state": "supervisor-lost", "endedAt": time.time(), "note": "The supervisor is gone and the task no longer runs; its outcome is unknown."}
    lost.pop("supervisorLost", None)
    write_json(os.path.join(directory, "status.json"), lost)
    return lost


def op_task_wait(request: dict, payload: bytes) -> dict:
    directory = _task_dir(check_root(request), request.get("handle"))
    wait = min(max(float(request.get("waitS") or 0), 0.0), 2.0)
    end = time.monotonic() + wait
    status = derive(directory)
    while status.get("state") not in FINAL and time.monotonic() < end:
        time.sleep(0.1)
        status = derive(directory)
    return status


def _stop(directory: str) -> dict:
    status = derive(directory)
    if status.get("state") in FINAL:
        return {**status, "confirmed": True, "action": "none"}
    try:
        open(os.path.join(directory, "stop"), "a").close()
    except OSError:
        pass
    end = time.monotonic() + 8
    while time.monotonic() < end:
        status = derive(directory)
        if status.get("state") in FINAL:
            return {**status, "confirmed": True, "action": "supervisor"}
        if status.get("supervisorLost"):
            break
        time.sleep(0.1)
    if status.get("supervisorLost"):
        _end_group(int(status["pgid"]), None)
        if not same_process(status.get("pid"), status.get("startTicks"), status.get("bootId")) and not _members(status.get("pgid"), status.get("startTicks"), os.path.basename(directory)):
            final = {**status, "state": "stopped", "endedAt": time.time(), "stoppedBy": "helper"}
            final.pop("supervisorLost", None)
            write_json(os.path.join(directory, "status.json"), final)
            return {**final, "confirmed": True, "action": "helper"}
    status = derive(directory)
    if status.get("state") in FINAL:
        return {**status, "confirmed": True, "action": "supervisor"}
    return {**status, "confirmed": False, "action": "unknown"}


def op_task_stop(request: dict, payload: bytes) -> dict:
    return _stop(_task_dir(check_root(request), request.get("handle")))


def op_task_status(request: dict, payload: bytes) -> dict:
    directory = _task_dir(check_root(request), request.get("handle"))
    return {**derive(directory), "request": read_json(os.path.join(directory, "request.json"))}


def op_stop_owned(request: dict, payload: bytes) -> dict:
    root = check_root(request)
    tasks = os.path.join(root, STATE, "tasks")
    results = []
    if os.path.isdir(tasks) and not os.path.islink(tasks):
        for handle in sorted(os.listdir(tasks)):
            directory = os.path.join(tasks, handle)
            if HANDLE.fullmatch(handle) and os.path.isdir(directory):
                status = derive(directory)
                if status.get("state") in FINAL:
                    continue
                results.append({"handle": handle, **_stop(directory)})
    return {"tasks": results, "confirmed": all(item.get("confirmed") for item in results)}


def _tail(path: str, limit: int) -> dict:
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except OSError:
        return {"bytes": 0, "text": "", "truncated": False}
    with os.fdopen(fd, "rb") as handle:
        size = os.fstat(handle.fileno()).st_size
        handle.seek(max(0, size - limit))
        data = handle.read(limit)
    return {"bytes": size, "text": data.decode("utf-8", "replace"), "truncated": size > limit}


def op_task_logs(request: dict, payload: bytes) -> dict:
    directory = _task_dir(check_root(request), request.get("handle"))
    limit = min(max(int(request.get("maxBytes") or 65536), 1024), 1024 * 1024)
    return {"stdout": _tail(os.path.join(directory, "stdout.log"), limit), "stderr": _tail(os.path.join(directory, "stderr.log"), limit)}


# --- services ----------------------------------------------------------------------------------------------------


def _tool(name: str) -> str:
    for path in TOOLS[name]:
        if os.path.isfile(path):
            return path
    raise Refusal("remote-error", f"{name} is not installed on the board.")


def _unit(request: dict) -> str:
    unit = request.get("unit")
    allowed = request.get("allowed") or []
    if not isinstance(unit, str) or not UNIT.fullmatch(unit) or unit not in allowed:
        raise Refusal("service-not-allowed", f"The unit {unit!r} is not a user service the project lists.")
    return unit


def _show(unit: str) -> dict:
    result = subprocess.run(
        [_tool("systemctl"), "--user", "--no-ask-password", "show", "-p", "LoadState,ActiveState,SubState,MainPID,UnitFileState,ExecMainStatus,Result", "--", unit],
        capture_output=True, timeout=30, env=_environment(), stdin=subprocess.DEVNULL,
    )
    values = {}
    for line in result.stdout.decode("utf-8", "replace").splitlines():
        key, sep, value = line.partition("=")
        if sep:
            values[key] = value
    return {"properties": values, "showExit": result.returncode, "stderr": result.stderr.decode("utf-8", "replace")[-2000:]}


def op_service(request: dict, payload: bytes) -> dict:
    unit = _unit(request)
    action = request.get("action")
    if action not in ("status", "start", "stop"):
        raise Refusal("usage", "A service action is status, start or stop.")
    done: dict = {}
    if action != "status":
        result = subprocess.run([_tool("systemctl"), "--user", "--no-ask-password", action, "--", unit], capture_output=True, timeout=60, env=_environment(), stdin=subprocess.DEVNULL)
        done = {"exit": result.returncode, "stderr": result.stderr.decode("utf-8", "replace")[-2000:]}
    account = pwd.getpwuid(os.getuid()).pw_name
    linger = os.path.exists(os.path.join("/var/lib/systemd/linger", account))
    return {"unit": unit, "action": action, "command": done, "linger": linger, **_show(unit)}


def op_journal(request: dict, payload: bytes) -> dict:
    unit = _unit(request)
    lines = request.get("lines")
    if not isinstance(lines, int) or not 1 <= lines <= 2000:
        raise Refusal("usage", "--lines is 1 to 2000.")
    result = subprocess.run([_tool("journalctl"), "--user", "--no-pager", "-o", "json", "-n", str(lines), "-u", unit], capture_output=True, timeout=60, env=_environment(), stdin=subprocess.DEVNULL)
    entries = []
    budget = 1024 * 1024
    for raw in result.stdout.decode("utf-8", "replace").splitlines():
        try:
            entry = json.loads(raw)
        except ValueError:
            continue
        message = entry.get("MESSAGE")
        if isinstance(message, list):
            message = bytes(value for value in message if isinstance(value, int) and 0 <= value < 256).decode("utf-8", "replace")
        item = {"time": entry.get("__REALTIME_TIMESTAMP"), "priority": entry.get("PRIORITY"), "message": message}
        budget -= len(json.dumps(item))
        if budget < 0:
            break
        entries.append(item)
    return {"unit": unit, "entries": entries, "journalExit": result.returncode, "stderr": result.stderr.decode("utf-8", "replace")[-2000:]}


# --- dispatch ----------------------------------------------------------------------------------------------------


def op_identify(request: dict, payload: bytes) -> dict:
    found = facts()
    check_identity(request, found)
    try:
        check_root(request)
        root = {"ok": True}
    except Refusal as refusal:
        root = {"ok": False, "code": refusal.code, "message": refusal.message}
    return {"facts": found, "root": root}


OPERATIONS = {
    "identify": op_identify,
    "stage": op_stage,
    "apply": op_apply,
    "task-wait": op_task_wait,
    "task-stop": op_task_stop,
    "task-status": op_task_status,
    "task-logs": op_task_logs,
    "stop-owned": op_stop_owned,
    "service": op_service,
    "journal": op_journal,
}


def main() -> int:
    reply: dict
    try:
        line = sys.stdin.buffer.readline(REQUEST_LIMIT + 1)
        if len(line) > REQUEST_LIMIT:
            raise Refusal("usage", "The request line is larger than 1 MiB.")
        request = json.loads(line.decode("utf-8"))
        if not isinstance(request, dict) or request.get("version") != VERSION:
            raise Refusal("helper-changed", f"The request is for helper {request.get('version') if isinstance(request, dict) else None}, this is {VERSION}.")
        size = request.get("payloadBytes", 0)
        if not isinstance(size, int) or not 0 <= size <= TOTAL_LIMIT:
            raise Refusal("usage", "payloadBytes is 0 to 64 MiB.")
        payload = sys.stdin.buffer.read(size) if size else b""
        if len(payload) != size:
            raise Refusal("candidate-changed", "The transfer ended early.")
        operation = request.get("op")
        if operation != "identify":
            check_identity(request, facts())
        if operation == "task-start":
            result = op_task_start(request, payload, globals().get("__vera_source__") or b"")
        elif operation in OPERATIONS:
            result = OPERATIONS[operation](request, payload)
        else:
            raise Refusal("usage", f"Unknown operation {operation!r}.")
        reply = {"ok": True, "helper": VERSION, "result": result}
    except Refusal as refusal:
        reply = {"ok": False, "helper": VERSION, "code": refusal.code, "message": refusal.message, **refusal.fields}
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        reply = {"ok": False, "helper": VERSION, "code": "remote-error", "message": f"{type(error).__name__}: {str(error)[:300]}"}
    sys.stdout.write(json.dumps(reply))
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
