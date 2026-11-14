# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "platformio==6.2.0",
#   "ajsonrpc==1.2.0",
#   "anyio==4.16.0",
#   "bottle==0.13.4",
#   "certifi==2026.10.23",
#   "charset-normalizer==3.5.2",
#   "click==8.5.1",
#   "colorama==0.4.6",
#   "h11==0.16.0",
#   "idna==3.20",
#   "marshmallow==4.4.0",
#   "pip==26.3",
#   "pyelftools==0.33",
#   "pyserial==3.5",
#   "requests==2.34.2",
#   "semantic-version==2.10.0",
#   "starlette==1.10.0",
#   "tabulate==0.10.0",
#   "typing-extensions==4.16.0",
#   "urllib3==2.8.0",
#   "uvicorn==0.54.0",
#   "wsproto==1.3.2",
# ]
# ///
"""PlatformIO projects for VERA (program `platformio` of the platformio plugin).

Operations: tools, inspect-project, inspect-environments, prepare-packages, build, artifacts, test-host, test-device,
test-run, clean. PlatformIO Core 6.2.0 above (with its whole dependency closure) is the tool every operation uses; it
runs as `<this Python> -m platformio`. Exit codes: 0 pass (test-device: built), 1 fail, 2 refused (nothing written),
3 incomplete, blocked, error or stopped.
"""

import os
import sys

# VERA hashes every file of the installed plugin folder: Python must not write a bytecode cache next to the
# support package. Set before the first import of it.
sys.dont_write_bytecode = True
# Paths and project names may hold any Unicode letter: the one JSON line is UTF-8 whatever the console code page.
sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from pio_support.cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
