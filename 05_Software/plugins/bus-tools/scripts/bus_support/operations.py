"""The adapter operations of bus-tool (spec REQ-DATA-634d35da section 6).

Order: registry, alias, profile (a file, or the call's own options) and request checks with nothing opened; both
ports by identity, the binary port opened, one status request and the backend check; then one configuration with its
read-back, the steps of the request on the configured bus (register reads and writes, transfers, pauses, an address
scan or a UART capture) and the declared final state with its read-back. A step is sent once: a device that does not
acknowledge, a missing reply or a short read ends the operation there.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from . import BACKEND, adapter, bpio, ports, registry, workspace
from . import profile as profiles
from .adapter import Link, Lost, NoReply, NotBpio
from .lifecycle import Lifecycle
from .report import Ended, refused

BUS = ("scan", "configure-bus", "read-register", "write-register", "transfer", "sequence", "capture")
OPERATIONS = ("identify", "pins", "release", *BUS)
CAPTURE_BYTES = 1024 * 1024
SHOWN = 4000
STEPS = 32
DELAY_MS = 10_000
DELAYS_MS = 60_000
VALUE_BYTES = 64
LOW_MV = 700
REPLY_GAP = 0.3
# The firmware answers every failed transaction with one text; on I2C that is a device that did not acknowledge.
FAILED = "protocol request failed"


@dataclass
class Step:
    """One step on the configured bus: `write` holds the bytes after an I2C address byte."""

    kind: str
    device: profiles.Device | None = None
    register: profiles.Register | None = None
    write: bytes = b""
    read: int = 0
    delay_ms: int = 0


@dataclass
class Plan:
    """What an operation will send, settled before any port is opened."""

    steps: list[Step] = field(default_factory=list)
    write: bytes = b""
    scan: tuple[int, int] | None = None
    power: tuple[int, int] | None = None


def _hex_option(value: str | None, option: str) -> bytes:
    if value is None:
        return b""
    if not profiles.HEX.fullmatch(value) or not value:
        raise refused("arguments", f"{option} takes an even number of hex digits without prefix or separators, such as d0 or 9f.")
    return bytes.fromhex(value)


def _power(args: Any, profile: profiles.Profile, entry: registry.Adapter) -> tuple[int, int] | None:
    """The supply request (mV, mA): --supply, else a profile that powers the circuit from the adapter; kept within
    the bench limits when lab/resources.json declares them (REQ-SEC-145e1953)."""
    if args.supply is not None:
        mv, ma = args.supply, args.supply_ma or 100
    elif profile.power["source"] == "adapter":
        mv, ma = profile.power["mv"], args.supply_ma or profile.power["ma"]
    else:
        return None
    if entry.max_mv is not None and entry.max_ma is not None and (mv > entry.max_mv or ma > entry.max_ma):
        raise refused("power-not-allowed", f"The call asks {mv} mV and {ma} mA; lab/resources.json allows {entry.alias} at most {entry.max_mv} mV and {entry.max_ma} mA.")
    return mv, ma


def _device(args: Any, profile: profiles.Profile, code: str) -> profiles.Device:
    name = getattr(args, "device", None)
    if name:
        device = profile.devices.get(name)
        if device is None:
            raise refused(code, f"The profile declares no device {name}; it declares {', '.join(profile.devices) or 'none'}.")
        return device
    if len(profile.devices) == 1:
        return next(iter(profile.devices.values()))
    if not profile.devices and profile.mode != "i2c":
        return profiles.Device("device", None)
    if not profile.devices:
        raise refused(code, "Name the I2C device: --address 0x76, or a profile that declares it.")
    raise refused(code, f"Name the device with --device: {', '.join(profile.devices)}.")


def _register(device: profiles.Device, name: str) -> profiles.Register:
    register = device.registers.get(name)
    if register is None:
        raise refused("register-unknown", f"The profile declares no register {name} on {device.name}; it declares {', '.join(device.registers) or 'none'}.")
    return register


def _read(device: profiles.Device, name: str, clears: bool) -> Step:
    register = _register(device, name)
    if not register.read:
        raise refused("register-unknown", f"{device.name}.{register.name} declares no bytes to read (read: 0); write it with write-register.")
    if register.access == "read-clears" and not clears:
        raise refused("clears-flags", f"Reading {device.name}.{register.name} clears flags on the device; name --clears to read it on purpose.")
    return Step("read", device, register, register.write, register.read)


def _write(device: profiles.Device, name: str, value: bytes) -> Step:
    register = _register(device, name)
    if not 1 <= len(value) <= VALUE_BYTES:
        raise refused("arguments", f"A register is written with 1 to {VALUE_BYTES} bytes of hex.")
    return Step("write", device, register, register.write + value)


def _steps(args: Any, profile: profiles.Profile) -> list[Step]:
    """The --step texts of sequence: `read [device.]register`, `write [device.]register HEX`, `transfer HEX|- [N]`
    and `delay MS`, run in order on the configured bus."""
    if len(args.step) > STEPS:
        raise refused("arguments", f"sequence takes at most {STEPS} steps.")
    usage = "A step is 'read [device.]register', 'write [device.]register HEX', 'transfer HEX|- [N]' or 'delay MS'"

    def target(text: str) -> tuple[profiles.Device, str]:
        name, dot, register = text.partition(".")
        if not dot:
            return _device(args, profile, "register-unknown"), name
        device = profile.devices.get(name)
        if device is None:
            raise refused("register-unknown", f"The profile declares no device {name}.")
        return device, register

    def number(text: str, low: int, high: int, what: str) -> int:
        if not text.isdecimal() or not low <= int(text) <= high:
            raise refused("arguments", f"{what} takes {low} to {high}.")
        return int(text)

    steps: list[Step] = []
    for text in args.step:
        words = text.split()
        verb = words[0] if words else ""
        if verb == "read" and len(words) == 2:
            device, name = target(words[1])
            steps.append(_read(device, name, args.clears))
        elif verb == "write" and len(words) == 3:
            device, name = target(words[1])
            steps.append(_write(device, name, _hex_option(words[2], "A written value")))
        elif verb == "transfer" and len(words) in (2, 3):
            data = b"" if words[1] == "-" else _hex_option(words[1], "A transfer")
            read = number(words[2], 0, 512, "A transfer's read count") if len(words) == 3 else 0
            if not data and not read:
                raise refused("arguments", f"{usage}; '{text}' sends and reads nothing.")
            steps.append(Step("transfer", _device(args, profile, "device-unknown"), None, data, read))
        elif verb == "delay" and len(words) == 2:
            steps.append(Step("delay", delay_ms=number(words[1], 1, DELAY_MS, "A delay in milliseconds")))
        else:
            raise refused("arguments", f"{usage}; not '{text[:80]}'.")
    if sum(step.delay_ms for step in steps) > DELAYS_MS:
        raise refused("arguments", f"The delays of one sequence add up to at most {DELAYS_MS // 1000} s.")
    return steps


def plan(args: Any, profile: profiles.Profile, entry: registry.Adapter) -> Plan:
    """Checks the request against the profile (REQ-SEC-b30461f8, REQ-SEC-a8f13a1a, REQ-SEC-85225742, capture-mode)."""
    result = Plan(power=_power(args, profile, entry))
    operation = args.operation
    if operation == "scan":
        if profile.mode != "i2c":
            raise refused("scan-mode", f"scan looks for I2C addresses; this bus is {profile.mode}.")
        first, last = profiles.address(args.first), profiles.address(args.last)
        if first is None or last is None or first > last:
            raise refused("arguments", "--from and --to take 7-bit I2C addresses from 0x08 to 0x77, --from not above --to.")
        result.scan = (first, last)
    elif operation == "read-register":
        device = _device(args, profile, "register-unknown")
        names = args.register or [item.name for item in device.registers.values() if item.access == "read" and item.read]
        if not names:
            raise refused("register-unknown", f"The profile declares no register to read on {device.name}.")
        result.steps = [_read(device, name, args.clears) for name in names]
    elif operation == "write-register":
        result.steps = [_write(_device(args, profile, "register-unknown"), args.register, _hex_option(args.value, "--value"))]
    elif operation == "transfer":
        data = _hex_option(args.write, "--write")
        if not data and not args.read:
            raise refused("arguments", "transfer needs --write, --read or both.")
        result.steps = [Step("transfer", _device(args, profile, "device-unknown"), None, data, args.read or 0)]
    elif operation == "sequence":
        result.steps = _steps(args, profile)
    elif operation == "capture":
        if profile.mode != "uart":
            raise refused("capture-mode", f"capture records a UART only; for passive {profile.mode} capture and decoding use the sigrok plugin with a logic analyzer.")
        result.write = _hex_option(args.write, "--write")
    address = 1 if profile.mode == "i2c" else 0
    for size, key in [(len(result.write), "maxWriteBytes")] + [pair for step in result.steps if step.kind != "delay" for pair in ((len(step.write) + address, "maxWriteBytes"), (step.read, "maxReadBytes"))]:
        if size > profile.limits[key]:
            raise refused("limit", f"The request {'writes' if key == 'maxWriteBytes' else 'reads'} {size} bytes in one transaction; the limit is {profile.limits[key]} (limits.{key}).")
    return result


def _text(data: bytes) -> str:
    return data.decode("utf-8", "replace").replace("\r\n", "\n").replace("\r", "\n")


def _shown(text: str) -> dict[str, Any]:
    """All of a short text, else its beginning and end."""
    if len(text) <= SHOWN:
        return {"text": text}
    head, tail = text[:1200], text[-2500:]
    return {"text": f"{head}\n[... {len(text) - len(head) - len(tail)} characters left out, all of them in the capture file ...]\n{tail}"}


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
        self.final = "keep" if getattr(args, "keep", False) else (profile.final if profile else "release")
        self.lines: list[dict[str, Any]] = []
        self.folder: Path | None = None
        self.cwd: Path | None = None

    # Steps ---------------------------------------------------------------------------------------------------------
    def open(self) -> dict[str, Any]:
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
        return response

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
        self.lines = [pin for pin in adapter.pins(readback) if pin["label"]]
        self.document["configuration"] = {"readBack": state, "maxWrite": readback.get("maxWrite"), "maxRead": readback.get("maxRead"), "psuMeasuredMv": readback.get("psuMeasuredMv"), "lines": {pin["label"]: pin["mv"] for pin in self.lines}}
        wanted = {"mode": profile.wire_mode, "pullups": profile.pullups, "psu": self.request.power is not None}
        if (state["mode"] or "").casefold() != wanted["mode"].casefold() or state["pullups"] != wanted["pullups"] or state["psu"] != wanted["psu"]:
            raise Ended("fail", "config-mismatch", f"The adapter reports {state} after the configuration, not {wanted}.")
        low = self._low()
        if low:
            self.document["warnings"].append({"code": "line-low", "message": f"{low} An idle I2C line reads high: check the pull-ups, the wiring and the circuit's supply."})
        return readback

    def _low(self) -> str:
        """The I2C lines that read low right after the configuration, as a sentence; empty when none does."""
        if self.profile is None or self.profile.mode != "i2c":
            return ""
        low = [f"{pin['label']} ({pin['pin']}) reads {pin['mv'] / 1000:.2f} V" for pin in self.lines if pin["label"].upper() in ("SDA", "SCL") and pin["mv"] < LOW_MV]
        return (" and ".join(low) + ".") if low else ""

    def _limits(self, readback: dict[str, Any]) -> None:
        assert self.request is not None and self.profile is not None
        address = 1 if self.profile.mode == "i2c" else 0
        writes = [len(self.request.write)] + [len(step.write) + address for step in self.request.steps]
        for key, size in (("maxWrite", max(writes)), ("maxRead", max([step.read for step in self.request.steps] or [0]))):
            allowed = readback.get(key) or 0
            if allowed and size > allowed:
                raise Ended("blocked", "limit", f"The request needs {size} bytes; the adapter's {key} in this mode is {allowed}. No data request was sent.")

    def _request(self, write: bytes, read: int, framed: bool, kept: bool = True) -> tuple[bytes, str | None]:
        """One data request, sent once: the bytes read, or the adapter's error text."""
        assert self.link is not None
        reply = self.link.exchange("data", bpio.data_request(write, read, framed), self.timeout, {"write": write.hex(), "read": read}, kept)
        error = reply.get("error") or reply.get("packetError")
        if reply.get("type") not in ("data", "error") or error:
            return b"", str(error or f"a {reply.get('type')} response")[:200]
        return bytes(reply.get("data") or b""), None

    def _unacknowledged(self, text: str) -> bool:
        return self.profile is not None and self.profile.mode == "i2c" and ("nack" in text.casefold() or FAILED in text.casefold())

    def _failure(self, step: Step, text: str) -> Ended:
        if self._unacknowledged(text):
            named = step.device is not None and self.profile is not None and self.profile.path != profiles.OPTIONS
            where = f"{step.device.name if named else 'The device'} at 0x{step.device.address:02x}" if step.device and step.device.address is not None else "The device"
            low = self._low()
            return Ended(
                "fail",
                "nack",
                f"{where} did not acknowledge (the adapter reports: {text}); the transaction was sent once. {low + ' ' if low else ''}Check the address, the wiring, the pull-ups and the device's supply; scan lists the addresses that answer.",
            )
        return Ended("fail", "adapter-error", f"The adapter reported an error for the transaction: {text}.")

    def transact(self, step: Step) -> bytes:
        """One read, write or transfer step as one transaction, recorded in `transactions`."""
        assert self.link is not None and self.profile is not None
        self._stop()
        prefix = bytes([step.device.address << 1]) if step.device and step.device.address is not None else b""
        write = prefix + step.write
        item: dict[str, Any] = {
            "index": len(self.document.setdefault("transactions", [])),
            "step": step.kind,
            "device": step.device.name if step.device else None,
            "register": step.register.name if step.register else None,
            "write": write.hex(),
            "readRequested": step.read,
            "read": None,
            "error": None,
        }
        self.document["transactions"].append(item)
        started = time.perf_counter()
        try:
            if self.profile.mode == "uart":
                return self._uart(step, item)
            received, error = self._request(write, step.read, framed=True)
        finally:
            item["durationMs"] = round((time.perf_counter() - started) * 1000, 1)
        if error is not None:
            item["error"] = error
            raise self._failure(step, error)
        item["read"] = received.hex()
        if len(received) != step.read:
            raise Ended("fail", "count-mismatch", f"The adapter returned {len(received)} bytes; {step.read} were requested.", requested=step.read, received=len(received))
        return received

    def _uart(self, step: Step, item: dict[str, Any]) -> bytes:
        """Writes, then takes what the UART receives until the bytes asked for arrived, the line fell silent or the
        timeout passed. The adapter passes received bytes on by itself; a read it is asked for loses all of them
        when one is late."""
        assert self.link is not None
        self.link.forget()
        if step.write:
            _, error = self._request(step.write, 0, framed=False)
            if error is not None:
                item["error"] = error
                raise self._failure(step, error)
        if not step.read:
            item["read"] = ""
            return b""
        self.link.listen(self.timeout, step.read, self.lifecycle.stop_requested, REPLY_GAP)
        received = b"".join(chunk for _, chunk in self.link.received)[: step.read]
        item["read"], item["text"] = received.hex(), _text(received)
        if not received:
            raise Ended("fail", "no-response", f"No byte arrived on the UART within {self.timeout:g} s. Check the baud rate, that RX and TX are crossed and the common ground.")
        if len(received) < step.read:
            self.document["warnings"].append({"code": "short-read", "message": f"{len(received)} of the {step.read} bytes asked for arrived before the line fell silent."})
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
            response = self.open()
            if operation == "identify":
                return
            if operation == "pins":
                self.document.update({"mode": response.get("mode"), "pullups": bool(response.get("pullups")), "supply": adapter.supply(response), "pins": adapter.pins(response)})
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
                if self.link.stale:
                    self.document["warnings"].append({"code": "late-reply", "message": f"{self.link.stale} late answers to earlier requests were discarded."})
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
        declared = self.final
        try:
            readback = self.configure()
            if operation == "configure-bus":
                self.document["final"] = {"declared": "configured", "state": adapter.state(readback), "physical": "confirmed"}
                self.lifecycle.physical = "confirmed"
                return
            self._limits(readback)
            if operation == "scan":
                self._scan()
            elif operation == "capture":
                self._capture()
            else:
                for step in self.request.steps:
                    self._step(step)
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

    def _step(self, step: Step) -> None:
        if step.kind == "delay":
            if self.lifecycle.wait(step.delay_ms / 1000):
                self._stop()
            return
        received = self.transact(step)
        if step.kind == "read":
            self._compare(step, received)

    def _compare(self, step: Step, received: bytes) -> None:
        register, device = step.register, step.device
        assert register is not None and device is not None
        expected = register.expect
        self.document.setdefault("registers", []).append(
            {
                "device": device.name,
                "name": register.name,
                "value": received.hex(),
                "expected": None if expected is None else expected.hex(),
                "matches": None if expected is None else received == expected,
            }
        )
        if expected is None and len(received) > 1 and len(set(received)) == 1 and received[0] in (0x00, 0xFF):
            self.document["warnings"].append({"code": "idle-pattern", "message": f"Every byte of {register.name} is 0x{received[0]:02x}: the device may be absent, unpowered or in another mode."})
        if expected is not None and received != expected:
            raise Ended(
                "fail",
                "unexpected-value",
                f"{register.name} reads {received.hex()}, the profile expects {expected.hex()}; check the SPI mode (cpol/cpha) and bit order, the wiring and the logic voltage. The read was not repeated.",
            )

    def _scan(self) -> None:
        """One empty write to each address: an address that acknowledges holds a device."""
        assert self.profile is not None and self.request is not None and self.request.scan is not None
        first, last = self.request.scan
        names = {device.address: device.name for device in self.profile.devices.values()}
        found: list[int] = []
        scan: dict[str, Any] = {"from": f"0x{first:02x}", "to": f"0x{last:02x}", "probed": 0, "found": []}
        self.document["scan"] = scan
        line = {"request": "data", "probes": 0, "reply": "scan"}
        self.transcript.append(line)
        for number in range(first, last + 1):
            self._stop()
            _, error = self._request(bytes([number << 1]), 0, framed=True, kept=False)
            scan["probed"] = line["probes"] = scan["probed"] + 1
            if error is None:
                found.append(number)
                scan["found"].append({"address": f"0x{number:02x}", "device": names.get(number)})
            elif not self._unacknowledged(error):
                raise Ended("fail", "adapter-error", f"The adapter reported an error for the probe of 0x{number:02x}: {error}.")
        if not found:
            self.document["warnings"].append({"code": "no-device", "message": f"No address from {scan['from']} to {scan['to']} acknowledged. {self._low() or 'Check the wiring, the pull-ups and the supply of the circuit.'}"})
        elif scan["probed"] >= 16 and len(found) == scan["probed"]:
            self.document["warnings"].append({"code": "all-acknowledged", "message": "Every address acknowledged, which no real bus does: SDA is probably held low."})

    def _capture(self) -> None:
        assert self.link is not None and self.profile is not None and self.request is not None
        if self.request.write:
            _, error = self._request(self.request.write, 0, framed=False)
            if error is not None:
                raise Ended("fail", "adapter-error", f"The adapter reported an error for the write: {error}.")
        self.link.listen(float(self.args.duration), CAPTURE_BYTES, self.lifecycle.stop_requested)
        chunks = list(self.link.received)
        data = b"".join(chunk for _, chunk in chunks)
        if len(data) > CAPTURE_BYTES:
            data = data[:CAPTURE_BYTES]
        if len(data) == CAPTURE_BYTES:
            self.document["warnings"].append({"code": "limit", "message": "The capture ended at 1 MiB."})
        folder, cwd = self.folder, self.cwd
        assert folder is not None and cwd is not None
        text = _text(data)
        (folder / "capture.bin").write_bytes(data)
        (folder / "capture.txt").write_text(text, encoding="utf-8", newline="\n")
        rows = ["offsetMs,hex"] + [f"{offset * 1000:.1f},{chunk.hex()}" for offset, chunk in chunks]
        (folder / "capture.csv").write_text("\n".join(rows) + "\n", encoding="utf-8", newline="\n")
        self.document["capture"] = {
            "bytes": len(data),
            "chunks": len(chunks),
            "durationS": self.args.duration,
            "file": workspace.relative(cwd, folder / "capture.bin"),
            "textFile": workspace.relative(cwd, folder / "capture.txt"),
            "csv": workspace.relative(cwd, folder / "capture.csv"),
            **_shown(text),
        }
        if not data:
            self.document["warnings"].append({"code": "nothing-received", "message": "No byte arrived. Check the baud rate, that the adapter's RX is on the circuit's TX and the common ground."})
        if self.lifecycle.stop_requested():
            raise Ended("incomplete", "stopped", "VERA asked the run to stop; the capture ended early.")


