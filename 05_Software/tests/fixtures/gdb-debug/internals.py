"""Unit checks of gdb_support, run by gdb-debug.test.ts (LAB-04).

argv: [1] the plugin's scripts folder, [2] the GDB stand-in executable, [3] a scratch folder, [4] the fixture firmware
folder. Every check asserts; the printed JSON summarises what was observed. Exit 0 = all checks passed.
"""

import json
import os
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, sys.argv[1])

from gdb_support import dwarf, elf, faults, mi, profiles, symbols, validate  # noqa: E402
from gdb_support.errors import Refused  # noqa: E402
from gdb_support.session import Events, Interrupted, Session, Timeout  # noqa: E402

scratch = Path(sys.argv[3])
firmware = Path(sys.argv[4])
out: dict = {}


def refused(call) -> str:
    try:
        call()
    except Refused as error:
        return error.message
    raise AssertionError("accepted")


# --- MI parser (REQ-FUNC-74347f3b) ---------------------------------------------------------------------------------
record = mi.parse('12^done,stack=[frame={level="0",addr="0x08000120",func="f"},frame={level="1",addr="0x0",func="g"}]')
assert record.kind == "result" and record.token == 12 and record.cls == "done"
assert [f["func"] for f in record.results["stack"]] == ["f", "g"]
record = mi.parse('^done,value="a\\"b\\\\c\\n\\303\\251",list=["x","y"],empty={},none=[]')
assert record.token is None and record.results["value"] == 'a"b\\c\né', record.results
assert record.results["list"] == ["x", "y"] and record.results["empty"] == {} and record.results["none"] == []
record = mi.parse('*stopped,reason="breakpoint-hit",bkptno="1",frame={addr="0x1",args=[{name="v",value="2"}]}')
assert record.kind == "exec" and record.cls == "stopped" and record.results["frame"]["args"][0]["value"] == "2"
assert mi.parse('~"type = int\\n"').text == "type = int\n"
assert mi.parse("(gdb) ").kind == "prompt"
assert mi.parse('=thread-group-exited,id="i1"').kind == "notify"
for bad in ['12~"x"', "garbage", '^done,value="open', "^done,x=", '5^done,a="1"junk']:
    try:
        mi.parse(bad)
        raise AssertionError(f"parsed {bad!r}")
    except mi.MiSyntax:
        pass
assert mi.quote('C:/a "b"\\c') == '"C:/a \\"b\\"\\\\c"'
try:
    mi.quote("x\nshell rm")
    raise AssertionError("newline quoted")
except ValueError:
    pass
out["mi"] = "ok"

# --- validation (REQ-SEC-a7bab79f) -----------------------------------------------------------------------------------
for good in ["counter", "sensor_state.raw", "buffer[3]", "s.a[2].b", "_x9"]:
    assert validate.variable(good) == good
for bad in [
    "counter = 0",
    "reset()",
    "x++",
    "--x",
    "*ptr",
    "p->next",
    "$pc",
    "$sp = 0",
    "&counter",
    "a[i]",
    "a[-1]",
    "monitor reset",
    "shell ls",
    "python print(1)",
    "source x.gdb",
    "define f",
    "counter\nshell",
    "x" * 129,
    "",
]:
    refused(lambda bad=bad: validate.variable(bad))
flash = [(0x08000000, 0x80000)]
assert validate.location("compute_ratio", flash) == "compute_ratio"
assert validate.location("ns::f", flash) == "ns::f"
assert validate.location("fault.c:25", flash) == "fault.c:25"
assert validate.location("*0x8000118", flash) == "*0x08000118"
for bad in ["*0x40000000", "*0x20000000", "fault.c:0", "fault.c", "f()", "f if x", "f\nmonitor", "-a", "*$pc", "fault.c:25 if 1"]:
    refused(lambda bad=bad: validate.location(bad, flash))
out["validate"] = "ok"

