"""A fake PyVISA for the offline tests of scpi-instruments. It never touches hardware and proves nothing about a real
instrument: it simulates a Rigol DP832, a Rigol DS1104Z and a Keysight 34461A from $FAKE_VISA_BENCH, keeps their
state across processes in $FAKE_VISA_STATE and appends every open, close, write and query to $FAKE_VISA_LOG.

Faults per resource (`faults` in the bench file): absent, driverMissing, timeoutOn (substring), hangOn (substring,
once), exitOn (substring: the command takes effect, then the process dies, once), dropAfter (commands, once),
ignoreOff, truncate, oversize, overload, shortPoints.
"""

from __future__ import annotations

import json
import math
import os
import re
import time

from . import constants, errors  # noqa: F401
from .errors import VisaIOError

__version__ = "1.16.2+fake"
TIMEOUT = -1073807339
NOT_FOUND = -1073807343
CONNECTION_LOST = -1073807194


def _bench() -> dict:
    with open(os.environ["FAKE_VISA_BENCH"], encoding="utf-8") as handle:
        return json.load(handle)


def _log(line: str) -> None:
    path = os.environ.get("FAKE_VISA_LOG")
    if path:
        with open(path, "a", encoding="utf-8", newline="\n") as handle:
            handle.write(line + "\n")


def _load_state() -> dict:
    path = os.environ.get("FAKE_VISA_STATE")
    if not path or not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def _save_state(state: dict) -> None:
    path = os.environ.get("FAKE_VISA_STATE")
    if path:
        with open(path + ".tmp", "w", encoding="utf-8") as handle:
            json.dump(state, handle)
        os.replace(path + ".tmp", path)


class ResourceManager:
    def __init__(self, backend: str = "") -> None:
        bench = _bench()
        if bench.get("noBackend"):
            raise ValueError("Could not locate a VISA implementation. Install either the IVI binary or pyvisa-py.")
        self.backend = backend
        _log(f"RM {backend}")

    def list_resources(self, query: str = "?*::INSTR") -> tuple[str, ...]:
        _log(f"LIST {query}")
        prefix = query.split("?")[0]
        return tuple(name for name in _bench()["resources"] if name.upper().startswith(prefix.upper()))

    def open_resource(self, name: str, **options: object) -> Instrument:
        spec = _bench()["resources"].get(name)
        faults = (spec or {}).get("faults", {})
        if spec is None or faults.get("absent"):
            _log(f"OPENFAIL {name}")
            raise VisaIOError(NOT_FOUND)
        if faults.get("driverMissing"):
            _log(f"OPENFAIL {name}")
            raise ValueError("Please install PyUSB to use this resource type. No module named 'usb'")
        _log(f"OPEN {name}")
        return Instrument(name, spec, options)

    def close(self) -> None:
        _log("RMCLOSE")


