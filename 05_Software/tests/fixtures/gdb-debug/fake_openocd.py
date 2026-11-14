"""An OpenOCD stand-in for gdb-debug tests (LAB-04). Not OpenOCD: it opens no probe.

It records its arguments (FAKE_OPENOCD_LOG, JSON lines), listens on the `bindto` address and `gdb_port` it was given,
prints OpenOCD's readiness line, and when the GDB stand-in's connection closes it prints the marker the gdb-detach
event of its arguments would print (`halted` for `catch {halt}`, `running` for `catch {resume}`). Scenario
(FAKE_OPENOCD_SCENARIO): {"fail": true} exits at once, {"silent": true} never gets ready, {"noMarker": true} prints no
marker.

With {"target": {...}} it also answers GDB's remote serial protocol for a halted Cortex-M target, so a real GDB can
connect (the opt-in real-GDB tests): flash holds the read-only sections of `target.elf` (read with gdb-debug's own ELF
reader from FAKE_GDB_PLUGIN), `scb` the System Control Block from 0xE000ED00, `ram` blocks over a zeroed RAM at
0x20000000, `registers` r0-r12, sp, lr, pc, xpsr, msp, psp. It serves memory and register reads, hardware breakpoints
(a continue stops at the first one after 0.2 s, or runs until GDB interrupts; with "hang" it never stops by itself),
single steps over Thumb instructions (`b .` stays put), and detach. Every write packet is refused and logged as
{"write": packet}; an interrupt is logged as {"interrupt": true}.
"""

from __future__ import annotations

import json
import os
import socket
import sys
import threading
import time
from pathlib import Path

sys.dont_write_bytecode = True
argv = sys.argv[1:]
scenario = json.loads(open(os.environ["FAKE_OPENOCD_SCENARIO"], encoding="utf-8").read()) if os.environ.get("FAKE_OPENOCD_SCENARIO") else {}
if os.environ.get("FAKE_OPENOCD_LOG"):
    with open(os.environ["FAKE_OPENOCD_LOG"], "a", encoding="utf-8") as handle:
        handle.write(json.dumps({"argv": argv, "pid": os.getpid(), "cwd": os.getcwd()}) + "\n")
if "--version" in argv:
    print("Open On-Chip Debugger 0.12.0 (fake stand-in)", file=sys.stderr)
    sys.exit(0)
commands = [argv[i + 1] for i, arg in enumerate(argv[:-1]) if arg == "-c"]
address = next((c.split()[1] for c in commands if c.startswith("bindto ")), "0.0.0.0")
port = int(next(c.split()[1] for c in commands if c.startswith("gdb_port ")))
detach = next((c for c in commands if "gdb-detach" in c), "")
state = "halted" if "catch {halt}" in detach else "running" if "catch {resume}" in detach else "unknown"


def say(text: str) -> None:
    sys.stdout.write(text + "\n")
    sys.stdout.flush()


say("Open On-Chip Debugger 0.12.0 (fake stand-in)")
if scenario.get("fail"):
    say("Error: open failed")
    sys.exit(1)
server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
server.bind((address, port))
server.listen(1)
if not scenario.get("silent"):
    say(f"Info : Listening on port {port} for gdb connections")


