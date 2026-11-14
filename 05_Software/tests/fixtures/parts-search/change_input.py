"""Runs parts-compare's real command line and appends a space to the --input file right after the comparison is
computed: after the run read the file and before it reads it again, with no timing involved.

Usage: python change_input.py <scripts folder> <parts-compare arguments...>
"""

import pathlib
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, sys.argv[1])

from parts_support import cli  # noqa: E402

arguments = sys.argv[2:]
target = pathlib.Path(arguments[arguments.index("--input") + 1])
original = cli.compare


def compare(request, started):  # type: ignore[no-untyped-def]
    outcome = original(request, started)
    target.write_bytes(target.read_bytes() + b" ")
    return outcome


cli.compare = compare
sys.exit(cli.main(arguments))
