# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Evidence-based component comparison for VERA (program `parts-compare` of the parts-search plugin).

Operation: compare. It reads one JSON request of hard constraints, preferences and candidates with their datasheet
values and supplier offers, and writes comparison.json, comparison.md and a proposed bom.csv into a new run folder.
It opens no network connection, orders nothing and changes no schematic or BOM. Standard library only. Exit codes:
0 completed, 2 refused request, 3 input or output failure. `parts-compare compare --help` lists the request fields.
"""

import os
import sys

# VERA hashes every file of the installed plugin folder: Python must not write a bytecode cache next to the
# support package. Set before the first import of it.
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from parts_support.cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
