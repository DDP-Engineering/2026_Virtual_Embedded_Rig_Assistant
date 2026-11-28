---
name: raspberry-pi-projects
description: How to reach a Raspberry Pi or another Linux board with pi-tool and put a project on it - declare the board, connect with the user's SSH key, read its health, write vera-pi.json, deploy changed files, install Python requirements and system packages, run a command line with exec and fetch a file. Use whenever a task sets up a Raspberry Pi, deploys or updates code on it, or needs a command run there.
---
# raspberry-pi-projects

VERA runs on this computer and reaches the board over SSH, as `ssh` does. Run `pi-tool` only through `run_program`.

## The board

1. Ask the user for the board's name or address and its login user (never guess them) and declare it in
   `lab/resources.json`; `host` and `user` are enough:
   `{ "format": 1, "resources": [ { "alias": "pi", "kind": "linux-board", "host": "raspberrypi.local", "user": "pi" } ] }`
   Optional: `port` (22), `root` (the projects folder, default `~/vera-projects`, created when missing), `hostKeys`
   (pins `SHA256:` fingerprints instead of learning the key), `identity` (`serial`, `machineId`, `model`: checks
   which board answers), `agentKey` (one key of the SSH agent, by fingerprint).
2. `pi-tool identify --board pi` connects and reports model, OS, Python, user and `health`: `temperatureC`,
   `throttled` (`under-voltage` means a weak power supply or cable), free disk and memory, load, running VERA tasks.
   The first connection saves the board's host key (`host-key-saved`) and installs VERA's helper in the user's home
   (`helper-installed`); both are only reported, neither is a step of yours.
3. Login uses the keys of the SSH agent, then the private keys in `~/.ssh` that need no passphrase. VERA never asks
   for a password or a passphrase, and neither do you.

| Error | Meaning and remedy |
|---|---|
| `no-key` | no usable key on this computer: the user runs `ssh-keygen -t ed25519`, then the authorize command the message shows |
| `auth-failed` | the board refused the keys: a wrong `user`, or the public key is not in the board's `authorized_keys`. The message shows the command; the user runs it in their own terminal, where it asks for the board's password |
| `unreachable`, `timeout` | wrong name or address, board off, or SSH not enabled on it |
| `host-key-changed` | another key than the trusted one. After the board's system was installed again: `pi-tool trust-host-key --board pi`, after asking the user. Otherwise another machine answers at that address: stop |
| `identity-mismatch` | the entry's `identity` names another board |

## vera-pi.json

```json
{ "format": 1, "kind": "vera-pi-project", "name": "blink-demo",
  "files": ["app.py", "lib", "requirements.txt", "blink-demo.service"], "exclude": ["*.log"],
  "requirements": "requirements.txt",
  "hardware": { "actuates": true, "note": "drives the LED on GPIO17" },
  "tasks": { "run": { "argv": ["python3", "app.py"] },
             "selftest": { "argv": ["python3", "app.py", "--selftest"], "budgetS": 60 } },
  "services": { "blink-demo.service": { "file": "blink-demo.service", "keepRunning": true, "actuates": true } } }
```

- `files`: paths relative to the manifest; a folder takes its files. `.venv`, `__pycache__` and `.git` never go;
  `exclude` adds names or patterns. Spaces in names are fine. A script with a `#!` line and Windows line ends is
  deployed with Unix line ends.
- `requirements`: a listed pip requirements file. VERA creates `.venv` in the board's project folder (with the
  system's packages visible, so `picamera2`, `gpiozero` and `lgpio` from apt work) and installs the file whenever it
  changed. Tasks, `exec --project` and `python3` then use that environment.
- A task's `argv[0]` is a deployed project file, `python3`, or any program on the board (`i2cdetect`, `raspistill`,
  `/usr/bin/env`). `budgetS` defaults to 600 (1-3500); `outputLimitBytes` to 1 MiB; `extraArgs: true` lets
  `run-task --arg` append arguments.
- `hardware` / `actuates`: say whether the code moves, switches or drives anything; the result repeats it.
- `pi-tool inspect-project --project blink/vera-pi.json` checks the manifest offline and lists every file.

## Deploying

- `pi-tool deploy --board pi --project blink/vera-pi.json` sends the new and changed files and installs changed
  requirements. `run-task` and `service-start` do the same first, so an edit needs no separate deploy.
- `pi-tool compare --board pi --project blink/vera-pi.json` changes nothing and lists what a deploy would send.
- A file edited on the board since VERA last applied it is a `conflict`: it stays as it is there and the result warns.
  `pi-tool fetch --board pi --project blink/vera-pi.json --path app.py` brings the board's copy into the run folder;
  `deploy --overwrite app.py` replaces it with this computer's copy (irreversible: ask the user first). Files that
  exist only on the board (`remoteOnly`) are never deleted.
- `setup-failed`: pip could not install the requirements; `setup.stderr` says why. A package that needs a system
  library is installed with `exec` first.

## Commands and files

- `pi-tool exec --board pi --command "sudo apt-get install -y i2c-tools"` runs one command line in a shell on the
  board, with live output and `--budget <seconds>` (default 120). `--project blink/vera-pi.json` runs it in the
  project's folder with its virtual environment. Use it for packages (`apt-get`, `pip`), hardware checks
  (`i2cdetect -y 1`, `pinctrl get`, `vcgencmd measure_temp`, `rpicam-hello --list-cameras`, `lsusb`),
  configuration (`sudo raspi-config nonint do_i2c 0`) and a reboot (`sudo reboot`: the call ends `connection-lost`;
  wait half a minute, then `identify`). Tell the user what the command changes before running it.
- `sudo` works where the board allows it without a password (the default user of Raspberry Pi OS); it cannot ask
  for one.
- `pi-tool fetch --board pi --path /var/log/syslog` copies one file of at most 8 MiB into the run folder; text
  shows its first lines in `file.preview`. `--path` is absolute, `~/...`, or relative to the project with
  `--project`.
- Results that leave files (`deploy`, `run-task`, `exec`, `fetch`, logs) are in `raspberry-pi-results/<run-id>/`.
