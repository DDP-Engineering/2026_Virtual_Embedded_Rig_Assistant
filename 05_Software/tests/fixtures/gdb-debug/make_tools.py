"""Builds executables for the GDB and OpenOCD stand-ins in argv[1] (LAB-04 tests).

gdb-debug starts its tools as executables, as VERA provides them. On Windows each stand-in becomes a real `.exe`: pip's
distlib launcher, followed by a shebang naming this Python and a zip whose `__main__` runs the stand-in script (what
pip does for console scripts). The launcher passes the argument vector unchanged and its job object ends the Python
child with it. On Linux each is an executable shebang script.
"""

from __future__ import annotations

import io
import json
import os
import stat
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent


def main() -> None:
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    made = {}
    for name, script in (("arm-none-eabi-gdb", "fake_gdb.py"), ("openocd", "fake_openocd.py")):
        source = HERE / script
        if os.name == "nt":
            from pip._vendor.distlib.scripts import ScriptMaker  # noqa: PLC0415

            launcher = ScriptMaker(str(out), str(out))._get_launcher("t")
            shebang = b'#!"' + sys.executable.encode() + b'"\r\n'
            payload = io.BytesIO()
            with zipfile.ZipFile(payload, "w") as archive:
                archive.writestr("__main__.py", f"import runpy\nrunpy.run_path({str(source)!r}, run_name='__main__')\n")
            target = out / f"{name}.exe"
            target.write_bytes(launcher + shebang + payload.getvalue())
        else:
            target = out / name
            target.write_text(f"#!{sys.executable}\nimport runpy\nrunpy.run_path({str(source)!r}, run_name='__main__')\n")
            target.chmod(target.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
        made[name] = str(target)
    print(json.dumps(made))


if __name__ == "__main__":
    main()
