# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Reproducible LTspice simulation for VERA (program `ltspice-tool` of the ltspice plugin).

Operations: validate, convert, run, sweep, measure, compare, report. The netlist or schematic and its includes are
checked before LTspice runs; LTspice runs in batch mode (-b) on a copy with the request's analysis, and each run
writes a new folder with the log, the raw file, the effective netlist, the series, a plot and a report. Standard
library only. Exit codes: 0 completed, 2 refused (nothing ran), 3 failed (LTspice failed or timed out, an input
changed, output failed).
"""

import os
import sys

# VERA hashes every file of the installed plugin folder: Python must not write a bytecode cache next to the
# support package. Set before the first import of it.
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ltspice_support.cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
