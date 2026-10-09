# Repository tools and environment

Setup, verification, packaging and diagnostic tooling kept beside the project, outside product source.

## Setup

Requirements on the machine: Python 3.11+ and Git. Everything else is installed inside this folder.

| | Windows | Ubuntu |
|---|---|---|
| Install or repair | `python 02_Tools/setup.py` | `python3 02_Tools/setup.py` |
| Check only | `python 02_Tools/setup.py --check` | `python3 02_Tools/setup.py --check` |

The setup script:
- downloads Node.js (version and SHA-256 pinned in [toolchain.json](toolchain.json)) into `runtime/`;
- runs `npm ci` in `05_Software` once it has a `package-lock.json`, with the npm and Electron
  download caches in `cache/`;
- on Ubuntu, checks the system libraries Electron and headless end-to-end tests need, and prints the
  `sudo apt install …` line for any that are missing. It never installs system packages itself.

`runtime/` and `cache/` are not in Git; running the setup again recreates them.

## Running npm with the local Node.js

```
python 02_Tools/npmw.py npm run verify     # from 05_Software
python 02_Tools/npmw.py npx vitest run
python 02_Tools/npmw.py node --version
```

The AEGIS commands in `.agentic/aegis.toml` use the same wrapper, so they do not depend on the
Node.js installed on the system, if any.

## Files

| File | Purpose |
|---|---|
| `toolchain.json` | pinned Node.js version, archive hashes, Linux system libraries |
| `toolchain.py` | shared paths and environment for the scripts |
| `setup.py` | check and install the toolchain and npm packages |
| `npmw.py` | run npm, npx or node from the local toolchain |
