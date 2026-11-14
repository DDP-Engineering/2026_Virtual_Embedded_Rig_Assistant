"""A stand-in for the Renode 1.17.0 engine in the renode plugin tests (LAB-06). Never evidence of the real engine.

It speaks the console protocol renode-sim uses (one command per line on stdin, the answer and a `(<machine>) ` prompt
on stdout), implements the monitor commands renode-sim sends, and models the fixture firmware of
`firmware/demo.c` from the strings in the loaded ELF: banner and version at boot, a TICK line every 100 ms of virtual
time, BUTTON lines and the LED following the user button, ECHO lines for received text, and for the DAC variant one
access to a non-existing peripheral in the log file. The build is recognised by its hash (`firmware/variants.json`). Virtual time advances only with `emulation RunFor`.

renode-sim passes the engine only system variables, so the stand-in reads its test settings from the JSON file
FAKE_RENODE_CONFIG names (set by the launcher make_engine.py builds, `fake.json` beside it): `calls` (a file that gets
one JSON line per start and command) and `scenario`, an object with optional keys `version` (the --version text), `hangAt` (virtual seconds after which RunFor never returns),
`crashAt` (virtual seconds after which the process exits 3), `badVersionCommand` (answer of `--version` lacks a
version), `ignoreQuit` (quit does nothing, the helper must kill), `spawnChild` (start a child process that sleeps).
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import struct
import subprocess
import sys
import time


def _config() -> dict:
    try:
        with open(os.environ.get("FAKE_RENODE_CONFIG", ""), encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return {}


CONFIG = _config()
SCENARIO = CONFIG.get("scenario") or {}
CALLS = CONFIG.get("calls")
with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "firmware", "variants.json"), encoding="utf-8") as _handle:
    VARIANTS: dict[str, str] = json.load(_handle)


def record(entry: dict) -> None:
    if CALLS:
        with open(CALLS, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry) + "\n")


def vector(elf: bytes) -> tuple[int, int]:
    """Initial SP and reset vector of the first loadable segment at 0x08000000 (ELF32 little-endian)."""
    phoff, = struct.unpack_from("<I", elf, 28)
    phentsize, phnum = struct.unpack_from("<HH", elf, 42)
    for index in range(phnum):
        ptype, offset, _vaddr, paddr, filesz = struct.unpack_from("<IIIII", elf, phoff + index * phentsize)
        if ptype == 1 and paddr == 0x08000000 and filesz >= 8:
            return struct.unpack_from("<II", elf, offset)
    return 0, 0


def parse_span(text: str) -> float:
    match = re.fullmatch(r"(\d+):(\d+):(\d+(?:\.\d+)?)", text)
    if not match:
        raise ValueError(text)
    return int(match.group(1)) * 3600 + int(match.group(2)) * 60 + float(match.group(3))


class Board:
    def __init__(self) -> None:
        self.machine: str | None = None
        self.elf = b""
        self.uart_file: str | None = None
        self.log_file: str | None = None
        self.virtual = 0.0
        self.booted = False
        self.button = False
        self.led = False
        self.reported_button = False
        self.ticks = 0
        self.rx = ""
        self.dac_logged = False
        self.started = False

    @property
    def variant(self) -> str:
        """The fixture build's behavior, by its SHA-256 (firmware/variants.json); unknown firmware stays silent."""
        return VARIANTS.get(hashlib.sha256(self.elf).hexdigest(), "silent")

    def uart(self, text: str) -> None:
        if self.uart_file:
            with open(self.uart_file, "a", encoding="utf-8", newline="") as handle:
                handle.write(text + "\r\n")

    def log(self, text: str, level: str = "WARNING") -> None:
        if self.log_file:
            with open(self.log_file, "a", encoding="utf-8", newline="\n") as handle:
                handle.write(f"[13:00:00.0000]  [{level}] {text}\n")

    def run_for(self, seconds: float) -> None:
        end = self.virtual + seconds
        if "hangAt" in SCENARIO and end > SCENARIO["hangAt"]:
            while True:
                time.sleep(1)
        if "crashAt" in SCENARIO and end > SCENARIO["crashAt"]:
            sys.exit(3)
        variant = self.variant
        if not self.started:
            self.started = True
            sp, reset = vector(self.elf)
            if SCENARIO.get("badInitial"):
                sp = 0x20001000
            if not SCENARIO.get("noInitial"):
                self.log(f"cpu: Setting initial values: PC = 0x{reset & ~1:X}, SP = 0x{sp:X}.", "INFO")
            if SCENARIO.get("logError"):
                self.log("cpu: CPU abort detected, halting.", "ERROR")
        if variant != "silent":
            if not self.booted:
                self.booted = True
                self.uart("VERA-FW renode-demo")
                self.uart("version 9.9.9" if variant == "wrong-version" else "version 1.2.3")
                if variant == "unmodeled":
                    self.log("sysbus: [cpu: 0x80001c4] WriteDoubleWord to non existing peripheral at 0x40007400, value 0x1.")
                    self.uart("dac on")
            while int(round(end * 10, 6)) > self.ticks:
                self.ticks += 1
                self.uart(f"TICK {self.ticks}")
            if self.button != self.reported_button:
                self.reported_button = self.button
                self.led = self.button
                self.uart("BUTTON 1" if self.button else "BUTTON 0")
        self.virtual = end

    def write_char(self, value: int) -> None:
        if self.variant == "silent":
            return
        char = chr(value)
        if char in "\r\n":
            if self.rx:
                self.uart(f"ECHO {self.rx}")
                self.rx = ""
        else:
            self.rx += char


