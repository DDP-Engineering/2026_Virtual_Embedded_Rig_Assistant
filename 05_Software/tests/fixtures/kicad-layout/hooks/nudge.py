# /// script
# requires-python = ">=3.11"
# dependencies = ["kicad-python==0.8.0", "protobuf==5.29.6", "pynng==0.9.0"]
# ///
"""A second KiCad API client for the kicad-layout tests (run with `uv run --script`):
- `move REF DX_MM`: move a footprint without saving (an unsaved edit in the candidate window);
- `revert`: reload the open board from its file;
- `answers`: exit 0 when a KiCad API answers, 1 otherwise;
- `docs`: print the open PCB documents (file name and project folder) and the in-memory text's SHA-256."""

import hashlib
import json
import sys
import tempfile
from pathlib import Path

from kipy import KiCad
from kipy.geometry import Vector2
from kipy.proto.common.types import base_types_pb2

SOCKET = f"ipc://{Path(tempfile.gettempdir()) / 'kicad' / 'api.sock'}"


def client(timeout: int = 5000) -> KiCad:
    return KiCad(socket_path=SOCKET, client_name="nudge", timeout_ms=timeout)


def main() -> int:
    command = sys.argv[1]
    if command == "answers":
        try:
            client(1500).ping()
            return 0
        except Exception:  # noqa: BLE001 - any failure means no API answers
            return 1
    kicad = client()
    if command == "docs":
        docs = kicad.get_open_documents(base_types_pb2.DocumentType.DOCTYPE_PCB)
        text = kicad.get_board().get_as_string() if docs else ""
        print(json.dumps({"documents": [[d.board_filename, d.project.path] for d in docs],
                          "memory": hashlib.sha256(text.encode("utf-8")).hexdigest()}))
        return 0
    board = kicad.get_board()
    if command == "move":
        ref, dx = sys.argv[2], float(sys.argv[3])
        fp = next(f for f in board.get_footprints() if f.reference_field.text.value == ref)
        fp.position = Vector2.from_xy(fp.position.x + round(dx * 1_000_000), fp.position.y)
        board.update_items([fp])
        return 0
    if command == "revert":
        board.revert()
        return 0
    return 2


if __name__ == "__main__":
    sys.exit(main())
