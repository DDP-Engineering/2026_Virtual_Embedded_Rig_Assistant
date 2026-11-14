# /// script
# requires-python = ">=3.11"
# dependencies = ["pyvisa==1.16.2", "pyvisa-py==0.8.1", "pyserial==3.5", "pyusb==1.3.1"]
# ///
"""Identified bench instruments through PyVISA for VERA (program `scpi` of the scpi-instruments plugin).

Operations: capabilities, discover-configured, identify, read, capture, status, configure, close, output, decode.
Instruments are declared in the workbench's lab/resources.json and acted on only through the package's validated
profiles; there is no raw SCPI. Exit codes: 0 pass, 1 fail, 2 refused or blocked before any instrument effect,
3 incomplete or error during I/O.
"""

import os
import sys

# VERA hashes every file of the installed plugin folder: Python must not write a bytecode cache next to the
# support package. Set before the first import of it.
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from scpi_support.cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
