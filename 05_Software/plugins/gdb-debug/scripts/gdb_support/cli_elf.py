"""`gdb-elf`: offline ELF inspection and re-diagnosis of a saved snapshot (spec REQ-DATA-d7da2a71 sections 2 and 6;
REQ-FUNC-0c6807c8, REQ-SEC-e1493c9b, REQ-FUNC-ccbd4442). Starts no process and opens no device."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from . import VERSION, dwarf, elf, faults, symbols
from .errors import Refused
from .report import emit
from .workspace import PathRefused, confined, entered_directory, regular_file, relative

USAGE = "gdb-elf {inspect <elf> | diagnose <run-folder> [--elf <elf>]}"


class _Parser(argparse.ArgumentParser):
    def error(self, message: str) -> None:  # type: ignore[override]
        raise Refused("request", f"{message}. Usage: {USAGE}")


def _parser() -> argparse.ArgumentParser:
    parser = _Parser(prog="gdb-elf", allow_abbrev=False, add_help=False)
    sub = parser.add_subparsers(dest="operation", required=True, parser_class=_Parser)
    inspect = sub.add_parser("inspect", allow_abbrev=False, add_help=False)
    inspect.add_argument("elf")
    diagnose = sub.add_parser("diagnose", allow_abbrev=False, add_help=False)
    diagnose.add_argument("run")
    diagnose.add_argument("--elf")
    return parser


def facts(image: elf.Elf, shown: str, size: int) -> dict[str, Any]:
    """The inspection document of one ELF."""
    attributes = image.arm_attributes()
    debug = dwarf.read(image)
    syms = image.symbols()
    alloc = [section for section in image.sections if section.flags & elf.SHF_ALLOC and section.size]
    out: dict[str, Any] = {
        "format": 1,
        "kind": "elf-inspection",
        "file": {"path": shown, "sha256": image.sha256, "bytes": size},
        "elf": {
            "class": image.bits,
            "endian": image.endian,
            "type": elf.TYPES.get(image.type, f"0x{image.type:x}"),
            "machine": image.machine_name,
            "machineCode": image.machine,
            "entry": f"0x{image.entry:08x}",
            "flags": f"0x{image.flags:08x}",
            "float": elf.float_abi(image, attributes),
        },
        "buildId": image.build_id(),
        "segments": [
            {
                "type": elf.SEGMENT_TYPES.get(segment.type, f"0x{segment.type:x}"),
                "vaddr": f"0x{segment.vaddr:08x}",
                "paddr": f"0x{segment.paddr:08x}",
                "filesz": segment.filesz,
                "memsz": segment.memsz,
                "flags": "".join(flag for bit, flag in ((4, "r"), (2, "w"), (1, "x")) if segment.flags & bit),
            }
            for segment in image.segments[:32]
        ],
        "sections": {"count": len(image.sections), "allocated": [s.name for s in alloc][:32]},
        "symbols": {
            "count": len(syms),
            "functions": sum(1 for s in syms if s.kind == elf.STT_FUNC),
            "objects": sum(1 for s in syms if s.kind == elf.STT_OBJECT),
        },
        "debug": {
            "present": debug.present,
            "sections": debug.sections[:24],
            "compressed": debug.compressed,
            "dwarfVersions": sorted(debug.versions),
            "units": debug.units,
            "producers": debug.producers,
            "optimization": debug.optimization() if debug.present else "unknown",
            "languages": debug.languages,
        },
        "limits": [],
    }
    if image.machine == 40:
        out["arm"] = {
            "cpuName": attributes.get("cpuName"),
            "arch": elf.arm_arch(attributes),
            "profile": attributes.get("profile") or None,
        }
    if not syms:
        out["limits"].append("The ELF has no symbol table (stripped); addresses cannot be named.")
    if not debug.present:
        out["limits"].append("The ELF has no DWARF debug information: no source lines, types or local variables.")
    if debug.unreadable:
        out["limits"].append(debug.unreadable)
    if debug.present and out["debug"]["optimization"] == "unknown":
        out["limits"].append(
            "The producers do not record an -O level (clang records it only with -grecord-command-line); "
            "optimised-out values show up per variable in a snapshot."
        )
    return out


def inspect(cwd: Path, spelled: Path, raw: str) -> int:
    path = _elf_path(cwd, spelled, raw, "inspect")
    try:
        image = elf.read(path)
        document = facts(image, relative(cwd, path), len(image.data))
    except elf.ElfError as error:
        raise Refused("elf", f"{raw[:120]}: {error}") from error
    emit(document)
    return 0


def _elf_path(cwd: Path, spelled: Path, raw: str, option: str) -> Path:
    try:
        return regular_file(cwd, raw, option, spelled)
    except PathRefused as error:
        raise Refused("elf", str(error)) from error


def _hex(value: object) -> int | None:
    try:
        return int(str(value), 16)
    except ValueError:
        return None


def diagnose(cwd: Path, spelled: Path, run: str, raw_elf: str | None) -> int:
    try:
        folder = confined(cwd, run, "diagnose", spelled)
    except PathRefused as error:
        raise Refused("request", str(error)) from error
    try:
        document = json.loads((folder / "result.json").read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise Refused("request", f"{run[:120]} holds no readable gdb-debug result.json.") from error
    if not isinstance(document, dict) or document.get("kind") != "gdb-debug-result" or document.get("format") != 1:
        raise Refused("request", f"{run[:120]}/result.json is not a gdb-debug result.")
    snapshot = document.get("snapshot")
    recorded = document.get("elf") or {}
    probe = document.get("probe") or {}
    if not isinstance(snapshot, dict) or not isinstance(recorded, dict) or not isinstance(probe, dict):
        raise Refused("request", f"{run[:120]} has no snapshot to diagnose.")
    if not isinstance(snapshot.get("registers") or {}, dict) or not isinstance(snapshot.get("fault") or {}, dict):
        raise Refused("request", f"{run[:120]}/result.json has a malformed snapshot.")
    elf_raw = raw_elf or recorded.get("path")
    if not isinstance(elf_raw, str):
        raise Refused("request", "Name the ELF with --elf.")
    path = _elf_path(cwd, spelled, elf_raw, "--elf")
    try:
        image = elf.read(path)
        table = symbols.Symbols(image)
    except elf.ElfError as error:
        raise Refused("elf", f"{elf_raw[:120]}: {error}") from error
    same = image.sha256 == recorded.get("sha256")
    match = recorded.get("match")
    compared = recorded.get("compared")
    partly = match == "unchecked" and isinstance(compared, int) and not isinstance(compared, bool) and compared > 0
    trusted = same and (match == "matched" or partly)
    registers = {
        name: number
        for name, value in (snapshot.get("registers") or {}).items()
        if (number := _hex(value)) is not None
    }
    fault = snapshot.get("fault") or {}
    frame_words = None
    frame = fault.get("frame") if isinstance(fault, dict) else None
    if isinstance(frame, dict):
        words = [_hex(frame.get(key)) for key in ("r0", "r1", "r2", "r3", "r12", "lr", "pc", "xpsr")]
        frame_words = None if None in words else [w for w in words if w is not None]
    scb = snapshot.get("scb")
    try:
        scb_bytes = bytes.fromhex(scb) if isinstance(scb, str) and len(scb) == 128 else None
    except ValueError:
        scb_bytes = None
    model = probe.get("faults") if probe.get("faults") in faults.MODELS else ("v6m" if scb_bytes is None else "v7m")
    decoded = faults.decode(model, registers, scb_bytes, frame_words)
    sites = [symbols.site(table, role, registers.get(name), trusted) for role, name in (("pc", "pc"), ("lr", "lr"))]
    if frame_words:
        sites.append(symbols.site(table, "stacked-pc", frame_words[6], trusted))
        sites.append(symbols.site(table, "stacked-lr", frame_words[5], trusted))
    limits = []
    if not same:
        limits.append("The ELF differs from the one the snapshot recorded (SHA-256); no address is attributed to a symbol.")
    if match == "mismatched":
        limits.append("The snapshot recorded that the ELF did not match the target's flash; no address is attributed.")
    elif match == "unchecked" and partly:
        limits.append("The snapshot compared only part of the ELF with the target's flash; attributions are not fully verified.")
    elif match == "unchecked":
        limits.append("The snapshot could not compare the ELF with the target's flash; no address is attributed.")
    emit(
        {
            "format": 1,
            "kind": "gdb-debug-diagnosis",
            "run": Path(run).as_posix(),
            "elf": {"path": Path(elf_raw).as_posix(), "sha256": image.sha256, "same": same},
            "match": match,
            "fault": decoded,
            "sites": sites,
            "limits": limits + decoded.get("limits", []),
        }
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if argv in (["--version"], ["-V"]):
        print(f"gdb-elf {VERSION}")
        return 0
    if argv in (["--help"], ["-h"]) or not argv:
        print(f"Usage: {USAGE}")
        return 0
    try:
        args = _parser().parse_args(argv)
        spelled = entered_directory()
        cwd = Path(spelled).resolve()
        if args.operation == "inspect":
            return inspect(cwd, spelled, args.elf)
        return diagnose(cwd, spelled, args.run, args.elf)
    except Refused as error:
        emit({"format": 1, "kind": "gdb-elf-refusal", "status": "refused", "problems": [{"code": error.code, "message": error.message}]})
        return 2
