"""Test hook of kicad-layout-tool (KICAD_LAYOUT_TEST_HOOK): run in-process at named points with `point`, `run_dir`,
`state` and `socket` in its globals. HOOK_POINT selects the point and HOOK_ACTION what to do there:
- move-other: a second API client moves footprint R3 by 1 mm (an item the request did not name);
- sleep: write the file HOOK_MARKER, then sleep two minutes (the test stops the helper);
- kill-editor: stop the PCB editor that the open started (the connection is lost);
- duplicate-placed: a second API client updates footprint HOOK_REF twice in one commit (KiCad then holds it twice)."""

import os
import subprocess
import sys
import time
from pathlib import Path

point = globals().get("point")
if point == os.environ.get("HOOK_POINT"):
    action = os.environ.get("HOOK_ACTION")
    if action == "move-other":
        from kipy import KiCad
        from kipy.geometry import Vector2

        board = KiCad(socket_path=globals()["socket"], client_name="hook", timeout_ms=5000).get_board()
        r3 = next(f for f in board.get_footprints() if f.reference_field.text.value == "R3")
        r3.position = Vector2.from_xy(r3.position.x + 1_000_000, r3.position.y)
        board.update_items([r3])
    elif action == "sleep":
        Path(os.environ["HOOK_MARKER"]).write_text("inside", encoding="utf-8")
        time.sleep(120)
    elif action == "duplicate-placed":
        from kipy import KiCad

        board = KiCad(socket_path=globals()["socket"], client_name="hook", timeout_ms=5000).get_board()
        footprint = next(f for f in board.get_footprints() if f.reference_field.text.value == os.environ["HOOK_REF"])
        commit = board.begin_commit()
        board.update_items([footprint])
        board.update_items([footprint])
        board.push_commit(commit, "duplicate")
    elif action == "kill-editor":
        pid = int(globals()["state"]["editor"]["pid"])
        if sys.platform == "win32":
            subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True, check=False)
        else:
            os.kill(pid, 9)
        time.sleep(2)
