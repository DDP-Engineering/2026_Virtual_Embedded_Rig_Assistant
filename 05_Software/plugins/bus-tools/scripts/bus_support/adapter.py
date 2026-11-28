"""The binary port of a Bus Pirate in BPIO2 mode: one request, one reply, each sent once (spec section 5).

Only the registry entry's `resource` port is ever opened; the terminal port is checked by identity and left closed.
A reply that does not arrive in time is NoReply, bytes that are no BPIO2 frame are NotBpio, a failing port is Lost.
Asynchronous DataResponse frames (UART receive) are kept in `received` and never taken for a reply. A reply that
arrives after its request was given up is discarded before the next request, so it is never taken for that one's.
"""

from __future__ import annotations

import os
import time
from typing import Any

from . import bpio, cobs

FRAME_LIMIT = 64 * 1024
STATUS_TIMEOUT = 2.0
POLL = 0.02
HARDWARE = (5, 6)


class NoReply(Exception):
    pass


class NotBpio(Exception):
    pass


class Lost(Exception):
    pass


class Link:
    def __init__(self, port: str, transcript: list[dict[str, Any]]) -> None:
        import serial  # noqa: PLC0415 - pyserial is needed only once an adapter is opened

        self.serial_module = serial
        self.transcript = transcript
        self.buffer = bytearray()
        self.received: list[tuple[float, bytes]] = []
        self.count = 0
        self.last = 0.0
        self.stale = 0
        self.started = time.monotonic()
        options: dict[str, Any] = {"baudrate": 3_000_000, "timeout": POLL, "write_timeout": 2}
        if os.name != "nt":
            options["exclusive"] = True
        try:
            self.port = serial.Serial(port, **options)
        except (serial.SerialException, OSError, ValueError) as error:
            raise Lost(f"The binary port {port} cannot be opened ({type(error).__name__}: {str(error)[:200]}).") from error

    def close(self) -> None:
        try:
            self.port.close()
        except Exception:  # noqa: BLE001 - closing a lost port must not hide the result
            pass

    def _frames(self, deadline: float) -> Any:
        """Yields decoded frames until `deadline`; raises NotBpio for invalid bytes, Lost when the port fails."""
        while True:
            while 0 in self.buffer:
                end = self.buffer.index(0)
                frame, self.buffer = bytes(self.buffer[:end]), self.buffer[end + 1 :]
                if not frame:
                    continue
                try:
                    yield bpio.parse_response(cobs.decode(frame))
                except ValueError as error:
                    raise NotBpio(f"The port answered bytes that are no BPIO2 frame ({error}); check that it is the binary port, that BPIO2 is the selected binmode and that no other program used it.") from error
            if len(self.buffer) > FRAME_LIMIT:
                raise NotBpio("The adapter answered more than 64 KiB without a frame delimiter.")
            if time.monotonic() >= deadline:
                return
            try:
                chunk = self.port.read(4096)
            except (self.serial_module.SerialException, OSError) as error:
                raise Lost(f"The serial port failed ({type(error).__name__}: {str(error)[:200]}).") from error
            if chunk:
                self.buffer += chunk

    def _keep(self, response: dict[str, Any]) -> bool:
        if response.get("type") == "data" and response.get("isAsync"):
            data = bytes(response.get("data") or b"")
            self.last = time.monotonic()
            self.received.append((self.last - self.started, data))
            self.count += len(data)
            return True
        return False

    def forget(self) -> None:
        """Drops the asynchronous data kept so far (what arrived before a UART exchange began)."""
        self.received, self.count = [], 0

    def _discard_late(self) -> None:
        """Before a request: a reply still on its way to an earlier, given-up request must not answer this one."""
        try:
            waiting = int(getattr(self.port, "in_waiting", 0) or 0)
            if waiting:
                self.buffer += self.port.read(waiting)
            for response in self._frames(0):
                if not self._keep(response):
                    self.stale += 1
        except NotBpio:
            self.buffer.clear()
        except (self.serial_module.SerialException, OSError):
            pass  # the write that follows reports a lost port

    def exchange(self, kind: str, packet: bytes, timeout: float, entry: dict[str, Any] | None = None, kept: bool = True) -> dict[str, Any]:
        """Sends one request once and returns its reply; NoReply when none arrives before `timeout` seconds."""
        line = {"request": kind, **(entry or {})}
        if kept:
            self.transcript.append(line)
        self._discard_late()
        try:
            self.port.write(cobs.encode(packet) + b"\x00")
            flush = getattr(self.port, "flush", None)
            if flush:
                flush()
        except (self.serial_module.SerialException, OSError) as error:
            line["reply"] = "lost"
            raise Lost(f"The serial port failed while sending ({type(error).__name__}: {str(error)[:200]}).") from error
        deadline = time.monotonic() + timeout
        for response in self._frames(deadline):
            if self._keep(response):
                continue
            line["reply"] = response.get("type")
            return response
        line["reply"] = "none"
        raise NoReply(f"The adapter did not answer the {kind} request within {timeout:g} s.")

    def listen(self, seconds: float, limit: int, stop: Any, gap: float | None = None) -> None:
        """Collects asynchronous data for up to `seconds` or `limit` bytes; stops early when `stop()` is true, and
        with `gap` once data arrived and nothing more did for that many seconds."""
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline and self.count < limit:
            if stop() or (gap is not None and self.count and time.monotonic() - self.last > gap):
                return
            for response in self._frames(min(deadline, time.monotonic() + 0.05)):
                self._keep(response)


