# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Native Arduino sketches for VERA (program `arduino-tool` of the arduino-cli plugin).

Operations: inspect, boards list|details|search, cores list|search, libraries list|search, install index|core|library,
compile, upload, report, clean. arduino-cli runs only with VERA's own Arduino environment and, outside install, an
offline configuration. Standard library only. Exit codes: 0 completed with status pass, 2 refused before arduino-cli
acted, 3 failed (compile or upload error, undeclared library, tool failure).
"""

import os
import sys

# VERA hashes every file of the installed plugin folder: Python must not write a bytecode cache next to the
# support package. Set before the first import of it.
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from arduino_support.cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
