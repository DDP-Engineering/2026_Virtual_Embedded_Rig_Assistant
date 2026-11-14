# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "west==1.5.0",
#   "cmake==4.4.4",
#   "ninja==1.13.2",
#   "pyelftools==0.33",
#   "PyYAML==6.0.3",
#   "pykwalify==1.8.0",
#   "jsonschema==4.26.0",
#   "packaging==26.3",
#   "anytree==2.13.0",
#   "intelhex==2.3.0",
#   "colorama==0.4.6",
#   "ply==3.11",
#   "tabulate==0.10.0",
#   "natsort==8.4.0",
#   "psutil==7.2.2",
#   "junitparser==5.0.3",
#   "python-dotenv==1.2.4",
#   "pyserial==3.5",
#   "requests==2.34.2",
#   "semver==3.1.0",
#   "tqdm==4.70.1",
#   "pytest==9.2.0",
# ]
# ///
"""Zephyr builds and tests for VERA (program `zephyr` of the zephyr plugin).

Operations: tools, inspect, prepare-workspace, build, artifacts, test-build, test-run, clean. The pinned west, CMake
and Ninja above are the host tools every operation uses. Exit codes: 0 pass (test-build: built), 1 fail, 2 refused
(nothing written), 3 incomplete, blocked, error or stopped.
"""

import os
import sys

# VERA hashes every file of the installed plugin folder: Python must not write a bytecode cache next to the
# support package. Set before the first import of it.
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from zephyr_support.cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
