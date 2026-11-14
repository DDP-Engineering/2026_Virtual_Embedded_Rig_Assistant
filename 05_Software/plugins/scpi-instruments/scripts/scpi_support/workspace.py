"""Path rules of the electronics plugins, kept as byte-identical copies in each plugin's support package.

The plugins' programs run without approval, so a path an option names is judged from its text before the file
system is asked anything about it: network, device and other-drive paths, control characters and paths that
leave the working directory are refused; only a path inside the working directory by its text is resolved,
links followed, and judged again. Result folders never lie inside `.vera`. This module imports nothing from its
package: a test checks that every copy is identical.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path, PureWindowsPath

# UTF-16 units of a path option, and of the relative path a document repeats as JSON writes it (a quotation mark
# or backslash, both legal in Linux file names, takes two): the output bound counts on that length.
PATH_TEXT_LIMIT = 1024
RUN_ID = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9])?")
DEVICES = frozenset(
    {"CON", "PRN", "AUX", "NUL", *(f"COM{n}" for n in range(1, 10)), *(f"LPT{n}" for n in range(1, 10))}
)
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


class PathRefused(Exception):
    """A path the rules refuse; the message names the option and is meant for the user."""


def utf16_length(text: str) -> int:
    """The length VERA's runner measures: UTF-16 code units, so a character beyond the BMP counts twice."""
    return len(text) + sum(1 for character in text if ord(character) > 0xFFFF)


def control_free(text: str) -> bool:
    """Whether a text holds no control character (C0 or DEL); JSON would write each as a six-unit escape."""
    return _CONTROL.search(text) is None


def is_device(segment: str) -> bool:
    """A Windows device name such as NUL or COM1, also with an extension: never a run id."""
    return segment.split(".")[0].rstrip(" ").upper() in DEVICES


def valid_run_id(value: str) -> bool:
    return RUN_ID.fullmatch(value) is not None and not is_device(value)


def is_vera(segment: str) -> bool:
    """`.vera` in any letter case, also in the spellings Windows opens as that folder (`.vera.`, `.vera::$DATA`)."""
    return segment.split(":")[0].rstrip(". ").casefold() == ".vera"


def inside(root: Path, candidate: Path) -> bool:
    left, right = os.path.normcase(str(root)), os.path.normcase(str(candidate))
    return right == left or right.startswith(left.rstrip("\\/") + os.sep)


def relative(cwd: Path, path: Path) -> str:
    try:
        return Path(os.path.relpath(path, cwd)).as_posix()
    except ValueError:  # Another drive or a device path.
        return path.as_posix()


def json_units(text: str) -> int:
    """The UTF-16 length of a text inside a JSON string, escapes included."""
    return utf16_length(json.dumps(text, ensure_ascii=False)[1:-1])


def utf8(text: str) -> bool:
    try:
        text.encode("utf-8")
    except UnicodeEncodeError:
        return False
    return True


def entered_directory() -> Path:
    """The working directory as the caller named it, which may pass through a link: $PWD when it is that very
    directory, else the system's own name for it. An absolute path may use either name."""
    actual = os.path.abspath(os.getcwd())
    named = os.environ.get("PWD")
    if named and os.path.isabs(named):
        # Compared after its text is normalised: a `..` behind a link must not name a different folder.
        candidate = os.path.abspath(named)
        try:
            if os.path.samefile(candidate, actual):
                return Path(candidate)
        except OSError:
            pass
    return Path(actual)


def confined(cwd: Path, raw: str, option: str, spelled: Path | None = None) -> Path:
    """The path an option names, resolved with links followed, inside the working directory.

    The text is judged first, without any file-system access; only a path that already lies inside the working
    directory by its text is resolved, and the resolved path is judged again. `cwd` is the resolved working
    directory; `spelled` is the same folder as the caller entered it (through a link, perhaps), which an
    absolute path may use as well. On Windows a device name such as NUL becomes a device path by its text and
    is refused as lying outside. Control characters are refused in the text and in the resolved relative path,
    which a document repeats: a link may resolve to a name that holds them."""
    outside = PathRefused(f"{option} must lie inside the working directory; '{raw[:120]}' does not.")
    if not raw:
        raise PathRefused(f"{option} needs a path.")
    if not control_free(raw):
        raise PathRefused(f"{option} takes a path without control characters.")
    if utf16_length(raw) > PATH_TEXT_LIMIT or not utf8(raw):
        raise PathRefused(f"{option} takes a path of at most {PATH_TEXT_LIMIT} UTF-16 units of valid Unicode text.")
    if raw.startswith(("\\\\", "//")):
        raise PathRefused(f"{option} does not accept network (UNC) or device paths.")
    path = Path(raw)
    if os.name == "nt":
        drive = PureWindowsPath(raw).drive
        if drive and (not PureWindowsPath(raw).is_absolute() or drive.casefold() != cwd.drive.casefold()):
            raise outside
    lexical = Path(os.path.abspath(path if path.is_absolute() else cwd / path))
    if not inside(cwd, lexical) and not (spelled is not None and inside(spelled, lexical)):
        raise outside
    try:
        resolved = Path(os.path.realpath(lexical))
    except (OSError, ValueError) as error:
        raise PathRefused(f"{option} '{raw[:120]}' cannot be resolved.") from error
    if not inside(cwd, resolved):
        raise outside
    shown = relative(cwd, resolved)
    if not control_free(shown):
        raise PathRefused(f"{option} resolves to a path that holds control characters.")
    if not utf8(shown) or json_units(shown) > PATH_TEXT_LIMIT:
        raise PathRefused(f"{option} resolves to a path that is too long or not valid Unicode text.")
    return resolved


def regular_file(cwd: Path, raw: str, option: str, spelled: Path | None = None) -> Path:
    """`confined`, and the path must be an existing regular file."""
    resolved = confined(cwd, raw, option, spelled)
    try:
        if not resolved.is_file():
            raise PathRefused(f"{option} '{raw[:120]}' is not an existing regular file.")
    except OSError as error:
        raise PathRefused(f"{option} '{raw[:120]}' cannot be read: {error.strerror or error}.") from error
    return resolved


def allowed_output(cwd: Path, folder: Path) -> bool:
    """Whether a folder, resolved now, still lies inside the working directory and outside `.vera`."""
    resolved = Path(os.path.realpath(folder))
    if not inside(cwd, resolved):
        return False
    return not any(is_vera(segment) for segment in Path(os.path.relpath(resolved, cwd)).parts)


def results_directory(cwd: Path, raw: str, spelled: Path | None = None) -> Path:
    """Where run folders go: inside the working directory, never inside `.vera`, never below or over a file."""
    resolved = confined(cwd, raw, "--results-dir", spelled)
    segments = [*Path(os.path.relpath(resolved, cwd)).parts, *Path(raw).parts]
    if any(is_vera(segment) for segment in segments):
        raise PathRefused("--results-dir must not lie inside .vera; that folder belongs to VERA.")
    try:
        existing = resolved
        while not existing.exists() and existing != existing.parent:
            existing = existing.parent
        if not existing.is_dir():
            raise PathRefused(f"--results-dir '{raw[:120]}' lies on or below a file, not a folder.")
    except OSError as error:
        raise PathRefused(f"--results-dir '{raw[:120]}' cannot be used: {error.strerror or error}.") from error
    return resolved
