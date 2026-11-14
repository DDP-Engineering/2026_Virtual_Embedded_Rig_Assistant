"""Exact board identifiers checked against Zephyr's board.yml files (spec REQ-DATA-d8ecee6a section 4, REQ-REL-cb83210f).

Hardware model v2: `name[@revision][/soc[/cluster][/variant...]]`. Only the boards of the Zephyr tree itself are
known (a board root of the application or of a module is a preflight finding, not a board source). A revision must
be one the board lists exactly; qualifiers must be a SoC/cluster/variant path the board declares; a board with one
SoC may omit them. The architecture comes from the board's Twister metadata, so the SDK toolchain can be checked.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .errors import Refused

TRIPLES = {"arm": "arm-zephyr-eabi", "arm64": "aarch64-zephyr-elf", "riscv": "riscv64-zephyr-elf",
           "x86": "x86_64-zephyr-elf", "arc": "arc-zephyr-elf", "mips": "mips-zephyr-elf",
           "sparc": "sparc-zephyr-elf", "rx": "rx-zephyr-elf"}


@dataclass(frozen=True)
class Board:
    name: str
    folder: Path
    revision: str | None
    qualifiers: str
    target: str
    arch: str
    toolchain: str | None
    revisions: tuple[str, ...]


def _yaml(path: Path) -> Any:
    import yaml  # noqa: PLC0415

    try:
        return yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, yaml.YAMLError):
        return None


def _variants(prefix: str, items: Any) -> list[str]:
    found: list[str] = []
    for item in items or []:
        if isinstance(item, dict) and isinstance(item.get("name"), str):
            path = f"{prefix}/{item['name']}"
            found.append(path)
            found.extend(_variants(path, item.get("variants")))
    return found


def qualifier_paths(entry: dict[str, Any]) -> list[str]:
    paths: list[str] = []
    for soc in entry.get("socs") or []:
        if not isinstance(soc, dict) or not isinstance(soc.get("name"), str):
            continue
        paths.append(soc["name"])
        paths.extend(_variants(soc["name"], soc.get("variants")))
        for cluster in soc.get("cpuclusters") or []:
            if isinstance(cluster, dict) and isinstance(cluster.get("name"), str):
                base = f"{soc['name']}/{cluster['name']}"
                paths.append(base)
                paths.extend(_variants(base, cluster.get("variants")))
    return paths


def find(zephyr: Path, name: str) -> tuple[dict[str, Any], Path] | None:
    for board_yml in sorted((zephyr / "boards").glob("*/*/board.yml")):
        data = _yaml(board_yml)
        if not isinstance(data, dict):
            continue
        entries = data.get("boards") if isinstance(data.get("boards"), list) else [data.get("board")]
        for entry in entries:
            if isinstance(entry, dict) and entry.get("name") == name:
                return entry, board_yml.parent
    return None


def check(zephyr: Path, name: str, revision: str | None, qualifiers: str | None) -> Board:
    found = find(zephyr, name)
    if found is None:
        raise Refused("board", f"The board {name} is not a board of this Zephyr tree ({zephyr / 'boards'}).")
    entry, folder = found
    spec = entry.get("revision") if isinstance(entry.get("revision"), dict) else None
    revisions = (spec or {}).get("revisions") or []
    listed = tuple(str(item.get("name")) for item in revisions if isinstance(item, dict))
    if revision is not None:
        if not spec:
            raise Refused("board-revision", f"The board {name} has no revisions; remove @{revision}.")
        if spec.get("format") == "custom":
            raise Refused("board-revision", f"The board {name} uses a custom revision scheme (board CMake code); it is not supported.")
        if revision not in listed:
            raise Refused("board-revision", f"The board {name} has no revision {revision}; it lists {', '.join(listed) or 'none'}.")
    paths = qualifier_paths(entry)
    if qualifiers is None:
        socs = [path for path in paths if "/" not in path]
        if len(socs) != 1 or any(path.startswith(f"{socs[0]}/") for path in paths):
            raise Refused("board-qualifier", f"The board {name} needs qualifiers; it declares {', '.join(paths)}.")
        qualifiers = socs[0]
    elif qualifiers not in paths:
        raise Refused("board-qualifier", f"The board {name} has no qualifiers {qualifiers}; it declares {', '.join(paths)}.")
    arch = None
    for metadata in sorted(folder.glob("*.yaml")):
        data = _yaml(metadata)
        if isinstance(data, dict) and isinstance(data.get("arch"), str):
            identifier = str(data.get("identifier", ""))
            if identifier in (name, f"{name}/{qualifiers}") or arch is None:
                arch = data["arch"]
    if arch is None:
        raise Refused("board", f"The board {name} has no Twister metadata naming its architecture.")
    target = name + (f"@{revision}" if revision else "") + f"/{qualifiers}"
    return Board(name, folder, revision, qualifiers, target, arch, TRIPLES.get(arch), listed)
