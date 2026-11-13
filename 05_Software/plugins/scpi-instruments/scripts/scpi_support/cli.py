"""`scpi <operation> [options]`: the entry of program `scpi` (spec REQ-DATA-b3e2930f).

Exit codes: 0 pass, 1 fail, 2 refused or blocked before any instrument effect, 3 incomplete or error during I/O.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import signal
import stat
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import VERSION, local
from . import profiles as profile_store
from . import registry as registry_store
from .classes import CLASSES
from .errors import Blocked, Incomplete, Problem, Refused
from .lifecycle import Lifecycle
from .report import Result, emit
from .request import OPERATIONS, Request, parse, validate
from .session import Session, versions
from .waveform import BlockError, SampleFormat, csv_text, samples, series
from .workspace import PathRefused, entered_directory, regular_file

HELP = f"""scpi-instruments {VERSION}: identified bench instruments through PyVISA.

  scpi capabilities (--profile ID | --alias A)
  scpi discover-configured [--list-local]
  scpi identify --instrument A
  scpi read --instrument A [--channel CH]
  scpi capture --instrument A --channel CH
  scpi status --instrument A
  scpi configure --instrument A --set NAME=VALUE [--set ...]
  scpi close --instrument A
  scpi output --instrument A --channel CH --voltage V --current I --hold S
  scpi decode --capture FOLDER

Instrument operations and decode take --results-dir DIR (default embedded-lab-results) and --run-id ID.
Instruments are declared in lab/resources.json ($SCPI_REGISTRY). Operations: {", ".join(OPERATIONS)}.
"""


CHANNEL_NAME = re.compile(r"[A-Za-z0-9_-]{1,16}")
CAPTURE_RECORD = re.compile(r"preamble-[A-Za-z0-9_-]{1,16}\.json")


class Interrupted(BaseException):
    """SIGTERM on Linux: unwinds through the operations' finally blocks (best effort before the kill)."""


def _terminate(_signum: int, _frame: Any) -> None:
    raise Interrupted()


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if argv in (["--version"],):
        print(f"scpi-instruments {VERSION}")
        return 0
    if argv and argv[0] in ("--help", "-h"):
        print(HELP)
        return 0
    if hasattr(signal, "SIGTERM") and os.name != "nt":
        signal.signal(signal.SIGTERM, _terminate)
    try:
        request = parse(argv)
    except Refused as error:
        emit({"format": 1, "kind": "scpi-result", "status": error.status, "problems": [{"code": error.code, "message": error.message}]})
        return error.exit
    if request.operation == "capabilities":
        return capabilities(request)
    if request.operation == "discover-configured":
        return discover(request)
    run_id = request.get("--run-id") or f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{secrets.token_hex(4)}"
    result = Result(request.operation, run_id)
    if request.operation == "decode":
        return decode(request, result)
    return instrument(request, result)


def _registry_input(registry: registry_store.Registry) -> dict[str, str]:
    return {"registry": "lab/resources.json", "sha256": registry.sha256}


def capabilities(request: Request) -> int:
    try:
        entry = None
        if request.get("--alias") is not None:
            entry = registry_store.load().entry(str(request.get("--alias")))
            profile = profile_store.load(entry.profile)
        else:
            profile = profile_store.load(str(request.get("--profile")))
    except Problem as error:
        emit({"format": 1, "kind": "scpi-result", "operation": "capabilities", "status": error.status, "problems": [{"code": error.code, "message": error.message}]})
        return error.exit
    operations = {
        "psu": ["identify", "read", "status", "configure", "close", "output"],
        "dmm": ["identify", "read", "status", "configure", "close"],
        "scope": ["identify", "capture", "status", "configure", "close"],
    }[profile.kind]
    channels = {
        name: {
            "limits": {
                quantity: min([value, *([entry.limits[name][quantity]] if entry and quantity in entry.limits.get(name, {}) else [])])
                for quantity, value in spec["limits"].items()
            }
        }
        for name, spec in profile.channels.items()
    }
    document: dict[str, Any] = {
        "format": 1,
        "kind": "scpi-capabilities",
        "status": "pass",
        "profile": profile.summary(),
        "identity": profile.data["identity"],
        "transport": {key: profile.transport[key] for key in ("timeoutMs",)},
        "operations": operations,
        "channels": channels,
    }
    if profile.kind == "dmm":
        document["functions"] = {spec["name"]: {"unit": spec["unit"], "ranges": spec["ranges"]} for spec in profile.data["functions"].values()}
    if profile.kind == "scope":
        document["settings"] = {"timebase": profile.data["timebase"], "scaleMin": profile.data["scaleMin"]}
    if entry is not None:
        document["alias"] = entry.alias
        document["resource"] = entry.resource
    emit(document)
    return 0


