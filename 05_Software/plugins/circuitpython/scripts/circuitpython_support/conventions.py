"""The library-bundle conventions circuitpython-tool takes from the pinned circup 3.1.0 (spec REQ-DATA-8f309a53).

Only these names are used: `shared.PLATFORMS`, `shared.SUPPORTED_PLATFORMS`, `shared.extract_metadata`,
`command_utils.clean_library_name`, `command_utils.libraries_from_requirements` and `shared.NOT_MCU_LIBRARIES`.
circup's CLI is never run. Imports are lazy so that operations without libraries do not load circup.
"""

from __future__ import annotations

import logging
import re
from functools import lru_cache

_LOG = logging.getLogger("circuitpython-tool")
_LOG.addHandler(logging.NullHandler())
_LOG.propagate = False
_MAJOR = re.compile(r"(\d+)\.x-mpy")
# The .mpy header of CircuitPython 9 and newer (circup: C\x06 = 9.0.0-alpha.1 and later; C\x05 = 7 and 8).
MPY_HEADER = b"C\x06"


@lru_cache(maxsize=1)
def supported_majors() -> tuple[int, ...]:
    from circup.shared import PLATFORMS, SUPPORTED_PLATFORMS

    majors = []
    for key in SUPPORTED_PLATFORMS:
        found = _MAJOR.fullmatch(PLATFORMS.get(key, ""))
        if found:
            majors.append(int(found.group(1)))
    return tuple(sorted(majors))


def platform(major: int) -> str:
    """The bundle platform name of a firmware major version, such as 9.x-mpy."""
    from circup.shared import PLATFORMS

    return PLATFORMS[f"{major}mpy"]


def clean_name(name: str) -> str:
    from circup.command_utils import clean_library_name

    return clean_library_name(name.strip().lower())


def requirement_names(text: str) -> list[str]:
    """Library names a bundle requirements.txt lists, cleaned, without host-only packages."""
    from circup.command_utils import libraries_from_requirements
    from circup.shared import NOT_MCU_LIBRARIES

    names = []
    for raw in libraries_from_requirements(text):
        if raw in NOT_MCU_LIBRARIES:
            continue
        name = clean_name(raw)
        if name and name not in names:
            names.append(name)
    return names


def version(path: str) -> str | None:
    """The `__version__` circup reads from a .py or .mpy file; None when absent or not a CircuitPython 9+ file."""
    from circup.shared import BAD_FILE_FORMAT, extract_metadata

    try:
        found = extract_metadata(path, _LOG).get("__version__")
    except (OSError, ValueError, UnicodeError):
        return None
    if not isinstance(found, str) or found == BAD_FILE_FORMAT:
        return None
    return found[:64]


def mpy_compatible(head: bytes) -> bool:
    return head[:2] == MPY_HEADER
