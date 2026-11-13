"""VERA's own Arduino environment and the way arduino-tool runs arduino-cli (spec REQ-DATA-e444904d).

The environment root holds arduino-cli's data, downloads and user folders, the build cache and one staging folder per
running operation; the Arduino IDE's folders are never named. Every arduino-cli call gets a configuration generated
into the operation's staging folder: the offline one points `network.proxy` at a dead loopback port so nothing but
`install` can download indexes, tools, cores or libraries or ask Arduino's board-identification service.
"""

from __future__ import annotations

import ctypes
import hashlib
import json
import os
import re
import secrets
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any

from . import FORMAT

DEAD_PROXY = "http://127.0.0.1:9"
STATE = "environment.json"
OWNER = "owner.json"
CONFIG = "arduino-cli.yaml"
OUTPUT_LIMIT = 64 * 1024 * 1024
RECENT = 3600
HTTPS_URL = re.compile(r"https://[A-Za-z0-9.-]+(?::\d{1,5})?(?:/[^\s\x00-\x1f\x7f\"']*)?")


class Unusable(Exception):
    """The environment cannot be used; the message is meant for the user."""


class ToolMissing(Exception):
    """VERA_PROGRAM_ARDUINO_CLI does not name an executable file."""


class ToolFailed(Exception):
    """arduino-cli ran and failed where arduino-tool needed its answer; the message is meant for the user."""


def _home() -> Path:
    named = os.environ.get("VERA_ARDUINO_HOME")
    if named:
        if not os.path.isabs(named):
            raise Unusable("VERA_ARDUINO_HOME must be an absolute path.")
        return Path(named)
    base = os.environ.get("USERPROFILE" if os.name == "nt" else "HOME") or os.environ.get("HOME")
    if not base or not os.path.isabs(base):
        raise Unusable("The home folder is unknown, so VERA's Arduino environment cannot be located.")
    return Path(base) / ".vera-arduino"


def _yaml(value: str) -> str:
    # A JSON string is a valid YAML double-quoted scalar.
    return json.dumps(value, ensure_ascii=False)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def alive(pid: int) -> bool:
    """Whether a process with this id still runs; an unknown answer counts as running."""
    if pid <= 0:
        return False
    if os.name == "nt":
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)  # type: ignore[attr-defined]
        handle = kernel.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not handle:
            return ctypes.get_last_error() == 5  # type: ignore[attr-defined]  # access denied: it exists
        try:
            code = ctypes.c_ulong()
            if not kernel.GetExitCodeProcess(handle, ctypes.byref(code)):
                return True
            return code.value == 259  # STILL_ACTIVE
        finally:
            kernel.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except OSError:
        return True
    return True


