---
name: micropython-deploy
description: How to identify a MicroPython board and put files on it safely with micropython-tool. Use whenever a task copies, replaces or inspects files on a MicroPython board, or needs to know which board and firmware are connected.
---
# micropython-deploy

Every board operation interrupts the program the board runs (Ctrl-C into the raw REPL). Say so before you start, and
pass `--restart` when the user wants the board's program to run again afterwards.

## Choose the board

1. `micropython-tool ports`: each port has an `identity` (`usb:<vid>:<pid>:<serial>` is stable, the others are not)
   and, for a common USB-to-serial bridge, `bridge`. A bridge says nothing about the board behind it: ask the user.
2. Pass both on every device operation: `--port COM5 --identity usb:2e8a:0005:E661`. A missing port or another
   identity is refused (`port-missing`, `identity-mismatch`); list the ports again, never guess another port.
3. `micropython-tool identify --port ... --identity ...` reports implementation, version, machine, unique id, memory and
   file-system space. Anything but MicroPython 1.22 or newer is refused (`incompatible-firmware`): installing firmware
   is a separate task for the vendor's tool, never part of a deploy.

## Look before you write

- `micropython-tool files --port ... --identity ... --path /lib` lists files with sizes and free space.
- `micropython-tool read-file ... --remote /main.py` copies a file into the run folder with its SHA-256.

## Deploy

`micropython-tool deploy-file --port ... --identity ... --source app/sensor.py --remote /lib/sensor.py`

- The approval binds the workbench file's hash; a file changed after approval is refused with CONFLICT.
- Pass `--expect-sha256 <hash from read-file>` (or `--expect-absent`) when you replace a file you inspected: a different
  current file is refused (`conflict`), and a change during the transfer fails without replacing.
- `--mkdir` creates missing parent folders; otherwise a missing folder is `remote-missing`.
- `boot.py` and `main.py` need `--startup` and an irreversible approval: a faulty one can lock out the REPL until the
  firmware is reinstalled. Prefer a module in `/lib` that main.py imports.
- Read the result: `mechanism` is `rename` (atomic where the file system supports it) or `remove-then-rename` (the
  target was briefly absent); `verified: true` means the board's hash matched.
- `no-space` means nothing was replaced. `disconnected`, `device-reset` or `no-response` mean the board was lost
  during the transfer: the target is unchanged while `phase` is `transfer`, unknown when it is `replace` - check with
  `files` or `read-file` before anything else. There is no backup or restore of the board.

A port that another VERA run uses (desktop app or CLI) is BUSY: wait for that run or stop it, never retry in a loop.