class Instrument:
    def __init__(self, name: str, spec: dict, options: dict) -> None:
        self.name = name
        self.spec = spec
        self.faults = spec.get("faults", {})
        self.options = options
        self.buffer = bytearray()
        self.count = 0

    # --- transport ---
    def write(self, command: str) -> None:
        _log(f"W {command}")
        self._fault(command)
        reply = self._handle(command)
        if reply is not None:
            self.buffer += reply if isinstance(reply, bytes) else (reply + "\n").encode()

    def read(self) -> str:
        index = self.buffer.find(b"\n")
        if index < 0:
            self.buffer.clear()
            raise VisaIOError(TIMEOUT)
        line = bytes(self.buffer[:index]).decode()
        del self.buffer[: index + 1]
        return line

    def query(self, command: str) -> str:
        self.write(command)
        return self.read()

    def read_bytes(self, count: int, break_on_termchar: bool = False) -> bytes:
        if len(self.buffer) < count:
            self.buffer.clear()
            raise VisaIOError(TIMEOUT)
        data = bytes(self.buffer[:count])
        del self.buffer[:count]
        return data

    def close(self) -> None:
        _log(f"CLOSE {self.name}")

    # --- faults ---
    def _fault(self, command: str) -> None:
        self.count += 1
        state = _load_state()
        flags = state.setdefault("_faults", {}).setdefault(self.name, {})
        hang = self.faults.get("hangOn")
        if hang and hang in command and not flags.get("hung"):
            flags["hung"] = True
            _save_state(state)
            time.sleep(600)
        crash = self.faults.get("exitOn")
        if crash and crash in command and not flags.get("crashed"):
            flags["crashed"] = True
            _save_state(state)
            _log(f"W {command}")
            reply = self._handle(command)
            del reply
            os._exit(9)
        drop = self.faults.get("dropAfter")
        if drop and self.count > drop and not flags.get("dropped"):
            flags["dropped"] = True
            _save_state(state)
            raise VisaIOError(CONNECTION_LOST)

    # --- simulated instruments ---
    def _handle(self, command: str) -> str | bytes | None:
        timeout = self.faults.get("timeoutOn")
        if timeout and timeout in command:
            return None
        if command == "*IDN?":
            return self.spec["idn"]
        model = self.spec["model"]
        state = _load_state()
        device = state.setdefault(self.name, {})
        reply = getattr(self, f"_{model}")(command, device)
        _save_state(state)
        return reply

    def _dp832(self, command: str, device: dict) -> str | None:
        channels = device.setdefault("channels", {str(n): {"v": 0.0, "i": 0.1, "on": False} for n in (1, 2, 3)})
        if match := re.fullmatch(r":SOUR(\d):VOLT (\S+)", command):
            channels[match[1]]["v"] = float(match[2])
        elif match := re.fullmatch(r":SOUR(\d):CURR (\S+)", command):
            channels[match[1]]["i"] = float(match[2])
        elif match := re.fullmatch(r":SOUR(\d):VOLT\?", command):
            return f"{channels[match[1]]['v']:.3f}"
        elif match := re.fullmatch(r":SOUR(\d):CURR\?", command):
            return f"{channels[match[1]]['i']:.4f}"
        elif match := re.fullmatch(r":OUTP CH(\d),(ON|OFF)", command):
            if match[2] == "ON" or not self.faults.get("ignoreOff"):
                channels[match[1]]["on"] = match[2] == "ON"
        elif match := re.fullmatch(r":OUTP\? CH(\d)", command):
            return "ON" if channels[match[1]]["on"] else "OFF"
        elif match := re.fullmatch(r":MEAS:VOLT\? CH(\d)", command):
            channel = channels[match[1]]
            return f"{channel['v'] if channel['on'] else 0.0:.3f}"
        elif match := re.fullmatch(r":MEAS:CURR\? CH(\d)", command):
            return f"{0.0123 if channels[match[1]]['on'] else 0.0:.4f}"
        else:
            device.setdefault("errors", []).append(command)
        return None

    def _34461a(self, command: str, device: dict) -> str | None:
        device.setdefault("function", "VOLT")
        ranges = device.setdefault("ranges", {})
        auto = device.setdefault("auto", {})
        if command == "FUNC?":
            return f'"{device["function"]}"'
        if command == "READ?":
            if self.faults.get("overload"):
                return "+9.90000000E+37"
            return {"VOLT": "+1.23456700E+00", "RES": "+4.70120000E+03"}.get(device["function"], "+1.00000000E-03")
        if match := re.fullmatch(r'FUNC "([A-Z:]+)"', command):
            device["function"] = match[1]
        elif match := re.fullmatch(r"([A-Z:]+):RANG:AUTO ON", command):
            auto[match[1]] = True
        elif match := re.fullmatch(r"([A-Z:]+):RANG:AUTO\?", command):
            return "1" if auto.get(match[1], True) else "0"
        elif match := re.fullmatch(r"([A-Z:]+):RANG (\S+)", command):
            ranges[match[1]] = float(match[2])
            auto[match[1]] = False
        elif match := re.fullmatch(r"([A-Z:]+):RANG\?", command):
            return f"{ranges.get(match[1], 10.0):+.8E}"
        else:
            device.setdefault("errors", []).append(command)
        return None

    def _ds1104z(self, command: str, device: dict) -> str | bytes | None:
        points = 1200
        if command == ":WAV:PRE?":
            shown = self.faults.get("shortPoints", points)
            return f"0,0,{shown},1,1.000000e-06,-6.000000e-04,0,4.000000e-02,0,127"
        if command == ":WAV:DATA?":
            raw = bytes([127 + round(50 * math.sin(2 * math.pi * i / 100)) for i in range(points)])
            raw = bytes([255, 0]) + raw[2:]
            header = f"#9{points:09d}".encode()
            if self.faults.get("truncate"):
                return header + raw[: points // 2]
            if self.faults.get("oversize"):
                return f"#9{2 * points:09d}".encode() + raw + raw + b"\n"
            return header + raw + b"\n"
        if command in (":WAV:MODE NORM", ":WAV:FORM BYTE") or command.startswith(":WAV:SOUR "):
            device.setdefault("transfer", []).append(command)
            return None
        if command == ":TIM:MAIN:SCAL?":
            return f"{device.get('timebase', 1e-4):.6e}"
        if command == ":TRIG:STAT?":
            return "STOP"
        if match := re.fullmatch(r":TIM:MAIN:SCAL (\S+)", command):
            device["timebase"] = float(match[1])
            return None
        if match := re.fullmatch(r":(CHAN\d):(SCAL|OFFS|PROB|BWL|DISP)(\?| \S+)", command):
            channel = device.setdefault(match[1], {"SCAL": 1.0, "OFFS": 0.0, "PROB": 10.0, "BWL": "OFF", "DISP": "1" if match[1] != "CHAN4" else "0"})
            if match[3] == "?":
                value = channel[match[2]]
                return f"{value:.6e}" if isinstance(value, float) else str(value)
            channel[match[2]] = float(match[3].strip())
            return None
        device.setdefault("errors", []).append(command)
        return None
