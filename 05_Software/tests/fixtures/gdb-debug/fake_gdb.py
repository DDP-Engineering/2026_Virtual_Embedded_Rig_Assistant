"""A scripted GDB/MI stand-in for gdb-debug tests (LAB-04). Not GDB: it proves the helper's protocol handling only.

Environment: FAKE_GDB_SCENARIO (JSON, below), FAKE_GDB_LOG (JSON lines: argv, then every command received),
FAKE_GDB_PLUGIN (the plugin's scripts folder, to read the ELF the emulated flash holds).

Scenario fields (all optional): architectures (accepted `set architecture` names), flash (ELF path whose read-only
sections are the target's flash), cpuid, scb (128 hex chars at 0xE000ED00), registers {name: hex}, registerOrder,
ram [{addr, hex}], frames [...], variables [...], symbols {name: {addr, size, type}}, continue {after, stop | never |
disconnect | exit}, step {reason | never}, commands {"-cmd": {silent | exit | untokened | lateBy | asyncBefore | error}},
connect {error}, version (text), unreadable [{addr, size}] (memory reads there fail),
exitAtStart (exits before its first prompt). A command's `error` answers it with ^error and that message.
"""

from __future__ import annotations

import json
import os
import re
import socket
import sys
import threading
import time

sys.dont_write_bytecode = True
SCENARIO = json.loads(open(os.environ["FAKE_GDB_SCENARIO"], encoding="utf-8").read()) if os.environ.get("FAKE_GDB_SCENARIO") else {}
LOG = os.environ.get("FAKE_GDB_LOG")
LOCK = threading.Lock()


def log(entry: dict) -> None:
    if LOG:
        with LOCK, open(LOG, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry) + "\n")


def write(line: str) -> None:
    with LOCK:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()


def c(text: str) -> str:
    return '"' + str(text).replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n") + '"'


def tuple_(fields: dict) -> str:
    return "{" + ",".join(f"{k}={c(v)}" for k, v in fields.items()) + "}"


argv = sys.argv[1:]
log({"argv": argv, "pid": os.getpid(), "cwd": os.getcwd()})
# The shapes of GDB 16's real answers: --version names no target, --configuration does.
if "--version" in argv:
    print(SCENARIO.get("version", "GNU gdb (Fake stand-in) 15.2\nCopyright (C) 2024 Free Software Foundation, Inc."))
    sys.exit(0)
if "--configuration" in argv:
    print("This GDB was configured as follows:\n   configure --host=x86_64-w64-mingw32 --target=arm-none-eabi")
    sys.exit(0)
ARCHS = SCENARIO.get("architectures", ["armv6-m", "armv7-m", "armv7e-m", "armv8-m.base", "armv8-m.main"])
if "--batch" in argv:
    wanted = next((a.split(" ", 2)[2] for a in argv if a.startswith("set architecture ")), None)
    if wanted and wanted not in ARCHS:
        print(f'Undefined item: "{wanted}".', file=sys.stderr)
        sys.exit(1)
    sys.exit(0)

FLASH: list[tuple[int, bytes]] = []
if SCENARIO.get("flash"):
    sys.path.insert(0, os.environ["FAKE_GDB_PLUGIN"])
    from gdb_support import elf  # noqa: E402

    image = elf.read(__import__("pathlib").Path(SCENARIO["flash"]))
    for section in image.sections:
        if section.type in (1, 7) and section.flags & 2 and not section.flags & 1 and section.size:
            FLASH.append((section.addr, image.contents(section)))
RAM = [(int(block["addr"], 16), bytes.fromhex(block["hex"])) for block in SCENARIO.get("ram", [])]
SCB = bytes.fromhex(SCENARIO.get("scb", "00" * 64))
CPUID = int(SCENARIO.get("cpuid", "0x410fc241"), 16)
REGISTERS = SCENARIO.get("registers", {"r0": "0x0", "sp": "0x20017fe0", "lr": "0x08000151", "pc": "0x08000120", "xpsr": "0x01000000"})
ORDER = SCENARIO.get("registerOrder") or [
    *(f"r{n}" for n in range(13)), "sp", "lr", "pc", "", "", "", "", "", "", "", "", "", "xpsr",
    "msp", "psp", "primask", "basepri", "faultmask", "control",
]
FRAMES = SCENARIO.get("frames", [{"level": "0", "addr": "0x08000120", "func": "compute_ratio", "file": "fault.c", "line": "25"}])
state = {"sock": None, "bp": 0, "line": 30}


