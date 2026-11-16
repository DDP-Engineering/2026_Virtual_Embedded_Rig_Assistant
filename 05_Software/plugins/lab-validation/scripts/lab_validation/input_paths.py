"""Host-selected HIL input scope; standalone helper calls retain working-directory confinement."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path, PureWindowsPath

from .errors import Refused
from .workspace import PathRefused, confined, control_free, inside, is_device, utf16_length, utf8


@dataclass(frozen=True)
class InputPolicy:
    scope: str
    excluded: tuple[Path, ...]


def host_policy() -> InputPolicy | None:
    """Read only host environment metadata, never request JSON or command options."""
    raw = os.environ.get("VERA_HIL_INPUT_POLICY")
    if raw is None:
        return None
    try:
        value = json.loads(raw)
        if (not isinstance(value, dict) or set(value) != {"scope", "excludedRoots"}
                or value["scope"] not in ("workbench", "filesystem")
                or not isinstance(value["excludedRoots"], list)
                or any(not isinstance(root, str) or not Path(root).is_absolute() for root in value["excludedRoots"])):
            raise ValueError("invalid host policy")
        return InputPolicy(value["scope"], tuple(
            path for root in value["excludedRoots"]
            for path in (Path(os.path.abspath(root)), Path(root).resolve())
        ))
    except (ValueError, OSError, TypeError) as error:
        raise Refused("path", "The host HIL input policy is invalid.") from error


def input_path(cwd: Path, spelled: Path, raw: str, option: str, policy: InputPolicy | None) -> Path:
    """Apply the captured host scope and exclusions to source files and their members."""
    if not raw or not control_free(raw) or not utf8(raw) or utf16_length(raw) > 1024:
        raise PathRefused(f"{option} needs a bounded ordinary input path.")
    slash = raw.replace("\\", "/")
    if os.name == "nt":
        drive = PureWindowsPath(raw).drive
        tail = slash[2:] if len(drive) == 2 and drive[1] == ":" else slash
        if slash.startswith(("//?/", "//./")) or ":" in tail or (drive and not PureWindowsPath(raw).is_absolute()):
            raise PathRefused(f"{option} refuses device and stream paths.")
        if any(is_device(part) or part.endswith((" ", ".")) for part in tail.split("/") if part not in ("", ".", "..")):
            raise PathRefused(f"{option} refuses device and ambiguous paths.")
    lexical = Path(os.path.abspath(Path(raw) if Path(raw).is_absolute() else cwd / raw))
    if policy and any(inside(root, lexical) for root in policy.excluded):
        raise PathRefused("Agent access to VERA application data is refused in every permission mode.")
    try:
        canonical = lexical.resolve()
    except (OSError, RuntimeError) as error:
        raise PathRefused(f"{option} cannot be resolved.") from error
    if policy and any(inside(root, canonical) for root in policy.excluded):
        raise PathRefused("Agent access to VERA application data is refused in every permission mode.")
    return canonical if policy and policy.scope == "filesystem" else confined(cwd, raw, option, spelled)


def shown(cwd: Path, path: Path) -> str:
    """Keep outside provenance absolute without changing workbench source identities."""
    return path.relative_to(cwd).as_posix() if inside(cwd, path) else path.as_posix()
