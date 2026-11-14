# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Deterministic electrical and thermal calculations for VERA (program `elec-calc` of the electronics-calc plugin).

Operations: dc, divider, rc, losses, thermal, tolerance, report. Each reads one JSON request with explicit units
and prints one format 1 result document with its formulas, assumptions, checks, warnings and limits; nothing is
evaluated from request text. Standard library only, so it runs offline. Exit codes: 0 result, 2 refused request,
3 input or output failure. `elec-calc <operation> --help` lists the models and their fields.
"""

import os
import sys

# VERA hashes every file of the installed plugin folder: Python must not write a bytecode cache next to the
# support package. Set before the first import of it.
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from elec_support.cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
