# raspberry-pi-linux

Projects, finite tasks and user services on a Raspberry Pi that VERA reaches over SSH from this computer. VERA keeps
running on Windows or Linux x64; nothing of VERA runs on the board except a small helper the user installs
explicitly. One program, `pi-tool`, a PEP 723 script pinned to asyncssh 2.24.1, which VERA installs with its own uv.

It has been verified against a local SSH test server whose commands ran in a real Linux shell (Ubuntu 24.04 in WSL 2,
with its systemd user manager); it has not run against a real Raspberry Pi yet, and not from native Ubuntu.

## Supported

- Raspberry Pi OS 12 (Bookworm) 64-bit on one Raspberry Pi, an unprivileged login user with a systemd user manager,
  `/usr/bin/python3` 3.9 or newer (Bookworm ships 3.11). Other distributions and boards are not claimed.
- Not offered: a shell, sudo, system services, raw GPIO, I2C or SPI access, OS provisioning, firmware or bootloader
  changes, reboot and shutdown.

## Declaring a board

A board is an entry of `lab/resources.json` (kind `linux-board`); VERA reserves it for each run, so another session or
the CLI gets BUSY:

```json
{ "format": 1, "resources": [
  { "alias": "pi", "kind": "linux-board", "host": "pi5.local", "port": 22, "user": "vera",
    "hostKeys": ["SHA256:<43 characters>"], "agentKey": "SHA256:<43 characters>",
    "identity": { "serial": "<16 hex>", "model": "Raspberry Pi 5 Model B Rev 1.0" },
    "root": "/home/vera/vera-projects" } ] }
```

- `hostKeys`: the fingerprints of the board's SSH host keys. Read them on the board's own console (keyboard and screen,
  or another channel you trust) with `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`. `pi-tool check-host-key`
  shows the key the board presents without logging in; pin it only after comparing. A key that differs later is
  refused as `host-key-changed`; VERA never accepts it by itself.
- `user`: an unprivileged account; `root` is refused. Its `~/.ssh/authorized_keys` holds the public half of a key in
  your system SSH agent (`ssh-add`; on Windows the OpenSSH Authentication Agent service or Pageant). `agentKey` picks
  one agent key by fingerprint. There is no password option: VERA never handles a password or a key file.
- `identity`: the board's serial (`cat /proc/device-tree/serial-number`), or its machine id (`/etc/machine-id`), and
  optionally the model (`cat /proc/device-tree/model`). A board that reports another value is refused.
- `root`: an existing folder owned by `user`, not writable by group or others and not a link. Projects go into
  `<root>/<project name>`; VERA's own state into `<root>/.vera-pi/`.

## First steps

1. `pi-tool check-host-key --board pi`, compare, pin.
2. `pi-tool install-helper --board pi` writes the helper to `~/.local/share/vera-pi/1.0.0/` after checking its
   SHA-256. Every later call runs only a helper whose SHA-256 matches the one in this plugin (`helper-missing`,
   `helper-changed` otherwise).
3. `pi-tool identify --board pi` reports model, serial, machine id, OS, architecture, kernel, Python, user and the
   checks of the remote root.

## Projects

A project folder in the workbench holds `vera-pi.json` (see the raspberry-pi-projects skill): the files to deploy, the
tasks it may run and the user services it may start. `deploy-candidate` uploads the files into a staging folder on the
board and compares each with the board's copy; `apply-candidate` replaces only the new and changed files of that
approved candidate. A file changed on the board since VERA last applied it is a `conflict` and stays unless named with
`--overwrite` (irreversible). No file is ever deleted, and no `--delete` sync exists.

## Tasks and services

`run-task` runs a declared task under a supervisor on the board that owns its process group and enforces its budget
and output limit, also when the SSH connection is gone. Stop ends it and confirms that its recorded PID (with start
time and boot) no longer runs; a lost connection is reported `connection-lost` with the remote state unknown, and VERA's
cleanup `stop-owned` settles it. A task recorded before the board booted again is `lost-by-reboot`, never signalled.
Services are `systemctl --user` units the manifest lists; a service declared `keepRunning` stays active after the run
only when lingering is enabled for the user (`loginctl enable-linger <user>` on the board, which VERA never runs);
without it systemd stops the user's services shortly after VERA's SSH session ends, and the result warns `no-linger`.
`collect-logs` copies journal lines and task logs into the run folder.

## Results

Each board call writes `arduino-iot-results/<run-id>/result.json` and `report.md` in the workbench (`candidate.json`
and task logs where they apply); `report` summarizes run folders as JSON, Markdown and HTML.
