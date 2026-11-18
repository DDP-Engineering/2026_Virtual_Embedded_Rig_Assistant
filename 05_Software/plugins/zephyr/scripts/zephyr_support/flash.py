"""`zephyr-flash`: flash an owned build through the one verified runner (spec REQ-DATA-d8ecee6a section 3,
REQ-FUNC-62b1d407, REQ-SEC-a4ed8466).

Only west's `stm32cubeprogrammer` runner is verified. Before the probe is opened: the build folder must be owned,
its HEX must equal the HEX of the named build run by SHA-256, every HEX data record must lie inside the flash region
the build's own devicetree names (no option-byte, OTP or RAM record), the build's runners.yaml may hold only the
runner arguments of the allowlist, and the probe alias must be a declared `probe` resource. The CLI found by VERA is
given to the runner with `--cli`; the probe's serial reaches it as `--dev-id`.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import traceback
from pathlib import Path

from . import VERSION, builddir, environment, model, preflight, registry
from .errors import Refused
from .lifecycle import Lifecycle
from .ops import evidence_run, posix
from .request import load
from .result import Run, emit, refuse, sha256
from .workspace import entered_directory

RUNNER = "stm32cubeprogrammer"
RUNNER_ARGS = {"--port=swd", "--reset-mode=hw"}
CONFIG_KEYS = {"board_dir", "elf_file", "hex_file", "bin_file", "uf2_file", "exe_file", "gdb", "openocd", "openocd_search"}


def flash_region(dts: Path) -> tuple[int, int]:
    """The (base, size) of the node `zephyr,flash` names in the build's final devicetree."""
    text = dts.read_text(encoding="utf-8", errors="replace")
    chosen = re.search(r"zephyr,flash\s*=\s*&([A-Za-z0-9_]+)\s*;", text)
    if not chosen:
        raise Refused("image", "The build's zephyr.dts names no zephyr,flash node.")
    node = re.search(rf"\b{re.escape(chosen.group(1))}\s*:\s*[A-Za-z0-9_,-]+@[0-9a-fA-F]+\s*\{{(.*?)\}};", text, re.S)
    reg = re.search(r"reg\s*=\s*<\s*(0x[0-9a-fA-F]+|\d+)\s+(0x[0-9a-fA-F]+|\d+)\s*>", node.group(1) if node else "")
    if not reg:
        raise Refused("image", f"The flash node {chosen.group(1)} has no reg in zephyr.dts.")
    return int(reg.group(1), 0), int(reg.group(2), 0)


def hex_ranges(path: Path) -> list[tuple[int, int]]:
    """The address ranges of the data records of an Intel HEX file (checksums verified)."""
    ranges: list[tuple[int, int]] = []
    upper = 0
    for number, line in enumerate(path.read_text(encoding="ascii", errors="replace").splitlines(), 1):
        line = line.strip()
        if not line:
            continue
        if not line.startswith(":") or len(line) < 11:
            raise Refused("image", f"zephyr.hex line {number} is not an Intel HEX record.")
        try:
            data = bytes.fromhex(line[1:])
        except ValueError as error:
            raise Refused("image", f"zephyr.hex line {number} is not hexadecimal.") from error
        if sum(data) & 0xFF or len(data) != data[0] + 5:
            raise Refused("image", f"zephyr.hex line {number} has a bad length or checksum.")
        count, address, kind = data[0], int.from_bytes(data[1:3], "big"), data[3]
        if kind == 0:
            ranges.append((upper + address, upper + address + count))
        elif kind == 4:
            upper = int.from_bytes(data[4:6], "big") << 16
        elif kind == 2:
            upper = int.from_bytes(data[4:6], "big") << 4
        elif kind == 1:
            break
        elif kind not in (3, 5):
            raise Refused("image", f"zephyr.hex line {number} has the record type {kind}.")
    return ranges


def runners_yaml(path: Path) -> list[str]:
    """Problems of runners.yaml for the verified runner."""
    import yaml  # noqa: PLC0415

    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    problems: list[str] = []
    if RUNNER not in (data.get("runners") or []):
        problems.append(f"the board does not configure the {RUNNER} runner")
    for argument in (data.get("args") or {}).get(RUNNER) or []:
        if str(argument) not in RUNNER_ARGS:
            problems.append(f"runner argument {str(argument)[:80]} is outside the allowlist")
    for key in (data.get("config") or {}):
        if key not in CONFIG_KEYS:
            problems.append(f"runners.yaml config key {str(key)[:40]} is unknown")
    if (data.get("config") or {}).get("hex_file") not in ("zephyr.hex", None):
        problems.append("runners.yaml names another HEX file than zephyr.hex")
    return problems


