"""Runs `serial_monitor.py list` as on Linux with a /dev/serial/by-id folder.

Usage: python by_id.py <serial_monitor.py> <folder> <JSON {entry name: device}>
BY_ID points at <folder>, whose entries resolve (os.path.realpath) to the devices of the mapping.
"""

import importlib.util
import json
import os
import sys

sys.dont_write_bytecode = True
script, folder, links = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
spec = importlib.util.spec_from_file_location("serial_monitor", script)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.BY_ID = folder
os.path.realpath = lambda path, *args, **kwargs: (
    links.get(os.path.basename(path), path) if os.path.dirname(path) == folder else path
)
sys.exit(module.main(["list"]))
