"""A local SSH server standing in for a Raspberry Pi's sshd in the raspberry-pi-linux tests (asyncssh 2.24.1).

It listens on 127.0.0.1, presents the host keys --host-key (one of each kind, as a board has), accepts only --user with a key from --authorized (no
password or keyboard-interactive method) and runs each exec request the way OpenSSH's sshd does: the command string
goes to `sh -c` as the user, in the user's home. --remote local runs that shell on this Linux host; --remote wsl runs
it in the default WSL distribution (Windows), so the remote helper meets a real Linux kernel, /proc and systemd.
Interactive shells, subsystems (SFTP), forwarding and agent forwarding are refused. Every authentication attempt and
exec request is logged as one JSON line to --log, so a test can prove which commands the client sent.

This is test infrastructure: it proves the SSH protocol paths and the remote helper on Linux, not a Raspberry Pi.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys

import asyncssh


def record(path: str, event: dict) -> None:
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(event) + "\n")


class Server(asyncssh.SSHServer):
    def __init__(self, args: argparse.Namespace, keys: list[asyncssh.SSHKey]) -> None:
        self.args = args
        self.keys = keys

    def begin_auth(self, username: str) -> bool:
        record(self.args.log, {"event": "begin-auth", "user": username})
        return True

    def password_auth_supported(self) -> bool:
        return False

    def kbdint_auth_supported(self) -> bool:
        return False

    def public_key_auth_supported(self) -> bool:
        return True

    def validate_public_key(self, username: str, key: asyncssh.SSHKey) -> bool:
        accepted = username == self.args.user and any(key.public_data == known.public_data for known in self.keys)
        record(self.args.log, {"event": "public-key", "user": username, "fingerprint": key.get_fingerprint("sha256"), "accepted": accepted})
        return accepted


def remote_argv(args: argparse.Namespace, command: str) -> list[str]:
    env = [f"HOME={args.home}", f"USER={args.user}", f"LOGNAME={args.user}", "PATH=/usr/local/bin:/usr/bin:/bin", "LANG=C.UTF-8", "SHELL=/bin/sh"]
    if args.runtime_dir:
        env.append(f"XDG_RUNTIME_DIR={args.runtime_dir}")
    # sshd runs the command string through the user's shell in the home folder: `sh -c <command>` after a cd there.
    shell = ["sh", "-c", 'cd "$HOME" || exit 1; exec sh -c "$1"', "sshd", command]
    if args.remote == "wsl":
        return ["wsl.exe", "-e", "env", "-i", *env, *shell]
    return ["env", "-i", *env, *shell]


async def handle(args: argparse.Namespace, process: asyncssh.SSHServerProcess) -> None:
    command = process.command
    if command is None:
        record(args.log, {"event": "shell"})
        process.stderr.write("Interactive shells are refused by this test server.\n")
        process.exit(1)
        return
    if process.subsystem:
        record(args.log, {"event": "subsystem", "name": process.subsystem})
        process.exit(1)
        return
    record(args.log, {"event": "exec", "command": command})
    local = await asyncio.create_subprocess_exec(
        *remote_argv(args, command),
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    await process.redirect(stdin=local.stdin, stdout=local.stdout, stderr=local.stderr)
    code = await local.wait()
    await process.stdout.drain()
    await process.stderr.drain()
    process.exit(code)


def keygen(folder: str) -> None:
    """Writes the test keys (host, host2, host-rsa, user, other) and prints their SHA-256 fingerprints."""
    found = {}
    for name in ("host", "host2", "host-rsa", "user", "other"):
        key = asyncssh.generate_private_key("ssh-rsa" if name.endswith("-rsa") else "ssh-ed25519")
        key.write_private_key(f"{folder}/{name}")
        key.write_public_key(f"{folder}/{name}.pub")
        found[name] = key.get_fingerprint("sha256")
    print(json.dumps(found), flush=True)


async def main() -> None:
    if sys.argv[1:2] == ["--keygen"]:
        keygen(sys.argv[2])
        return
    parser = argparse.ArgumentParser()
    parser.add_argument("--host-key", action="append", required=True)
    parser.add_argument("--authorized", action="append", required=True)
    parser.add_argument("--user", required=True)
    parser.add_argument("--home", required=True)
    parser.add_argument("--remote", choices=("local", "wsl"), required=True)
    parser.add_argument("--runtime-dir", default="")
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--log", required=True)
    args = parser.parse_args()
    keys = [asyncssh.read_public_key(path) for path in args.authorized]
    server = await asyncssh.create_server(
        lambda: Server(args, keys),
        "127.0.0.1",
        args.port,
        server_host_keys=args.host_key,
        process_factory=lambda process: handle(args, process),
        encoding=None,
        allow_scp=False,
        agent_forwarding=False,
        x11_forwarding=False,
        allow_pty=False,
        sftp_factory=None,
        line_editor=False,
    )
    port = server.sockets[0].getsockname()[1]
    print(json.dumps({"port": port}), flush=True)
    await server.wait_closed()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(0)
