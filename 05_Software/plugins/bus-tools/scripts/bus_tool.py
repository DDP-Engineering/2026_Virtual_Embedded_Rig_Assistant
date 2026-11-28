# /// script
# requires-python = ">=3.11"
# dependencies = ["flatbuffers==25.12.19", "pyserial==3.5"]
# ///
"""Active I2C, SPI and UART transactions through an identified bus adapter for VERA (program `bus-tool` of the
bus-tools plugin).

Operations: devices, capabilities, identify, pins, scan, configure-bus, read-register, write-register, transfer,
sequence, capture, release, report. The one backend is a Bus Pirate 5 or 6 in its BPIO2 binary mode (FlatBuffers over
COBS on its second USB serial port); the adapter is declared in lab/resources.json ($BUS_REGISTRY) and the bus in a
profile file or by the call's own options. Exit codes: 0 pass, 1 fail, 2 blocked before any bus effect, 3 incomplete
or error.
"""

import os
import sys

# VERA hashes every file of the installed plugin folder: Python must not write a bytecode cache next to the
# support package. Set before the first import of it.
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from bus_support.cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
