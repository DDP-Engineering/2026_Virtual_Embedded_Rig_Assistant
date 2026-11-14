"""The adapter operations of bus-tool (spec REQ-DATA-634d35da section 6).

Order: registry, alias, profile and request checks (nothing opened), both ports by identity, the binary port opened,
one status request and the backend check; then at most one configuration with its read-back, at most one data
request (capture: one optional write, then asynchronous reads) and the declared final state with its read-back.
Nothing is ever repeated: a NACK, a missing reply or a short read ends the operation after the single attempt.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from . import BACKEND, adapter, bpio, ports, registry, workspace
from . import profile as profiles
from .adapter import Link, Lost, NoReply, NotBpio
from .lifecycle import Lifecycle
from .report import Ended, Refused, refused

BUS = ("configure-bus", "read-register", "transfer", "capture")
OPERATIONS = ("identify", "release", *BUS)


@dataclass
class Plan:
    """What an operation will send, settled before any port is opened."""

    write: bytes = b""
    read: int = 0
    device: str | None = None
    register: profiles.Register | None = None
    power: tuple[int, int] | None = None


def _hex_option(value: str | None, option: str) -> bytes:
    if value is None:
        return b""
    if not profiles.HEX.fullmatch(value) or not value:
        raise refused("arguments", f"{option} takes an even number of hex digits without prefix or separators, such as d0 or 9f.")
    return bytes.fromhex(value)


def _power(args: Any, profile: profiles.Profile, entry: registry.Adapter) -> tuple[int, int] | None:
    """The supply request: (mV, mA) only when declared, named with --power and within the bench limits (REQ-SEC-145e1953)."""
    if profile.power["source"] == "external":
        if args.power:
            raise refused("power-not-allowed", "The profile declares an external supply; --power would switch the adapter's supply on.")
        return None
    mv, ma = profile.power["mv"], profile.power["ma"]
    if not args.power:
        raise refused("power-not-allowed", f"The profile powers the circuit from the adapter ({mv} mV, {ma} mA); name --power to switch the supply on on purpose.")
    if entry.max_mv is None or entry.max_ma is None:
        raise refused("power-not-allowed", f"lab/resources.json declares no power limits for {entry.alias}; the adapter's supply stays off.")
    if mv > entry.max_mv or ma > entry.max_ma:
        raise refused("power-not-allowed", f"The profile asks {mv} mV and {ma} mA; {entry.alias} allows at most {entry.max_mv} mV and {entry.max_ma} mA.")
    return mv, ma


def plan(args: Any, profile: profiles.Profile, entry: registry.Adapter) -> Plan:
    """Checks the request against the profile (REQ-SEC-b30461f8, REQ-SEC-a8f13a1a, REQ-SEC-85225742, capture-mode)."""
    result = Plan(power=_power(args, profile, entry))
    if args.operation in ("read-register", "transfer"):
        device = profile.devices.get(args.device)
        if device is None:
            raise refused("register-unknown" if args.operation == "read-register" else "transfer-not-allowed", f"The profile declares no device {args.device}.")
        result.device = device.name
        prefix = bytes([device.address << 1]) if device.address is not None else b""
        if args.operation == "read-register":
            register = device.registers.get(args.register)
            if register is None:
                raise refused("register-unknown", f"The profile declares no register {args.register} on {device.name}; only declared registers are read.")
            if register.access == "read-clears" and not args.clears:
                raise refused("clears-flags", f"Reading {device.name}.{register.name} clears flags on the device; name --clears to read it on purpose.")
            result.register, result.write, result.read = register, prefix + register.write, register.read
        else:
            if not device.raw_transfer:
                raise refused("transfer-not-allowed", f"The profile does not allow raw transfers to {device.name} (rawTransfer); use read-register with a declared register.")
            data = _hex_option(args.write, "--write")
            if not data and not args.read:
                raise refused("arguments", "transfer needs --write, --read or both.")
            result.write, result.read = prefix + data, args.read or 0
    elif args.operation == "capture":
        if profile.mode != "uart":
            raise refused("capture-mode", f"capture records a UART only; for passive {profile.mode} capture and decoding use the sigrok plugin with a logic analyzer.")
        result.write = _hex_option(args.write, "--write")
    if len(result.write) > profile.limits["maxWriteBytes"]:
        raise refused("limit", f"The request writes {len(result.write)} bytes; the profile allows {profile.limits['maxWriteBytes']}.")
    if result.read > profile.limits["maxReadBytes"]:
        raise refused("limit", f"The request reads {result.read} bytes; the profile allows {profile.limits['maxReadBytes']}.")
    return result


class Session:
    """One adapter operation: owns the link, the result fields and the lifecycle reports."""

    def __init__(self, args: Any, document: dict[str, Any], lifecycle: Lifecycle, entry: registry.Adapter, profile: profiles.Profile | None, request: Plan | None) -> None:
        self.args = args
        self.document = document
        self.lifecycle = lifecycle
        self.entry = entry
        self.profile = profile
        self.request = request
        self.transcript: list[dict[str, Any]] = []
        self.link: Link | None = None
        self.lost = False
        self.timeout = (profile.limits["timeoutMs"] / 1000) if profile else adapter.STATUS_TIMEOUT
        self.folder: Path | None = None
        self.cwd: Path | None = None

    # Steps ---------------------------------------------------------------------------------------------------------
    def open(self) -> None:
        ports.check(self.entry.resource, self.entry.terminal, self.entry.identity)
        self.lifecycle.report("start", "unchanged")
        try:
            self.link = Link(self.entry.resource, self.transcript)
            response = adapter.status(self.link)
        except NotBpio as error:
            raise refused("not-bpio2", str(error)) from error
        except Lost as error:
            self.lost = True
            raise Ended("incomplete", "disconnected", str(error)) from error
        if response.get("packetError"):
            raise refused("adapter-unsupported", f"The adapter refused the BPIO2 {bpio.PROTOCOL_MAJOR}.{bpio.MINIMUM_MINOR} request: {str(response['packetError'])[:200]}.")
        described = adapter.describe(response)
        self.document["adapter"].update(described)
        if not described["supported"]:
            raise refused(
                "adapter-unsupported",
                f"The adapter reports hardware {described['hardware']} and BPIO {described['protocol']}; bus-tool supports Bus Pirate hardware 5 and 6 with BPIO 2 only.",
            )
        self.lifecycle.report("identified")

    def _stop(self) -> None:
        if self.lifecycle.stop_requested():
            raise Ended("incomplete", "stopped", "VERA asked the run to stop; no further data request was sent.")

    def _status(self) -> dict[str, Any]:
        assert self.link is not None
        try:
            return adapter.status(self.link)
        except NotBpio as error:
            raise Ended("incomplete", "no-response", str(error)) from error

    def configure(self) -> dict[str, Any]:
        assert self.link is not None and self.profile is not None and self.request is not None
        profile = self.profile
        self._stop()
        self.lifecycle.report("acting", "pending")
        reply = self.link.exchange(
            "configuration",
            bpio.configuration_request(profile.wire_mode, profile.settings(), profile.pullups, self.request.power),
            self.timeout,
            {"mode": profile.wire_mode, "pullups": profile.pullups, "power": self.request.power},
        )
        error = reply.get("error") or reply.get("packetError")
        if reply.get("type") not in ("configuration", "error") or error:
            raise Ended("fail", "config-error", f"The adapter refused the {profile.wire_mode} configuration: {str(error or reply.get('type'))[:200]}.")
        readback = self._status()
        state = adapter.state(readback)
        self.document["configuration"] = {"readBack": state, "maxWrite": readback.get("maxWrite"), "maxRead": readback.get("maxRead"), "psuMeasuredMv": readback.get("psuMeasuredMv")}
        wanted = {"mode": profile.wire_mode, "pullups": profile.pullups, "psu": self.request.power is not None}
        if (state["mode"] or "").casefold() != wanted["mode"].casefold() or state["pullups"] != wanted["pullups"] or state["psu"] != wanted["psu"]:
            raise Ended("fail", "config-mismatch", f"The adapter reports {state} after the configuration, not {wanted}.")
        return readback

    def _limits(self, readback: dict[str, Any]) -> None:
        assert self.request is not None
        for key, size in (("maxWrite", len(self.request.write)), ("maxRead", self.request.read)):
            allowed = readback.get(key) or 0
            if allowed and size > allowed:
                raise Ended("blocked", "limit", f"The request needs {size} bytes; the adapter's {key} in this mode is {allowed}. No data request was sent.")

    def data(self, write: bytes, read: int, framed: bool) -> bytes:
        assert self.link is not None and self.request is not None
        self._stop()
        item: dict[str, Any] = {
            "index": len(self.document.setdefault("transactions", [])),
            "device": self.request.device,
            "register": self.request.register.name if self.request.register else None,
            "write": write.hex(),
            "readRequested": read,
            "read": None,
            "error": None,
        }
        self.document["transactions"].append(item)
        started = time.monotonic()
        try:
            reply = self.link.exchange("data", bpio.data_request(write, read, framed), self.timeout, {"write": write.hex(), "read": read})
        finally:
            item["durationMs"] = round((time.monotonic() - started) * 1000, 1)
        error = reply.get("error") or reply.get("packetError")
        if reply.get("type") not in ("data", "error") or error:
            text = str(error or f"a {reply.get('type')} response")[:200]
            item["error"] = text
            if "nack" in text.casefold():
                raise Ended("fail", "nack", f"The device did not acknowledge ({text}); the request was sent once and not repeated. Check the address, wiring, pull-ups and supply.")
            raise Ended("fail", "adapter-error", f"The adapter reported an error for the transaction: {text}.")
        received = bytes(reply.get("data") or b"")
        item["read"] = received.hex()
        if len(received) != read:
            raise Ended("fail", "count-mismatch", f"The adapter returned {len(received)} bytes; {read} were requested.", requested=read, received=len(received))
        return received

    def finish(self, declared: str) -> None:
        """Applies the final state (release or keep) once and reads it back (REQ-FUNC-d9a201a5)."""
        self.lifecycle.report("cleaning")
        final: dict[str, Any] = {"declared": declared, "state": None, "physical": "unknown"}
        self.document["final"] = final
        if self.link is None or self.lost:
            self.lifecycle.physical = "unknown"
            return
        try:
            if declared == "release":
                reply = self.link.exchange("release", bpio.release_request(), adapter.STATUS_TIMEOUT, {"mode": "HiZ", "pullups": False, "power": None})
                if reply.get("error") or reply.get("packetError"):
                    final["error"] = str(reply.get("error") or reply.get("packetError"))[:200]
            state = adapter.state(adapter.status(self.link))
            final["state"] = state
            if declared == "release":
                confirmed = (state["mode"] or "").casefold() == "hiz" and not state["pullups"] and not state["psu"]
            else:
                assert self.profile is not None and self.request is not None
                confirmed = (state["mode"] or "").casefold() == self.profile.wire_mode.casefold() and state["pullups"] == self.profile.pullups and state["psu"] == (self.request.power is not None)
            final["physical"] = "confirmed" if confirmed else "unknown"
        except (NoReply, NotBpio) as error:
            final["error"] = str(error)[:200]
        except Lost as error:
            self.lost = True
            final["error"] = str(error)[:200]
        self.lifecycle.physical = final["physical"]

    # Operations ----------------------------------------------------------------------------------------------------
    def run(self) -> None:
        operation = self.args.operation
        try:
            self.open()
            if operation == "identify":
                return
            if operation == "release":
                self.lifecycle.report("acting", "pending")
                self.finish("release")
                self._release_verdict()
                return
            self._act()
        finally:
            if self.link is not None:
                self.link.close()
            self.document["requests"] = self.transcript

    def _release_verdict(self) -> None:
        final = self.document["final"]
        if final["physical"] == "confirmed":
            return
        if final["state"] is None:
            raise Ended("incomplete", "no-response", f"The release was not confirmed: {final.get('error', 'no read-back')}.")
        raise Ended("fail", "config-mismatch", f"The adapter reports {final['state']} after the release, not HiZ with pull-ups and supply off.")

    def _act(self) -> None:
        assert self.profile is not None and self.request is not None
        operation = self.args.operation
        ended: Ended | None = None
        declared = self.profile.final
        try:
            readback = self.configure()
            if operation == "configure-bus":
                self.document["final"] = {"declared": "configured", "state": adapter.state(readback), "physical": "confirmed"}
                self.lifecycle.physical = "confirmed"
                return
            self._limits(readback)
            framed = self.profile.mode in ("i2c", "spi")
            if operation == "read-register":
                received = self.data(self.request.write, self.request.read, framed)
                self._compare(received)
            elif operation == "transfer":
                self.data(self.request.write, self.request.read, framed)
            else:
                self._capture()
        except Ended as error:
            ended = error
            if error.problem["code"] == "stopped":
                declared = "release"
        except NoReply as error:
            ended = Ended("incomplete", "no-response", f"{error} It was not repeated.")
        except NotBpio as error:
            ended = Ended("incomplete", "no-response", str(error))
        except Lost as error:
            self.lost = True
            ended = Ended("incomplete", "disconnected", f"{error} Nothing more was sent; the bus state is unknown.")
        if operation != "configure-bus" or ended is not None:
            self.finish(declared)
        if ended is not None:
            raise ended

    def _compare(self, received: bytes) -> None:
        register = self.request.register if self.request else None
        assert register is not None
        expected = register.expect
        self.document["register"] = {
            "device": self.request.device if self.request else None,
            "name": register.name,
            "value": received.hex(),
            "expected": None if expected is None else expected.hex(),
            "matches": None if expected is None else received == expected,
        }
        if expected is None and received and len(set(received)) == 1 and received[0] in (0x00, 0xFF):
            self.document["warnings"].append({"code": "idle-pattern", "message": f"Every byte read is 0x{received[0]:02x}: the device may be absent, unpowered or in another mode."})
        if expected is not None and received != expected:
            raise Ended(
                "fail",
                "unexpected-value",
                f"{register.name} reads {received.hex()}, the profile expects {expected.hex()}; check the SPI mode (cpol/cpha) and bit order, the wiring and the logic voltage. The read was not repeated.",
            )

    def _capture(self) -> None:
        assert self.link is not None and self.profile is not None and self.request is not None
        if self.request.write:
            self.data(self.request.write, 0, framed=False)
        limit = self.profile.limits["maxReadBytes"]
        self.link.listen(float(self.args.duration), limit, self.lifecycle.stop_requested)
        chunks = list(self.link.received)
        data = b"".join(chunk for _, chunk in chunks)
        if len(data) > limit:
            data = data[:limit]
            self.document["warnings"].append({"code": "limit", "message": f"The capture kept the first {limit} bytes (limits.maxReadBytes)."})
        folder, cwd = self.folder, self.cwd
        assert folder is not None and cwd is not None
        (folder / "capture.bin").write_bytes(data)
        rows = ["offsetMs,hex"] + [f"{offset * 1000:.1f},{chunk.hex()}" for offset, chunk in chunks]
        (folder / "capture.csv").write_text("\n".join(rows) + "\n", encoding="utf-8", newline="\n")
        self.document["capture"] = {"bytes": len(data), "chunks": len(chunks), "durationS": self.args.duration, "file": workspace.relative(cwd, folder / "capture.bin"), "csv": workspace.relative(cwd, folder / "capture.csv")}
        if self.lifecycle.stop_requested():
            raise Ended("incomplete", "stopped", "VERA asked the run to stop; the capture ended early.")


def prepare(args: Any, document: dict[str, Any], cwd: Path, spelled: Path) -> tuple[registry.Adapter, profiles.Profile | None, Plan | None]:
    """Every check that needs no port (spec section 6): registry, alias, profile, request."""
    bench = registry.load()
    entry = bench.adapter(args.adapter)
    document["inputs"] = {"registry": {"path": "lab/resources.json", "sha256": bench.sha256}}
    document["adapter"] = {"alias": entry.alias, "backend": BACKEND, "port": entry.resource, "terminal": entry.terminal, "identity": entry.identity}
    if args.operation not in BUS:
        return entry, None, None
    try:
        file = workspace.regular_file(cwd, args.bus, "--bus", spelled)
    except workspace.PathRefused as error:
        raise refused("path", str(error)) from error
    profile = profiles.load(file, workspace.relative(cwd, file))
    document["inputs"]["profile"] = {"path": profile.path, "sha256": profile.sha256}
    document["bus"] = {"profile": profile.name, "mode": profile.mode, **{key: value for key, value in profile.bus.items() if key != "mode"}, "logicMv": profile.logic_mv, "power": profile.power["source"], "final": profile.final}
    return entry, profile, plan(args, profile, entry)


def check_state(lifecycle: Lifecycle, alias: str, operation: str) -> None:
    unknown = lifecycle.unknown(alias)
    if unknown and operation not in ("identify", "release"):
        raise Refused(
            [
                {
                    "code": "state-unknown",
                    "message": f"VERA recorded the physical state of {alias} as unknown since run {unknown.get('runId')} ({unknown.get('reason')}); run release first so a read-back confirms it.",
                }
            ]
        )
