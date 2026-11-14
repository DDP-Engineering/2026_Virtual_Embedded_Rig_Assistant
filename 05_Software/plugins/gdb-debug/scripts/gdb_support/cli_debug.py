"""`gdb-debug`: tools, snapshot, break, step and the cleanup release (spec REQ-DATA-d7da2a71 sections 2-6).

Everything a request names is checked before any process starts: options, the registry probe, the package profile,
the ELF (REQ-SEC-e1493c9b), variables and locations (REQ-SEC-a7bab79f). Exit codes: 0 pass, 2 refused (nothing
started, no folder), 3 incomplete, blocked or error (the result names why).
"""

from __future__ import annotations

import argparse
import os
import re
import signal
import subprocess
import sys
from pathlib import Path
from typing import Any

from . import VERSION, elf, profiles, registry, validate
from .cli_elf import facts
from .errors import Refused
from .lifecycle import Lifecycle
from .operations import Live, Request
from .report import Result, emit
from .session import GDB_OPTIONS
from .workspace import PathRefused, entered_directory, regular_file, relative

USAGE = (
    "gdb-debug {tools | release --probe A | snapshot|break|step --probe A --elf F --firmware-effect none|actuates "
    "--on-exit halted|resume [--read VAR]... [--frames N] [--at LOCATION --timeout S] [--count N] [--instruction]}"
)
PLUGIN = Path(__file__).resolve().parent.parent.parent
TOOL_TIMEOUT = 20


class _Parser(argparse.ArgumentParser):
    def error(self, message: str) -> None:  # type: ignore[override]
        raise Refused("request", f"{message}. Usage: {USAGE}")


def _bounded(low: int, high: int, name: str):
    def parse(text: str) -> int:
        if not re.fullmatch(r"[0-9]{1,6}", text) or not low <= int(text) <= high:
            raise argparse.ArgumentTypeError(f"{name} must be a whole number from {low} to {high}")
        return int(text)

    return parse


def _parser() -> argparse.ArgumentParser:
    parser = _Parser(prog="gdb-debug", allow_abbrev=False, add_help=False)
    sub = parser.add_subparsers(dest="operation", required=True, parser_class=_Parser)
    sub.add_parser("tools", allow_abbrev=False, add_help=False)
    release = sub.add_parser("release", allow_abbrev=False, add_help=False)
    release.add_argument("--probe", required=True)
    for name in ("snapshot", "break", "step"):
        live = sub.add_parser(name, allow_abbrev=False, add_help=False)
        live.add_argument("--probe", required=True)
        live.add_argument("--elf", required=True)
        live.add_argument("--firmware-effect", required=True, choices=["none", "actuates"])
        live.add_argument("--on-exit", required=True, choices=["halted", "resume"])
        live.add_argument("--read", action="append", default=[])
        live.add_argument("--frames", type=_bounded(1, 64, "--frames"), default=16)
        live.add_argument("--results-dir")
        live.add_argument("--run-id")
        if name == "break":
            live.add_argument("--at", required=True)
            live.add_argument("--timeout", required=True, type=_bounded(1, 3000, "--timeout"))
        if name == "step":
            live.add_argument("--count", required=True, type=_bounded(1, 100, "--count"))
            live.add_argument("--instruction", action="store_true")
    return parser


def _program(variable: str, name: str) -> str:
    path = os.environ.get(variable)
    if not path:
        raise Refused("tools", f"{name} was not provided ({variable}); install it and let VERA find it.")
    return path


def check_image(image: elf.Elf, profile: profiles.Profile) -> list[str]:
    """Refuses an ELF the profile's core cannot run; returns limits for what cannot be checked."""
    if image.machine != 40 or image.bits != 32 or image.endian != "little":
        raise Refused(
            "elf",
            f"The ELF is a {image.bits}-bit {image.endian}-endian {image.machine_name} image; profile {profile.id} "
            "debugs 32-bit little-endian ARM M-profile firmware.",
        )
    attributes = image.arm_attributes()
    if attributes.get("profile") not in (None, "", "M"):
        raise Refused("elf", f"The ELF is built for the ARM {attributes.get('profile')} profile, not for a Cortex-M core.")
    arch = elf.arm_arch(attributes)
    if arch is None:
        return ["The ELF declares no ARM architecture (no .ARM.attributes); compatibility with the core is unchecked."]
    if arch not in profiles.RUNS[profile.arch]:
        raise Refused("elf", f"The ELF is built for {arch}, which the profile's {profile.core} ({profile.arch}) cannot run.")
    return []