def main() -> int:
    args = sys.argv[1:]
    record({"argv": args})
    if args == ["--version"]:
        if SCENARIO.get("badVersionCommand"):
            print("something else")
        else:
            print(SCENARIO.get("version", "Renode v1.17.0.0 (fake stand-in for tests)"))
        return 0
    if args[:5] != ["--disable-gui", "--console", "--plain", "--hide-log", "--config"] or len(args) != 6:
        print(f"fake renode: unexpected options {args}", file=sys.stderr)
        return 9
    if SCENARIO.get("spawnChild"):
        child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(600)"])
        record({"child": child.pid})
    record({"pid": os.getpid()})
    board = Board()
    prompt = "(monitor) "
    sys.stdout.write("Renode, version 1.17.0.0 (fake)\n" + prompt)
    sys.stdout.flush()
    for raw in sys.stdin:
        line = raw.rstrip("\r\n")
        record({"command": line})
        answer = ""
        try:
            if line == "quit":
                if SCENARIO.get("ignoreQuit"):
                    continue
                return 0
            if match := re.fullmatch(r"logFile @(\S+) true", line):
                board.log_file = match.group(1)
                open(board.log_file, "a").close()
            elif line == "using sysbus":
                pass
            elif match := re.fullmatch(r'mach create "([A-Za-z0-9_-]+)"', line):
                board.machine = match.group(1)
                prompt = f"({board.machine}) "
            elif re.fullmatch(r"machine LoadPlatformDescription @.+", line):
                if not os.path.isfile(line.split("@", 1)[1]):
                    answer = f"There was an error executing command '{line}': \nfile not found"
            elif re.fullmatch(r"sysbus\.cpu PerformanceInMips \d+", line) or re.fullmatch(r'emulation SetGlobalQuantum "[0-9.]+"', line):
                pass
            elif match := re.fullmatch(r"sysbus LoadELF @(\S+)", line):
                if SCENARIO.get("loadFails"):
                    answer = f"There was an error executing command '{line}': \nParameters did not match the signature"
                else:
                    with open(match.group(1), "rb") as handle:
                        board.elf = handle.read()
            elif re.fullmatch(r"sysbus\.cpu VectorTableOffset 0x[0-9a-f]{8}", line):
                pass
            elif match := re.fullmatch(r"sysbus\.(\w+) CreateFileBackend @(\S+) true", line):
                if board.uart_file is not None or os.path.exists(match.group(2)):
                    answer = f"There was an error executing command '{line}': the file backend exists already"
                else:
                    board.uart_file = match.group(2)
                    open(board.uart_file, "a").close()
            elif match := re.fullmatch(r"sysbus\.(\w+) CloseFileBackend @(\S+)", line):
                if board.uart_file != match.group(2):
                    answer = f"There was an error executing command '{line}': Couldn't find active file backend"
                board.uart_file = None
            elif match := re.fullmatch(r'emulation RunFor "([0-9:.]+)"', line):
                board.run_for(parse_span(match.group(1)))
            elif match := re.fullmatch(r"sysbus\.usart2 WriteChar (0x[0-9a-f]{2})", line):
                board.write_char(int(match.group(1), 16))
            elif line == "sysbus.gpioPortA.UserButton Press":
                board.button = True
            elif line == "sysbus.gpioPortA.UserButton Release":
                board.button = False
            elif line == "sysbus.gpioPortD.UserLED State":
                answer = ("True" if board.led else "False") if not SCENARIO.get("ledStuck") else "False"
            elif line == "emulation GetTimeSourceInfo":
                whole = int(board.virtual)
                fraction = round((board.virtual - whole) * 1e7)
                answer = f"Elapsed Virtual Time: 00:{whole // 60:02d}:{whole % 60:02d}.{fraction:07d}\nElapsed Host Time: 00:00:01"
            else:
                answer = f"No such command or device: {line.split(' ')[0]}"
        except OSError as error:
            answer = f"There was an error executing command: {error}"
        sys.stdout.write((answer + "\n" if answer else "") + prompt)
        sys.stdout.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
