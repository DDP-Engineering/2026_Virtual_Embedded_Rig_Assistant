# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "west==1.5.0",
#   "pyelftools==0.33",
#   "PyYAML==6.0.3",
#   "pykwalify==1.8.0",
#   "packaging==26.3",
#   "intelhex==2.3.0",
#   "colorama==0.4.6",
#   "psutil==7.2.2",
#   "pyserial==3.5",
# ]
# ///
"""Flashing of owned Zephyr builds for VERA (program `zephyr-flash` of the zephyr plugin).

Operations: tools, flash, release (VERA's cleanup). Only west's stm32cubeprogrammer runner is verified; the
STM32_Programmer_CLI comes from VERA (VERA_PROGRAM_STM32_PROGRAMMER_CLI). Exit codes: 0 pass, 1 fail, 2 refused
(nothing opened), 3 stopped or error.
"""

import os
import sys

# VERA hashes every file of the installed plugin folder: Python must not write a bytecode cache next to the
# support package. Set before the first import of it.
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from zephyr_support.flash import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