def _profile(args: Any, document: dict[str, Any], cwd: Path, spelled: Path) -> profiles.Profile:
    """The bus of a call: the profile file --bus names, or the mode's defaults with the call's own options."""
    options = [name for name in ("mode", "address", "speed", "spi_mode", "pullups") if getattr(args, name, None) is not None]
    if args.bus:
        if options:
            raise refused("arguments", "--bus names a profile; --mode, --address, --speed, --spi-mode and --pullups describe a bus without one. Use one or the other.")
        try:
            file = workspace.regular_file(cwd, args.bus, "--bus", spelled)
        except workspace.PathRefused as error:
            raise refused("path", str(error)) from error
        profile = profiles.load(file, workspace.relative(cwd, file))
        document["inputs"]["profile"] = {"path": profile.path, "sha256": profile.sha256}
        return profile
    address = getattr(args, "address", None)
    mode = getattr(args, "mode", None) or ("i2c" if address or args.operation == "scan" else None)
    if mode is None:
        raise refused("arguments", "Name the bus: --bus PROFILE, or --mode i2c, spi or uart (--address 0x76 alone means I2C).")
    if address is not None and (mode != "i2c" or profiles.address(address) is None):
        raise refused("arguments", "--address takes a 7-bit I2C address from 0x08 to 0x77, such as 0x76, on an I2C bus.")
    if getattr(args, "spi_mode", None) is not None and mode != "spi":
        raise refused("arguments", "--spi-mode is used with --mode spi.")
    return profiles.from_options(mode, address, getattr(args, "speed", None), getattr(args, "spi_mode", None), getattr(args, "pullups", None))


def prepare(args: Any, document: dict[str, Any], cwd: Path, spelled: Path) -> tuple[registry.Adapter, profiles.Profile | None, Plan | None]:
    """Every check that needs no port (spec section 6): registry, alias, profile, request."""
    bench = registry.load()
    entry = bench.adapter(args.adapter)
    document["inputs"] = {"registry": {"path": "lab/resources.json", "sha256": bench.sha256}}
    document["adapter"] = {"alias": entry.alias, "backend": BACKEND, "port": entry.resource, "terminal": entry.terminal, "identity": entry.identity}
    if args.operation not in BUS:
        return entry, None, None
    profile = _profile(args, document, cwd, spelled)
    request = plan(args, profile, entry)
    document["bus"] = {
        "profile": profile.name,
        "mode": profile.mode,
        **{key: value for key, value in profile.bus.items() if key != "mode"},
        "logicMv": profile.logic_mv,
        "power": "external" if request.power is None else {"mv": request.power[0], "ma": request.power[1]},
        "final": "keep" if args.keep else profile.final,
    }
    return entry, profile, request
