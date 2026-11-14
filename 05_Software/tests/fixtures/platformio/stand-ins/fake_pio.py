"""PlatformIO Core stand-in of the platformio plugin tests (LAB-08). Never PlatformIO itself.

The helper runs it as `<python> fake_pio.py <pio arguments>` when VERA_PIO_TEST=1 and VERA_PIO_TEST_PIO name it. It
reads its settings from `<core>/fake.json` (the helper scrubs the environment, so the core folder is the channel),
appends one JSON line per call to `<core>/calls.jsonl` (argv, cwd, the PLATFORMIO_*/proxy variables it saw, PIDs) and
imitates the outputs the helper reads:

- `run -d P -e E -t buildprog`: `$PLATFORMIO_WORKSPACE_DIR/build/E/firmware.elf` (copied from settings.elf[E]),
  firmware.bin, PlatformIO's RAM/Flash summary; settings: fail (compiler error, exit 1), sleep (a child process that
  sleeps, PID recorded), touch (a project file it rewrites), noElf.
- `run ... -t nobuild -t upload`: prints the upload; settings uploadExit.
- `test -d P -e E ... --json-output-path F`: a JSON report from settings.tests[suite] = [[case, STATUS, message]];
  with --without-uploading --without-testing it writes the suite's firmware (settings.testElf) instead.
- `pkg install ...`: copies settings.template into the core (platforms/, packages/) and settings.libraries into
  `$PLATFORMIO_LIBDEPS_DIR/E/`.
"""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

core = Path(os.environ.get("PLATFORMIO_CORE_DIR", "."))
settings_path = core / "fake.json"
settings = json.loads(settings_path.read_text(encoding="utf-8")) if settings_path.is_file() else {}
args = sys.argv[1:]


def option(name, default=None):
    return args[args.index(name) + 1] if name in args and args.index(name) + 1 < len(args) else default


def options(name):
    return [args[i + 1] for i, value in enumerate(args) if value == name and i + 1 < len(args)]


def record(**extra):
    seen = {key: value for key, value in os.environ.items()
            if key.startswith("PLATFORMIO_") or key.lower().endswith("_proxy") or key in ("PATH", "NO_PROXY")}
    entry = {"argv": args, "cwd": os.getcwd(), "env": seen, "pid": os.getpid(), **extra}
    with open(core / "calls.jsonl", "a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry) + "\n")


environment = option("-e")
workspace = Path(os.environ.get("PLATFORMIO_WORKSPACE_DIR", "."))
output = workspace / "build" / str(environment)

if args[:2] == ["pkg", "install"]:
    record(tool="pkg")
    template = settings.get("template")
    if template:
        for part in ("platforms", "packages"):
            if (Path(template) / part).is_dir():
                shutil.copytree(Path(template) / part, core / part, dirs_exist_ok=True)
    libraries = settings.get("libraries")
    if libraries and environment:
        target = Path(os.environ["PLATFORMIO_LIBDEPS_DIR"]) / environment
        shutil.copytree(libraries, target, dirs_exist_ok=True)
    print("Resolving dependencies... done")
    sys.exit(settings.get("installExit", 0))

if args[:1] == ["run"] and "upload" in options("-t"):
    record(tool="upload")
    print("Uploading .pio/build/firmware.elf")
    print(f"Upload flags: {os.environ.get('PLATFORMIO_UPLOAD_FLAGS')}")
    sys.exit(settings.get("uploadExit", 0))

if args[:1] == ["run"]:
    child = None
    if settings.get("sleep"):
        child = subprocess.Popen([sys.executable, "-c", f"import time; time.sleep({settings['sleep']})"])
    record(tool="build", child=child.pid if child else None)
    if settings.get("touch"):
        path = Path(option("-d")) / settings["touch"]
        path.write_text(path.read_text(encoding="utf-8") + "\n/* touched */\n", encoding="utf-8")
    if child is not None:
        child.wait()
    print(f"Processing {environment} (platform: stand-in)")
    if settings.get("fail"):
        print("Compiling .pio/build/src/main.o")
        print("src/main.c:42:5: error: 'undeclared_thing' undeclared (first use in this function)")
        print("*** [.pio/build/src/main.o] Error 1")
        sys.exit(1)
    output.mkdir(parents=True, exist_ok=True)
    elf = (settings.get("elf") or {}).get(environment)
    if elf and not settings.get("noElf"):
        shutil.copyfile(elf, output / "firmware.elf")
        (output / "firmware.bin").write_bytes(Path(elf).read_bytes()[:512])
    print("RAM:   [          ]   0.1% (used 108 bytes from 131072 bytes)")
    print("Flash: [          ]   0.1% (used 1144 bytes from 1048576 bytes)")
    print("========================= [SUCCESS] Took 0.10 seconds =========================")
    sys.exit(0)

if args[:1] == ["test"]:
    record(tool="test")
    suites = options("--filter")
    if "--without-testing" in args:
        output.mkdir(parents=True, exist_ok=True)
        elf = (settings.get("testElf") or {}).get(suites[0] if suites else "")
        if settings.get("fail"):
            print("test/test_lines/test_main.c:7:1: error: expected ';' before '}' token")
            sys.exit(1)
        if elf:
            shutil.copyfile(elf, output / "firmware.elf")
        print("Building... done (uploading and testing skipped)")
        sys.exit(0)
    report = {"version": "1.0", "test_suites": []}
    failed = False
    for suite in suites:
        cases = []
        for name, status, message in (settings.get("tests") or {}).get(suite, []):
            failed = failed or status in ("FAILED", "ERRORED")
            cases.append({"name": name, "status": status, "message": message, "stdout": "", "duration": 0.0,
                          "exception": None, "source": {"file": f"test/{suite}/test_main.c", "line": 10}})
            print(f"test/{suite}/test_main.c:10:{name}:{ {'PASSED': 'PASS', 'FAILED': 'FAIL', 'SKIPPED': 'IGNORE'}.get(status, 'FAIL') }")
        if suite in (settings.get("tests") or {}):
            report["test_suites"].append({"env_name": environment, "test_name": suite, "status": "FAILED" if failed else "PASSED",
                                          "test_cases": cases})
    output.mkdir(parents=True, exist_ok=True)
    (output / ("program.exe" if os.name == "nt" else "program")).write_bytes(b"stand-in program")
    path = option("--json-output-path")
    if path and not settings.get("noReport"):
        Path(path).write_text(json.dumps(report), encoding="utf-8")
    sys.exit(1 if failed else 0)

record(tool="unknown")
print("stand-in: unsupported command " + " ".join(args))
sys.exit(2)
