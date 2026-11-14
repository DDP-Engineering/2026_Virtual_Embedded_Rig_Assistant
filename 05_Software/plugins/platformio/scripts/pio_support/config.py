"""platformio.ini read by PlatformIO's own parser (spec REQ-DATA-865c8fbd section 4, REQ-FUNC-fa8f52db,
REQ-FUNC-90fd8436).

The helper imports `platformio.project.config.ProjectConfig` from its pinned PlatformIO Core and reads the project
inside the project folder (extra_configs globs are relative to it) while os.environ is the scrubbed environment the
build will get, so the effective values it judges are the ones PlatformIO will use: no second parser can disagree
with the tool. Nothing of the project runs: ProjectConfig only reads ini files.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .errors import Refused
from .workspace import inside

FOLDERS = ("src_dir", "include_dir", "lib_dir", "test_dir", "data_dir", "boards_dir", "monitor_dir", "shared_dir")


@dataclass
class Config:
    project: Path
    files: list[Path]
    environments: list[str]
    default_envs: list[str]
    platformio: dict[str, Any]
    raw: list[tuple[str, str, str]]
    effective: dict[str, dict[str, dict[str, Any]]]
    folders: dict[str, Path]
    warnings: list[str] = field(default_factory=list)

    def options(self, environment: str) -> dict[str, dict[str, Any]]:
        return self.effective.get(environment, {})

    def value(self, environment: str, option: str, default: Any = None) -> Any:
        entry = self.options(environment).get(option)
        return default if entry is None else entry["value"]

    def listed(self, environment: str, option: str) -> list[str]:
        value = self.value(environment, option, [])
        if value is None:
            return []
        if isinstance(value, (list, tuple)):
            return [str(item) for item in value if str(item).strip()]
        return [str(value)] if str(value).strip() else []


def _plain(value: Any) -> Any:
    if isinstance(value, (list, tuple)):
        return [_plain(item) for item in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def load(project: Path, env: dict[str, str]) -> Config:
    from . import environment  # noqa: PLC0415

    with environment.applied(env):
        saved = os.getcwd()
        os.chdir(project)
        try:
            return _read(project)
        finally:
            os.chdir(saved)


class _Globs:
    """Stands in for the `glob` module inside PlatformIO's config module while it reads: an extra_configs pattern that
    is absolute, a network or device path, starts with `~` (already expanded to an absolute path) or climbs with `..`
    is refused before anything is read, so a safe inspection never opens a file outside the project."""

    def __init__(self, real: Any, project: Path) -> None:
        self.real = real
        self.project = project

    def glob(self, pattern: str, *args: Any, **kwargs: Any) -> list[str]:
        text = str(pattern)
        if (os.path.isabs(text) or text.startswith(("\\", "/", "~")) or (len(text) > 1 and text[1] == ":")
                or ".." in Path(text.replace("\\", "/")).parts):
            raise Refused("config-outside", f"extra_configs pattern {text[:200]!r} reaches outside the project folder; "
                          "VERA reads only files inside it.")
        found = self.real.glob(pattern, *args, **kwargs)
        for item in found:
            # A link inside the project may lead elsewhere (on Windows even to a network share): judged resolved.
            if not inside(self.project, Path(os.path.realpath(self.project / item))):
                raise Refused("config-outside", f"extra_configs pattern {text[:200]!r} matches {str(item)[:200]!r}, "
                              "which resolves outside the project folder.")
        return found

    def __getattr__(self, name: str) -> Any:
        return getattr(self.real, name)


def _read(project: Path) -> Config:
    from platformio.exception import PlatformioException  # noqa: PLC0415
    from platformio.project import config as module  # noqa: PLC0415
    from platformio.project.config import ProjectConfig  # noqa: PLC0415

    real_glob = module.glob
    module.glob = _Globs(real_glob, project)
    try:
        return _parse(project, ProjectConfig, PlatformioException)
    finally:
        module.glob = real_glob


def _parse(project: Path, ProjectConfig: Any, PlatformioException: Any) -> Config:  # noqa: N803 - classes passed in
    try:
        config = ProjectConfig(str(project / "platformio.ini"))
        files = [Path(os.path.realpath(project / item)) for item in config._parsed]  # noqa: SLF001 - PlatformIO's list
        environments = config.envs()
        default_envs = [str(item) for item in config.default_envs()]
        raw: list[tuple[str, str, str]] = []
        parser = config._parser  # noqa: SLF001 - the merged raw values PlatformIO itself uses
        for section in parser.sections():
            for option in parser.options(section):
                raw.append((section, option, str(parser.get(section, option, raw=True))))
        platformio = {option: _plain(config.get("platformio", option)) for option in parser.options("platformio")} \
            if parser.has_section("platformio") else {}
        folders = {name: Path(os.path.realpath(str(config.get("platformio", name)))) for name in FOLDERS}
        effective: dict[str, dict[str, dict[str, Any]]] = {}
        for name in environments:
            section = f"env:{name}"
            options: dict[str, dict[str, Any]] = {}
            for option in config.options(env=name):
                # PlatformIO reads a renamed option (extra_script, src_filter, lib_use, ...) under its current name:
                # judge it under that name too, with the value PlatformIO's own lookup returns.
                meta = config.find_option_meta(section, option)
                canonical = meta.name if meta is not None else option
                if canonical in options:
                    continue
                names = {canonical, *((meta.oldnames or []) if meta is not None else [])}
                source = next((s for s, o in config.walk_options(section) if o in names), "system environment")
                options[canonical] = {"value": _plain(config.get(section, canonical)), "section": source,
                                      **({"spelled": option} if option != canonical else {})}
            effective[name] = options
    except Refused:
        raise
    except PlatformioException as error:
        raise Refused("input", f"platformio.ini cannot be read: {str(error)[:300]}") from error
    except Exception as error:  # noqa: BLE001 - configparser and recursion errors of a hand-written file
        raise Refused("input", f"platformio.ini cannot be read: {type(error).__name__}: {str(error)[:300]}") from error
    return Config(project=project, files=files, environments=environments, default_envs=default_envs,
                  platformio=platformio, raw=raw, effective=effective, folders=folders,
                  warnings=[str(item) for item in config.warnings])
