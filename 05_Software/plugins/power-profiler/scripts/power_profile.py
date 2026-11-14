# /// script
# requires-python = ">=3.12"
# dependencies = ["pyjoulescope_driver==2.5.5"]
# ///
"""Live power profiling for VERA (program `power-profile` of the power-profiler plugin).

A Joulescope JS220 through the official pyjoulescope_driver: tools, identify, capture and the cleanup release. The
meter is opened without its defaults, its current path is never switched, changed settings are restored and read
back. Exit codes: 0 pass, 2 refused or blocked before any setting changed, 3 incomplete, 4 error.
"""

import os
import sys

# VERA hashes every file of the installed plugin folder: Python must not write a bytecode cache next to the
# support package. Set before the first import of it.
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from power_support.cli_profile import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
