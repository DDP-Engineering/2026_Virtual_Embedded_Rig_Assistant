"""Test hook: parse an LTspice raw file with ltspice-tool's raw.py and print a JSON summary.

Usage: python -I raw_dump.py <plugin scripts folder> <file.raw>"""

import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, sys.argv[1])

from ltspice_support import raw  # noqa: E402

try:
    data = raw.read(Path(sys.argv[2]))
except raw.RawError as error:
    print(json.dumps({"error": error.kind, "message": str(error)}))
    sys.exit(0)


def value(x: complex | float) -> list[float] | float:
    return [x.real, x.imag] if isinstance(x, complex) else x


print(json.dumps({
    "title": data.title,
    "plot": data.plot,
    "flags": sorted(data.flags),
    "names": data.names,
    "types": data.types,
    "points": data.points,
    "axis": data.has_axis,
    "steps": [end - start for start, end in data.steps],
    "first": [value(column[0]) for column in data.columns],
    "last": [value(column[-1]) for column in data.columns],
    "stepFirst": [[value(column[start]) for column in data.columns] for start, _ in data.steps],
}))
