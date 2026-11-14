"""The two constant remote commands of the bundled helper version (spec REQ-DATA-44547a17 section 4).

Both are `/usr/bin/python3 -I -c '<stub>'` with a stub built only from the helper's version and SHA-256: no value from
the agent, a manifest or the registry ever becomes part of a command the board's shell parses. Requests and file
contents travel on stdin.
"""

from __future__ import annotations

import hashlib
from functools import lru_cache
from pathlib import Path

HELPER = Path(__file__).resolve().parent.parent / "remote" / "vera_pi_remote.py"
HELPER_VERSION = "0.2.0"
HELPER_LIMIT = 512 * 1024
PYTHON = "/usr/bin/python3"


@lru_cache(maxsize=1)
def helper() -> tuple[bytes, str]:
    data = HELPER.read_bytes()
    return data, hashlib.sha256(data).hexdigest()


def installed_path() -> str:
    return f"~/.local/share/vera-pi/{HELPER_VERSION}/vera_pi_remote.py"


def _command(stub: str) -> str:
    if "'" in stub:  # pragma: no cover - the stubs below are constants
        raise ValueError("A remote stub must not contain a single quotation mark.")
    return f"{PYTHON} -I -c '{stub}'"


def install_command() -> str:
    _, digest = helper()
    stub = (
        "import hashlib,json,os,sys\n"
        "b=sys.stdin.buffer.read(%d)\n"
        "def out(v):\n"
        " sys.stdout.write(json.dumps(v));sys.exit(0)\n"
        "if len(b)>%d or hashlib.sha256(b).hexdigest()!=\"%s\":\n"
        " out({\"ok\":False,\"code\":\"helper-changed\",\"message\":\"The helper bytes did not arrive intact; nothing was written.\"})\n"
        "d=os.path.join(os.path.expanduser(\"~\"),\".local\",\"share\",\"vera-pi\",\"%s\")\n"
        "os.makedirs(d,mode=0o700,exist_ok=True)\n"
        "p=os.path.join(d,\"vera_pi_remote.py\")\n"
        "try:\n"
        " o=open(p,\"rb\").read()\n"
        "except OSError:\n"
        " o=None\n"
        "if o==b:\n"
        " out({\"ok\":True,\"result\":{\"state\":\"already-installed\",\"path\":p,\"sha256\":\"%s\"}})\n"
        "t=p+\".tmp-\"+str(os.getpid())\n"
        "f=os.fdopen(os.open(t,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600),\"wb\")\n"
        "f.write(b);f.flush();os.fsync(f.fileno());f.close()\n"
        "os.replace(t,p)\n"
        "out({\"ok\":True,\"result\":{\"state\":\"installed\" if o is None else \"replaced\",\"path\":p,\"sha256\":\"%s\"}})\n"
    ) % (HELPER_LIMIT + 1, HELPER_LIMIT, digest, HELPER_VERSION, digest, digest)
    return _command(stub)


def run_command() -> str:
    _, digest = helper()
    stub = (
        "import hashlib,json,os,sys\n"
        "def out(v):\n"
        " sys.stdout.write(json.dumps(v));sys.exit(0)\n"
        "if sys.version_info<(3,9):\n"
        " out({\"ok\":False,\"code\":\"python-too-old\",\"message\":\"The board needs Python 3.9 or later.\"})\n"
        "p=os.path.join(os.path.expanduser(\"~\"),\".local\",\"share\",\"vera-pi\",\"%s\",\"vera_pi_remote.py\")\n"
        "try:\n"
        " b=open(p,\"rb\").read()\n"
        "except OSError:\n"
        " out({\"ok\":False,\"code\":\"helper-missing\",\"message\":\"The VERA helper %s is not installed on the board; run install-helper first.\"})\n"
        "h=hashlib.sha256(b).hexdigest()\n"
        "if h!=\"%s\":\n"
        " out({\"ok\":False,\"code\":\"helper-changed\",\"found\":h,\"message\":\"The installed VERA helper differs from version %s; run install-helper again.\"})\n"
        "g={\"__name__\":\"__vera_pi__\",\"__file__\":p,\"__vera_source__\":b}\n"
        "exec(compile(b,p,\"exec\"),g)\n"
        "sys.exit(g[\"main\"]())\n"
    ) % (HELPER_VERSION, HELPER_VERSION, digest, HELPER_VERSION)
    return _command(stub)


def commands() -> tuple[str, str]:
    return install_command(), run_command()
