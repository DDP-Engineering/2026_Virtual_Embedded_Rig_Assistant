"""A scripted stand-in for wokwi-cli 0.29.1, for tests/plugins/wokwi.test.ts. It never opens a network connection.

The test launches it through a generated wrapper named wokwi-cli(.cmd). VERA_FAKE_WOKWI names a scenario JSON file;
every call is appended to `<scenario>.calls.jsonl` with its argv, working directory, the WOKWI_*/NO_COLOR variables it
received and the files of the project folder it was given, so a test can check what wokwi-tool asked for. Its output
texts are those of the real wokwi-cli 0.29.1 source (commands/simulate.ts, commands/lint.ts).
"""

import json
import os
import signal
import sys
import time
from pathlib import Path

BANNER = "Wokwi CLI v0.29.1 (0aa185144b92)"


def main(argv):
    # The real CLI (Node) writes UTF-8 to its pipes whatever the console code page.
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    scenario_path = Path(os.environ["VERA_FAKE_WOKWI"])
    scenario = json.loads(scenario_path.read_text(encoding="utf-8"))
    record = {
        "argv": argv,
        "cwd": os.getcwd(),
        "env": {name: value for name, value in os.environ.items() if name.upper().startswith("WOKWI_") or name.upper() in ("NO_COLOR", "FORCE_COLOR")},
        "pid": os.getpid(),
    }
    if argv and not argv[0].startswith("-") and argv[0] != "lint" and Path(argv[0]).is_dir():
        root = Path(argv[0])
        record["project"] = sorted(path.relative_to(root).as_posix() for path in root.rglob("*") if path.is_file())
    with open(str(scenario_path) + ".calls.jsonl", "a", encoding="utf-8") as log:
        log.write(json.dumps(record) + "\n")
    if argv == ["--short-version"]:
        print(scenario.get("version", "0.29.1 (0aa185144b92)"))
        return 0
    if argv[:1] == ["lint"]:
        lint = scenario.get("lint", {})
        print(BANNER)
        sys.stderr.write(lint.get("stderr", ""))
        print(lint.get("stdout", "✓ No issues found"))
        return lint.get("code", 0)
    run = scenario.get("run", {})
    option = lambda name: argv[argv.index(name) + 1] if name in argv else None  # noqa: E731
    print(BANNER)
    if run.get("connected", True):
        print("Connected to Wokwi Simulation API 1.0.0-fake")

    def stopped(signum, _frame):
        name = {getattr(signal, "SIGBREAK", -1): "SIGBREAK", signal.SIGTERM: "SIGTERM", signal.SIGINT: "SIGINT"}.get(signum, "SIGNAL")
        sys.stderr.write(f"\n{name}: stopping the simulation\n")
        sys.stderr.flush()
        Path(str(scenario_path) + ".signalled").write_text(name, encoding="utf-8")
        os._exit(128 + {"SIGBREAK": 21, "SIGTERM": 15, "SIGINT": 2}.get(name, 1))

    for name in ("SIGTERM", "SIGINT", "SIGBREAK"):
        number = getattr(signal, name, None)
        if number is not None:
            signal.signal(number, stopped)
    serial = option("--serial-log-file")
    if serial:
        # The real CLI opens the serial log as the simulation starts, so it exists even when nothing was printed.
        Path(serial).write_text(run.get("serial", ""), encoding="utf-8")
    token = os.environ.get("WOKWI_CLI_TOKEN", "")
    if run.get("echoToken"):
        print(f"debug token {token}")
        sys.stderr.write(f"Error: bad header Bearer {token}\n")
        if serial:
            with open(serial, "a", encoding="utf-8") as handle:
                handle.write(f"leak {token}\n")
    if run.get("bigStdout"):
        chunk = "x" * 65536 + "\n"
        for _ in range(run["bigStdout"] // len(chunk) + 1):
            sys.stdout.write(chunk)
        sys.stdout.flush()
    if option("--vcd-file") and run.get("vcd"):
        Path(option("--vcd-file")).write_text("$timescale 1ns $end\n", encoding="utf-8")
    if option("--screenshot-file") and run.get("screenshot"):
        Path(option("--screenshot-file")).write_bytes(b"\x89PNG\r\n\x1a\nfake")
    sys.stdout.write(run.get("stdout", ""))
    sys.stdout.flush()
    if run.get("hang"):
        Path(str(scenario_path) + ".running").write_text(json.dumps({"pid": os.getpid(), "ppid": os.getppid()}), encoding="utf-8")
        while True:
            time.sleep(0.1)
    time.sleep(run.get("sleep", 0))
    sys.stderr.write(run.get("stderr", ""))
    sys.stderr.flush()
    return run.get("code", 0)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