def status(link: Link) -> dict[str, Any]:
    try:
        response = link.exchange("status", bpio.status_request(), STATUS_TIMEOUT)
    except NoReply as error:
        raise NotBpio(f"The binary port did not answer a BPIO2 status request within {STATUS_TIMEOUT:g} s; select the BPIO2 binmode on the adapter and name its binary port.") from error
    if response.get("type") == "error":
        return {"packetError": response.get("packetError")}
    if response.get("type") != "status":
        raise NotBpio(f"The adapter answered a status request with a {response.get('type')} response.")
    return response


def describe(response: dict[str, Any]) -> dict[str, Any]:
    """The adapter fields of a result from a status response, with the supported verdict (spec section 1)."""
    hardware, protocol, firmware = response.get("hardware") or [0, 0], response.get("protocol") or [0, 0], response.get("firmware") or [0, 0]
    return {
        "hardware": f"{hardware[0]} REV{hardware[1]}",
        "hardwareMajor": hardware[0],
        "firmware": f"{firmware[0]}.{firmware[1]}",
        "gitHash": response.get("gitHash"),
        "firmwareDate": response.get("date"),
        "protocol": f"{protocol[0]}.{protocol[1]}",
        "modes": response.get("modes") or [],
        "mode": response.get("mode"),
        "maxWrite": response.get("maxWrite"),
        "maxRead": response.get("maxRead"),
        "psu": supply(response),
        "pullups": response.get("pullups"),
        "supported": hardware[0] in HARDWARE and protocol[0] == bpio.PROTOCOL_MAJOR,
    }


def pins(response: dict[str, Any]) -> list[dict[str, Any]]:
    """The voltage on each IO pin (adc_mv, IO0 first) with the label the current mode gives it.

    The firmware lists a label for every header pin, the supply pin first and ground last, so ten labels frame
    eight readings; labels are left out when the counts fit neither way, and a pin the mode does not use has none.
    """
    readings = list(response.get("adcMv") or [])
    labels = list(response.get("pinLabels") or [])
    if len(labels) == len(readings) + 2:
        labels = labels[1:-1]
    elif len(labels) != len(readings):
        labels = []
    direction, value = int(response.get("ioDirection") or 0), int(response.get("ioValue") or 0)
    return [
        {
            "pin": f"IO{index}",
            "label": labels[index].strip().strip("-") or None if labels else None,
            "mv": reading,
            "output": bool(direction >> index & 1),
            "high": bool(value >> index & 1),
        }
        for index, reading in enumerate(readings)
    ]


def supply(response: dict[str, Any]) -> dict[str, Any]:
    return {"enabled": bool(response.get("psu")), "setMv": response.get("psuSetMv"), "measuredMv": response.get("psuMeasuredMv"), "measuredMa": response.get("psuMeasuredMa"), "currentError": bool(response.get("psuCurrentError"))}


def state(response: dict[str, Any]) -> dict[str, Any]:
    return {"mode": response.get("mode"), "pullups": bool(response.get("pullups")), "psu": bool(response.get("psu"))}
