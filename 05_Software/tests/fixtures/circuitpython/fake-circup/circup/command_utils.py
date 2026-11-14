"""Fake circup.command_utils: clean_library_name and libraries_from_requirements of circup 3.1.0."""

import re


def clean_library_name(assumed_library_name):
    not_standard_names = {
        "adafruit_adafruitio": "adafruit_io",
        "adafruit_asyncio": "asyncio",
        "adafruit_busdevice": "adafruit_bus_device",
        "adafruit_connectionmanager": "adafruit_connection_manager",
        "adafruit_display_button": "adafruit_button",
        "adafruit_neopixel": "neopixel",
        "adafruit_sd": "adafruit_sdcard",
        "adafruit_simpleio": "simpleio",
        "pimoroni_ltr559": "pimoroni_circuitpython_ltr559",
    }
    if "circuitpython" in assumed_library_name:
        assumed_library_name = assumed_library_name.replace("-circuitpython-", "_").replace("_circuitpython_", "_").replace("-", "_")
    if assumed_library_name in not_standard_names:
        return not_standard_names[assumed_library_name]
    return assumed_library_name


def libraries_from_requirements(requirements):
    libraries = ()
    for line in requirements.split("\n"):
        line = line.lower().strip()
        if line.startswith("#") or line == "":
            pass
        else:
            line = re.split("[<>=~[;]", line)[0].strip()
            libraries = libraries + (line,)
    return libraries
