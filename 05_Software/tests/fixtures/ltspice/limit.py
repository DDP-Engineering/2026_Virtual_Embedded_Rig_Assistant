"""Runs ltspice-tool's real command line with the raw data limit lowered to LIMIT_ROWS rows (default 1000), so a long
transient is stopped by the data limit within a second.

Usage: python limit.py <scripts folder> <ltspice-tool arguments...>
"""

import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, sys.argv[1])

from ltspice_support import cli, engine  # noqa: E402

engine.ROW_LIMIT_OVERRIDE = int(os.environ.get("LIMIT_ROWS", "1000"))
sys.exit(cli.main(sys.argv[2:]))
