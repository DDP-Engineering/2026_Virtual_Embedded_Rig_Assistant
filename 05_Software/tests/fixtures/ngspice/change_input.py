"""Runs ngspice-tool's real command line and changes the --input file right after the engine run: after the run read
the file and before it checks it again, with no timing involved. CHANGE_MODE=delete removes the file instead of
appending a space.

Usage: python change_input.py <scripts folder> <ngspice-tool arguments...>
"""

import os
import pathlib
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, sys.argv[1])

from ngspice_support import cli, engine  # noqa: E402

arguments = sys.argv[2:]
target = pathlib.Path(arguments[arguments.index("--input") + 1])
original = engine.run


def run(*args, **kwargs):  # type: ignore[no-untyped-def]
    outcome = original(*args, **kwargs)
    if os.environ.get("CHANGE_MODE") == "delete":
        target.unlink()
    else:
        target.write_bytes(target.read_bytes() + b" ")
    return outcome


engine.run = run
sys.exit(cli.main(arguments))
