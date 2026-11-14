"""Runs `elec-calc` with request files whose names are not valid Unicode text (test fixture).

Node cannot pass such a name as a process argument, so this helper creates the files in the current (empty)
working directory and starts the program itself. NTFS accepts a lone surrogate in a name; other file systems
accept bytes that are not UTF-8.

Usage: odd_name.py <path of elec_calc.py>
Prints one JSON object: for `dc` and `report` the exit code, standard output and the end of standard error, and
the folders that exist afterwards; or {"skipped": reason} when the file system refuses such a name.
"""

import json
import os
import subprocess
import sys

script = sys.argv[1]
REQUEST = b'{"model": "ohm", "voltage": "5 V", "current": "1 A"}'
REPORT = b'{"title": "Odd name", "calculations": [{"id": "a", "operation": "dc", "input": ' + REQUEST + b"}]}"
names = ["req\ud800.json", "rep\ud800.json"] if os.name == "nt" else [b"req\xff.json", b"rep\xff.json"]
try:
    for name, content in zip(names, (REQUEST, REPORT)):
        with open(name, "wb") as handle:
            handle.write(content)
except OSError as error:
    print(json.dumps({"skipped": str(error)}))
    sys.exit(0)

environment = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}
outcome: dict[str, object] = {}
for operation, name, more in (("dc", names[0], []), ("report", names[1], ["--run-id", "odd"])):
    done = subprocess.run([sys.executable, script, operation, "--input", name, *more], capture_output=True, env=environment)
    outcome[operation] = {
        "code": done.returncode,
        "stdout": done.stdout.decode("utf-8", "replace"),
        "stderr": done.stderr.decode("utf-8", "replace")[-400:],
    }
outcome["folders"] = sorted(entry.name for entry in os.scandir(".") if entry.is_dir())
print(json.dumps(outcome))
