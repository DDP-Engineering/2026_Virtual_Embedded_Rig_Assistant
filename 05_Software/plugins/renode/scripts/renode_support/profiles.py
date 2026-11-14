"""Platform profiles of renode-sim and their validators (spec REQ-DATA-8a943977 section 3, REQ-SEC-1190bf53).

A profile is `profile.json`, one `.repl` and one `.resc`, in the plugin's `profiles/<id>/` or the workbench's
`renode/profiles/<id>/`. The `.repl` may use only the pinned engine's own platform files (by their recorded hash) or
`.repl` files beside it, and may not contain monitor commands, host-binding objects or host paths. The `.resc` is
parsed into a small set of approved commands; its text is never sent to the engine.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .errors import Refused

PROFILE_BYTES = 64 * 1024
REPL_BYTES = 64 * 1024
REPL_FILES = 8
ID = re.compile(r"[a-z][a-z0-9-]{0,47}")
NAME = re.compile(r"[a-z][a-z0-9-]{0,31}")
UART_NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_]{0,31}")
TARGET = re.compile(r"sysbus(?:\.[A-Za-z_][A-Za-z0-9_]*){1,3}")
HEX = re.compile(r"0x[0-9a-fA-F]{1,8}")
SHA256 = re.compile(r"[0-9a-f]{64}")
ENGINE_FILE = re.compile(r"platforms/[A-Za-z0-9_./-]{1,200}\.repl")
LOCAL_REPL = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}\.repl")
ARCHES = {
    "cortex-m0": {"v6-M", "v6S-M"},
    "cortex-m0plus": {"v6-M", "v6S-M"},
    "cortex-m3": {"v7-M"},
    "cortex-m4": {"v7E-M"},
    "cortex-m7": {"v7E-M"},
    "cortex-m33": {"v8-M.main"},
}
STIMULUS_KINDS = {"button", "uart-input"}
OBSERVABLE_KINDS = {"led"}
KEYS = {
    "format", "id", "title", "platform", "engine", "verification", "repl", "resc", "engineFiles", "cpu", "boot",
    "memory", "uarts", "console", "peripherals", "stimuli", "observables", "unsupported", "slice",
}
# Constructs a workbench .repl may not contain: host-binding objects, scripts, monitor commands, host paths.
DENIED_WORDS = re.compile(
    r"python|script|socket|pty|tap|switch|hostnetwork|usbip|gdb|terminal|backend|filename|filepath", re.IGNORECASE
)
QUOTED = re.compile(r'"([^"\\]*)"')
# `@ sysbus <...>`, `@ gpioPortA`, `@ none` and `@ { ... }` register a peripheral; nothing else may follow an @.
# and `-> nvic@38`, `-> gpioPortA@0`, `[0-3] -> nvic@[19-22]` connect interrupt lines.
REGISTRATION = re.compile(r"@\s*(?:\{|\[|[0-9]|[A-Za-z_][A-Za-z0-9_]*(?=\s|$|[<{;,\]]))")


@dataclass
class Profile:
    id: str
    origin: str
    folder: Path
    data: dict[str, Any]
    files: dict[str, str] = field(default_factory=dict)
    commands: list[tuple[str, ...]] = field(default_factory=list)
    sha256: str = ""

    @property
    def arch(self) -> str:
        return self.data["cpu"]["arch"]

    @property
    def isa(self) -> str:
        return self.data["cpu"]["isa"]

    @property
    def boot(self) -> int:
        return int(self.data["boot"], 16)

    @property
    def slice(self) -> float:
        return float(self.data["slice"])

    def regions(self) -> list[tuple[str, str, int, int]]:
        return [(m["name"], m["kind"], int(m["start"], 16), int(m["size"], 16)) for m in self.data["memory"]]

    def row(self) -> dict[str, Any]:
        """The compact listing row; `profiles --profile ID` shows the whole summary."""
        data = self.data
        return {
            "id": self.id, "origin": self.origin, "sha256": self.sha256, "title": data["title"], "engine": data["engine"],
            "verification": data["verification"], "cpu": data["cpu"], "boot": data["boot"], "console": data["console"],
            "stimuli": sorted(data["stimuli"]), "observables": sorted(data["observables"]),
            "peripherals": [entry["name"] for entry in data["peripherals"]], "unsupported": len(data["unsupported"]),
        }

    def summary(self) -> dict[str, Any]:
        keep = ("title", "platform", "engine", "verification", "cpu", "boot", "memory", "uarts", "console",
                "peripherals", "stimuli", "observables", "unsupported", "slice")
        return {
            "id": self.id,
            "origin": self.origin,
            "sha256": self.sha256,
            "files": dict(self.files),
            "engineFiles": dict(self.data["engineFiles"]),
            **{key: self.data[key] for key in keep},
        }


def _refuse(profile: str, message: str, detail: dict | None = None) -> Refused:
    return Refused("profile-refused", f"Profile {profile}: {message}", detail)


def _text(value: Any, limit: int) -> bool:
    return isinstance(value, str) and 0 < len(value) <= limit and not any(ord(c) < 32 or ord(c) == 127 for c in value)


def _check_document(pid: str, data: Any) -> None:
    if not isinstance(data, dict):
        raise _refuse(pid, "profile.json is not a JSON object.")
    unknown = set(data) - KEYS
    if unknown:
        raise _refuse(pid, f"profile.json has unknown keys: {', '.join(sorted(unknown))}.")
    missing = KEYS - set(data)
    if missing:
        raise _refuse(pid, f"profile.json lacks: {', '.join(sorted(missing))}.")
    if type(data["format"]) is not int or data["format"] != 1:
        raise _refuse(pid, "profile.json format must be 1.")
    if data["id"] != pid:
        raise _refuse(pid, f"profile.json names id {str(data['id'])[:48]!r}, not its folder name.")
    for key, limit in (("title", 200), ("platform", 400)):
        if not _text(data[key], limit):
            raise _refuse(pid, f"{key} must be 1-{limit} printable characters.")
    if not isinstance(data["engine"], str) or not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", data["engine"]):
        raise _refuse(pid, "engine must be a version such as 1.17.0.")
    if data["verification"] not in ("verified", "unverified"):
        raise _refuse(pid, "verification must be verified or unverified.")
    for key, suffix in (("repl", ".repl"), ("resc", ".resc")):
        value = data[key]
        if not isinstance(value, str) or not LOCAL_REPL.fullmatch(value.replace(".resc", ".repl")) or not value.endswith(suffix):
            raise _refuse(pid, f"{key} must be a plain {suffix} file name beside profile.json.")
    files = data["engineFiles"]
    if not isinstance(files, dict) or len(files) > 16:
        raise _refuse(pid, "engineFiles must map at most 16 engine platform files to their SHA-256.")
    for name, digest in files.items():
        if not ENGINE_FILE.fullmatch(name) or ".." in name or not isinstance(digest, str) or not SHA256.fullmatch(digest):
            raise _refuse(pid, f"engineFiles entry {name[:80]!r} must be a platforms/... .repl path with a SHA-256.")
    cpu = data["cpu"]
    if not isinstance(cpu, dict) or set(cpu) != {"arch", "isa"} or not isinstance(cpu["arch"], str) or not isinstance(cpu["isa"], str) or cpu["arch"] not in ARCHES or cpu["isa"] not in ARCHES[cpu["arch"]]:
        raise _refuse(pid, f"cpu must be {{arch, isa}} with arch one of {', '.join(ARCHES)} and its ISA.")
    if not isinstance(data["boot"], str) or not HEX.fullmatch(data["boot"]):
        raise _refuse(pid, "boot must be a hexadecimal address such as 0x08000000.")
    memory = data["memory"]
    if not isinstance(memory, list) or not 1 <= len(memory) <= 16:
        raise _refuse(pid, "memory must list 1-16 regions.")
    kinds = set()
    for region in memory:
        if (
            not isinstance(region, dict)
            or set(region) != {"name", "kind", "start", "size"}
            or not isinstance(region["name"], str)
            or not UART_NAME.fullmatch(region["name"])
            or region["kind"] not in ("flash", "ram")
            or not isinstance(region["start"], str)
            or not HEX.fullmatch(region["start"])
            or not isinstance(region["size"], str)
            or not HEX.fullmatch(region["size"])
            or int(region["size"], 16) == 0
            or int(region["start"], 16) + int(region["size"], 16) > 1 << 32
        ):
            raise _refuse(pid, "each memory region must be {name, kind: flash|ram, start, size} inside 32 bits.")
        kinds.add(region["kind"])
    if kinds != {"flash", "ram"}:
        raise _refuse(pid, "memory must hold at least one flash and one ram region.")
    uarts = data["uarts"]
    if not isinstance(uarts, dict) or not 1 <= len(uarts) <= 16:
        raise _refuse(pid, "uarts must map 1-16 names to their sysbus peripheral.")
    for name, target in uarts.items():
        if not UART_NAME.fullmatch(name) or not isinstance(target, str) or not TARGET.fullmatch(target):
            raise _refuse(pid, f"uart {name[:32]!r} must name a sysbus peripheral such as sysbus.usart2.")
    if not isinstance(data["console"], str) or data["console"] not in uarts:
        raise _refuse(pid, "console must name one of the uarts.")
    peripherals = data["peripherals"]
    if not isinstance(peripherals, list) or len(peripherals) > 64:
        raise _refuse(pid, "peripherals must list at most 64 modeled peripherals.")
    for entry in peripherals:
        if (
            not isinstance(entry, dict)
            or not set(entry) <= {"name", "model", "address", "note"}
            or not {"name", "model"} <= set(entry)
            or not all(_text(entry[key], 300) for key in entry)
        ):
            raise _refuse(pid, "each peripheral must be {name, model, address?, note?} of printable text.")
    for group, allowed in (("stimuli", STIMULUS_KINDS), ("observables", OBSERVABLE_KINDS)):
        values = data[group]
        if not isinstance(values, dict) or len(values) > 32:
            raise _refuse(pid, f"{group} must map at most 32 names to declarations.")
        for name, entry in values.items():
            if not NAME.fullmatch(name) or not isinstance(entry, dict) or not isinstance(entry.get("kind"), str) or entry["kind"] not in allowed:
                raise _refuse(pid, f"{group} entry {name[:32]!r} must have a kind of {', '.join(sorted(allowed))}.")
            if entry["kind"] == "uart-input":
                if set(entry) != {"kind", "uart"} or not isinstance(entry["uart"], str) or entry["uart"] not in uarts:
                    raise _refuse(pid, f"stimulus {name} must name one of the profile's uarts.")
            elif set(entry) != {"kind", "target"} or not isinstance(entry["target"], str) or not TARGET.fullmatch(entry["target"]):
                raise _refuse(pid, f"{group} entry {name} must name a sysbus target such as sysbus.gpioPortA.UserButton.")
    unsupported = data["unsupported"]
    if not isinstance(unsupported, list) or len(unsupported) > 32 or not all(_text(item, 400) for item in unsupported):
        raise _refuse(pid, "unsupported must list at most 32 printable statements.")
    value = data["slice"]
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0.001 <= value <= 0.1:
        raise _refuse(pid, "slice must be 0.001-0.1 virtual seconds.")


def _strip_comments(name: str, pid: str, text: str) -> list[str]:
    """The lines of a platform description with `//` and `/* */` comments removed in one quote-aware pass (a comment
    marker inside a string is part of the string). A string that spans lines or holds a comment marker is refused,
    so the validator and the engine can never disagree about where a comment ends."""
    out: list[str] = []
    in_block = False
    for number, raw in enumerate(text.splitlines(), 1):
        kept: list[str] = []
        quoted = False
        index = 0
        while index < len(raw):
            pair = raw[index:index + 2]
            char = raw[index]
            if in_block:
                if pair == "*/":
                    in_block = False
                    index += 2
                    continue
                index += 1
                continue
            if quoted:
                if pair in ("/*", "*/", "//"):
                    raise _refuse(pid, f"{name} line {number}: a comment marker inside a string is not allowed",
                                  {"file": name, "line": number, "cause": "comment marker inside a string"})
                if char == '"':
                    quoted = False
                kept.append(char)
                index += 1
                continue
            if pair == "//":
                break
            if pair == "/*":
                in_block = True
                index += 2
                continue
            if char == '"':
                quoted = True
            kept.append(char)
            index += 1
        if quoted:
            raise _refuse(pid, f"{name} line {number}: a string must end on its line",
                          {"file": name, "line": number, "cause": "unterminated string"})
        out.append("".join(kept))
    if in_block:
        raise _refuse(pid, f"{name}: a /* comment is not closed.")
    return out


def _strip_comment(line: str) -> str:
    """The line without a `//` comment outside a quoted string."""
    quoted = False
    for index, char in enumerate(line):
        if char == '"':
            quoted = not quoted
        elif not quoted and line.startswith("//", index):
            return line[:index]
    return line


def check_repl(pid: str, folder: Path, name: str, engine_files: dict[str, str], seen: dict[str, str]) -> None:
    """Validates one profile .repl and the local .repl files it uses (REQ-SEC-1190bf53); fills `seen` with hashes."""
    if name in seen:
        return
    if len(seen) >= REPL_FILES:
        raise _refuse(pid, f"more than {REPL_FILES} .repl files.")
    path = folder / name
    try:
        data = path.read_bytes()
    except OSError as error:
        raise _refuse(pid, f"{name} cannot be read: {error.strerror or error}.") from error
    if len(data) > REPL_BYTES:
        raise _refuse(pid, f"{name} is larger than {REPL_BYTES} bytes.")
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as error:
        raise _refuse(pid, f"{name} is not UTF-8 text.") from error
    seen[name] = hashlib.sha256(data).hexdigest()
    local: list[str] = []
    for number, raw in enumerate(_strip_comments(name, pid, text), 1):
        line = raw.strip()
        if not line:
            continue

        def refuse(reason: str, number: int = number) -> Refused:
            return _refuse(pid, f"{name} line {number}: {reason}", {"file": name, "line": number, "cause": reason})

        using = re.fullmatch(r'using\s+"([^"]*)"(?:\s+prefixed\s+"[A-Za-z0-9_]{1,32}")?', line)
        if using:
            target = using.group(1)
            if target in engine_files:
                continue
            if LOCAL_REPL.fullmatch(target):
                local.append(target)
                continue
            raise refuse(f"using {target[:120]!r} names neither a hashed engine platform file nor a .repl beside the profile")
        if line.startswith("using"):
            raise refuse("only using \"<file>\" is allowed")
        if re.search(r"\binit\b", line):
            raise refuse("init blocks run monitor commands and are not allowed")
        # `@ sysbus <...>` registers a peripheral; `@` before anything but a peripheral name is a file path.
        for index in (i for i, char in enumerate(line) if char == "@"):
            if not REGISTRATION.match(line, index):
                raise refuse("@ file paths are not allowed; @ may only register a peripheral on a bus")
        if "://" in line:
            raise refuse("URLs are not allowed")
        if "\\" in line:
            raise refuse("backslashes (host paths) are not allowed")
        words = DENIED_WORDS.search(line)
        if words:
            raise refuse(f"{words.group(0)!r} can bind a host resource or run a script")
        for quoted in QUOTED.findall(line):
            if quoted.startswith(("/", "~")) or re.match(r"^[A-Za-z]:", quoted) or ".." in quoted:
                raise refuse("host file paths are not allowed")
    for target in local:
        check_repl(pid, folder, target, engine_files, seen)


def parse_resc(pid: str, text: str, repl: str) -> list[tuple[str, ...]]:
    """The approved commands of a profile .resc (spec section 3); any other line is refused with its number."""
    commands: list[tuple[str, ...]] = []
    for number, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line == "using sysbus":
            commands.append(("using-sysbus",))
        elif re.fullmatch(r'mach create(?:\s+"[A-Za-z0-9_-]{1,48}")?', line):
            commands.append(("mach-create",))
        elif re.fullmatch(r"machine LoadPlatformDescription @(\S+)", line):
            target = line.split("@", 1)[1]
            if target != repl:
                raise _refuse(pid, f"resc line {number}: LoadPlatformDescription may load only {repl}.",
                              {"file": "resc", "line": number, "cause": "platform file"})
            commands.append(("load-platform",))
        elif match := re.fullmatch(r"(?:sysbus\.)?cpu PerformanceInMips ([0-9]{1,5})", line):
            mips = int(match.group(1))
            if not 1 <= mips <= 10000:
                raise _refuse(pid, f"resc line {number}: PerformanceInMips must be 1-10000.")
            commands.append(("mips", str(mips)))
        elif match := re.fullmatch(r'emulation SetGlobalQuantum "([0-9]{1,3}(?:\.[0-9]{1,9})?)"', line):
            commands.append(("quantum", match.group(1)))
        else:
            raise _refuse(
                pid,
                f"resc line {number}: {line[:80]!r} is not an approved monitor command (allowed: using sysbus, mach create, "
                "machine LoadPlatformDescription, cpu PerformanceInMips, emulation SetGlobalQuantum).",
                {"file": "resc", "line": number, "cause": "not an approved monitor command"},
            )
    if ("load-platform",) not in commands or ("mach-create",) not in commands:
        raise _refuse(pid, "the resc must create the machine and load the profile's platform.")
    return commands


def load(folder: Path, origin: str) -> Profile:
    pid = folder.name
    if not ID.fullmatch(pid):
        raise _refuse(pid[:48], "the folder name is not a profile id.")
    path = folder / "profile.json"
    try:
        raw = path.read_bytes()
        if len(raw) > PROFILE_BYTES:
            raise _refuse(pid, "profile.json is larger than 64 KiB.")
        data = json.loads(raw.decode("utf-8"))
    except (OSError, UnicodeDecodeError, ValueError, RecursionError) as error:
        raise _refuse(pid, f"profile.json cannot be read: {str(error)[:200]}.") from error
    try:
        _check_document(pid, data)
    except Refused:
        raise
    except (TypeError, KeyError, AttributeError, ValueError) as error:
        raise _refuse(pid, "profile.json has a value of the wrong type.") from error
    seen: dict[str, str] = {}
    check_repl(pid, folder, data["repl"], data["engineFiles"], seen)
    try:
        resc = (folder / data["resc"]).read_bytes()
    except OSError as error:
        raise _refuse(pid, f"{data['resc']} cannot be read: {error.strerror or error}.") from error
    if len(resc) > REPL_BYTES:
        raise _refuse(pid, f"{data['resc']} is larger than {REPL_BYTES} bytes.")
    try:
        commands = parse_resc(pid, resc.decode("utf-8"), data["repl"])
    except UnicodeDecodeError as error:
        raise _refuse(pid, f"{data['resc']} is not UTF-8 text.") from error
    files = {"profile.json": hashlib.sha256(raw).hexdigest(), **seen, data["resc"]: hashlib.sha256(resc).hexdigest()}
    return Profile(pid, origin, folder, data, files, commands, files["profile.json"])


def roots(plugin: Path, cwd: Path) -> list[tuple[str, Path]]:
    return [("plugin", plugin / "profiles"), ("workbench", cwd / "renode" / "profiles")]


def listing(plugin: Path, cwd: Path) -> tuple[list[Profile], list[dict[str, Any]]]:
    """Every profile: the valid ones and the refused ones with their reason (REQ-FUNC-0000b585)."""
    valid: list[Profile] = []
    refused: list[dict[str, Any]] = []
    owners: dict[str, str] = {}
    for origin, root in roots(plugin, cwd):
        try:
            folders = sorted(p for p in root.iterdir() if p.is_dir()) if root.is_dir() else []
        except OSError:
            folders = []
        for folder in folders[:64]:
            try:
                profile = load(folder, origin)
            except Refused as error:
                refused.append({"id": folder.name[:48], "origin": origin, "code": error.code, "reason": error.message, **error.detail})
                continue
            except Exception as error:  # noqa: BLE001 - one malformed workbench profile never hides the others
                refused.append({"id": folder.name[:48], "origin": origin, "code": "profile-refused",
                                "reason": f"Profile {folder.name[:48]} cannot be read: {type(error).__name__}."})
                continue
            if profile.id in owners:
                refused.append({"id": profile.id, "origin": origin, "code": "profile-duplicate",
                                "reason": f"Profile {profile.id} is defined by the {owners[profile.id]} already."})
                valid = [p for p in valid if p.id != profile.id]
                continue
            owners[profile.id] = origin
            valid.append(profile)
    return valid, refused


def find(plugin: Path, cwd: Path, pid: str) -> Profile:
    if not ID.fullmatch(pid):
        raise Refused("profile", f"--profile {pid[:48]!r} is not a profile id.")
    valid, refused = listing(plugin, cwd)
    for profile in valid:
        if profile.id == pid:
            return profile
    for entry in refused:
        if entry["id"] == pid:
            raise Refused(entry["code"], entry["reason"], {k: v for k, v in entry.items() if k in ("file", "line", "cause")})
    raise Refused("profile", f"No profile {pid}; renode-sim profiles lists the supported ones.")


def engine_root(executable: Path) -> Path | None:
    """The folder that holds the engine's `platforms/`: the executable's folder or one of its 3 parents."""
    folder = executable.resolve().parent
    for candidate in [folder, *list(folder.parents)[:3]]:
        if (candidate / "platforms").is_dir():
            return candidate
    return None


def check_engine_files(profile: Profile, executable: Path) -> dict[str, str]:
    """Hashes the profile's engine platform files under the engine root (REQ-SEC-1190bf53, REQ-PLAT-d03a51af).

    A missing or changed file blocks the run, and so does an engine file that would download something or run
    monitor commands (an `init` block or a URL) or that uses an engine file the profile does not hash.
    """
    found: dict[str, str] = {}
    files = profile.data["engineFiles"]
    if not files:
        return found
    root = engine_root(executable)
    if root is None:
        raise Refused("engine-files", f"The engine at {executable} has no platforms folder; profile {profile.id} cannot be checked.")
    for name, expected in files.items():
        path = root / name
        try:
            data = path.read_bytes()
        except OSError as error:
            raise Refused("engine-files", f"Engine file {name} of profile {profile.id} is missing.") from error
        digest = hashlib.sha256(data).hexdigest()
        if digest != expected:
            raise Refused(
                "engine-files",
                f"Engine file {name} has SHA-256 {digest}, not the {expected} profile {profile.id} was made for.",
            )
        text = data.decode("utf-8", errors="replace")
        for number, raw in enumerate(text.splitlines(), 1):
            line = _strip_comment(raw).strip()
            if "://" in line or re.search(r"\binit\b\s*(?:add\s*)?:", line):
                raise Refused(
                    "engine-files",
                    f"Engine file {name} line {number} runs monitor commands or downloads a file ({line[:80]!r}); "
                    f"profile {profile.id} must use a copy without it beside the profile.",
                )
            using = re.fullmatch(r'using\s+"([^"]*)".*', line)
            if using and using.group(1) not in files:
                raise Refused("engine-files", f"Engine file {name} uses {using.group(1)[:120]!r}, which profile {profile.id} does not hash.")
        found[name] = digest
    return found
