"""STM32_Programmer_CLI stand-in of the zephyr plugin tests: records its arguments and reports a download."""

import json
import os
import sys
import time
from pathlib import Path

root = Path(os.environ["ZEPHYR_BASE"]).parent
with open(root / "calls.jsonl", "a", encoding="utf-8") as handle:
    handle.write(json.dumps({"tool": "STM32_Programmer_CLI", "args": sys.argv[1:]}) + "\n")
fake = json.loads((root / "fake.json").read_text(encoding="utf-8")) if (root / "fake.json").exists() else {}
time.sleep(float(fake.get("cliSleep", 0)))
print("STM32CubeProgrammer version: 2.23.0")
print("File download complete")
