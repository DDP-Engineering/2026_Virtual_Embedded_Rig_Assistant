"""Project inputs of a Wokwi job: wokwi.toml, the firmware and ELF with their form, hash and origin (spec
REQ-DATA-d985bb3d section 3; REQ-FUNC-447f33d6, REQ-SEC-1b90a69a)."""

from __future__ import annotations

import hashlib
import json
import os
import re
import tomllib
from pathlib import Path
from typing import Any

from . import workspace
from .report import Refused, problem, refused

FILE_LIMIT = 32 * 1024 * 1024
TOTAL_LIMIT = 64 * 1024 * 1024
CONFIG_LIMIT = 64 * 1024
FORMS = {".hex": "hex", ".bin": "bin", ".uf2": "uf2", ".elf": "elf"}
FLASHER = "flasher_args.json"
CONFIG_KEYS = {"version", "firmware", "elf"}
CANDIDATE_LIMIT = 50
SKIPPED_FOLDERS = {".git", ".vera", "node_modules", "__pycache__"}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def project_folder(cwd: Path, spelled: Path, raw: str) -> Path:
    try:
        folder = workspace.confined(cwd, raw, "--project", spelled)
    except workspace.PathRefused as error:
        raise refused("path", str(error)) from error
    if not folder.is_dir():
        raise refused("project-missing", f"--project '{raw[:120]}' is not a folder.")
    return folder


def load_config(project: Path) -> dict[str, Any] | None:
    """wokwi.toml of the project, or None. Keys and tables that add files or local ports are unsupported-input."""
    path = project / "wokwi.toml"
    if not path.is_file():
        return None
    try:
        if path.stat().st_size > CONFIG_LIMIT:
            raise refused("config-invalid", "wokwi.toml is larger than 64 KiB.")
        data = tomllib.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, tomllib.TOMLDecodeError) as error:
        raise refused("config-invalid", f"wokwi.toml cannot be read: {str(error)[:200]}") from error
    others = sorted(set(data) - {"wokwi"})
    if others:
        raise refused("unsupported-input", f"wokwi.toml has [{others[0]}]: custom chips, SD cards and other tables add files to the transmission and are not supported.", input=f"wokwi.toml [{others[0]}]")
    table = data.get("wokwi")
    if not isinstance(table, dict):
        raise refused("config-invalid", "wokwi.toml needs a [wokwi] table.")
    extra = sorted(set(table) - CONFIG_KEYS)
    if extra:
        raise refused("unsupported-input", f"wokwi.toml sets {extra[0]}: GDB and RFC 2217 servers and other options are not supported in a finite job.", input=f"wokwi.toml {extra[0]}")
    if table.get("version") != 1 or isinstance(table.get("version"), bool):
        raise refused("config-invalid", "wokwi.toml needs version = 1.")
    if not isinstance(table.get("firmware"), str) or not table["firmware"]:
        raise refused("config-invalid", "wokwi.toml needs firmware as a path.")
    if "elf" in table and (not isinstance(table["elf"], str) or not table["elf"]):
        raise refused("config-invalid", "wokwi.toml elf must be a path.")
    return {"path": "wokwi.toml", "version": 1, "firmware": table["firmware"], "elf": table.get("elf")}


def locate(cwd: Path, spelled: Path, project: Path, option: str | None, configured: str | None, name: str) -> Path | None:
    """An option names a path from the working directory; a wokwi.toml value names one from the project."""
    raw = option if option is not None else (str(project / configured) if configured else None)
    if raw is None:
        return None
    try:
        return workspace.regular_file(cwd, raw, name, spelled)
    except workspace.PathRefused as error:
        raise refused("path", str(error)) from error


def _form(path: Path) -> str:
    if path.name == FLASHER:
        return "esp-idf-flasher-args"
    form = FORMS.get(path.suffix.lower())
    if form is None:
        raise refused("unsupported-input", f"{path.name}: wokwi-tool simulates .hex, .bin, .uf2, .elf or ESP-IDF flasher_args.json firmware.", input=path.name)
    return form


def _check_content(path: Path, form: str) -> None:
    with path.open("rb") as handle:
        head = handle.read(4096)
    if not head:
        raise refused("firmware-invalid", f"{path.name} is empty.")
    if form == "elf" and not head.startswith(b"\x7fELF"):
        raise refused("firmware-invalid", f"{path.name} does not start with the ELF magic.")
    if form == "uf2" and not head.startswith(b"UF2\n"):
        raise refused("firmware-invalid", f"{path.name} does not start with the UF2 magic.")
    if form == "hex":
        first = next((line for line in head.decode("latin-1").splitlines() if line.strip()), "")
        if not first.startswith(":"):
            raise refused("firmware-invalid", f"{path.name} is not an Intel HEX file.")


def flash_parts(cwd: Path, path: Path) -> list[dict[str, Any]]:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, ValueError) as error:
        raise refused("firmware-invalid", f"{path.name} is not JSON.") from error
    files = document.get("flash_files") if isinstance(document, dict) else None
    if not isinstance(files, dict) or not files or len(files) > 16:
        raise refused("firmware-invalid", f"{path.name} needs flash_files with 1-16 entries.")
    parts = []
    for offset, name in files.items():
        if not isinstance(name, str) or not re.fullmatch(r"(?:0x)?[0-9a-fA-F]{1,8}", str(offset)):
            raise refused("firmware-invalid", f"{path.name} has an invalid flash_files entry {str(offset)[:20]}.")
        relative = Path(name)
        part = (path.parent / relative).resolve()
        if relative.is_absolute() or ".." in relative.parts or not workspace.inside(path.parent.resolve(), part) or not part.is_file():
            raise refused("firmware-invalid", f"{path.name} names {name[:120]}, which is not a file inside its folder.")
        if part.stat().st_size > FILE_LIMIT:
            raise refused("firmware-invalid", f"{name[:120]} is larger than 32 MiB.")
        parts.append({"offset": str(offset), "file": relative.as_posix(), "path": workspace.relative(cwd, part), "bytes": part.stat().st_size, "sha256": sha256_file(part)})
    return parts


