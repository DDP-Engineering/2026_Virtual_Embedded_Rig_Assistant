# raspberry-pi-linux

Projects, tasks, commands and user services on a Raspberry Pi that VERA reaches over SSH from this computer. VERA
keeps running on Windows or Linux x64; nothing of VERA runs on the board except a small helper that installs itself
on the first call. One program, `pi-tool`, a PEP 723 script pinned to asyncssh 2.24.1, which VERA installs with its
own uv.

It has been verified against a local SSH test server whose commands ran in a real Linux shell (Ubuntu 24.04 in WSL 2,
with its systemd user manager); it has not run against a real Raspberry Pi or a real OpenSSH server yet, and not from
native Ubuntu.

## Supported

- Raspberry Pi OS 12 (Bookworm) 64-bit on a Raspberry Pi, an unprivileged login user with a systemd user manager,
  `/usr/bin/python3` 3.9 or newer (Bookworm ships 3.11). Other distributions and boards are not claimed.
- Not offered: passwords and passphrases, OS provisioning, firmware or bootloader changes.

## Declaring a board

A board is an entry of `lab/resources.json` (kind `linux-board`); VERA reserves it for each run, so another session or
the CLI gets BUSY. A host and a user are enough:

```json
{ "format": 1, "resources": [
  { "alias": "pi", "kind": "linux-board", "host": "raspberrypi.local", "user": "pi" } ] }
```

| Field | Default | Meaning |
|---|---|---|
| `port` | 22 | the SSH port |
| `root` | `~/vera-projects` | the folder projects go into (`<root>/<project name>`), created when missing; VERA's own state is in `<root>/.vera-pi/`. It must belong to the user and not be writable by every user |
| `hostKeys` | none | `SHA256:` fingerprints that pin the board's host key; then only those are accepted and nothing is learned |
| `identity` | none | `serial` (`cat /proc/device-tree/serial-number`), `machineId` (`/etc/machine-id`), `model`; a board that reports another value is refused |
| `agentKey` | none | the fingerprint of the one SSH agent key to offer |

## Connecting

`pi-tool` connects as `ssh` does and reads neither a password nor a passphrase.

- **Login key**: the keys of the SSH agent when one answers (`SSH_AUTH_SOCK`; on Windows the OpenSSH agent's pipe),
  then the private keys in `~/.ssh` that need no passphrase (`id_ed25519`, `id_ecdsa`, `id_rsa`, then every other key
  with a `.pub` file beside it), at most six. A key with a passphrase is used through the agent (`ssh-add`). The
  public half belongs in `~/.ssh/authorized_keys` of the board's user; `no-key` and `auth-failed` show the command
  that puts it there. `~/.ssh/config` is not read.
- **Host key**: `hostKeys` when the entry pins them; else the key `pi-tool` saved for this host
  (`lab/linux-board-keys.json`); else the keys `~/.ssh/known_hosts` holds for it. A board seen for the first time is
  accepted and its key saved, as `ssh -o StrictHostKeyChecking=accept-new` does. A key that differs is refused as
  `host-key-changed`; `pi-tool trust-host-key --board pi` accepts the key the board presents now (after its system
  was installed again). `pi-tool` asks for the Ed25519 key first, then ECDSA, then RSA, and tries each kind before it
  calls a key changed.
- **Helper**: every call runs VERA's helper on the board only when its SHA-256 matches the copy in this plugin; a
  missing or older helper is written to `~/.local/share/vera-pi/0.3.0/` first (`helper-installed`).
- `pi-tool identify --board pi` reports model, serial, machine id, OS, architecture, kernel, Python, user, the
  projects folder and the board's health: temperature, `vcgencmd get_throttled` decoded (under-voltage, throttling),
  free disk and memory, load and running VERA tasks.

## Projects

A project folder in the workbench holds `vera-pi.json` (see the raspberry-pi-projects skill): the files to deploy,
an optional pip requirements file, the tasks and the user services.

- `deploy` compares hashes and sends only new and changed files; `run-task` and `service-start` do that first.
  `compare` lists the differences without changing anything. A file edited on the board since VERA last applied it
  is a `conflict` and stays unless named with `--overwrite` (irreversible). No file is ever deleted.
- `requirements` creates `.venv` in the board's project folder with `--system-site-packages` and installs the file
  again whenever it changed; tasks and `exec --project` run with that environment first on their `PATH`.
- A script with a `#!` line and Windows line ends is deployed with Unix line ends; `.venv`, `__pycache__` and `.git`
  are never deployed.
- `deploy-candidate` and `apply-candidate` remain for a deploy in two approved steps: stage, show the list, apply.

## Tasks, commands and services

`run-task` runs a declared task, and `exec` one command line in a shell, under a supervisor on the board that owns
the process group and enforces the budget and output limit, also when the SSH connection is gone. Output is passed
on while it runs (Python runs unbuffered). Stop ends it and confirms that its recorded PID (with start time and boot)
no longer runs; a lost connection is reported `connection-lost` with the remote state unknown, and VERA's cleanup
`stop-owned` settles it. A task recorded before the board booted again is `lost-by-reboot`, never signalled. The board
keeps the folders of the 20 newest finished tasks.

Services are `systemctl --user` units the manifest lists. `service-start` installs the unit file the manifest names,
restarts the unit and, for a service declared `keepRunning`, enables it at boot and turns lingering on
(`loginctl enable-linger`, with `sudo -n` when the plain call is refused). `collect-logs` copies journal lines and
task logs into the run folder; `fetch` copies one file of the board (at most 8 MiB) there.

## Risk matrix

| Operations | Risk |
|---|---|
| `capabilities`, `inspect-project`, `report` | safe |
| `check-host-key`, `identify`, `compare`, `task-status`, `service-status`, `collect-logs`, `fetch` | device-read |
| `trust-host-key`, `install-helper`, `deploy`, `deploy-candidate`, `apply-candidate`, `run-task`, `exec`, `service-start`, `service-stop`, `stop-owned` | device-write |
| `deploy --overwrite`, `apply-candidate --overwrite` | irreversible |

## Results

`deploy`, `run-task`, `exec`, `fetch`, `collect-logs`, the service changes and `report` write
`raspberry-pi-results/<run-id>/result.json` and `report.md` in the workbench, with task logs and fetched files where
they apply. Calls that only look (`identify`, `compare`, the status calls) leave no folder.
