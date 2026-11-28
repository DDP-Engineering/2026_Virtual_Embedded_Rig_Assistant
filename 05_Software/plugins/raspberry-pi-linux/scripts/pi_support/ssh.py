"""The SSH connection to a board (spec REQ-DATA-44547a17 section 4), on asyncssh 2.24.1.

It behaves as `ssh` does. The host key is trusted from, in this order: the fingerprints `hostKeys` pins in
lab/resources.json (then nothing else counts); the key pi-tool saved for this host (lab/linux-board-keys.json, next to
the registry); the keys `~/.ssh/known_hosts` holds for it. A host seen for the first time is accepted and saved, as
`ssh -o StrictHostKeyChecking=accept-new` does; a key that differs from the trusted one is refused until the user
accepts it with `trust-host-key`. Host certificates are never trusted and `~/.ssh/config` is not read.

Login is by public key only: the keys of the SSH agent when one answers, then the private keys in `~/.ssh` that need
no passphrase. No password or passphrase is ever asked for or handled.
"""

from __future__ import annotations

import asyncio
import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

import asyncssh

from . import remote
from .registry import Board
from .report import Ended, Refused, refused, stamp

CONNECT_TIMEOUT = 15
REMOTE_TIMEOUT = 120
# sshd counts every offered key against MaxAuthTries (6 by default).
OFFERED_KEYS = 6
STORE = "linux-board-keys.json"
# The order `ssh` asks for host keys in: a board shows its Ed25519 key when it has one.
FAMILIES = (
    ("ssh-ed25519",),
    ("ecdsa-sha2-nistp256", "ecdsa-sha2-nistp384", "ecdsa-sha2-nistp521"),
    ("rsa-sha2-512", "rsa-sha2-256"),
)
DEFAULT_KEY_NAMES = ("id_ed25519", "id_ecdsa", "id_rsa")


def fingerprint(key: Any) -> str:
    return str(key.get_fingerprint("sha256"))


def ssh_dir() -> Path:
    """The user's SSH folder; $PI_SSH_DIR replaces it in tests."""
    return Path(os.environ.get("PI_SSH_DIR") or Path.home() / ".ssh")


def _family(kind: str) -> tuple[str, ...]:
    for family in FAMILIES:
        if kind in family or (kind == "ssh-rsa" and family[0].startswith("rsa")):
            return family
    return ()


def _algorithms(kinds: tuple[str, ...] = ()) -> list[str]:
    """Host key algorithms: those of the trusted keys first, then Ed25519, ECDSA and RSA."""
    first = [name for kind in kinds for name in _family(kind)]
    return list(dict.fromkeys([*first, *(name for family in FAMILIES for name in family)]))


# --- trust in the host key ---------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Trust:
    source: str  # "pinned", "saved", "known_hosts" or "first-use"
    fingerprints: tuple[str, ...] = ()
    kinds: tuple[str, ...] = ()


def _store_path() -> Path:
    return Path(os.environ.get("PI_REGISTRY", "")).parent / STORE


def _store() -> dict[str, Any]:
    try:
        document = json.loads(_store_path().read_text(encoding="utf-8"))
        hosts = document.get("hosts") if isinstance(document, dict) else None
        return hosts if isinstance(hosts, dict) else {}
    except (OSError, ValueError):
        return {}


def save_key(board: Board, presented: dict[str, Any]) -> None:
    """Remembers the board's host key next to the registry; an unwritable folder only loses the memory."""
    hosts = _store()
    hosts[board.address()] = {"fingerprint": presented["fingerprint"], "type": presented["type"], "savedAt": stamp()}
    path = _store_path()
    temporary = path.with_name(path.name + ".tmp")
    try:
        temporary.write_text(json.dumps({"format": 1, "hosts": hosts}, indent=2) + "\n", encoding="utf-8", newline="\n")
        os.replace(temporary, path)
    except OSError:
        pass


