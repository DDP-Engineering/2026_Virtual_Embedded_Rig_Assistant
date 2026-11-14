"""Read-only USB access prerequisites (spec REQ-DATA-dd3e4fe1 section 5, REQ-FUNC-cd01d9d7).

Nothing here installs, writes or changes a driver, a udev rule or a permission: missing items come back with the
vendor's instructions as text for the user to follow.
"""

from __future__ import annotations

import glob
import os
import sys
from typing import Any

UDEV_FOLDERS = ("/etc/udev/rules.d", "/lib/udev/rules.d", "/usr/lib/udev/rules.d")
UDEV_HINT = ("Install the Joulescope udev rule from the vendor (https://github.com/jetperch/joulescope_driver, file "
             "72-joulescope.rules) into /etc/udev/rules.d, reload udev and replug the meter; VERA does not change udev.")
WINUSB_HINT = ("The JS220 uses Windows' built-in WinUSB driver; when Windows does not bind it, follow the vendor's "
               "instructions. VERA does not install or replace drivers.")


def check() -> dict[str, Any]:
    if sys.platform == "win32":
        system = os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32", "winusb.dll")
        present = os.path.isfile(system)
        return {"platform": "windows", "winusb": {"path": system, "present": present},
                "ok": present, **({} if present else {"hint": WINUSB_HINT})}
    if sys.platform.startswith("linux"):
        rules = sorted({path for folder in UDEV_FOLDERS for path in glob.glob(os.path.join(folder, "*joulescope*"))})
        groups: list[str] = []
        try:
            import grp

            groups = sorted({grp.getgrgid(gid).gr_name for gid in os.getgroups()})
        except (ImportError, KeyError, OSError):
            pass
        return {"platform": "linux", "udevRules": rules, "groups": groups, "ok": bool(rules),
                **({} if rules else {"hint": UDEV_HINT})}
    return {"platform": sys.platform, "ok": False, "hint": "VERA supports power-profiler on Windows x64 and Ubuntu x64 only."}
