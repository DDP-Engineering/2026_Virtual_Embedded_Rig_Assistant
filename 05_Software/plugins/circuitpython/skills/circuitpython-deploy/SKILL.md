---
name: circuitpython-deploy
description: How to identify a CircuitPython board by its CIRCUITPY drive and put code on it safely with circuitpython-tool, then read the run that follows. Use whenever a task copies code.py or other files to a CircuitPython board, inspects its drive, or captures its console.
---
# circuitpython-deploy

CircuitPython reloads code.py after files on its CIRCUITPY drive change: a deploy runs the new code, and that code
may drive the board's pins and anything wired to them. Say so before you deploy.

## Choose the board

1. `circuitpython-tool devices`: each CIRCUITPY drive has `path`, `identity`, `firmware` and, when its UID matches a
   serial port, `bound: true` with `port`. Two boards are told apart only by identity, never by the drive label.
2. Pass both on every volume operation: `--volume E: --identity usb:239a:80f4:E6614C311B7B6A2F`. A missing drive or
   another identity is refused (`volume-missing`, `identity-mismatch`); list the devices again, never guess.
   `ambiguous` or `identity-insufficient` means VERA cannot tell the drive from another board: ask the user to unplug
   the others.
3. `circuitpython-tool identify --volume ... --identity ...` reports the CircuitPython version, board id, UID, the
   bundle platform (`9.x-mpy`), free space and whether the drive is read-only. Only CircuitPython 9, 10 and 11 are
   accepted (`incompatible-firmware`); installing firmware (UF2) is a separate task for the user.

## Look before you write

- `inspect-code` lists the drive with SHA-256, names the startup file CircuitPython runs (code.txt, code.py, main.txt,
  main.py, first found) and copies it and boot.py into the run folder. settings.toml and secrets.py are listed but
  never read: they hold Wi-Fi passwords and keys.
- When the user edits files on the drive too (an editor such as Mu or VS Code), deploy with `--expect-from
  <inspect-code result.json>`: anything changed since the inspection is refused (`conflict`).

## Deploy

`circuitpython-tool deploy --volume E: --identity ... --libraries <run>/library-set.json --source app/code.py --target /code.py --capture 10 --port COM7`

- The approval binds the hashes of every `--source`, the library set and `--expect-from`; a file changed after
  approval is refused with CONFLICT.
- Files go one at a time, libraries first, code.py last; `files[].state` says which are `confirmed`. `boot.py` needs
  `--boot` and an irreversible approval: it can take the drive away from the computer until safe mode.
- `read-only` means boot.py gave the drive to CircuitPython; `no-space` means nothing was written (before) or the
  listed files are confirmed (during). `disconnected` (exit 3): the board was unplugged - check `files` for what was
  confirmed and never call the application updated.
- `--capture N --port <bound port>` reads the console run after the writes: `run.state` `finished`, `running` (a
  loop) or `exception` with the traceback (status fail). `autoreload: off` with `no-run-observed` means the board's
  code disabled autoreload: run `capture-output --reload` to start it.

## Console

`circuitpython-tool capture-output --port COM7 --identity ... --duration 10` reads without sending anything;
`--reload` sends Ctrl-C and Ctrl-D so code.py starts again (a device-write). Stop ends the helper on this computer
only: code already running on the board keeps running until it ends, the board reloads or it is unplugged.

A drive or port that another VERA run uses (desktop app or CLI) is BUSY: wait for that run or stop it.