def trust(board: Board) -> Trust:
    if board.host_keys:
        return Trust("pinned", board.host_keys)
    saved = _store().get(board.address())
    if isinstance(saved, dict) and isinstance(saved.get("fingerprint"), str):
        return Trust("saved", (saved["fingerprint"],), (str(saved.get("type") or ""),))
    known = ssh_dir() / "known_hosts"
    try:
        if known.is_file():
            keys = asyncssh.match_known_hosts(str(known), board.host, "", board.port)[0]
            if keys:
                return Trust("known_hosts", tuple(fingerprint(key) for key in keys), tuple(key.get_algorithm() for key in keys))
    except (OSError, ValueError, asyncssh.Error):
        pass
    return Trust("first-use")


class TrustClient(asyncssh.SSHClient):
    def __init__(self, trusted: Trust, record_only: bool = False) -> None:
        self.trusted = trusted
        self.record_only = record_only
        self.presented: dict[str, Any] | None = None

    def validate_host_public_key(self, host: str, addr: str, port: int, key: asyncssh.SSHKey) -> bool:
        found = fingerprint(key)
        first = self.trusted.source == "first-use"
        self.presented = {"type": key.get_algorithm(), "fingerprint": found, "trusted": first or found in self.trusted.fingerprints, "trust": self.trusted.source}
        return not self.record_only and bool(self.presented["trusted"])


WHERE = {"pinned": "the one lab/resources.json pins (hostKeys)", "saved": "the one VERA saved for this board", "known_hosts": "the one ~/.ssh/known_hosts holds for it"}


def host_key_refusal(board: Board, presented: dict[str, Any]) -> Exception:
    remedy = (
        "update hostKeys in lab/resources.json"
        if presented["trust"] == "pinned"
        else f"accept the new key with `pi-tool trust-host-key --board {board.alias}`"
    )
    return refused(
        "host-key-changed",
        f"{board.alias} ({board.host}) presents the host key {presented['fingerprint']} ({presented['type']}), not {WHERE.get(presented['trust'], 'a trusted one')}. Nothing was sent. If the board's system was installed again, {remedy}; otherwise another machine answers at this address.",
        hostKey=presented,
    )


def _unreachable(board: Board, error: BaseException) -> Exception:
    if isinstance(error, asyncio.TimeoutError):
        return refused("timeout", f"{board.host}:{board.port} did not answer within {CONNECT_TIMEOUT} s. Check that the board is powered, on the network and that SSH is enabled on it.")
    return refused("unreachable", f"{board.host}:{board.port} cannot be reached: {type(error).__name__}: {str(error)[:200]}. Check the host name or address, that the board is on the network and that SSH is enabled on it.")


async def _present(board: Board, trusted: Trust, algorithms: list[str]) -> dict[str, Any]:
    """Connects only until the host key is presented; never authenticates."""
    client = TrustClient(trusted, record_only=True)
    try:
        conn = await asyncio.wait_for(
            asyncssh.connect(
                board.host, board.port, username=board.user, client_factory=lambda: client, known_hosts=lambda *_: ([], [], []),
                config=None, client_keys=None, agent_path=None, password_auth=False, kbdint_auth=False, gss_host=None,
                x509_trusted_certs=None, server_host_key_algs=algorithms, connect_timeout=CONNECT_TIMEOUT, login_timeout=CONNECT_TIMEOUT,
            ),
            CONNECT_TIMEOUT + 5,
        )
        conn.close()
    except asyncssh.HostKeyNotVerifiable:
        pass
    except (OSError, asyncio.TimeoutError, asyncssh.Error) as error:
        if client.presented is None:
            raise _unreachable(board, error) from error
    if client.presented is None:
        raise refused("unreachable", f"{board.alias} presented no host key.")
    return client.presented


