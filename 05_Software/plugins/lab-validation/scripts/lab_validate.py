# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Offline validation of measurements against requirements and simulations for VERA (program `lab-validate` of the
lab-validation plugin).

Operations: inspect, normalize, measure, align, compare, report. A format 1 JSON request names its sources (scpi
capture folders, CSV and sigrok CSV files, ngspice/ltspice run folders), signals, measurements, comparisons and
criteria; every number is computed here, offline, standard library only. Exit codes: 0 pass, 1 fail, 2 refused before
anything was written, 3 incomplete or error.
"""

import os
import sys

# VERA hashes every file of the installed plugin folder: Python must not write a bytecode cache next to the
# support package. Set before the first import of it.
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from lab_validation.cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
