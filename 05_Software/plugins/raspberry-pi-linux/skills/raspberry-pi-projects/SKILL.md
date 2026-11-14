---
name: raspberry-pi-projects
description: How to reach a Raspberry Pi with pi-tool and deploy a project there - pin and check its SSH host key, install the remote helper, identify the board, write vera-pi.json, stage a hashed deploy candidate and apply only the approved files. Use whenever a task deploys or updates code on a Raspberry Pi or another Linux board.
---
# raspberry-pi-projects

VERA runs on this computer and reaches the board over SSH; the board is a `linux-board` entry of `lab/resources.json`
(see the plugin README). Never guess a host key, user or root: the user declares them.

## Connecting

1. `pi-tool check-host-key --board pi` shows the presented key without logging in. `host-key-unpinned`: ask the user
   to compare the fingerprint with `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` on the board's console and pin
   it. `host-key-changed`: stop and tell the user; never edit hostKeys to make it pass.
2. `pi-tool install-helper --board pi` (approved once per helper version). `helper-missing` or `helper-changed` from
   any other call means this step is due.
3. `pi-tool identify --board pi`: model, serial, machine id, OS, architecture, user and `rootCheck`.
   `identity-mismatch` means another board answers; `root-invalid` means the remote root is missing, a link, owned by
   someone else or writable by others - the user fixes it on the board.
4. Errors before login: `agent-unavailable` (no SSH agent), `agent-key-missing` (the agent lacks the key),
   `auth-failed` (the board refused the key), `unreachable`, `timeout`. The user resolves them; VERA never asks for a
   password.

## vera-pi.json

```json
{ "format": 1, "kind": "vera-pi-project", "name": "blink-demo",
  "files": ["app.py", "lib", "run.sh"], "exclude": ["__pycache__"],
  "hardware": { "actuates": true, "note": "drives the LED on GPIO17" },
  "tasks": { "selftest": { "argv": ["python3", "app.py", "--selftest"], "budgetS": 60,
                           "outputLimitBytes": 1048576, "extraArgs": false, "actuates": false } },
  "services": { "blink-demo.service": { "keepRunning": true, "actuates": true } } }
```

- `files`: paths relative to the manifest; a folder takes its files. No `..`, absolute path, link or `.vera-pi`.
  Spaces are fine: nothing passes them through a shell.
- A task's program is `python3` or a file the project deploys; sudo, shells, `env` and system programs are refused
  (`command-not-allowed`). `budgetS` 1-3500, `outputLimitBytes` 1 KiB-16 MiB.
- `hardware` / `actuates`: say whether project code moves, switches or drives anything; the approval shows it.
- `pi-tool inspect-project --project blink/vera-pi.json` checks the manifest offline and lists every file with its
  SHA-256.

## Deploying

1. `pi-tool deploy-candidate --board pi --project blink/vera-pi.json` stages the files below the root's `.vera-pi`
   folder and writes `candidate.json` with each file's action: `new`, `changed`, `unchanged` or `conflict` (changed on
   the board since VERA last applied it), plus `remoteOnly` files, which are never deleted.
2. Show the user the candidate's list, then `pi-tool apply-candidate --board pi --candidate
   arduino-iot-results/<run-id>/candidate.json`. VERA's approval binds that file by hash. `candidate-changed` (staged
   bytes changed) and `conflict` (a target changed after staging) apply nothing: stage again.
3. A conflict file is replaced only with `--overwrite <path>`, which is irreversible: the board's edits are lost. Ask
   the user first.
