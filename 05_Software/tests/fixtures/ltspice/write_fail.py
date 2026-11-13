"""Runs ltspice-tool's real command line and fails the writing of the report files, as a full disk would.

Usage: python write_fail.py <scripts folder> <ltspice-tool arguments...>
"""

import sys

sys.dont_write_bytecode = True
sys.path.insert(0, sys.argv[1])

from ltspice_support import cli, report  # noqa: E402


def write_files(*args, **kwargs):  # type: ignore[no-untyped-def]
    raise OSError(28, "No space left on device")


report.write_files = write_files
sys.exit(cli.main(sys.argv[2:]))
