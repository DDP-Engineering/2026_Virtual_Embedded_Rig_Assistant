# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Autoroute a kicad-layout candidate with Freerouting, offline (program `freerouting-tool` of the freerouting plugin).

Operation: route (export a DSN from a copy of the saved candidate with KiCad's Python, run Freerouting with a finite
budget, convert the new wires and vias of its SES into a kicad-layout request). The candidate is never written: the
agent applies the request with `kicad-layout-tool edit --request`. Prints one JSON document. Exit codes: 0 completed,
2 refused, 3 failed; the candidate is unchanged in every case.
"""

import os
import sys

# VERA hashes every file of the installed plugin folder: no bytecode cache next to the support package.
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from freerouting_support.cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
