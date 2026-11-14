# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Firmware on virtual boards for VERA (program `renode-sim` of the renode plugin).

Runs a firmware ELF on an approved Renode profile, headless, with UARTs on files in a new run folder and no socket,
device or GUI. Operations: tools, profiles, validate, run, capture-uart, test, report. Exit codes: 0 pass, 1 fail or
timeout, 2 refused (nothing written), 3 incomplete, blocked, error or stopped.
"""

import os
import sys

# VERA hashes every file of the installed plugin folder: Python must not write a bytecode cache next to the
# support package. Set before the first import of it.
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from renode_support.cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
