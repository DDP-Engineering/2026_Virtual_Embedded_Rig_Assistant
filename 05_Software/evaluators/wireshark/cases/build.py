"""Generate the evaluator's two synthetic saved captures."""

from base64 import b64encode
from pathlib import Path
import runpy

ROOT = Path(__file__).resolve().parent
wire = runpy.run_path(str(ROOT.parents[2] / "tests/fixtures/wireshark-tshark/build.py"))
tcp, to_board, to_host, pcapng = (wire[name] for name in ("tcp", "to_board", "to_host", "pcapng"))
host, board = (wire[name] for name in ("HOST_IP", "BOARD_IP"))


def client(seq: int, ack: int, flags: int, payload: bytes = b"") -> bytes:
    return to_board(6, tcp(host, board, 41000, 80, seq, ack, payload, flags), seq)


def build() -> None:
    credential = b64encode(b"lab:QUARTZ_EVAL_PROOF_404")
    payload = (
        b"POST /fixture HTTP/1.1\r\nHost: example.test\r\nAuthorization: Basic "
        + credential
        + b"\r\nContent-Length: 19\r\n\r\nVERA_LOCAL_SENTINEL"
    )
    frames = [
        client(1000, 0, 2),
        to_host(6, tcp(board, host, 80, 41000, 2000, 1001, b"", 0x12), 2),
        client(1001, 2001, 0x10),
        client(1001, 2001, 0x18, payload),
    ]
    (ROOT / "sensitive.pcapng").write_bytes(pcapng([(0, frame, len(frame)) for frame in frames], 1))
    (ROOT / "empty.pcapng").write_bytes(pcapng([], 1))


if __name__ == "__main__":
    build()