async def _trusted_algorithms(board: Board, trusted: Trust) -> tuple[dict[str, Any], list[str]]:
    """The key the board presents and the algorithms that make it present a trusted one.

    A board holds several host keys (Ed25519, ECDSA, RSA) and shows the one the client asks for first; a pin or a
    known_hosts line may name any of them, so each kind is asked for before the key counts as changed."""
    algorithms = _algorithms(trusted.kinds)
    presented = await _present(board, trusted, algorithms)
    if presented["trusted"]:
        return presented, algorithms
    for family in FAMILIES:
        if presented["type"] in family or (presented["type"] == "ssh-rsa" and family[0].startswith("rsa")):
            continue
        try:
            other = await _present(board, trusted, list(family))
        except Refused:
            continue
        if other["trusted"]:
            return other, list(family)
    return presented, algorithms


async def check_host_key(board: Board) -> dict[str, Any]:
    """The key the board presents and whether it is trusted; never authenticates."""
    trusted = trust(board)
    presented, _ = await _trusted_algorithms(board, trusted)
    if trusted.source == "first-use":
        presented["trusted"] = False
    return presented


async def trust_host_key(board: Board) -> dict[str, Any]:
    """Saves the key the board presents now as the trusted one (after its system was installed again)."""
    if board.host_keys:
        raise refused("host-key-pinned", f"lab/resources.json pins the host key of {board.alias} (hostKeys); change or remove hostKeys there instead.")
    presented = await _present(board, Trust("first-use"), _algorithms())
    save_key(board, presented)
    return {**presented, "trusted": True, "trust": "saved"}


# --- login keys --------------------------------------------------------------------------------------------------


def _authorize_hint(board: Board) -> str:
    port = "" if board.port == 22 else f" -p {board.port}"
    target = f"{board.user}@{board.host}"
    if os.name == "nt":
        return f'type $env:USERPROFILE\\.ssh\\id_ed25519.pub | ssh{port} {target} "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"'
    return f"ssh-copy-id{port} {target}"


def _key_files() -> list[Path]:
    folder = ssh_dir()
    try:
        others = sorted(path.name[:-4] for path in folder.glob("*.pub") if not path.name.endswith("-cert.pub"))
    except OSError:
        others = []
    names = list(dict.fromkeys([*DEFAULT_KEY_NAMES, *others]))
    return [folder / name for name in names if (folder / name).is_file()]


@dataclass
class Keys:
    pairs: list[Any] = field(default_factory=list)
    sources: list[str] = field(default_factory=list)
    protected: list[str] = field(default_factory=list)
    agent: Any = None
    agent_problem: str | None = None

    def close(self) -> None:
        if self.agent is not None:
            self.agent.close()


def _fingerprint_of(pair: Any) -> str:
    return fingerprint(asyncssh.public_key.decode_ssh_public_key(pair.public_data))


