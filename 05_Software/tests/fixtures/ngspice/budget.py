"""Runs ngspice-tool's real command line with the sweep budget set to zero, so no sweep point fits.

Usage: python budget.py <scripts folder> <ngspice-tool arguments...>
"""

import sys

sys.dont_write_bytecode = True
sys.path.insert(0, sys.argv[1])

from ngspice_support import cli  # noqa: E402

cli.SWEEP_BUDGET = 0.0
sys.exit(cli.main(sys.argv[2:]))
