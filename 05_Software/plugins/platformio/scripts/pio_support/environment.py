"""The scrubbed process environment of PlatformIO (spec REQ-DATA-865c8fbd section 5, REQ-SEC-bb7ede2f).

PlatformIO sees the system variables, a PATH of the host toolchain (native tests), the helper's own Python folder and
the system folders, its core folder, the owned workspace and libdeps folders, and switches that turn off telemetry,
upgrade checks and progress bars. No PLATFORMIO_* variable of the caller survives: PlatformIO appends the multi-value
ones (extra scripts, build flags, upload flags) to the project's own values. Every operation but prepare-packages gets
a closed loopback proxy, so an install attempt fails instead of downloading; prepare-packages keeps the
caller's proxy and CA-bundle variables.
"""

from __future__ import annotations

import contextlib
import os
import sys
from collections.abc import Iterator
from pathlib import Path

SYSTEM = ("SYSTEMROOT", "SystemRoot", "WINDIR", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "LOCALAPPDATA", "APPDATA",
          "PROGRAMDATA", "PATHEXT", "COMSPEC", "LANG", "LC_ALL", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE")
DEAD_PROXY = "http://127.0.0.1:9"
PROXIES = ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy")
NETWORK = ("NO_PROXY", "no_proxy", "REQUESTS_CA_BUNDLE", "SSL_CERT_FILE", "SSL_CERT_DIR")


def _system_path() -> list[str]:
    keep: list[str] = []
    windows = os.environ.get("SYSTEMROOT") or os.environ.get("SystemRoot")
    for entry in os.environ.get("PATH", "").split(os.pathsep):
        if not entry:
            continue
        if windows and os.path.normcase(entry).startswith(os.path.normcase(windows)):
            keep.append(entry)
        elif os.name != "nt" and entry in ("/usr/bin", "/bin", "/usr/local/bin"):
            keep.append(entry)
    return keep


def build(core: Path, workspace: Path | None, libdeps: Path | None, offline: bool = True,
          toolchain: Path | None = None, cache: Path | None = None) -> dict[str, str]:
    env = {key: value for key, value in os.environ.items() if key in SYSTEM}
    folders = ([str(toolchain)] if toolchain is not None else []) + [str(Path(sys.executable).parent)]
    env["PATH"] = os.pathsep.join(folders + _system_path())
    env["PLATFORMIO_CORE_DIR"] = str(core)
    if workspace is not None:
        env["PLATFORMIO_WORKSPACE_DIR"] = str(workspace)
    if libdeps is not None:
        env["PLATFORMIO_LIBDEPS_DIR"] = str(libdeps)
    env["PLATFORMIO_SETTING_ENABLE_TELEMETRY"] = "No"
    env["PLATFORMIO_SETTING_CHECK_PLATFORMIO_INTERVAL"] = "3650"
    env["PLATFORMIO_DISABLE_UPGRADE_CHECK"] = "true"
    env["PLATFORMIO_DISABLE_PROGRESSBAR"] = "true"
    env["PLATFORMIO_NO_ANSI"] = "true"
    env["PYTHONUTF8"] = "1"
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    env["NO_COLOR"] = "1"
    if offline:
        for name in PROXIES:
            env[name] = DEAD_PROXY
        env["NO_PROXY"] = ""
        env["no_proxy"] = ""
        # PlatformIO would otherwise resolve a package from its cached registry answers and install it from its
        # download cache without any network: offline runs install nothing at all.
        env["PLATFORMIO_SETTING_ENABLE_CACHE"] = "No"
        if cache is not None:
            # The setting only stops cache writes; PlatformIO still reads <cache>/http and reuses <cache>/downloads.
            # An empty cache folder of this run alone makes any unexpected install fail closed.
            cache.mkdir(parents=True, exist_ok=True)
            env["PLATFORMIO_CACHE_DIR"] = str(cache)
    else:
        # The network step reaches the registry the way the user's network requires: their proxy and CA bundle.
        for name in (*PROXIES, *NETWORK):
            if name in os.environ:
                env[name] = os.environ[name]
    return env


@contextlib.contextmanager
def applied(env: dict[str, str]) -> Iterator[None]:
    """Runs a block of this process with `env` as os.environ (PlatformIO's parser reads os.environ)."""
    saved = dict(os.environ)
    os.environ.clear()
    os.environ.update(env)
    try:
        yield
    finally:
        os.environ.clear()
        os.environ.update(saved)


def pio_command() -> list[str]:
    """PlatformIO Core of the helper environment; the offline test seam replaces it only in a test process."""
    if os.environ.get("VERA_PIO_TEST") == "1" and os.environ.get("VERA_PIO_TEST_PIO"):
        return [sys.executable, os.environ["VERA_PIO_TEST_PIO"]]
    return [sys.executable, "-m", "platformio"]