def discover(request: Request) -> int:
    result = Result("discover-configured", None)
    del result.document["runId"]
    try:
        registry = registry_store.load()
    except Problem as error:
        result.fail(error)
        return result.finish(error.exit)
    entries = []
    for entry in registry.entries:
        try:
            summary: dict[str, Any] | None = profile_store.load(entry.profile).summary()
        except Problem as error:
            summary = None
            result.problem(error.code, f"{entry.alias}: {error.message}")
        entries.append({"alias": entry.alias, "kind": "visa", "resource": entry.resource, "serial": entry.serial, "backend": entry.backend, "profile": summary, "note": entry.note})
    result["inputs"] = _registry_input(registry)
    result["entries"] = entries
    if "--list-local" in request.flags:
        # Serial ports (pyserial) and USBTMC devices (pyusb) only: never VISA's resource listing, never the network.
        result["local"] = []
        try:
            result["local"].extend(local.serial_resources())
        except Exception as error:  # noqa: BLE001 - a transport without its driver lists nothing
            result.problem("driver-missing", f"Serial ports cannot be listed: {type(error).__name__}: {error}"[:300])
        try:
            names, notes = local.usb_resources()
            result["local"].extend(names)
            for note in notes:
                result.problem("driver-missing", note)
        except Exception as error:  # noqa: BLE001
            note = local.platform_note()
            result.problem("driver-missing", f"USBTMC devices cannot be listed: {type(error).__name__}: {error}. {note or ''}"[:300])
    return result.finish(0)


def _folder(request: Request, result: Result) -> None:
    cwd = Path(os.path.realpath(os.getcwd()))
    result.create_folder(cwd, entered_directory(), request.get("--results-dir"))


def instrument(request: Request, result: Result) -> int:
    lifecycle = Lifecycle()
    session: Session | None = None
    exit_code = 0
    try:
        registry = registry_store.load()
        entry = registry.entry(str(request.get("--instrument")))
        profile = profile_store.load(entry.profile)
        checked = validate(request, profile, entry)
        result["inputs"] = {**_registry_input(registry), "arguments": [request.operation, *sum(([k, v] for k, v in request.options.items()), [])], "settings": [f"{k}={v}" for k, v in request.settings]}
        result["instrument"] = {"alias": entry.alias, "resource": entry.resource, "backend": entry.backend, "profile": profile.summary()}
        result["tool"].update(versions())
        if request.operation in ("configure", "output") and lifecycle.unknown(entry.alias):
            state = lifecycle.unknown(entry.alias) or {}
            raise Blocked(
                "state-unknown",
                f"The physical state of {entry.alias} is unknown since run {state.get('runId')} ({state.get('reason')}); "
                "run close first so a readback confirms it.",
            )
        _folder(request, result)
        lifecycle.report("start", "unchanged")
        session = Session(entry.resource, entry.backend, profile, lifecycle)
        session.open()
        try:
            identity = session.identify(entry.serial)
        except Blocked as error:
            if session.identity is not None:
                result["instrument"]["identity"] = session.identity.__dict__
                result["instrument"]["matchingProfile"] = profile_store.profile_for(session.identity)
            raise error
        result["instrument"]["identity"] = identity.__dict__
        lifecycle.report("identified")
        if request.operation != "identify":
            operation = CLASSES[profile.kind](session, profile, entry, lifecycle, result, checked)
            getattr(operation, request.operation)()
    except Problem as error:
        result.fail(error)
        exit_code = error.exit
    except Interrupted:
        result.fail(Incomplete("stopped", "VERA ended the run (SIGTERM)."))
        exit_code = 3
    except Exception as error:  # noqa: BLE001 - never a traceback: a diagnosis
        result.fail(Problem("internal", f"Unexpected failure: {type(error).__name__}: {error}"[:300]))
        exit_code = 3
    finally:
        if lifecycle.physical == "pending":
            lifecycle.physical = "unknown"
        if session is not None:
            result["commands"] = session.transcript
            session.close()
        result["lifecycle"] = {"phases": lifecycle.phases + ["released"], "physical": lifecycle.physical, "stopRequested": lifecycle.stopped}
        lifecycle.report("released")
    if result["status"] == "incomplete" and exit_code == 0:
        exit_code = 3
    if result["status"] == "fail" and exit_code == 0:
        exit_code = 1
    return result.finish(exit_code)


