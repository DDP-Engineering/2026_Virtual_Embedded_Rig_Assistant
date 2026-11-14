# /// script
# requires-python = ">=3.11"
# dependencies = ["circup==3.1.0", "pyserial==3.5"]
# ///
"""CircuitPython code and compatible libraries for VERA (program `circuitpython-tool` of the circuitpython plugin).

Operations: devices, identify, inspect-code, inspect-libraries, prepare-libraries, deploy, capture-output, report.
The board is reached through its CIRCUITPY drive and, for console capture, its serial port; circup supplies the
library-bundle conventions, never its CLI. Exit codes: 0 pass, 1 fail, 2 refused before anything was written to a
volume or sent to a board, 3 incomplete or error.
"""

import os
import sys

# VERA hashes every file of the installed plugin folder: Python must not write a bytecode cache next to the
# support package. Set before the first import of it.
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from circuitpython_support.cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
