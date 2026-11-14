"""Installed PlatformIO packages, read offline (spec REQ-DATA-865c8fbd section 5, REQ-FUNC-684b0afc,
REQ-SEC-bb7ede2f).

PlatformIO keeps platforms in `<core>/platforms/<folder>/platform.json`, tool packages in
`<core>/packages/<folder>/package.json` and an environment's libraries in `<libdeps>/<env>/<folder>/library.json`;
each install also writes `.piopm` (type, name, version, spec). The helper only reads these JSON files: it never loads
a platform's Python code to learn what it needs. The check before a build covers the exact platform release, the
framework packages its manifest names for the environment's frameworks, a toolchain, the build engine tool-scons and
the declared libraries (Unity for tests); packages the platform's own code adds are guarded by the closed proxy.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .errors import Refused

LIMIT = 4 * 1024 * 1024


@dataclass
class Package:
    kind: str
    name: str
    version: str | None
    owner: str | None
    path: Path
    manifest_sha256: str
    manifest: dict[str, Any]

    def as_json(self) -> dict[str, Any]:
        return {"kind": self.kind, "name": self.name, "version": self.version, "owner": self.owner,
                "path": str(self.path), "manifestSha256": self.manifest_sha256}


def _json(path: Path) -> tuple[dict[str, Any], bytes] | None:
    try:
        data = path.read_bytes()[: LIMIT + 1]
    except OSError:
        return None
    if len(data) > LIMIT:
        return None
    try:
        value = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return None
    return (value, data) if isinstance(value, dict) else None


def _scan(root: Path, kind: str, manifest_name: str) -> list[Package]:
    found: list[Package] = []
    try:
        folders = sorted(child for child in root.iterdir() if child.is_dir()) if root.is_dir() else []
    except OSError:
        return found
    for folder in folders[:512]:
        manifest = _json(folder / manifest_name)
        if manifest is None:
            continue
        data, raw = manifest
        meta = _json(folder / ".piopm")
        spec = (meta[0].get("spec") if meta else None) or {}
        owner = spec.get("owner") if isinstance(spec, dict) else None
        found.append(Package(kind, str(data.get("name", folder.name)), str(data["version"]) if "version" in data else None,
                             str(owner) if owner else None, folder, hashlib.sha256(raw).hexdigest(), data))
    return found


def platforms(core: Path) -> list[Package]:
    return _scan(core / "platforms", "platform", "platform.json")


def tools(core: Path) -> list[Package]:
    return _scan(core / "packages", "package", "package.json")


def libraries(libdeps: Path, environment: str) -> list[Package]:
    return _scan(libdeps / environment, "library", "library.json")


def split_spec(spec: str) -> tuple[str | None, str, str | None]:
    """owner/name@version -> (owner, name, version)."""
    owner, _, rest = spec.partition("/") if "/" in spec else (None, "", spec)
    name, _, version = rest.partition("@")
    return owner, name.strip(), version.strip() or None


def platform_of(core: Path, spec: str) -> Package | None:
    owner, name, version = split_spec(spec)
    for package in platforms(core):
        if package.name == name and package.version == version and (package.owner in (None, owner)):
            return package
    return None


@dataclass
class Needed:
    platform: Package | None
    packages: list[Package]
    libraries: list[Package]
    missing: list[str]

    def as_json(self) -> list[dict[str, Any]]:
        return [p.as_json() for p in ([self.platform] if self.platform else []) + self.packages + self.libraries]


def needed(core: Path, libdeps: Path, environment: str, platform: str, frameworks: list[str], lib_deps: list[str],
           tests: bool, test_framework: str) -> Needed:
    """What an environment needs and what of it is installed (spec section 5)."""
    missing: list[str] = []
    found_platform = platform_of(core, platform)
    installed = tools(core)
    by_name = {package.name: package for package in installed}
    chosen: list[Package] = []
    if found_platform is None:
        missing.append(f"platform {platform}")
    else:
        declared = found_platform.manifest.get("packages") or {}
        declared = declared if isinstance(declared, dict) else {}
        framework_table = found_platform.manifest.get("frameworks") or {}
        names: list[str] = []
        for framework in frameworks:
            entry = framework_table.get(framework) if isinstance(framework_table, dict) else None
            if not isinstance(entry, dict) or not entry.get("package"):
                missing.append(f"framework {framework} (not offered by {found_platform.name})")
                continue
            names.append(str(entry["package"]))
        for name, entry in declared.items():
            if isinstance(entry, dict) and (entry.get("type") == "toolchain" or not entry.get("optional", False)):
                names.append(name)
        for name in dict.fromkeys(names):
            if name in by_name:
                chosen.append(by_name[name])
            else:
                missing.append(f"package {name}")
    if "tool-scons" in by_name:
        chosen.append(by_name["tool-scons"])
    else:
        missing.append("package tool-scons")
    libs = libraries(libdeps, environment)
    chosen_libs: list[Package] = []
    wanted = list(lib_deps)
    if tests and test_framework == "unity" and not any(split_spec(spec)[1] == "Unity" for spec in wanted):
        wanted.append("throwtheswitch/Unity")
    for spec in wanted:
        _, name, version = split_spec(spec)
        hit = next((lib for lib in libs if lib.name == name and (version is None or lib.version == version)), None)
        if hit is None:
            missing.append(f"library {spec}")
        else:
            chosen_libs.append(hit)
    return Needed(found_platform, chosen, chosen_libs, missing)


def uploaders(platform: Package, protocol: str) -> list[str]:
    """The `owner/name@requirement` of every uploader the platform declares: PlatformIO makes all of them required for
    an upload target (PlatformBase.configure_default_packages); a J-Link package only for a jlink protocol."""
    declared = platform.manifest.get("packages") or {}
    found: list[str] = []
    for name, entry in (declared.items() if isinstance(declared, dict) else []):
        if not isinstance(entry, dict) or entry.get("type") != "uploader":
            continue
        if "jlink" in name and "jlink" not in protocol:
            continue
        found.append(f"{entry.get('owner', 'platformio')}/{name}@{entry.get('version', '*')}")
    return found


def require(found: Needed) -> None:
    if found.missing:
        raise Refused("packages-missing", "Not installed for this environment: " + ", ".join(found.missing[:8])
                      + ". Run platformio prepare-packages (the network step) first.", {"missing": found.missing})


def board(found: Needed, name: str) -> dict[str, Any] | None:
    """The platform's board definition (boards/<name>.json), when the platform is installed."""
    if found.platform is None or not name:
        return None
    manifest = _json(found.platform.path / "boards" / f"{name}.json")
    return manifest[0] if manifest else None
