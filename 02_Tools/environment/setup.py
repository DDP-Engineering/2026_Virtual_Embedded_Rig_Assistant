"""Check and install everything VERA needs to build and test, on Windows and Ubuntu.

    python 02_Tools/environment/setup.py           check, then install what is missing
    python 02_Tools/environment/setup.py --check   report only; exit 1 when something is missing

Installs Node.js (pinned and SHA-256 verified, toolchain.json) into 02_Tools/runtime/ and runs
`npm ci` in 05_Software with the npm and Electron caches kept in 02_Tools/cache/. Nothing is
installed system-wide; missing system packages are reported with the command to install them.
"""

from __future__ import annotations

import argparse
import hashlib
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import zipfile
from pathlib import Path

if sys.version_info < (3, 11):
    sys.exit(f"Python 3.11 or newer is required (found {sys.version.split()[0]}).")

import toolchain as tc  # noqa: E402  (after the version gate: it relies on 3.9+ string methods)

OK, MISSING = "ok", "missing"


def report(status: str, item: str, detail: str = "") -> None:
    print(f"  [{status:7}] {item}{'  - ' + detail if detail else ''}")


def check_git() -> bool:
    git = shutil.which("git")
    if git:
        version = subprocess.run([git, "--version"], capture_output=True, text=True).stdout.strip()
        report(OK, "git", version)
        return True
    hint = "install Git for Windows" if sys.platform == "win32" else "sudo apt install git"
    report(MISSING, "git", hint)
    return False


def node_installed() -> bool:
    exe = tc.node_exe()
    if not exe.exists():
        return False
    out = subprocess.run([str(exe), "--version"], capture_output=True, text=True).stdout.strip()
    return out == "v" + tc.NODE["version"]


def download(url: str, target: Path, sha256: str) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() == sha256:
        return
    print(f"  downloading {url}")
    partial = target.with_suffix(target.suffix + ".part")
    with urllib.request.urlopen(url, timeout=60) as response, open(partial, "wb") as out:
        shutil.copyfileobj(response, out)
    digest = hashlib.sha256(partial.read_bytes()).hexdigest()
    if digest != sha256:
        partial.unlink()
        sys.exit(f"SHA-256 mismatch for {url}: expected {sha256}, got {digest}")
    partial.replace(target)


def install_node() -> None:
    archive = tc.NODE["archives"][tc.platform_key()]
    file = tc.CACHE / "downloads" / archive["file"]
    download(tc.NODE["base_url"] + archive["file"], file, archive["sha256"])
    tc.RUNTIME.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=tc.RUNTIME) as tmp:
        if file.suffix == ".zip":
            with zipfile.ZipFile(file) as z:
                z.extractall(tmp)
        else:
            with tarfile.open(file) as t:
                t.extractall(tmp, filter="data")
        extracted = Path(tmp) / tc.node_home().name
        if tc.node_home().exists():
            shutil.rmtree(tc.node_home())
        extracted.replace(tc.node_home())


def check_node(fix: bool) -> bool:
    if node_installed():
        report(OK, "node", f"v{tc.NODE['version']} in {tc.node_home().relative_to(tc.REPO)}")
        return True
    if not fix:
        report(MISSING, "node", f"v{tc.NODE['version']}; run without --check to install")
        return False
    install_node()
    ok = node_installed()
    report(OK if ok else MISSING, "node", f"v{tc.NODE['version']} installed" if ok else "installation failed")
    return ok


def run_npm(args: list[str]) -> int:
    cmd = [str(tc.node_exe()), str(tc.npm_cli("npm")), *args]
    return subprocess.run(cmd, cwd=tc.SOFTWARE, env=tc.environment()).returncode


def check_packages(fix: bool) -> bool:
    lock = tc.SOFTWARE / "package-lock.json"
    if not (tc.SOFTWARE / "package.json").exists():
        report(OK, "npm packages", "05_Software has no package.json yet; nothing to install")
        return True
    if not lock.exists():
        report(MISSING, "npm packages", "no package-lock.json; create it with npm install")
        return False
    installed = tc.SOFTWARE / "node_modules" / ".package-lock.json"
    if installed.exists() and installed.stat().st_mtime >= lock.stat().st_mtime:
        report(OK, "npm packages", "node_modules matches package-lock.json")
        return True
    if not fix:
        report(MISSING, "npm packages", "node_modules missing or older than package-lock.json")
        return False
    print("  running npm ci in 05_Software")
    ok = run_npm(["ci"]) == 0
    report(OK if ok else MISSING, "npm packages", "npm ci done" if ok else "npm ci failed")
    return ok


def check_linux_libraries() -> bool:
    if not sys.platform.startswith("linux"):
        return True
    ldconfig = shutil.which("ldconfig") or "/sbin/ldconfig"
    known = subprocess.run([ldconfig, "-p"], capture_output=True, text=True).stdout
    missing: list[str] = []
    for soname, package in tc.CONFIG["linux_libraries"]["electron"].items():
        if soname not in known:
            missing.append(package)
    for program, package in tc.CONFIG["linux_libraries"]["e2e"].items():
        if not shutil.which(program):
            missing.append(package)
    if missing:
        report(MISSING, "system libraries", "sudo apt install " + " ".join(missing))
        return False
    report(OK, "system libraries", "Electron runtime libraries and xvfb present")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true", help="report only; install nothing")
    fix = not parser.parse_args().check
    print(f"VERA toolchain ({tc.platform_key()}, Python {sys.version.split()[0]})")
    results = [check_git(), check_node(fix), check_linux_libraries()]
    if results[1]:
        results.append(check_packages(fix))
    ready = all(results)
    print("ready" if ready else "not ready: see the items marked missing")
    return 0 if ready else 1


if __name__ == "__main__":
    sys.exit(main())