def live(args: argparse.Namespace, cwd: Path, spelled: Path, lifecycle: Lifecycle) -> int:
    probe, _digest = registry.read(args.probe)
    profile = profiles.load(PLUGIN / "profiles", probe.profile)
    if probe.vid != profile.vid or probe.pid not in profile.pids:
        raise Refused(
            "profile",
            f"Probe {probe.alias} ({probe.vid}:{probe.pid}) is not a probe profile {profile.id} supports "
            f"({profile.vid}:{'/'.join(profile.pids)}).",
        )
    try:
        path = regular_file(cwd, args.elf, "--elf", spelled)
    except PathRefused as error:
        raise Refused("elf", str(error)) from error
    shown = relative(cwd, path)
    try:
        image = elf.read(path)
        image_limits = check_image(image, profile)
        # Every ELF fact the session needs is read now, so a malformed table is a refusal, never a traceback later.
        inspection = facts(image, shown, len(image.data))
        image.symbols()
    except elf.ElfError as error:
        raise Refused("elf", f"{args.elf[:120]}: {error}") from error
    if len(args.read) > 8:
        raise Refused("request", "Name at most 8 variables with --read.")
    reads = tuple(validate.variable(name) for name in args.read)
    location = validate.location(args.at, list(profile.flash)) if args.operation == "break" else None
    gdb = _program("VERA_PROGRAM_ARM_NONE_EABI_GDB", "arm-none-eabi-gdb")
    openocd = _program("VERA_PROGRAM_OPENOCD", "OpenOCD")
    result = Result(args.operation, args.run_id)
    result.create_folder(cwd, spelled, args.results_dir)
    gdb_version, _ = _version(gdb, GDB_VERSION)
    openocd_version, _ = _version(openocd, OPENOCD_VERSION)
    result["tools"] = {
        "gdb": {"path": gdb, "version": gdb_version, "target": _gdb_target(gdb)},
        "openocd": {"path": openocd, "version": openocd_version},
    }
    result["probe"] = {
        "alias": probe.alias,
        "resource": probe.resource,
        "profile": profile.id,
        "profileStatus": profile.status,
        "faults": profile.faults,
    }
    result["elf"] = {
        "path": shown,
        "sha256": image.sha256,
        "bytes": len(image.data),
        "machine": inspection["elf"]["machine"],
        "arch": (inspection.get("arm") or {}).get("arch"),
        "debug": inspection["debug"]["present"],
        "match": "unchecked",
    }
    result["firmwareEffect"] = args.firmware_effect
    result["onExit"] = args.on_exit
    request = Request(
        args.operation,
        probe,
        profile,
        path,
        shown,
        image,
        reads,
        args.frames,
        location,
        getattr(args, "timeout", None),
        getattr(args, "count", None),
        bool(getattr(args, "instruction", False)),
        args.firmware_effect,
        args.on_exit,
        gdb,
        openocd,
    )
    session = Live(request, result, lifecycle)
    exit_code = session.run()
    result["limits"] = [*image_limits, *inspection["limits"], *result.get("limits", [])]
    if profile.status == "unverified":
        result["limits"].append(f"Profile {profile.id} is unverified: no recorded run on a real board yet.")
    return result.finish(exit_code)


GDB_VERSION = r"GNU gdb[^\n]*?(\d+\.\d+(?:\.\d+)?)"
OPENOCD_VERSION = r"Open On-Chip Debugger (\d+\.\d+\.\d+)"


