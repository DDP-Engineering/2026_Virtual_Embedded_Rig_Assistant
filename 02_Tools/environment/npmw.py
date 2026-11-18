"""Run npm, npx or node from the repository-local toolchain, whatever is on the system PATH.

    python 02_Tools/environment/npmw.py npm run verify
    python 02_Tools/environment/npmw.py npx vitest run
    python 02_Tools/environment/npmw.py node --version
    python 02_Tools/environment/npmw.py test          (a first argument that is not npm/npx/node goes to npm)

Runs in the current folder. Install the toolchain first with `python 02_Tools/environment/setup.py`.
"""

from __future__ import annotations

import subprocess
import sys

import toolchain as tc


def packages_stale() -> bool:
    """True when 05_Software/node_modules is missing or older than package-lock.json."""
    lock = tc.SOFTWARE / "package-lock.json"
    installed = tc.SOFTWARE / "node_modules" / ".package-lock.json"
    if not lock.exists():
        return False
    return not installed.exists() or installed.stat().st_mtime < lock.stat().st_mtime


def main(argv: list[str]) -> int:
    if not tc.node_exe().exists():
        print("Node.js is not installed in 02_Tools/runtime; run: python 02_Tools/environment/setup.py", file=sys.stderr)
        return 2
    tool, args = (argv[0], argv[1:]) if argv and argv[0] in ("npm", "npx", "node") else ("npm", argv)
    # A stale install fails later with "cannot find module"; say the cause first. An install repairs it itself.
    if not (tool == "npm" and args[:1] in (["ci"], ["install"])) and packages_stale():
        print(
            "warning: 05_Software/node_modules is missing or older than package-lock.json;"
            " run: python 02_Tools/environment/setup.py",
            file=sys.stderr,
        )
    cmd = [str(tc.node_exe())] if tool == "node" else [str(tc.node_exe()), str(tc.npm_cli(tool))]
    return subprocess.run(cmd + args, env=tc.environment()).returncode


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
