"""The verified SSH connection to a board (spec REQ-DATA-44547a17 section 4), on asyncssh 2.24.1.

The host key is accepted only when its SHA-256 fingerprint is pinned in lab/resources.json: `known_hosts` is a callable
returning no trusted key, so asyncssh asks `validate_host_public_key` and never reads `~/.ssh/known_hosts`; host
certificates are never trusted. `config=None` keeps `~/.ssh/config` out. Authentication is public key through the
system SSH agent only; no password, keyboard-interactive, GSS, host-based or key-file method is offered.
"""

from __future__ import annotations

import asyncio
import json
import os
from dataclasses import dataclass, field
from typing import Any

import asyncssh

from . import remote
from .registry import Board
from .report import Ended, refused

CONNECT_TIMEOUT = 15
REMOTE_TIMEOUT = 120


def fingerprint(key: Any) -> str:
    return str(key.get_fingerprint("sha256"))


class PinnedClient(asyncssh.SSHClient):
    def __init__(self, pins: tuple[str, ...], record_only: bool = False) -> None:
        self.pins = pins
        self.record_only = record_only
        self.presented: dict[str, Any] | None = None

    def validate_host_public_key(self, host: str, addr: str, port: int, key: asyncssh.SSHKey) -> bool:
        found = fingerprint(key)
        self.presented = {"type": key.get_algorithm(), "fingerprint": found, "pinned": found in self.pins}
        return not self.record_only and found in self.pins


def _host_key_refusal(board: Board, presented: dict[str, Any]) -> Exception:
    if not board.host_keys:
        return refused(
            "host-key-unpinned",
            f"{board.alias} presents the host key {presented['fingerprint']} ({presented['type']}); no host key is pinned in lab/resources.json. Compare it with `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` on the board's own console before pinning it.",
            hostKey=presented,
        )
    return refused(
        "host-key-changed",
        f"{board.alias} presents the host key {presented['fingerprint']} ({presented['type']}), which lab/resources.json does not pin. Nothing was sent. A changed key is never accepted automatically: confirm the change on the board's console, then update hostKeys.",
        hostKey=presented,
    )


async def check_host_key(board: Board) -> dict[str, Any]:
    """Connects only until the host key is presented; never authenticates."""
    client = PinnedClient(board.host_keys, record_only=True)
    try:
        conn = await asyncio.wait_for(
            asyncssh.connect(
                board.host, board.port, username=board.user, client_factory=lambda: client, known_hosts=lambda *_: ([], [], []),
                config=None, client_keys=None, agent_path=None, password_auth=False, kbdint_auth=False, gss_host=None,
                x509_trusted_certs=None, connect_timeout=CONNECT_TIMEOUT, login_timeout=CONNECT_TIMEOUT,
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


def _unreachable(board: Board, error: BaseException) -> Exception:
    if isinstance(error, asyncio.TimeoutError):
        return refused("timeout", f"{board.host}:{board.port} did not answer within {CONNECT_TIMEOUT} s.")
    return refused("unreachable", f"{board.host}:{board.port} cannot be reached: {type(error).__name__}: {str(error)[:200]}.")


async def _agent_keys(board: Board) -> tuple[Any, list[Any]]:
    path = os.environ.get("SSH_AUTH_SOCK", "")
    if not path and os.name != "nt":
        raise refused("agent-unavailable", "No SSH agent is reachable: SSH_AUTH_SOCK is not set. Start the system SSH agent and add the board's key (ssh-add).")
    try:
        agent = await asyncio.wait_for(asyncssh.connect_agent(path), 10)
        keys = await asyncio.wait_for(agent.get_keys(), 10)
    except (OSError, asyncio.TimeoutError, asyncssh.Error, ValueError) as error:
        raise refused("agent-unavailable", f"The system SSH agent cannot be reached ({type(error).__name__}). Start it and add the board's key (ssh-add).") from error
    fingerprints = [fingerprint(asyncssh.public_key.decode_ssh_public_key(key.public_data)) for key in keys]
    if board.agent_key is not None:
        keys = [key for key, found in zip(keys, fingerprints) if found == board.agent_key]
        if not keys:
            agent.close()
            raise refused("agent-key-missing", f"The SSH agent holds no key {board.agent_key} (agentKey of {board.alias}); it holds {len(fingerprints)} other key(s).")
    if not keys:
        agent.close()
        raise refused("agent-key-missing", "The SSH agent holds no key; add the board's key with ssh-add.")
    return agent, list(keys)


@dataclass
class Session:
    board: Board
    conn: Any
    host_key: dict[str, Any]
    exec_log: list[str] = field(default_factory=list)

    async def call(self, op: str, payload: bytes = b"", timeout: float = REMOTE_TIMEOUT, **fields: Any) -> dict[str, Any]:
        """One finite operation of the installed helper; Refused/Ended carry the helper's own code."""
        request = {"op": op, "version": remote.HELPER_VERSION, "root": self.board.root, "expect": self.board.expect(), "payloadBytes": len(payload), **fields}
        data = json.dumps(request).encode("utf-8") + b"\n" + payload
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
            raise refused("remote-error", f"The board answered without a helper document (exit {result.exit_status}): {text.strip()[:300]}") from error
        if not isinstance(reply, dict):
            raise refused("remote-error", "The board answered with an unexpected document.")
        return reply

    def close(self) -> None:
        self.conn.close()


async def connect(board: Board) -> Session:
    """A connection whose host key is pinned and whose user authenticated with an agent key."""
    if not board.host_keys:
        presented = await check_host_key(board)
        raise _host_key_refusal(board, presented)
    try:
        agent, keys = await _agent_keys(board)
    except Exception as agent_problem:
        # The host-key verdict comes first (spec section 4): look at the presented key before naming the agent.
        try:
            presented = await check_host_key(board)
        except Exception:
            raise agent_problem from None
        if not presented["pinned"]:
            raise _host_key_refusal(board, presented) from None
        raise
    client = PinnedClient(board.host_keys)
    try:
        conn = await asyncio.wait_for(
            asyncssh.connect(
                board.host, board.port, username=board.user, client_factory=lambda: client, known_hosts=lambda *_: ([], [], []),
                config=None, client_keys=keys, agent_path=None, password_auth=False, kbdint_auth=False, gss_host=None,
                host_based_auth=False, x509_trusted_certs=None, preferred_auth="publickey", agent_forwarding=False,
                keepalive_interval=5, keepalive_count_max=3, connect_timeout=CONNECT_TIMEOUT, login_timeout=CONNECT_TIMEOUT, encoding=None,
            ),
            CONNECT_TIMEOUT * 2 + 5,
        )
    except asyncssh.HostKeyNotVerifiable as error:
        if client.presented is not None and not client.presented["pinned"]:
            raise _host_key_refusal(board, client.presented) from error
        raise refused("host-key-changed", f"{board.alias}'s host key could not be verified: {str(error)[:200]}.") from error
    except asyncssh.PermissionDenied as error:
        raise refused("auth-failed", f"{board.alias} refused the agent key for user {board.user}; add the key to ~{board.user}/.ssh/authorized_keys on the board.") from error
    except (OSError, asyncio.TimeoutError, asyncssh.Error) as error:
        raise _unreachable(board, error) from error
    finally:
        agent.close()
    assert client.presented is not None
    return Session(board, conn, client.presented)
