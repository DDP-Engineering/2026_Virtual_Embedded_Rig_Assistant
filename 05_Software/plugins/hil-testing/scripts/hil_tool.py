# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Reports of hardware-in-the-loop runs for VERA (program `hil` of the hil-testing plugin).

VERA itself compiles and runs `hil check <plan>` and `hil run <plan>`; this helper only renders a finished run folder:
`hil report --run DIR` writes report.html, report.md and junit.xml next to its result.json. Standard library only; no
network, no other process. Exit codes: 0 written, 2 refused (nothing written).
"""

import os
import sys

# VERA hashes every file of the installed plugin folder: Python must not write a bytecode cache next to the
# support package. Set before the first import of it.
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from hil_report.cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
