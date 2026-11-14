"""Stand-in of Zephyr's `west flash` for the zephyr plugin tests: the stm32cubeprogrammer runner's command line.

Loaded by the real west of the helper environment from this fake Zephyr tree. Like the real runner it runs the CLI
given with --cli as `--connect "port=swd reset=HWrst sn=<dev-id>" --download <build>/zephyr/zephyr.hex --start`.
"""

import json
import os
import subprocess
import sys
from pathlib import Path

from west.commands import WestCommand


class Flash(WestCommand):
    def __init__(self):
        super().__init__("flash", "stand-in flash", "stand-in flash")

    def do_add_parser(self, parser_adder):
        parser = parser_adder.add_parser(self.name)
        parser.add_argument("-d", "--build-dir")
        parser.add_argument("-r", "--runner")
        parser.add_argument("--no-rebuild", action="store_true")
        parser.add_argument("--dev-id")
        parser.add_argument("--cli")
        return parser

    def do_run(self, args, unknown):
        hex_file = Path(args.build_dir) / "zephyr" / "zephyr.hex"
        cli = [sys.executable, args.cli] if args.cli.endswith(".py") else [args.cli]
        command = [*cli, "--connect", f"port=swd reset=HWrst sn={args.dev_id}", "--download", str(hex_file), "--start"]
        record = Path(os.environ["ZEPHYR_BASE"]).parent / "calls.jsonl"
        with open(record, "a", encoding="utf-8") as handle:
            handle.write(json.dumps({"tool": "west-flash", "args": vars(args), "unknown": unknown,
                                     "path": os.environ.get("PATH", "")}) + "\n")
        raise SystemExit(subprocess.call(command))
