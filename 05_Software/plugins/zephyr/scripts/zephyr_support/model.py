"""The west workspace as it is on disk, read offline (spec REQ-DATA-d8ecee6a section 4).

The manifest is resolved with west's own Manifest class. Imports are read from the imported project's working tree
(ImportFlag.FORCE_PROJECTS with a file importer), so no git process runs; checked-out heads are read from the `.git`
files. Global and system west configuration files are replaced by empty files before west is imported.
"""

from __future__ import annotations

import configparser
import os
import re
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .errors import Refused

LOCAL_KEYS = {("manifest", "path"), ("manifest", "file"), ("zephyr", "base"), ("update", "narrow"), ("update", "fetch")}
SHA1 = re.compile(r"[0-9a-f]{40}")


@dataclass
class Project:
    name: str
    path: Path
    revision: str
    head: str | None
    west_commands: list[Path] = field(default_factory=list)
    module_file: Path | None = None
    module: dict[str, Any] | None = None


@dataclass
class Workspace:
    topdir: Path
    manifest_dir: Path
    manifest_file: Path
    config: dict[str, dict[str, str]]
    projects: list[Project]
    manifest_commands: list[Path]
    manifest_module: Path | None
    zephyr: Path
    version: str
    sdk_minimum: str | None

    def project(self, name: str) -> Project | None:
        return next((project for project in self.projects if project.name == name), None)


def isolate_west_config(folder: Path | None = None) -> None:
    """Points WEST_CONFIG_GLOBAL/SYSTEM at empty files so only the workspace's own .west/config counts."""
    base = folder or Path(tempfile.mkdtemp(prefix="vera-zephyr-west-"))
    for name in ("WEST_CONFIG_GLOBAL", "WEST_CONFIG_SYSTEM"):
        target = base / f"{name.lower()}.ini"
        if not target.exists():
            target.write_text("", encoding="utf-8")
        os.environ[name] = str(target)
    for name in list(os.environ):
        if (name.upper().startswith(("ZEPHYR_", "WEST_")) and name.upper() not in ("WEST_CONFIG_GLOBAL", "WEST_CONFIG_SYSTEM")):
            os.environ.pop(name, None)


def read_head(project_path: Path) -> str | None:
    """The commit a checkout's HEAD names, from the .git files only (a link file, loose refs, packed-refs)."""
    git = project_path / ".git"
    try:
        if git.is_file():
            text = git.read_text(encoding="utf-8", errors="replace").strip()
            if not text.startswith("gitdir:"):
                return None
            target = Path(text[7:].strip())
            git = target if target.is_absolute() else (project_path / target)
        if not git.is_dir():
            return None
        head = (git / "HEAD").read_text(encoding="utf-8", errors="replace").strip()
        for _ in range(4):
            if SHA1.fullmatch(head):
                return head
            if not head.startswith("ref: "):
                return None
            ref = head[5:].strip()
            loose = git / ref
            if loose.is_file():
                head = loose.read_text(encoding="utf-8", errors="replace").strip()
                continue
            packed = git / "packed-refs"
            if packed.is_file():
                for line in packed.read_text(encoding="utf-8", errors="replace").splitlines():
                    parts = line.split(" ", 1)
                    if len(parts) == 2 and parts[1].strip() == ref and SHA1.fullmatch(parts[0]):
                        return parts[0]
            return None
    except OSError:
        return None
    return None


def outer_west(topdir: Path) -> Path | None:
    for parent in topdir.parents:
        if (parent / ".west").exists():
            return parent
    return None


def read_config(topdir: Path) -> dict[str, dict[str, str]]:
    path = topdir / ".west" / "config"
    parser = configparser.ConfigParser(interpolation=None)
    try:
        with open(path, encoding="utf-8") as handle:
            parser.read_file(handle)
    except FileNotFoundError as error:
        raise Refused("west-config", f"The workspace {topdir} has no .west/config; run prepare-workspace first.") from error
    except (OSError, configparser.Error) as error:
        raise Refused("west-config", f".west/config cannot be read: {error}.") from error
    return {section: dict(parser.items(section)) for section in parser.sections()}


