# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Offline power, energy and charge analysis for VERA (program `power-analyze` of the power-profiler plugin).

Operations: acquisition, import, inspect, measure-energy, segment, compare, battery, report. Standard library only;
no device, network or other process. Exit codes: 0 pass, 2 refused, 3 incomplete, 4 error.
"""

import os
import sys

# VERA hashes every file of the installed plugin folder: Python must not write a bytecode cache next to the
# support package. Set before the first import of it.
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from power_support.cli_analyze import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