def flash(cwd: Path, spelled: Path, raw: str, build_raw: str, alias: str, effect: str, lifecycle: Lifecycle,
          results: str | None) -> int:
    request = load(cwd, spelled, raw)
    builddir.check_owned(request, "build")
    _, build_doc = evidence_run(cwd, build_raw)
    if build_doc.get("kind") != "zephyr-result" or build_doc.get("operation") != "build" or build_doc.get("status") != "pass":
        raise Refused("evidence", "--build must name a passed zephyr build run.")
    if str(Path(build_doc.get("buildDir") or "")).casefold() != str(request.build_dir).casefold():
        raise Refused("evidence", "The build run built another folder than this request's buildDir.")
    expected = next((a for a in build_doc.get("artifacts") or [] if a.get("role") == "hex"), None)
    zephyr_dir = request.build_dir / "zephyr"
    hex_file = zephyr_dir / "zephyr.hex"
    if expected is None or not hex_file.is_file() or sha256(hex_file) != expected.get("sha256"):
        raise Refused("image-changed", "The build folder's zephyr.hex is missing or differs from the build run's HEX.")
    base, size = flash_region(zephyr_dir / "zephyr.dts")
    outside = [(start, end) for start, end in hex_ranges(hex_file) if start < base or end > base + size]
    if outside:
        raise Refused("image", f"zephyr.hex writes 0x{outside[0][0]:08X}, outside the flash region 0x{base:08X}+0x{size:X}.")
    problems = runners_yaml(zephyr_dir / "runners.yaml")
    if problems:
        raise Refused("runner", "; ".join(problems[:6]) + ".")
    probe, registry_sha = registry.read(alias)
    cli = Path(os.environ.get("VERA_PROGRAM_STM32_PROGRAMMER_CLI", ""))
    if not cli.is_file():
        raise Refused("tools", "STM32_Programmer_CLI was not provided (VERA_PROGRAM_STM32_PROGRAMMER_CLI).")
    model.isolate_west_config()
    workspace = model.load(request.workspace, request.manifest)
    # west flash imports zephyr's runners and every module's `runners:` Python: the workspace is checked again here,
    # since it may have changed after the build (spec section 4).
    report = preflight.Report()
    preflight.workspace(report, request, workspace)
    preflight.approve(report, request)
    if report.refusing:
        raise Refused("preflight", f"The preflight refused {len(report.refusing)} finding(s); see detail.",
                      {"findings": [finding.as_json() for finding in report.refusing][:20]})

    run = Run("flash", "hardware")
    run["board"] = build_doc.get("board")
    run["buildDir"] = str(request.build_dir)
    # Outside VERA no approved hash exists and the registry is read unchecked; the result says which it was.
    run["flash"] = {"runner": RUNNER, "probe": {"alias": probe.alias, "resource": probe.resource}, "registrySha256": registry_sha,
                    "registryVerified": bool(os.environ.get("VERA_REGISTRY_SHA256")),
                    "image": {"path": str(hex_file), "sha256": expected["sha256"], "region": [f"0x{base:08X}", size]},
                    "firmwareEffect": effect, "cli": str(cli), "physical": "unchanged"}
    run.create_folder(cwd, spelled, results)
    assert run.folder is not None
    lifecycle.report("flashing", "unknown")
    run["flash"]["physical"] = "unknown"
    env = environment.build(run.folder, workspace.zephyr, offline=True, first=[cli.parent])
    command = [sys.executable, "-m", "west", "flash", "-d", posix(request.build_dir), "-r", RUNNER, "--no-rebuild",
               "--dev-id", probe.serial, "--cli", posix(cli)]
    code, _ = run.step("flash", command, request.workspace, env, lifecycle.stop_requested)
    if lifecycle.stop_requested():
        run.set_status("stopped", "stop-requested", "VERA asked the run to stop; the flash state is unknown.")
    if code != 0:
        run.set_status("fail", "flash-failed", f"west flash exited {code}; the target's flash content is unknown.")
    lifecycle.report("done", "unknown")
    return run.finish({"flash": run["flash"]})


def release(alias: str, lifecycle: Lifecycle) -> int:
    if not registry.ALIAS.fullmatch(alias):
        raise Refused("request", f"--probe {alias[:40]!r} is not a registry alias.")
    lifecycle.report("cleaning", "unknown")
    lifecycle.report("released", "unknown")
    emit({"format": 1, "kind": "zephyr-flash-release", "probe": alias, "physical": "unknown",
          "note": "No process was started and the target was not touched; an interrupted flash leaves its content unknown."})
    return 0


def tools() -> int:
    cli = os.environ.get("VERA_PROGRAM_STM32_PROGRAMMER_CLI")
    emit({"format": 1, "kind": "zephyr-flash-tools", "helper": VERSION, "runner": RUNNER, "runnerArgs": sorted(RUNNER_ARGS),
          "cli": cli, "python": sys.executable})
    return 0


class Parser(argparse.ArgumentParser):
    def error(self, message: str) -> None:  # type: ignore[override]
        raise Refused("usage", message)


def main(argv: list[str] | None = None) -> int:
    operation = "flash"
    lifecycle = Lifecycle()
    try:
        root = Parser(prog="zephyr-flash")
        root.add_argument("--version", action="store_true")
        sub = root.add_subparsers(dest="operation", parser_class=Parser)
        sub.add_parser("tools")
        rel = sub.add_parser("release")
        rel.add_argument("--probe", required=True)
        fl = sub.add_parser("flash")
        fl.add_argument("--request", required=True)
        fl.add_argument("--build", required=True)
        fl.add_argument("--probe", required=True)
        fl.add_argument("--firmware-effect", required=True, choices=["none", "actuates"])
        fl.add_argument("--results-dir")
        args = root.parse_args(argv)
        if args.version:
            print(f"zephyr-flash {VERSION}")
            return 0
        operation = args.operation or "flash"
        if args.operation == "tools":
            return tools()
        if args.operation == "release":
            return release(args.probe, lifecycle)
        if args.operation != "flash":
            raise Refused("usage", "Name an operation: tools, flash, release.")
        spelled = entered_directory()
        return flash(Path(spelled).resolve(), spelled, args.request, args.build, args.probe, args.firmware_effect,
                     lifecycle, args.results_dir)
    except Refused as error:
        return refuse(error, operation)
    except Exception as error:  # noqa: BLE001
        emit({"format": 1, "kind": "zephyr-result", "operation": operation, "status": "error", "code": "internal",
              "reason": f"{type(error).__name__}: {str(error)[:300]}", "trace": traceback.format_exc(limit=6)[-1500:]})
        return 3

