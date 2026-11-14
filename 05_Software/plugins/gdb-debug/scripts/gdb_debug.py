# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Supervised GDB debugging for VERA (program `gdb-debug` of the gdb-debug plugin).

Each call is one finite session: OpenOCD from a package profile on 127.0.0.1, GDB/MI driven through pipes this helper
owns, a fixed command set, the declared exit policy, both processes stopped. Operations: tools, snapshot, break, step,
and the cleanup release. Exit codes: 0 pass, 2 refused (nothing started), 3 incomplete, blocked or error.
"""

import os
import sys

# VERA hashes every file of the installed plugin folder: Python must not write a bytecode cache next to the
# support package. Set before the first import of it.
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from gdb_support.cli_debug import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