async def _keys(board: Board) -> Keys:
    """The keys to offer: the agent's, then the files of ~/.ssh without a passphrase; at most OFFERED_KEYS."""
    found = Keys()
    path = os.environ.get("SSH_AUTH_SOCK", "")
    if path or os.name == "nt":
        try:
            found.agent = await asyncio.wait_for(asyncssh.connect_agent(path), 5)
            for pair in await asyncio.wait_for(found.agent.get_keys(), 5):
                found.pairs.append(pair)
                found.sources.append("agent")
        except (OSError, asyncio.TimeoutError, asyncssh.Error, ValueError) as error:
            found.agent_problem = type(error).__name__
    else:
        found.agent_problem = "SSH_AUTH_SOCK is not set"
    if board.agent_key is not None:
        chosen = [pair for pair in found.pairs if _fingerprint_of(pair) == board.agent_key]
        if not chosen:
            held = len(found.pairs)
            found.close()
            if found.agent is None:
                raise refused("agent-unavailable", f"agentKey of {board.alias} names a key of the SSH agent, and no agent answers ({found.agent_problem}). Start the agent and add the key (ssh-add), or remove agentKey to use the keys in ~/.ssh.")
            raise refused("agent-key-missing", f"The SSH agent holds no key {board.agent_key} (agentKey of {board.alias}); it holds {held} other key(s).")
        found.pairs, found.sources = chosen, ["agent"]
        return found
    seen = {pair.public_data for pair in found.pairs}
    for file in _key_files():
        try:
            pairs = asyncssh.load_keypairs(str(file), ignore_encrypted=True)
        except (OSError, ValueError, asyncssh.Error):
            continue
        if not pairs:
            found.protected.append(file.name)
        for pair in pairs:
            if pair.public_data not in seen:
                seen.add(pair.public_data)
                found.pairs.append(pair)
                found.sources.append(f"~/.ssh/{file.name}")
    del found.pairs[OFFERED_KEYS:], found.sources[OFFERED_KEYS:]
    if not found.pairs:
        found.close()
        protected = f" The keys {', '.join(found.protected)} in ~/.ssh need a passphrase: load one into the SSH agent with ssh-add." if found.protected else ""
        raise refused(
            "no-key",
            f"No SSH key is available to log in to {board.alias}: ~/.ssh holds no usable private key and no SSH agent answers.{protected} "
            f"Create a key with `ssh-keygen -t ed25519` (an empty passphrase, or an agent) and authorize it on the board: {_authorize_hint(board)}",
        )
    return found


# --- session -----------------------------------------------------------------------------------------------------


@dataclass
class Session:
    board: Board
    conn: Any
    host_key: dict[str, Any]
    login: str = ""
    exec_log: list[str] = field(default_factory=list)
    installed: dict[str, Any] | None = None
    on_install: Callable[[dict[str, Any]], None] | None = None

    async def call(self, op: str, payload: bytes = b"", timeout: float = REMOTE_TIMEOUT, **fields: Any) -> dict[str, Any]:
        """One finite operation of the board's helper; Refused/Ended carry the helper's own code. A missing or
        outdated helper is installed first, once."""
        request = {"op": op, "version": remote.HELPER_VERSION, "root": self.board.root, "expect": self.board.expect(), "payloadBytes": len(payload), **fields}
        data = json.dumps(request).encode("utf-8") + b"\n" + payload
        reply = await self._run(remote.run_command(), data, timeout)
        if reply.get("ok") is not True and reply.get("code") in ("helper-missing", "helper-changed") and self.installed is None:
            self.installed = await self.install()
            if self.on_install is not None:
                self.on_install(self.installed)
            reply = await self._run(remote.run_command(), data, timeout)
        if reply.get("ok") is True and isinstance(reply.get("result"), dict):
            return reply["result"]
        code = str(reply.get("code") or "remote-error")
        message = str(reply.get("message") or "The remote helper refused the operation.")
        extra = {key: value for key, value in reply.items() if key not in ("ok", "code", "message", "helper")}
        raise refused(code, message, remoteDetail=extra) if extra else refused(code, message)

    async def install(self) -> dict[str, Any]:
        data, _ = remote.helper()
        reply = await self._run(remote.install_command(), data, REMOTE_TIMEOUT)
        if reply.get("ok") is True and isinstance(reply.get("result"), dict):
            return reply["result"]
        raise refused(str(reply.get("code") or "remote-error"), str(reply.get("message") or "Installing the helper failed."))

    async def _run(self, command: str, data: bytes, timeout: float) -> dict[str, Any]:
        self.exec_log.append(command)
        try:
            result = await asyncio.wait_for(self.conn.run(command, input=data, check=False), timeout)
        except asyncio.TimeoutError as error:
            raise Ended("incomplete", "timeout", f"The board did not answer within {timeout:.0f} s; its state is unknown.", remote={"state": "unknown"}) from error
        except (OSError, asyncssh.Error) as error:
            raise Ended("incomplete", "connection-lost", f"The SSH connection to {self.board.alias} ended ({type(error).__name__}); the remote state is unknown.", remote={"state": "unknown"}) from error
        stdout = result.stdout or b""
        if isinstance(stdout, str):
            stdout = stdout.encode("utf-8")
        try:
            reply = json.loads(stdout.decode("utf-8"))
        except (UnicodeDecodeError, ValueError) as error:
            if result.exit_status is None:
                raise Ended("incomplete", "connection-lost", f"The SSH connection to {self.board.alias} ended during the call; the remote state is unknown.", remote={"state": "unknown"}) from error
            stderr = (result.stderr or b"")
            text = stderr.decode("utf-8", "replace") if isinstance(stderr, bytes) else str(stderr)
            # The end of stderr names the failure (the last line of a traceback), not its beginning.
            raise refused("remote-error", f"The board answered without a helper document (exit {result.exit_status}): {text.strip()[-300:]}") from error
        if not isinstance(reply, dict):
            raise refused("remote-error", "The board answered with an unexpected document.")
        return reply

    def close(self) -> None:
        self.conn.close()