def _capture_file(source: Path, name: str, limit: int) -> bytes:
    """A regular file of the capture folder by its exact name (never a link), at most `limit` bytes."""
    path = source / name
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode):
        raise Refused("request", f"{name} in the capture folder is not a regular file.")
    if info.st_size > limit:
        raise Refused("request", f"{name} is larger than {limit} bytes.")
    return path.read_bytes()


def decode(request: Request, result: Result) -> int:
    """Recomputes the series of a capture's run folder from its raw blocks and preambles.

    Every name is derived from a channel name of the safe form, never taken from a preamble as a path, and every
    file is checked before the new run folder is created."""
    exit_code = 0
    try:
        cwd = Path(os.path.realpath(os.getcwd()))
        source = Path(os.path.realpath(regular_file(cwd, str(request.get("--capture")).rstrip("/\\") + "/result.json", "--capture", entered_directory()))).parent
        names = sorted(name for name in os.listdir(source) if CAPTURE_RECORD.fullmatch(name))
        if not names:
            raise Refused("request", "--capture names a folder without preamble-<channel>.json files.")
        computed = []
        for name in names:
            record = json.loads(_capture_file(source, name, 1024 * 1024).decode("utf-8"))
            channel = str(record["channel"])
            if f"preamble-{channel}.json" != name or not CHANNEL_NAME.fullmatch(channel):
                raise Refused("request", f"{name} names another channel.")
            if record["raw"]["file"] != f"raw-{channel}.bin":
                raise Refused("request", f"{name} names a raw file other than raw-{channel}.bin.")
            # No larger than the capturing profile allows: a planted file must not exhaust memory.
            profile = profile_store.load(str(record["profile"]))
            if profile.kind != "scope":
                raise Refused("request", f"{name} names profile {profile.id}, which captures no waveforms.")
            limit = int(profile.data["samples"]["width"]) * int(profile.data["samples"]["maxPoints"])
            data = _capture_file(source, f"raw-{channel}.bin", limit)
            if hashlib.sha256(data).hexdigest() != record["raw"]["sha256"]:
                raise Refused("request", f"raw-{channel}.bin changed since the capture (SHA-256 differs).")
            computed.append((channel, series(samples(data, SampleFormat.of(record["samples"])), record["preamble"])))
        _folder(request, result)
        result["inputs"] = {"capture": Path(os.path.relpath(source, cwd)).as_posix()}
        result["series"] = [
            {"channel": channel, "points": len(points), "unit": "V", "timeUnit": "s", "file": result.write(f"waveform-{channel}.csv", csv_text(points).encode())}
            for channel, points in computed
        ]
    except (PathRefused, BlockError, KeyError, TypeError, ValueError, OSError) as error:
        result.fail(Refused("request", f"The capture cannot be decoded: {error}"[:300]))
        exit_code = 2
    except Problem as error:
        result.fail(error)
        exit_code = error.exit
    return result.finish(exit_code)


if __name__ == "__main__":
    raise SystemExit(main())
