# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Analyse KiCad 10 projects for VERA without changing them (program `kicad-tool` of the kicad plugin).

Operations: inspect, erc, drc, bom, netlist, export, review-report. kicad-cli runs on a copy of the project in a
temporary folder; each operation writes a new run folder with result.json and report.md and prints one JSON
document. Standard library only. Exit codes: 0 completed, 2 refused, 3 KiCad or write failure.
"""

import os
import sys

# VERA hashes every file of the installed plugin folder: Python must not write a bytecode cache next to the
# support package. Set before the first import of it.
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from kicad_support.cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
