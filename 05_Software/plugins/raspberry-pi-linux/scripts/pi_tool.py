# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "asyncssh==2.24.1",
#   "cryptography==49.0.0",
#   "typing-extensions==4.16.0",
# ]
# ///
"""Projects, tasks and user services on a Linux board (Raspberry Pi) for VERA (program `pi-tool` of the
raspberry-pi-linux plugin).

Operations: capabilities, check-host-key, trust-host-key, install-helper, identify, inspect-project, compare, deploy,
deploy-candidate, apply-candidate, run-task, exec, task-status, stop-owned, service-status, service-start,
service-stop, collect-logs, fetch, report. The board is a `linux-board` entry of lab/resources.json ($PI_REGISTRY),
reached as `ssh` reaches it: a host key learned on first use and a key of the SSH agent or of ~/.ssh; on the board the
remote helper acts, reached through two constant commands. Exit codes: 0 pass, 1 fail, 2 blocked, 3 incomplete or
error.
"""

import os
import sys

# VERA hashes every file of the installed plugin folder: Python must not write a bytecode cache next to the
# support package. Set before the first import of it.
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from pi_support.cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