def fact(cwd: Path, path: Path, role: str) -> dict[str, Any]:
    """Path, form, size and SHA-256 of a firmware or ELF file; refusals for unsupported or mismatched files."""
    form = _form(path)
    if role == "elf" and form != "elf":
        raise refused("firmware-invalid", f"--elf {path.name} must be an ELF file.")
    size = path.stat().st_size
    if size > FILE_LIMIT:
        raise refused("firmware-invalid", f"{path.name} is larger than 32 MiB.")
    _check_content(path, "elf" if role == "elf" else form)
    entry: dict[str, Any] = {"role": role, "path": workspace.relative(cwd, path), "form": form, "bytes": size, "sha256": sha256_file(path)}
    if form == "esp-idf-flasher-args":
        entry["parts"] = flash_parts(cwd, path)
        if sum(part["bytes"] for part in entry["parts"]) > TOTAL_LIMIT:
            raise refused("firmware-invalid", "The flash files are larger than 64 MiB together.")
    entry["origin"] = origin(cwd, path, entry["sha256"])
    return entry


def origin(cwd: Path, path: Path, sha256: str) -> dict[str, Any]:
    """Where a file was built, as far as its location and neighbouring records say; never an identity proof."""
    folder = path.parent
    while workspace.inside(cwd, folder):
        record = folder / "result.json"
        if record.is_file():
            try:
                document = json.loads(record.read_text(encoding="utf-8"))
            except (OSError, UnicodeDecodeError, ValueError):
                document = None
            if isinstance(document, dict) and document.get("operation") == "compile":
                for binary in document.get("binaries") or []:
                    if isinstance(binary, dict) and binary.get("sha256") == sha256 and isinstance(binary.get("path"), str):
                        try:
                            same = (folder / binary["path"]).resolve() == path.resolve()
                        except OSError:
                            same = False
                        if same:
                            return {"tool": "arduino-cli", "run": folder.name, "fqbn": document.get("fqbn")}
            break
        if folder == cwd or folder.parent == folder:
            break
        folder = folder.parent
    shown = workspace.relative(cwd, path)
    pio = re.search(r"(?:^|/)\.pio/build/([^/]+)/", shown)
    if pio:
        return {"tool": "platformio", "environment": pio.group(1)}
    folder = path.parent
    while workspace.inside(cwd, folder):
        description = folder / "project_description.json"
        if description.is_file():
            try:
                target = json.loads(description.read_text(encoding="utf-8")).get("target")
            except (OSError, UnicodeDecodeError, ValueError, AttributeError):
                target = None
            return {"tool": "esp-idf", **({"target": target} if isinstance(target, str) else {})}
        if folder == cwd or folder.parent == folder:
            break
        folder = folder.parent
    return {"tool": "unknown"}


def build_match(firmware: dict[str, Any], elf: dict[str, Any] | None) -> str:
    if elf is None or elf is firmware:
        return "same-file" if elf is firmware else "no-elf"
    first, second = firmware["origin"], elf["origin"]
    if first.get("tool") == "arduino-cli" and second.get("tool") == "arduino-cli" and first.get("run") == second.get("run"):
        return "same-run"
    if Path(firmware["path"]).parent == Path(elf["path"]).parent:
        return "same-folder"
    return "unverified"


def candidates(cwd: Path, project: Path) -> list[str]:
    """Firmware-looking files inside the project, for inspect-project."""
    found: list[str] = []
    for folder, folders, files in os.walk(project):
        folders[:] = sorted(name for name in folders if name not in SKIPPED_FOLDERS and not workspace.is_vera(name))
        if len(Path(folder).relative_to(project).parts) > 6:
            folders[:] = []
            continue
        for name in sorted(files):
            if name == FLASHER or Path(name).suffix.lower() in FORMS:
                found.append(workspace.relative(cwd, Path(folder) / name))
                if len(found) >= CANDIDATE_LIMIT:
                    return found
    return found


def inputs(cwd: Path, spelled: Path, project: Path, firmware_option: str | None, elf_option: str | None) -> dict[str, Any]:
    """The resolved firmware, ELF and config of a project; refusals as for prepare-job."""
    config = load_config(project)
    firmware_path = locate(cwd, spelled, project, firmware_option, config["firmware"] if config else None, "--firmware")
    if firmware_path is None:
        raise refused("firmware-missing", "Name the firmware with --firmware or in wokwi.toml.")
    firmware = fact(cwd, firmware_path, "firmware")
    elf_path = locate(cwd, spelled, project, elf_option, config["elf"] if config else None, "--elf")
    if elf_path is not None and elf_path.resolve() == firmware_path.resolve():
        elf_path = None
    elf = fact(cwd, elf_path, "elf") if elf_path is not None else (firmware if firmware["form"] == "elf" else None)
    total = firmware["bytes"] + (elf["bytes"] if elf is not None and elf is not firmware else 0) + sum(part["bytes"] for part in firmware.get("parts", []))
    if total > TOTAL_LIMIT:
        raise refused("firmware-invalid", "Firmware and ELF are larger than 64 MiB together.")
    return {"config": config, "firmware": firmware, "elf": elf, "buildMatch": build_match(firmware, elf)}


def problems_of(error: Refused) -> list[dict[str, Any]]:
    return [problem(item["code"], item["message"]) for item in error.problems]