def _module(project_path: Path) -> tuple[Path | None, dict[str, Any] | None]:
    import yaml  # noqa: PLC0415

    for name in ("module.yml", "module.yaml"):
        candidate = project_path / "zephyr" / name
        if candidate.is_file():
            try:
                data = yaml.safe_load(candidate.read_text(encoding="utf-8"))
            except (OSError, UnicodeDecodeError, yaml.YAMLError) as error:
                raise Refused("module-hook", f"{candidate} cannot be read as YAML: {error}.") from error
            return candidate, data if isinstance(data, dict) else {}
    return None, None


def _version(zephyr: Path) -> str:
    values: dict[str, str] = {}
    try:
        for line in (zephyr / "VERSION").read_text(encoding="utf-8").splitlines():
            if "=" in line:
                key, _, value = line.partition("=")
                values[key.strip()] = value.strip()
        return f"{int(values['VERSION_MAJOR'])}.{int(values['VERSION_MINOR'])}.{int(values['PATCHLEVEL'])}"
    except (OSError, KeyError, ValueError) as error:
        raise Refused("zephyr-version", f"{zephyr}/VERSION does not name a Zephyr version.") from error


def load(topdir: Path, manifest: str, config_required: bool = True) -> Workspace:
    """Resolves the workspace; `config_required` is false only before prepare-workspace creates .west."""
    from west.configuration import Configuration  # noqa: PLC0415
    from west.manifest import ImportFlag, Manifest, ManifestImportFailed, MalformedManifest  # noqa: PLC0415

    config = read_config(topdir) if config_required or (topdir / ".west" / "config").exists() else {}
    manifest_dir = topdir / manifest
    manifest_file = manifest_dir / config.get("manifest", {}).get("file", "west.yml")

    def importer(project: Any, path: str) -> str | None:
        target = Path(project.abspath) / path
        try:
            return target.read_text(encoding="utf-8")
        except OSError:
            return None

    try:
        if config:
            resolved = Manifest(topdir=topdir, config=Configuration(topdir=topdir), importer=importer,
                                import_flags=ImportFlag.FORCE_PROJECTS)
        else:
            resolved = Manifest.from_data(manifest_file.read_text(encoding="utf-8"), importer=importer,
                                          import_flags=ImportFlag.IGNORE_PROJECTS)
    except (ManifestImportFailed, MalformedManifest, OSError, ValueError) as error:
        raise Refused("manifest", f"The west manifest cannot be resolved: {str(error)[:300]}") from error
    projects: list[Project] = []
    zephyr: Path | None = None
    for item in resolved.get_projects([]):
        if item.name == "manifest" or not resolved.is_active(item):
            continue
        path = Path(item.abspath) if item.abspath else topdir / item.path
        commands = [path / entry for entry in item.west_commands]
        module_file, module = _module(path) if path.is_dir() else (None, None)
        projects.append(Project(item.name, path, str(item.revision), read_head(path), commands, module_file, module))
        if item.name == "zephyr":
            zephyr = path
    self_project = resolved.projects[0]
    manifest_commands = [manifest_dir / entry for entry in getattr(self_project, "west_commands", [])]
    module_file, _ = _module(manifest_dir)
    if zephyr is None:
        raise Refused("manifest", "The workspace's manifest has no project named zephyr.")
    version = _version(zephyr) if (zephyr / "VERSION").exists() else ""
    sdk_minimum = None
    try:
        sdk_minimum = (zephyr / "SDK_VERSION").read_text(encoding="utf-8").strip() or None
    except OSError:
        pass
    return Workspace(topdir, manifest_dir, manifest_file, config, projects, manifest_commands, module_file, zephyr,
                     version, sdk_minimum)


def version_tuple(text: str) -> tuple[int, ...]:
    try:
        return tuple(int(part) for part in text.split("."))
    except ValueError:
        return ()
