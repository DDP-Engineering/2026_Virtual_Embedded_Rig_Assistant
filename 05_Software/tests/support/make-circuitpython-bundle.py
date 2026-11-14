"""Writes small Adafruit-style CircuitPython bundle zips for the circuitpython tests (no download).

Usage: make-circuitpython-bundle.py <out-dir> <tag>. Writes adafruit-circuitpython-bundle-{py,9.x-mpy,10.x-mpy}-<tag>.zip
with the layout of the real bundle (<root>/lib/..., <root>/requirements/<name>/requirements.txt and pyproject.toml).
.mpy files carry the CircuitPython 9+ header C\\x06 and a version string, except adafruit_bad (C\\x05, CircuitPython 8).
"""

import sys
import zipfile
from pathlib import Path

LIBRARIES = {
    # name: (files below lib/, version, requirements.txt, circup_dependencies)
    "adafruit_bme280": (["adafruit_bme280/__init__", "adafruit_bme280/basic", "adafruit_bme280/advanced"], "2.6.4", "Adafruit-Blinka\nadafruit-circuitpython-busdevice\nadafruit-circuitpython-register>=1.0\n", None),
    "adafruit_bus_device": (["adafruit_bus_device/__init__", "adafruit_bus_device/i2c_device"], "5.2.10", "", None),
    "adafruit_register": (["adafruit_register/__init__", "adafruit_register/i2c_bit"], "1.10.1", "adafruit-circuitpython-busdevice\n", None),
    "neopixel": (["neopixel"], "6.3.12", "adafruit-circuitpython-pixelbuf\n", None),
    "adafruit_pixelbuf": (["adafruit_pixelbuf"], "2.0.6", "", None),
    "adafruit_ghost": (["adafruit_ghost"], "0.1.0", "adafruit-circuitpython-nowhere\n", None),
    "adafruit_extra": (["adafruit_extra"], "1.0.0", "", ["adafruit_ticks"]),
    "adafruit_ticks": (["adafruit_ticks"], "1.1.1", "", None),
    "adafruit_bad": (["adafruit_bad"], "0.0.1", "", None),
    "adafruit_badchild": (["adafruit_badchild"], "0.0.1", "adafruit-circuitpython-bad\n", None),
}


def mpy(name: str, version: str) -> bytes:
    header = b"C\x05" if name.startswith("adafruit_bad/") or name == "adafruit_bad" else b"C\x06"
    return header + b"\x00\x1f" + b"__version__\x00" + version.encode() + b"\x00" + name.encode() + b"\x00" * 16


def main(out: str, tag: str) -> None:
    folder = Path(out)
    folder.mkdir(parents=True, exist_ok=True)
    for platform in ("py", "9.x-mpy", "10.x-mpy"):
        root = f"adafruit-circuitpython-bundle-{platform}-{tag}"
        with zipfile.ZipFile(folder / f"{root}.zip", "w", zipfile.ZIP_DEFLATED) as bundle:
            bundle.writestr(f"{root}/VERSIONS.txt", f"bundle {tag}\n")
            for name, (files, version, requirements, extra) in LIBRARIES.items():
                for file in files:
                    if platform == "py":
                        bundle.writestr(f"{root}/lib/{file}.py", f'__version__ = "{version}"\n')
                    else:
                        bundle.writestr(f"{root}/lib/{file}.mpy", mpy(file, version))
                bundle.writestr(f"{root}/requirements/{name}/requirements.txt", requirements)
                pyproject = '[project]\nname = "x"\n'
                if extra:
                    pyproject += "\n[circup]\ncircup_dependencies = [" + ", ".join(f'"{item}"' for item in extra) + "]\n"
                bundle.writestr(f"{root}/requirements/{name}/pyproject.toml", pyproject)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