def log(entry: dict) -> None:
    if os.environ.get("FAKE_OPENOCD_LOG"):
        with open(os.environ["FAKE_OPENOCD_LOG"], "a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry) + "\n")


NAMES = [*(f"r{n}" for n in range(13)), "sp", "lr", "pc", "xpsr", "msp", "psp"]
FEATURES = (
    '<?xml version="1.0"?><!DOCTYPE target SYSTEM "gdb-target.dtd"><target version="1.0">'
    "<architecture>arm</architecture><feature name=\"org.gnu.gdb.arm.m-profile\">"
    + "".join(
        f'<reg name="{name}" bitsize="32" regnum="{number}"'
        + (' type="data_ptr"' if name == "sp" else ' type="code_ptr"' if name == "pc" else ' type="int"')
        + ' group="general"/>'
        for number, name in enumerate(NAMES[:17])
    )
    + '</feature><feature name="org.gnu.gdb.arm.m-system">'
    + '<reg name="msp" bitsize="32" regnum="17" type="data_ptr" group="system"/>'
    + '<reg name="psp" bitsize="32" regnum="18" type="data_ptr" group="system"/>'
    + "</feature></target>"
)


class Target:
    """A halted Cortex-M target behind GDB's remote serial protocol."""

    def __init__(self, spec: dict) -> None:
        sys.path.insert(0, os.environ["FAKE_GDB_PLUGIN"])
        from gdb_support import elf  # noqa: PLC0415

        image = elf.read(Path(spec["elf"]))
        self.flash = [
            (s.addr, image.contents(s))
            for s in image.sections
            if s.type in (1, 7) and s.flags & 2 and not s.flags & 1 and s.size
        ]
        self.ram = bytearray(int(spec.get("ramSize", 0x30000)))
        for block in spec.get("ram", []):
            start = int(block["addr"], 16) - 0x20000000
            data = bytes.fromhex(block["hex"])
            self.ram[start : start + len(data)] = data
        self.scb = bytes.fromhex(spec["scb"])
        self.registers = [int(spec.get("registers", {}).get(name, "0x0"), 16) for name in NAMES]
        self.breakpoints: set[int] = set()
        self.running = False
        self.hang = bool(spec.get("hang"))

    def memory(self, address: int, size: int) -> bytes | None:
        for start, data in [*self.flash, (0x20000000, bytes(self.ram)), (0xE000ED00, self.scb)]:
            if start <= address and address + size <= start + len(data):
                return data[address - start : address - start + size]
        return None

    def step(self) -> None:
        pc = self.registers[15] & ~1
        half = self.memory(pc, 2)
        word = int.from_bytes(half, "little") if half else 0
        if word != 0xE7FE:  # `b .` branches to itself
            self.registers[15] = pc + (4 if word >> 11 in (0x1D, 0x1E, 0x1F) else 2)


def checksum(data: bytes) -> bytes:
    return b"%02x" % (sum(data) & 0xFF)


def rsp(connection: socket.socket, target: Target) -> None:
    buffer = b""
    stop = threading.Event()

    def send(payload: str) -> None:
        data = payload.encode("latin-1")
        connection.sendall(b"$" + data + b"#" + checksum(data))

    def resume() -> None:
        target.running = True
        stop.clear()
        if target.breakpoints and not target.hang:
            def hit() -> None:
                if not stop.wait(0.2) and target.running:
                    target.running = False
                    target.registers[15] = min(target.breakpoints)
                    send("T05hwbreak:;")

            threading.Thread(target=hit, daemon=True).start()

    while True:
        chunk = connection.recv(4096)
        if not chunk:
            return
        buffer += chunk
        while buffer:
            if buffer[:1] in (b"+", b"-"):
                buffer = buffer[1:]
                continue
            if buffer[:1] == b"\x03":
                buffer = buffer[1:]
                log({"interrupt": True})
                if target.running:
                    target.running = False
                    stop.set()
                    send("T02")
                continue
            if buffer[:1] != b"$":
                buffer = buffer[1:]
                continue
            end = buffer.find(b"#")
            if end < 0 or len(buffer) < end + 3:
                break
            packet = buffer[1:end].decode("latin-1")
            buffer = buffer[end + 3 :]
            connection.sendall(b"+")
            reply = answer(packet, target, resume)
            if reply is not None:
                send(reply)
            if packet == "D" or packet.startswith("D;") or packet in ("k", "vKill;1"):
                return


def answer(packet: str, target: Target, resume) -> str | None:
    head = packet.split(":")[0]
    if head == "qSupported":
        return "PacketSize=4000;qXfer:features:read+;hwbreak+;vContSupported+"
    if packet.startswith("qXfer:features:read:target.xml:"):
        offset, length = (int(x, 16) for x in packet.rsplit(":", 1)[1].split(","))
        part = FEATURES[offset : offset + length]
        return ("l" if offset + length >= len(FEATURES) else "m") + part
    if packet == "?":
        return "T05"
    if packet == "qAttached":
        return "1"
    if packet.startswith("H"):
        return "OK"
    if packet == "g":
        return "".join(value.to_bytes(4, "little").hex() for value in target.registers)
    if packet.startswith("p"):
        number = int(packet[1:], 16)
        return target.registers[number].to_bytes(4, "little").hex() if number < len(NAMES) else "E00"
    if packet.startswith("m"):
        address, size = (int(x, 16) for x in packet[1:].split(","))
        data = target.memory(address, size)
        return data.hex() if data is not None else "E01"
    if packet[:1] in ("M", "X", "G", "P") or packet.startswith(("Z0", "z0", "vFlash", "qRcmd")):
        log({"write": packet[:80]})
        return "E01"
    if packet.startswith(("Z1,", "z1,")):
        address = int(packet.split(",")[1], 16)
        (target.breakpoints.add if packet[0] == "Z" else target.breakpoints.discard)(address)
        return "OK"
    if packet == "vCont?":
        return "vCont;c;C;s;S;t"
    if packet in ("c", "vCont;c") or packet.startswith("vCont;c:"):
        resume()
        return None
    if packet in ("s", "vCont;s") or packet.startswith("vCont;s:"):
        target.step()
        return "T05"
    if packet == "D" or packet.startswith("D;"):
        return "OK"
    return ""


def serve() -> None:
    while True:
        connection, _peer = server.accept()
        say("Info : accepting 'gdb' connection")
        try:
            if scenario.get("target"):
                rsp(connection, Target(scenario["target"]))
            while connection.recv(1024):
                pass
        except OSError:  # A killed GDB resets the connection; OpenOCD treats that as a close too.
            pass
        connection.close()
        if not scenario.get("noMarker"):
            say(f"User : VERA-DETACH {state}")


threading.Thread(target=serve, daemon=True).start()
while True:
    time.sleep(1)
