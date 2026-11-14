"""Fake circup.shared: the constants and extract_metadata of circup 3.1.0, reduced to what the tests exercise."""

import re

BAD_FILE_FORMAT = "Invalid"
PLATFORMS = {"py": "py", "8mpy": "8.x-mpy", "9mpy": "9.x-mpy", "10mpy": "10.x-mpy", "11mpy": "11.x-mpy"}
SUPPORTED_PLATFORMS = ["9mpy", "10mpy", "11mpy"]
NOT_MCU_LIBRARIES = ["", "adafruit-blinka", "adafruit-blinka-bleio", "adafruit-blinka-displayio", "adafruit-circuitpython-typing", "circuitpython_typing", "pyserial"]


def extract_metadata(path, logger):
    result = {}
    if path.endswith(".py"):
        result["mpy"] = False
        with open(path, encoding="utf-8", errors="replace") as handle:
            content = handle.read()
        for match in re.findall(r"""(__\w+__)(?:\s*:\s*\w+)?\s*=\s*(?:['"]|\(\s)(.+)['"]""", content):
            result[match[0]] = str(match[1])
    elif path.endswith(".mpy"):
        result["mpy"] = True
        with open(path, "rb") as handle:
            content = handle.read()
        if content[0:2] == b"C\x06":
            result["compatibility"] = ("9.0.0-alpha.1", None)
            match = re.search(rb"([\d]+\.[\d]+\.[\d]+)\x00", content)
            if match:
                result["__version__"] = match.group(1).decode("utf-8")
        elif content[0:2] == b"C\x05":
            result["compatibility"] = ("7.0.0-alpha.1", "8.99.99")
        else:
            result["__version__"] = BAD_FILE_FORMAT
    return result