# --- faults (REQ-FUNC-9ab9965c) --------------------------------------------------------------------------------------
scb = bytearray(64)
scb[0:4] = (0x410FC241).to_bytes(4, "little")
scb[0x28:0x2C] = ((1 << 25) | (1 << 1) | (1 << 7) | (1 << 15) | (1 << 9)).to_bytes(4, "little")
scb[0x2C:0x30] = (1 << 30).to_bytes(4, "little")
scb[0x34:0x38] = (0x20001234).to_bytes(4, "little")
scb[0x38:0x3C] = (0x40000000).to_bytes(4, "little")
decoded = faults.decode("v7m", {"xpsr": 0x01000003, "lr": 0xFFFFFFFD}, bytes(scb), [1, 2, 3, 4, 5, 0x08000135, 0x0800011E, 0x01000000])
names = [cause["name"] for cause in decoded["causes"]]
assert names == ["DACCVIOL", "PRECISERR", "DIVBYZERO", "FORCED"], names
assert decoded["mmfar"] == "0x20001234" and decoded["bfar"] == "0x40000000" and decoded["stack"] == "psp"
assert decoded["exception"] == {"number": 3, "name": "HardFault"} and decoded["frame"]["pc"] == "0x0800011e"
assert faults.stacked_address({"xpsr": 3, "lr": 0xFFFFFFF9, "msp": 0x20017FB8, "psp": 0x2000F000}) == 0x20017FB8
assert faults.stacked_address({"xpsr": 3, "lr": 0xFFFFFFFD, "msp": 0x20017FB8, "psp": 0x2000F000}) == 0x2000F000
assert faults.stacked_address({"xpsr": 0x01000000, "lr": 0x08000135}) is None
stkof = bytearray(64)
stkof[0x28:0x2C] = (1 << 20).to_bytes(4, "little")
assert [c["name"] for c in faults.decode("v8m", {"xpsr": 6}, bytes(stkof), None)["causes"]] == ["STKOF"]
assert faults.decode("v7m", {"xpsr": 6}, bytes(stkof), None)["causes"] == []
v6 = faults.decode("v6m", {"xpsr": 0x01000003, "lr": 0xFFFFFFF9}, None, None)
assert v6["exception"]["name"] == "HardFault" and any("ARMv6-M" in text for text in v6["limits"])
assert faults.decode("v7m", {"xpsr": 0x01000000}, bytes(64), None)["exception"]["name"] == "thread mode"
assert faults.decode("v7m", {"xpsr": 0x01000015}, bytes(64), None)["exception"]["name"] == "IRQ 5"
assert faults.part(0x410FC241) == ("0xc24", "cortex-m4") and faults.part(0x410CC601) == ("0xc60", "cortex-m0+")
out["faults"] = "ok"

# --- ELF, symbols, DWARF producers (REQ-FUNC-0c6807c8, REQ-SEC-e1493c9b) -------------------------------------------
image = elf.read(firmware / "fault-m4.elf")
table = symbols.Symbols(image)
ratio = next(s for s in image.symbols() if s.name == "compute_ratio")
site = table.lookup((ratio.value & ~1) + 6)
assert site is not None and site.symbol == "compute_ratio" and site.offset == 6
assert table.lookup(0x07FFFFFF) is None and table.lookup(0x20000004) is None
assert symbols.site(table, "pc", ratio.value, False) == {"role": "pc", "addr": f"0x{ratio.value:08x}"}
data = (firmware / "fault-m4.elf").read_bytes()
for broken in [data[:40], data[:200], b"\x7fELF" + b"\x09" * 60, b"not an elf at all" * 4]:
    try:
        elf.parse(broken)
        raise AssertionError("parsed a broken ELF")
    except elf.ElfError:
        pass
corrupt = bytearray(data)
corrupt[0x20:0x24] = (len(data) + 100).to_bytes(4, "little")  # e_shoff beyond the file
try:
    elf.parse(bytes(corrupt))
    raise AssertionError("parsed a section table outside the file")
except elf.ElfError:
    pass
info = dwarf.DebugInfo(present=True, producers=["GNU C17 13.2.1 20231009 -mcpu=cortex-m4 -mthumb -g -O2"])
assert info.optimization() == "O2"
assert dwarf.DebugInfo(present=True, producers=["GNU C17 -Os -g", "GNU C17 -Os"]).optimization() == "Os"
assert dwarf.DebugInfo(present=True, producers=["GNU C17 -O0", "GNU C17 -O2"]).optimization() == "mixed"
assert dwarf.DebugInfo(present=True, producers=["GNU C17 -O -g"]).optimization() == "O1"
assert dwarf.DebugInfo(present=True, producers=["clang version 18.1.6"]).optimization() == "unknown"
# A chain of DW_FORM_indirect forms is refused, never followed recursively.
try:
    dwarf._value(dwarf._Reader(bytes([0x16] * 2000), "<"), 0x16, 4, 4, 4, {"str": b"", "line_str": b""})
    raise AssertionError("indirect chain accepted")
except elf.ElfError:
    pass
