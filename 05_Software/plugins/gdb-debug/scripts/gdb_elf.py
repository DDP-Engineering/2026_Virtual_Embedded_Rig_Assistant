# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Offline firmware ELF inspection and fault re-diagnosis for VERA (program `gdb-elf` of the gdb-debug plugin).

`gdb-elf inspect <elf>` reports architecture, hash, segments, symbols and debug information; `gdb-elf diagnose
<run-folder>` re-decodes a saved gdb-debug snapshot against its ELF. Standard library only; it starts no process and
opens no device. Exit codes: 0 done, 2 refused.
"""

import os
import sys

# VERA hashes every file of the installed plugin folder: Python must not write a bytecode cache next to the
# support package. Set before the first import of it.
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from gdb_support.cli_elf import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
