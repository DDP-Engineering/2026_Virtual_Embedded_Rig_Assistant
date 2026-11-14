"""A PCB editor that never serves the KiCad API (KICAD_LAYOUT_TEST_EDITOR): it records its PID and waits until it is
stopped, so the open's wait ends in a connection failure."""

import os
import sys
import time
from pathlib import Path

marker = os.environ.get("STUB_PID_FILE")
if marker:
    Path(marker).write_text(str(os.getpid()), encoding="utf-8")
print("stub editor for", sys.argv[1:], flush=True)
time.sleep(600)