assert dwarf.LANGUAGES[0x2A] == "C++17" and dwarf.LANGUAGES[0x2B] == "C++20"
out["elf"] = "ok"

# --- profiles (REQ-SEC-593220cf) -------------------------------------------------------------------------------------
shipped = profiles.all_profiles(Path(sys.argv[1]).parent / "profiles")
out["profiles"] = [(p.id, p.status, p.core, p.faults) for p in shipped]
good = json.loads((Path(sys.argv[1]).parent / "profiles" / "stm32f4-stlink.json").read_text(encoding="utf-8"))
folder = scratch / "profiles"
folder.mkdir(parents=True, exist_ok=True)
variants = {
    "extra": {**good, "tcl": "proc x {} {}"},
    "dotdot": {**good, "openocd": {**good["openocd"], "target": "target/../../project.cfg"}},
    "project": {**good, "openocd": {**good["openocd"], "interface": "project/my.cfg"}},
    "peripheral": {**good, "memory": {**good["memory"], "ram": [{"start": "0x40000000", "size": 1024}]}},
    "system": {**good, "memory": {**good["memory"], "ram": [{"start": "0xE0000000", "size": 1024}]}},
    "overlap": {**good, "memory": {"flash": [{"start": "0x08000000", "size": 4096}], "ram": [{"start": "0x08000800", "size": 1024}]}},
    "rtos": {**good, "rtos": "freertos"},
    "faults": {**good, "core": {**good["core"], "faults": "v9m"}},
}
for name, body in variants.items():
    (folder / f"{name}.json").write_text(json.dumps({**body, "id": name}), encoding="utf-8")
    refused(lambda name=name: profiles.load(folder, name))
refused(lambda: profiles.load(folder, "../profiles/stm32f4-stlink"))
out["profileRefusals"] = len(variants) + 1

# --- session correlation against the GDB stand-in (REQ-FUNC-74347f3b) ---------------------------------------------
scenario = scratch / "session.json"
scenario.write_text(
    json.dumps(
        {
            "commands": {
                "-data-list-register-names": {"lateBy": 0.6},
                "-stack-info-depth": {"asyncBefore": ['999^done,value="foreign"', '*stopped,reason="signal-received",signal-name="SIGTRAP"']},
                "-file-exec-and-symbols": {"untokened": True},
                "-data-list-register-values": {"silent": True},
            }
        }
    ),
    encoding="utf-8",
)
os.environ["FAKE_GDB_SCENARIO"] = str(scenario)
os.environ["FAKE_GDB_LOG"] = str(scratch / "session-gdb.log")
events = Events()
session = Session(sys.argv[2], scratch / "gdb", scratch / "mi.log", events)
session.start()
reply, _ = session.command('-file-exec-and-symbols "a.elf"')
assert reply.cls == "done" and reply.token == 1
try:
    session.command("-data-list-register-names", 0.2)
    raise AssertionError("no timeout")
except Timeout:
    pass
assert session.state == "unknown" and not session.responsive and 2 in session.abandoned
session.responsive = True  # Only to show the late answer is never taken as the next command's result.
reply, _ = session.command("-stack-info-depth 4", 3)
assert reply.token == 3 and reply.results.get("depth") == "1", reply.results
session.drain(1.0)
kinds = [(e["kind"], e["text"]) for e in events.items]
assert ("untokened", "^done") in kinds, kinds
assert any(kind == "stale" and text.startswith("999^done") for kind, text in kinds), kinds
assert any(kind == "stale" and text.startswith("2^done,register-names") for kind, text in kinds), kinds
assert session.stops and session.stops[0].results["reason"] == "signal-received" and session.state == "halted"
times = [e["t"] for e in events.items]
assert times == sorted(times) and len(set(times)) == len(times)
session.kill()
# A stop request lets a pending command finish within one second; a command still pending then is abandoned
# (REQ-REL-d5f06a9b) and GDB counts as unresponsive.
stop_events = Events()
stopping = Session(sys.argv[2], scratch / "gdb2", scratch / "mi2.log", stop_events, lambda: True)
stopping.start()
reply, _ = stopping.command("-data-list-register-names", 5)
assert reply.cls == "done" and stopping.responsive
assert any(e["kind"] == "stopped" and "finished after the stop request" in e["text"] for e in stop_events.items)
try:
    stopping.command("-data-list-register-values --skip-unavailable x", 5)
    raise AssertionError("not interrupted")
except Interrupted:
    pass
assert not stopping.responsive and stopping.state == "unknown"
stopping.kill()
out["session"] = kinds

print(json.dumps(out))
