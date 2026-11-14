# /// script
# requires-python = ">=3.11"
# dependencies = ["pyyaml==6.0.3"]
# ///
"""Wokwi cloud firmware simulation jobs and finite scenarios for VERA (program `wokwi-tool` of the wokwi plugin).

Operations: capabilities, inspect-project, validate-diagram, prepare-job, run-scenario, collect-results, report.
Everything but run-scenario is offline. run-scenario runs the pinned wokwi-cli 0.29.1 once on a job folder of exact
copies; the Wokwi token arrives only on stdin from VERA and reaches only that wokwi-cli child, in its environment.
Exit codes: 0 pass, 1 fail, 2 blocked before anything was sent, 3 incomplete or error.
"""

import os
import sys

# VERA hashes every file of the installed plugin folder: Python must not write a bytecode cache next to the
# support package. Set before the first import of it.
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from wokwi_support.cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