async def connect(board: Board) -> Session:
    """A connection whose host key is trusted and whose user logged in with a key."""
    trusted = trust(board)
    try:
        keys = await _keys(board)
    except Refused as key_problem:
        # The host-key verdict comes first: a changed key is what the user must hear about.
        try:
            presented, _ = await _trusted_algorithms(board, trusted)
        except Refused:
            raise key_problem from None
        if not presented["trusted"]:
            raise host_key_refusal(board, presented) from None
        raise
    algorithms = _algorithms(trusted.kinds)
    client = TrustClient(trusted)
    conn: Any = None
    try:
        for attempt in range(2):
            client = TrustClient(trusted)
            try:
                conn = await asyncio.wait_for(
                    asyncssh.connect(
                        board.host, board.port, username=board.user, client_factory=lambda: client, known_hosts=lambda *_: ([], [], []),
                        config=None, client_keys=keys.pairs, agent_path=None, password_auth=False, kbdint_auth=False, gss_host=None,
                        host_based_auth=False, x509_trusted_certs=None, preferred_auth="publickey", agent_forwarding=False,
                        server_host_key_algs=algorithms, keepalive_interval=5, keepalive_count_max=3, connect_timeout=CONNECT_TIMEOUT,
                        login_timeout=CONNECT_TIMEOUT, encoding=None,
                    ),
                    CONNECT_TIMEOUT * 2 + 5,
                )
                break
            except asyncssh.HostKeyNotVerifiable as error:
                if client.presented is None:
                    raise refused("host-key-changed", f"{board.alias}'s host key could not be verified: {str(error)[:200]}.") from error
                # The trusted key may be of another kind than the one the board showed first.
                presented, algorithms = await _trusted_algorithms(board, trusted)
                if attempt or not presented["trusted"]:
                    raise host_key_refusal(board, presented if not presented["trusted"] else client.presented) from error
    except asyncssh.PermissionDenied as error:
        _remember(board, trusted, client)
        offered = ", ".join(dict.fromkeys(keys.sources))
        raise refused(
            "auth-failed",
            f"{board.alias} refused the {len(keys.pairs)} key(s) offered for user {board.user} (from {offered}). Check the user name, then authorize a key on the board: {_authorize_hint(board)}",
        ) from error
    except (OSError, asyncio.TimeoutError, asyncssh.Error) as error:
        raise _unreachable(board, error) from error
    finally:
        keys.close()
    assert client.presented is not None
    _remember(board, trusted, client)
    return Session(board, conn, client.presented)


def _remember(board: Board, trusted: Trust, client: TrustClient) -> None:
    """A host seen for the first time is remembered as soon as it showed its key, as ssh does."""
    if trusted.source == "first-use" and client.presented is not None:
        save_key(board, client.presented)
