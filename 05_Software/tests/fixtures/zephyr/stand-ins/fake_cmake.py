"""CMake/Ninja stand-in of the zephyr plugin tests (VERA_ZEPHYR_TEST_CMAKE; offline evidence of the helper only).

Configure (`-S app -B dir -D...`) writes what Zephyr's CMake leaves in a build folder: CMakeCache.txt, zephyr/.config
merged from CONF_FILE and EXTRA_CONF_FILE, zephyr/zephyr.dts with the zephyr,flash node, build_info.yml and
zephyr/runners.yaml. `--build dir` writes zephyr.elf (a fixture ELF), zephyr.hex/bin derived from the configuration and
prints the linker's memory region table. A Kconfig line setting CONFIG_VERA_NO_SUCH_SYMBOL fails like Kconfig, an
overlay line `current-speed = <115200>` without ';' fails like the devicetree parser. Settings come from fake.json
beside the Zephyr base, because the helper hands its processes a scrubbed environment; every call is recorded.
"""

import hashlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path

base = Path(os.environ["ZEPHYR_BASE"])
root = base.parent
try:
    fake = json.loads((root / "fake.json").read_text(encoding="utf-8"))
except OSError:
    fake = {}
args = sys.argv[1:]


def record(entry: dict) -> None:
    with open(root / "calls.jsonl", "a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry) + "\n")


record({"tool": "cmake", "args": args, "pid": os.getpid(), "env": dict(os.environ)})


def defines() -> dict:
    found = {}
    for arg in args:
        if arg.startswith("-D") and "=" in arg:
            key, _, value = arg[2:].partition("=")
            found[key] = value
    return found


def files(value: str) -> list:
    return [item for item in value.split(";") if item]


def hex_line(data: bytes) -> str:
    return ":" + (data + bytes([(-sum(data)) & 0xFF])).hex().upper()


def build(folder: Path) -> int:
    if fake.get("sleep"):
        child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)"])
        record({"tool": "compiler", "pid": child.pid})
        time.sleep(float(fake["sleep"]))
    out = folder / "zephyr"
    config = (out / ".config").read_bytes()
    (out / "zephyr.elf").write_bytes(Path(fake["elf"]).read_bytes())
    digest = hashlib.sha256(config).digest()
    address = int(fake.get("hexAddress", 0x08000000))
    upper = bytes([2, 0, 0, 4, (address >> 24) & 0xFF, (address >> 16) & 0xFF])
    data = bytes([16, (address >> 8) & 0xFF, address & 0xFF, 0]) + digest[:16]
    (out / "zephyr.hex").write_text("\n".join([hex_line(upper), hex_line(data), ":00000001FF"]) + "\n", encoding="ascii")
    (out / "zephyr.bin").write_bytes(digest[:16])
    (out / "zephyr.map").write_text("Memory Configuration\n", encoding="utf-8")
    print("[1/1] Linking C executable zephyr/zephyr.elf")
    print("Memory region         Used Size  Region Size  %age Used")
    print("           FLASH:       16756 B         1 MB      1.60%")
    print("             RAM:        4480 B       128 KB      3.42%")
    return 0


def configure() -> int:
    d = defines()
    folder = Path(args[args.index("-B") + 1])
    (folder / "zephyr").mkdir(parents=True, exist_ok=True)
    (folder / "CMakeCache.txt").write_text(f"BOARD:STRING={d.get('BOARD')}\n", encoding="utf-8")
    print(f"-- Board: {d.get('BOARD')}")
    merged = []
    for name in files(d.get("CONF_FILE", "")) + files(d.get("EXTRA_CONF_FILE", "")):
        text = Path(name).read_text(encoding="utf-8")
        print(f"Merged configuration '{name}'")
        for number, item in enumerate(text.splitlines(), 1):
            if item.startswith("CONFIG_VERA_NO_SUCH_SYMBOL"):
                print(f"{name}:{number}: warning: attempt to assign the value 'y' to the undefined symbol VERA_NO_SUCH_SYMBOL")
                print("error: Aborting due to Kconfig warnings")
                print(f"CMake Error at {base.as_posix()}/cmake/modules/kconfig.cmake:400 (message):")
                print("  command failed with return code: 1")
                return 1
        merged.append(text)
    for name in files(d.get("DTC_OVERLAY_FILE", "")):
        print(f"-- Found devicetree overlay: {name}")
        for number, item in enumerate(Path(name).read_text(encoding="utf-8").splitlines(), 1):
            if item.strip() == "current-speed = <115200>":
                print(f"devicetree error: {name}:{number + 1} (column 1): parse error: expected ';' or ','")
                return 1
    (folder / "zephyr" / ".config").write_text("\n".join(merged) + "\nCONFIG_SYS_CLOCK_HW_CYCLES_PER_SEC=168000000\n",
                                               encoding="utf-8")
    (folder / "zephyr" / "zephyr.dts").write_text(
        "/dts-v1/;\n/ {\n\tchosen {\n\t\tzephyr,flash = &flash0;\n\t};\n\tsoc {\n"
        "\t\tflash0: flash@8000000 {\n\t\t\treg = < 0x8000000 0x100000 >;\n\t\t};\n\t};\n};\n", encoding="utf-8")
    users = files(d.get("CONF_FILE", "")) + files(d.get("EXTRA_CONF_FILE", "")) + list(fake.get("undeclared", []))
    info = ["cmake:", "  board:", f"    name: '{d.get('BOARD')}'", "  kconfig:", "    user-files:"]
    info += [f"     - '{item}'" for item in users]
    overlays = files(d.get("DTC_OVERLAY_FILE", ""))
    info += ["  devicetree:", "    user-files:" + ("" if overlays else " []")] + [f"     - '{item}'" for item in overlays]
    (folder / "build_info.yml").write_text("\n".join(info) + "\n", encoding="utf-8")
    runner_args = fake.get("runnerArgs", ["--port=swd", "--reset-mode=hw"])
    (folder / "zephyr" / "runners.yaml").write_text(
        "runners:\n- stm32cubeprogrammer\n- openocd\nflash-runner: stm32cubeprogrammer\nconfig:\n  board_dir: x\n"
        "  elf_file: zephyr.elf\n  hex_file: zephyr.hex\n  bin_file: zephyr.bin\nargs:\n  stm32cubeprogrammer:\n"
        + "".join(f"    - {json.dumps(item)}\n" for item in runner_args), encoding="utf-8")
    print("-- Configuring done")
    return int(fake.get("configureExit", 0))


sys.exit(build(Path(args[args.index("--build") + 1])) if "--build" in args else configure())