def _gdb_target(executable: str) -> str | None:
    """GDB's configured target triple (`--target=arm-none-eabi`; the host triple for gdb-multiarch). GDB 12 and newer
    print it only for `--configuration`, not for `--version`."""
    found = re.search(r"--target=([\w.-]+)", _output(executable, "--configuration"))
    return found.group(1) if found else None


def _output(executable: str, flag: str) -> str:
    try:
        done = subprocess.run([executable, flag], capture_output=True, timeout=TOOL_TIMEOUT, stdin=subprocess.DEVNULL)
    except (OSError, subprocess.TimeoutExpired) as error:
        return str(error)[:200]
    return (done.stdout + done.stderr).decode("utf-8", "replace")


def _version(executable: str, pattern: str) -> tuple[str | None, str]:
    text = _output(executable, "--version")
    found = re.search(pattern, text)
    return (found.group(1) if found else None), text


def tools() -> int:
    gdb = _program("VERA_PROGRAM_ARM_NONE_EABI_GDB", "arm-none-eabi-gdb")
    openocd = _program("VERA_PROGRAM_OPENOCD", "OpenOCD")
    gdb_version, _ = _version(gdb, GDB_VERSION)
    openocd_version, _ = _version(openocd, OPENOCD_VERSION)
    support: dict[str, Any] = {}
    for profile in profiles.all_profiles(PLUGIN / "profiles"):
        if profile.architecture not in support:
            try:
                done = subprocess.run(
                    [gdb, *GDB_OPTIONS[1:], "--batch", "-ex", f"set architecture {profile.architecture}"],
                    capture_output=True,
                    timeout=TOOL_TIMEOUT,
                    stdin=subprocess.DEVNULL,
                )
                output = (done.stdout + done.stderr).decode("utf-8", "replace")
                support[profile.architecture] = done.returncode == 0 and "Undefined item" not in output
            except (OSError, subprocess.TimeoutExpired):
                support[profile.architecture] = False
    emit(
        {
            "format": 1,
            "kind": "gdb-debug-tools",
            "gdb": {"path": gdb, "version": gdb_version, "target": _gdb_target(gdb)},
            "openocd": {"path": openocd, "version": openocd_version},
            "profiles": [
                {
                    "id": profile.id,
                    "status": profile.status,
                    "description": profile.description,
                    "architecture": profile.architecture,
                    "gdbSupports": support.get(profile.architecture, False),
                }
                for profile in profiles.all_profiles(PLUGIN / "profiles")
            ],
        }
    )
    return 0


def release(alias: str, lifecycle: Lifecycle) -> int:
    """VERA's cleanup after an interrupted session: never touches the target (a reconnect would halt the core)."""
    if not registry.ALIAS.fullmatch(alias):
        raise Refused("request", f"--probe {alias[:40]!r} is not a registry alias.")
    lifecycle.report("cleaning", "unknown")
    lifecycle.report("released", "unknown")
    emit(
        {
            "format": 1,
            "kind": "gdb-debug-release",
            "probe": alias,
            "physical": "unknown",
            "note": "No process was started and the target was not touched; its halt/run state is unknown until the "
            "next snapshot.",
        }
    )
    return 0


def _terminate(_signum: int, _frame: Any) -> None:
    raise SystemExit(3)


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if argv in (["--version"], ["-V"]):
        print(f"gdb-debug {VERSION}")
        return 0
    if argv in (["--help"], ["-h"]) or not argv:
        print(f"Usage: {USAGE}")
        return 0
    signal.signal(signal.SIGTERM, _terminate)
    lifecycle = Lifecycle()
    try:
        args = _parser().parse_args(argv)
        if args.operation == "tools":
            return tools()
        if args.operation == "release":
            return release(args.probe, lifecycle)
        spelled = entered_directory()
        return live(args, Path(spelled).resolve(), spelled, lifecycle)
    except Refused as error:
        emit({"format": 1, "kind": "gdb-debug-refusal", "status": "refused", "problems": [{"code": error.code, "message": error.message}]})
        return 2
