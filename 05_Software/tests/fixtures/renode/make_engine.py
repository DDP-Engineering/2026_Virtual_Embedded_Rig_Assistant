"""Builds a stand-in engine folder in argv[1] for the renode plugin tests (LAB-06), as the LAB-04 make_tools.py does.

renode-sim starts the engine as an executable and looks for `platforms/` beside it, as in the Renode portable package.
On Windows the stand-in becomes a real `renode.exe`: pip's distlib launcher, a shebang naming this Python and a zip
whose `__main__` runs fake_renode.py (what pip does for console scripts); on Linux an executable shebang script. The
platform files are the two Renode 1.17.0 platform descriptions the stm32f4-discovery profile hashes, copied from
`engine/platforms/` (Renode is MIT licensed; the files are byte-identical to tag v1.17.0). The launcher sets
FAKE_RENODE_CONFIG to `fake.json` beside it, where the tests write the stand-in's settings.
"""

from __future__ import annotations

import io
import json
import os
import shutil
import stat
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent


def _main(source: Path, out: Path) -> str:
    config = str(out / "fake.json")
    return (
        f"import os, runpy\nos.environ['FAKE_RENODE_CONFIG'] = {config!r}\n"
        f"runpy.run_path({str(source)!r}, run_name='__main__')\n"
    )


def main() -> None:
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    source = HERE / "fake_renode.py"
    if os.name == "nt":
        from pip._vendor.distlib.scripts import ScriptMaker  # noqa: PLC0415

        launcher = ScriptMaker(str(out), str(out))._get_launcher("t")
        shebang = b'#!"' + sys.executable.encode() + b'"\r\n'
        payload = io.BytesIO()
        with zipfile.ZipFile(payload, "w") as archive:
            archive.writestr("__main__.py", _main(source, out))
        target = out / "renode.exe"
        target.write_bytes(launcher + shebang + payload.getvalue())
    else:
        target = out / "renode"
        target.write_text(f"#!{sys.executable}\n" + _main(source, out))
        target.chmod(target.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    shutil.copytree(HERE / "engine" / "platforms", out / "platforms", dirs_exist_ok=True)
    print(json.dumps({"renode": str(target)}))


if __name__ == "__main__":
    main()
