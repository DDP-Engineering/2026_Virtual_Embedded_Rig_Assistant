# /// script
# requires-python = ">=3.11"
# dependencies = ["mpremote==1.29.0", "pyserial==3.5", "platformdirs==4.14.0"]
# ///
"""Finite operations on MicroPython boards for VERA (program `micropython-tool` of the micropython plugin).

Operations: ports, identify, files, read-file, deploy-file, run-file, capture-output, reset, report. mpremote's serial
transport is the engine; the helper sends only its own fixed snippets, so there is no REPL, connect, exec, eval or
mount. Exit codes: 0 pass, 1 fail, 2 refused before the board's files or code were touched, 3 incomplete or error.
"""

import os
import sys

# VERA hashes every file of the installed plugin folder: Python must not write a bytecode cache next to the
# support package. Set before the first import of it.
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from micropython_support.cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
