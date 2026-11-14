# /// script
# requires-python = ">=3.11"
# dependencies = ["kicad-python==0.8.0", "protobuf==5.29.6", "pynng==0.9.0"]
# ///
"""Edit candidate copies of KiCad 10 boards through KiCad's IPC API (program `kicad-layout-tool` of the
kicad-layout plugin).

Operations: open (copy a board into a new run folder and open the copy in KiCad's PCB editor), edit (check a
request and run it on the candidate in one commit, then DRC and a report), close (stop that editor). The source
board is never written. Each operation prints one JSON document. Exit codes: 0 completed, 2 refused (nothing
changed), 3 failed (nothing saved, unless the problem says that the edit was saved and its checks did not finish).
"""

import os
import sys

# VERA hashes every file of the installed plugin folder: Python must not write a bytecode cache next to the
# support package. Set before the first import of it.
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from kicad_layout_support.cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
