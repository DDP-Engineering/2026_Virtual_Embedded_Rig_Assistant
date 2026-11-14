"""Loaded by Python's `site` when this folder is on PYTHONPATH: the no-network test of lab-validation.

Every socket, subprocess and os.system call raises, so an operation that tried one fails the test.
"""

import os
import socket
import subprocess


class GuardViolation(RuntimeError):
    pass


def _refuse(*_args, **_kwargs):
    raise GuardViolation("lab-validation guard: network or process access attempted")


class _Socket(socket.socket):
    def __init__(self, *args, **kwargs):
        _refuse()


socket.socket = _Socket
socket.create_connection = _refuse
socket.getaddrinfo = _refuse
subprocess.Popen = _refuse
subprocess.run = _refuse
os.system = _refuse
for name in ("execv", "execve", "execvp", "spawnv", "spawnve", "startfile", "posix_spawn"):
    if hasattr(os, name):
        setattr(os, name, _refuse)