class Environment:
    def __init__(self) -> None:
        self.root = _home()
        self.data = self.root / "data"
        self.downloads = self.root / "downloads"
        self.user = self.root / "user"
        self.cache = self.root / "cache"
        self.staging = self.root / "staging"

    def ensure(self) -> None:
        for folder in (self.data, self.downloads, self.user, self.cache, self.staging):
            folder.mkdir(parents=True, exist_ok=True)

    def index_urls(self) -> list[str]:
        path = self.root / STATE
        if not path.exists():
            return []
        try:
            state = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            raise Unusable(f"{STATE} of VERA's Arduino environment cannot be read: {error}.") from error
        urls = state.get("indexUrls") if isinstance(state, dict) and state.get("format") == FORMAT else None
        if not isinstance(urls, list) or not all(isinstance(url, str) and HTTPS_URL.fullmatch(url) for url in urls):
            raise Unusable(f"{STATE} of VERA's Arduino environment is not a format 1 document.")
        return urls

    def save_index_urls(self, urls: list[str]) -> None:
        path = self.root / STATE
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps({"format": FORMAT, "indexUrls": urls}, indent=2) + "\n", encoding="utf-8")
        os.replace(temporary, path)

    def config(self, online: bool, urls: list[str] | None = None) -> str:
        """The arduino-cli configuration of one operation."""
        lines = [
            "directories:",
            f"  data: {_yaml(self.data.as_posix())}",
            f"  downloads: {_yaml(self.downloads.as_posix())}",
            f"  user: {_yaml(self.user.as_posix())}",
            "build_cache:",
            f"  path: {_yaml(self.cache.as_posix())}",
            "board_manager:",
            "  additional_urls: [" + ", ".join(_yaml(url) for url in (urls if urls is not None else self.index_urls())) + "]",
            "library:",
            "  enable_unsafe_install: false",
            "updater:",
            "  enable_notification: false",
            "output:",
            "  no_color: true",
        ]
        if not online:
            lines += ["network:", f"  proxy: {_yaml(DEAD_PROXY)}"]
        return "\n".join(lines) + "\n"

    def redact(self, text: str) -> str:
        """Writes the environment root as `<arduino-home>`, in either slash form and, on Windows, any letter case."""
        for form in {str(self.root), self.root.as_posix()}:
            pattern = re.escape(form)
            text = re.sub(pattern, "<arduino-home>", text, flags=re.IGNORECASE if os.name == "nt" else 0)
        return text

    def platform_folder(self, vendor: str, arch: str, version: str) -> Path:
        return self.data / "packages" / vendor / "hardware" / arch / version

    def stage(self, run_id: str) -> "Stage":
        """A new staging folder that appears under its final name only with its owner.json inside, so a concurrent
        clean never sees it without an owner."""
        self.ensure()
        name = f"{run_id}-{secrets.token_hex(3)}"
        starting = self.staging / f".starting-{name}"
        starting.mkdir()
        (starting / OWNER).write_text(json.dumps({"format": FORMAT, "pid": os.getpid()}) + "\n", encoding="utf-8")
        folder = self.staging / name
        os.replace(starting, folder)
        return Stage(self, folder)

    def clean(self) -> dict[str, Any]:
        removed: list[str] = []
        busy: list[str] = []
        failed: list[str] = []
        if self.staging.is_dir():
            for entry in sorted(self.staging.iterdir()):
                if entry.is_symlink() or not entry.is_dir():
                    continue
                try:
                    owner = json.loads((entry / OWNER).read_text(encoding="utf-8"))
                    pid = int(owner.get("pid", 0))
                except (OSError, ValueError, TypeError, AttributeError):
                    pid = 0
                try:
                    recent = time.time() - entry.stat().st_mtime < RECENT
                except OSError:
                    recent = True
                # A folder whose owner runs, or a recent one without a readable owner (still being created), stays.
                if (pid and alive(pid)) or (not pid and recent):
                    busy.append(entry.name)
                    continue
                shutil.rmtree(entry, ignore_errors=True)
                (failed if entry.exists() else removed).append(entry.name)
        # A running compile uses the cache: it stays until no staging folder is in use.
        cache = self.cache.is_dir() and not self.cache.is_symlink() and not busy
        if cache:
            shutil.rmtree(self.cache, ignore_errors=True)
        return {"staging": {"removed": removed, "inUse": busy, "failed": failed}, "cacheRemoved": bool(cache and not self.cache.exists())}


class Stage:
    """One operation's staging folder: its arduino-cli configuration, build folder and copies."""

    def __init__(self, environment: Environment, folder: Path) -> None:
        self.environment = environment
        self.folder = folder

    def remove(self) -> None:
        shutil.rmtree(self.folder, ignore_errors=True)

    def redact(self, text: str) -> str:
        for form in {str(self.folder), self.folder.as_posix()}:
            text = re.sub(re.escape(form), "<staging>", text, flags=re.IGNORECASE if os.name == "nt" else 0)
        return self.environment.redact(text)


class Cli:
    """arduino-cli with one generated configuration; argv only, closed stdin, JSON output."""

    def __init__(self, stage: Stage, online: bool = False, urls: list[str] | None = None) -> None:
        executable = os.environ.get("VERA_PROGRAM_ARDUINO_CLI", "")
        if not executable or not os.path.isfile(executable):
            raise ToolMissing()
        self.executable = executable
        self.stage = stage
        self.text = stage.environment.config(online, urls)
        self.path = stage.folder / CONFIG
        self.path.write_text(self.text, encoding="utf-8")
        self.calls = 0

    @property
    def config_sha256(self) -> str:
        return sha256_bytes(self.stage.environment.redact(self.text).encode("utf-8"))

    def run(self, args: list[str], timeout: float | None = None) -> tuple[int, Any, str]:
        """Exit code, parsed JSON document (None when stdout is not JSON) and stderr."""
        self.calls += 1
        # Global flags first: arduino-tool refuses option-like values, and nothing after the command can turn --json off.
        argv = [self.executable, "--config-file", str(self.path), "--json", *args]
        started = time.monotonic()
        try:
            completed = subprocess.run(
                argv,
                stdin=subprocess.DEVNULL,
                capture_output=True,
                timeout=timeout,
                cwd=self.stage.folder,
            )
        except subprocess.TimeoutExpired:
            return 124, None, f"arduino-cli {' '.join(args[:2])} did not answer within {round(time.monotonic() - started)} s."
        stdout = completed.stdout[:OUTPUT_LIMIT].decode("utf-8", "replace")
        stderr = completed.stderr[:OUTPUT_LIMIT].decode("utf-8", "replace")
        try:
            document = json.loads(stdout) if stdout.strip() else None
        except ValueError:
            document = None
        return completed.returncode, document, stderr