UNREADABLE = [(int(block["addr"], 16), int(block["size"])) for block in SCENARIO.get("unreadable", [])]


def memory(address: int, size: int) -> bytes | None:
    if any(start < address + size and address < start + length for start, length in UNREADABLE):
        return None
    if 0xE000ED00 <= address and address + size <= 0xE000ED40:
        block = CPUID.to_bytes(4, "little") + SCB[4:]
        return block[address - 0xE000ED00 : address - 0xE000ED00 + size]
    for start, data in [*FLASH, *RAM]:
        if start <= address and address + size <= start + len(data):
            return data[address - start : address - start + size]
    return None


def frame_text(frame: dict) -> str:
    return tuple_({**frame, "arch": "armv7e-m"})


def stopped(fields: dict, frame: dict | None = None) -> str:
    frame = frame or FRAMES[0]
    body = ",".join(f"{k}={c(v)}" for k, v in fields.items())
    return f"*stopped,{body + ',' if body else ''}frame={frame_text(frame)},thread-id=\"1\",stopped-threads=\"all\""


def later(seconds: float, lines: list[str]) -> None:
    def emit() -> None:
        time.sleep(seconds)
        for line in lines:
            write(line)

    threading.Thread(target=emit, daemon=True).start()


def handle(token: str, command: str, rest: str) -> list[str] | None:
    if command == "-gdb-set":
        if rest.startswith("architecture "):
            name = rest.split(" ", 1)[1]
            if name not in ARCHS:
                return [f'{token}^error,msg={c(f"Undefined item: {chr(34)}{name}{chr(34)}.")}']
        return [f"{token}^done"]
    if command == "-file-exec-and-symbols":
        return [f"{token}^done"]
    if command == "-interpreter-exec":
        text = json.loads(rest.split(" ", 1)[1]) if rest.startswith("console ") else ""
        if text.startswith("whatis "):
            name = text[7:]
            found = SCENARIO.get("symbols", {}).get(name)
            if not found:
                return [f"{token}^error,msg={c(f'No symbol {chr(34)}{name}{chr(34)} in current context.')}"]
            return [f'~{c("type = " + found["type"] + chr(10))}', f"{token}^done"]
        return [f"{token}^done"]
    if command == "-target-select":
        if SCENARIO.get("connect", {}).get("error"):
            return [f'{token}^error,msg={c(SCENARIO["connect"]["error"])}']
        host, port = rest.split(" ", 1)[1].rsplit(":", 1)
        sock = socket.create_connection((host, int(port)), timeout=5)
        state["sock"] = sock
        return ['=thread-group-started,id="i1",pid="42000"', f"{token}^connected", stopped({})]
    if command == "-data-read-memory-bytes":
        address_text, size_text = rest.split()
        address, size = int(address_text, 16), int(size_text)
        data = memory(address, size)
        if data is None:
            return [f"{token}^error,msg={c(f'Cannot access memory at address 0x{address:x}')}"]
        return [f'{token}^done,memory=[{{begin="0x{address:08x}",offset="0x00000000",end="0x{address + size:08x}",contents="{data.hex()}"}}]']
    if command == "-data-list-register-names":
        return [f"{token}^done,register-names=[{','.join(c(n) for n in ORDER)}]"]
    if command == "-data-list-register-values":
        values = [f'{{number="{i}",value={c(REGISTERS[n])}}}' for i, n in enumerate(ORDER) if n in REGISTERS]
        return [f"{token}^done,register-values=[{','.join(values)}]"]
    if command == "-stack-info-depth":
        return [f'{token}^done,depth="{min(len(FRAMES), int(rest or 9999))}"']
    if command == "-stack-list-frames":
        low, high = (int(v) for v in rest.split())
        chosen = FRAMES[low : high + 1]
        return [f"{token}^done,stack=[{','.join('frame=' + frame_text(f) for f in chosen)}]"]
    if command == "-stack-list-variables":
        return [f"{token}^done,variables=[{','.join(tuple_(v) for v in SCENARIO.get('variables', []))}]"]
    if command == "-data-evaluate-expression":
        expression = json.loads(rest)
        found = re.fullmatch(r"(sizeof|&)\((.+)\)", expression)
        symbol = SCENARIO.get("symbols", {}).get(found.group(2)) if found else None
        if not symbol:
            return [f"{token}^error,msg={c('No symbol in current context.')}"]
        if found.group(1) == "sizeof":
            return [f'{token}^done,value="{symbol["size"]}"']
        kind, address = symbol["type"], symbol["addr"]
        return [f"{token}^done,value={c(f'({kind} *) {address} <{found.group(2)}>')}"]
    if command == "-break-insert":
        state["bp"] += 1
        location = rest.split()[-1]
        bp = SCENARIO.get("breakpoint", {"addr": "0x08000118", "func": "compute_ratio"})
        return [f'{token}^done,bkpt={{number="{state["bp"]}",type="hw breakpoint",disp="keep",enabled="y",addr={c(bp["addr"])},func={c(bp["func"])},original-location={c(location)}}}']
    if command == "-break-delete":
        return [f"{token}^done"]
    if command == "-exec-continue":
        plan = SCENARIO.get("continue", {"after": 0.2, "stop": {"reason": "breakpoint-hit", "bkptno": "1"}})
        after = float(plan.get("after", 0.2))
        if plan.get("exit"):
            later(after, [])
            threading.Thread(target=lambda: (time.sleep(after), os._exit(1)), daemon=True).start()
        elif plan.get("disconnect"):
            later(after, ['&"Remote communication error.  Target disconnected.: Connection reset by peer.\\n"'])
        elif not plan.get("never"):
            later(after, [stopped(plan["stop"], plan.get("frame"))])
        return [f"{token}^running", '*running,thread-id="all"']
    if command == "-exec-interrupt":
        later(0.05, [stopped({"reason": "signal-received", "signal-name": "SIGINT", "signal-meaning": "Interrupt"})])
        return [f"{token}^done"]
    if command in ("-exec-step", "-exec-step-instruction"):
        plan = SCENARIO.get("step", {"reason": "end-stepping-range"})
        if not plan.get("never"):
            state["line"] += 1
            frame = {**FRAMES[0], "line": str(state["line"]), "addr": f"0x{0x08000120 + state['line']:08x}"}
            later(0.05, [stopped({"reason": plan["reason"]}, frame)])
        return [f"{token}^running", '*running,thread-id="all"']
    if command == "-target-detach":
        if state["sock"] is not None:
            state["sock"].close()
            state["sock"] = None
        return [f"{token}^done", '=thread-group-exited,id="i1"']
    if command == "-gdb-exit":
        write(f"{token}^exit")
        sys.exit(0)
    return [f"{token}^error,msg={c('Undefined MI command: ' + command)}"]


if SCENARIO.get("exitAtStart"):
    print("fake gdb: cannot start", file=sys.stderr)
    sys.exit(1)
write("(gdb)")
for raw in sys.stdin:
    line = raw.rstrip("\r\n")
    found = re.fullmatch(r"(\d*)(-[\w-]+)\s*(.*)", line)
    if not found:
        log({"raw": line})
        write('^error,msg="not an MI command"')
        continue
    token, command, rest = found.groups()
    log({"cmd": command, "args": rest, "token": token})
    behaviour = SCENARIO.get("commands", {}).get(command, {})
    if behaviour.get("exit"):
        os._exit(1)
    if behaviour.get("silent"):
        continue
    for extra in behaviour.get("asyncBefore", []):
        write(extra)
    if behaviour.get("untokened"):
        write("^done")
    lines = [f"{token}^error,msg={c(behaviour['error'])}"] if behaviour.get("error") else handle(token, command, rest)
    if lines is None:
        continue
    if behaviour.get("lateBy"):
        later(float(behaviour["lateBy"]), lines)
        continue
    for item in lines:
        write(item)
    write("(gdb)")
