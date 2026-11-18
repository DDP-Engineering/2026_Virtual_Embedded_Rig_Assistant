# /// script
# requires-python = ">=3.11"
# dependencies = ["kicad-python==0.8.0", "protobuf==5.29.6", "pynng==0.9.0"]
# ///
"""kicad-layout-tool with the tests' seams (run with `uv run --script` in place of the plugin's script): hook.py runs
at the tool's named points, and an open starts editor_stub.py instead of KiCad's PCB editor. The shipped tool has
neither, so the tests that need a real editor open their candidates with the plugin's own script."""

import runpy
import subprocess
import sys
from pathlib import Path
from typing import Any

HOOKS = Path(__file__).resolve().parent
# As the plugin's script does: no bytecode cache next to the support package.
sys.dont_write_bytecode = True
sys.path.insert(0, str(HOOKS.parents[3] / "plugins" / "kicad-layout" / "scripts"))

from kicad_layout_support import cli, kicad  # noqa: E402


def hook(point: str, **values: Any) -> None:
    runpy.run_path(str(HOOKS / "hook.py"), init_globals={"point": point, **values})


def launch(kicad_cli: Path, board: Path) -> subprocess.Popen[bytes]:
    return subprocess.Popen(
        [sys.executable, str(HOOKS / "editor_stub.py"), str(board)],
        cwd=str(board.parent),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        close_fds=True,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if kicad.WINDOWS else 0,
    )


cli._hook = hook
kicad.launch = launch

if __name__ == "__main__":
    sys.exit(cli.main(sys.argv[1:]))
