# raspberry-pi-linux: pi-tool, the remote helper and their documents

Governs REQ-DATA-44547a17 and the raspberry-pi-linux requirements that name this spec. The registry kind
`linux-board` is part of `.agentic/specs/REQ-DATA-f2cbfc23.md` §1-2; the agent-socket hand-off is REQ-SEC-adb91424.

## 1 Shape

VERA runs on the desktop host; `pi-tool` (PEP 723, asyncssh 2.24.1) runs there and reaches the board over SSH. The
board runs a stdlib-only remote helper `vera_pi_remote.py` (Python >= 3.9) that the user installs once per helper
version with `install-helper`. Supported matrix: Raspberry Pi OS 12 (Bookworm) 64-bit on a Raspberry Pi with an
unprivileged login user and a systemd user manager; other distributions and models are not claimed. No raw GPIO, I2C
or SPI access, OS provisioning, firmware/bootloader change, reboot or shutdown is offered.

## 2 Command line

```text
pi-tool capabilities
pi-tool check-host-key   --board A
pi-tool install-helper   --board A
pi-tool identify         --board A
pi-tool inspect-project  --project FILE
pi-tool deploy-candidate --board A --project FILE
pi-tool apply-candidate  --board A --candidate FILE [--overwrite PATH]...
pi-tool run-task         --board A --project FILE --task NAME [--arg VALUE]...
pi-tool task-status      --board A --handle H
pi-tool stop-owned       --board A
pi-tool service-status|service-start|service-stop --board A --project FILE --service UNIT
pi-tool collect-logs     --board A --project FILE [--service UNIT]... [--handle H]... [--lines N]
pi-tool report           --run DIR...
```

Every operation except capabilities and inspect-project takes `--results-dir DIR` (default `arduino-iot-results`) and
`--run-id ID` and writes `result.json` and `report.md` into a new run folder there (created exclusively, never inside
`.vera`). `--board` names a `linux-board` alias of `lab/resources.json` (`$PI_REGISTRY`); the approved registry hash
(`$VERA_REGISTRY_SHA256`) is re-checked. FILE options are paths inside the working directory. `--lines` 1...2000
(default 200); `--arg` at most 16, only for a task that declares `extraArgs: true`; `--overwrite` names candidate paths.
stdout holds one JSON document (at most 11000 UTF-16 units, long lists cut); exit 0 pass, 1 fail, 2 blocked,
3 incomplete or error.

## 3 Project manifest `vera-pi.json`

```json
{
  "format": 1,
  "kind": "vera-pi-project",
  "name": "blink-demo",
  "files": ["app.py", "lib", "run.sh"],
  "exclude": ["__pycache__"],
  "hardware": { "actuates": true, "note": "drives the LED on GPIO17" },
  "tasks": {
    "selftest": { "argv": ["python3", "app.py", "--selftest"], "budgetS": 60, "outputLimitBytes": 1048576,
                  "extraArgs": false, "actuates": false, "note": "" }
  },
  "services": { "blink-demo.service": { "keepRunning": true, "actuates": true, "note": "" } }
}
```

- `name` `^[a-z0-9][a-z0-9-]{0,63}$`: the remote project folder `<root>/<name>`.
- `files`: 1...512 paths relative to the manifest's folder, `/`-separated; a folder entry takes every regular file
  below it, skipping segments listed in `exclude` (at most 32 names). A segment is 1...128 characters without control
  characters, `/` or `\`, never `.` or `..`; the first segment never starts with `.vera-pi`; at most 8 segments.
  Spaces and shell characters are ordinary characters. Links, devices and files outside the folder are refused. At most
  512 files, 16 MiB each, 64 MiB in total. The mode sent is `0755` for a file with an executable bit (on Windows: a
  `.sh` file, one starting with `#!` or an ELF binary), else `0644`.
- `tasks`: at most 16 names `^[a-z0-9][a-z0-9-]{0,31}$`; `argv` 1...32 strings of 1...1024 characters without NUL;
  `argv[0]` is `python3` (run as `/usr/bin/python3`) or a path of a listed file; anything else (sudo, su, doas,
  pkexec, sh, bash, env, absolute paths) is `command-not-allowed`. `budgetS` 1...3500 (pi-tool waits at most 30 s more, inside VERA's 3600 s run limit); `outputLimitBytes` 1024...16 MiB
  (stdout and stderr together).
- `services`: at most 8 unit names `^[A-Za-z0-9][A-Za-z0-9_.@-]{0,118}\.service$`, user units only.
- `hardware`, `actuates` and `note` classify project code that may move, switch or drive hardware; they are shown by
  inspect-project and repeated in results. Unknown fields anywhere are refused (`manifest`).

## 4 SSH

Connection: TCP to `host:port` (connect and login timeout 15 s, keepalive 5 s x 3), host key accepted only when its
`SHA256:` fingerprint is in `hostKeys` (a callable known-hosts list, so `~/.ssh/known_hosts` is never read; host
certificates are not trusted), `~/.ssh/config` never read, user from the entry, public-key authentication through the
system agent only (`SSH_AUTH_SOCK`; on Windows without it Pageant, else `\\.\pipe\openssh-ssh-agent`), offering the
`agentKey` key when declared, else every agent key; no password, keyboard-interactive, GSS, key files, agent or X11
forwarding, port forwarding, PTY or shell. Refusal codes in order (an agent problem is reported only after the host key was found pinned): `host-key-unpinned`, `host-key-changed`,
`agent-unavailable`, `agent-key-missing`, `auth-failed`, `unreachable`, `timeout`.

Remote commands are exactly two constant strings for the bundled helper version `V` and SHA-256 `H`:
`/usr/bin/python3 -I -c '<install stub(V, H)>'` and `/usr/bin/python3 -I -c '<run stub(V, H)>'`. Neither contains a
value from the agent, the manifest or the registry. The install stub reads the helper bytes from stdin (at most
512 KiB), refuses them unless their SHA-256 is `H`, and writes `~/.local/share/vera-pi/V/vera_pi_remote.py` (folders
0700, file 0600, written aside and renamed). The run stub reads that file, refuses with `helper-missing` or
`helper-changed` (and the found hash) unless its SHA-256 is `H`, otherwise executes it, which reads one request line
(JSON, at most 1 MiB) and `payloadBytes` raw bytes from stdin and writes one JSON response.

## 5 Remote helper operations

Every request carries `root` and `expect {user, serial?, machineId?, model?}`. Before any operation the helper checks the
login user (`pwd` name equals `user`, uid != 0) and the identity (`/proc/device-tree/serial-number` or
`/sys/firmware/devicetree/base/serial-number`, `/etc/machine-id`, `/proc/device-tree/model`): any declared value that
differs or is unreadable is `identity-mismatch`. Project operations also check the root: an existing directory, not a
link and below no link (`realpath` equals the path), owned by the uid, not group- or world-writable (`root-invalid`).
VERA's own state is `<root>/.vera-pi/` (0700): `candidates/<id>/`, `tasks/<handle>/`, `projects/<name>.json`.

| op | effect |
|---|---|
| identify | facts: model, serial, machineId, os (ID, VERSION_ID, PRETTY_NAME), machine, kernel, python, user, uid, home, bootId, root checks, helper version |
| stage | creates `candidates/<id>/` exclusively, removes its own partial folder when staging fails, writes the payload files there with their modes, checks each hash, and once the new candidate.json is written removes the project's earlier candidates (their listed files, then empty folders); it returns per file the target's current hash and the last applied hash, plus remote-only files of the project folder (at most 512 listed) |
| apply | checks every staged hash (`candidate-changed`) and every target's base hash (`conflict`) first, then renames the new, changed and overwritten files into place (parents 0755, no link followed), writes `projects/<name>.json`, unlinks the remaining staged files and removes the empty staging folders; it deletes no project file |
| task-start | creates `tasks/<handle>/` with request.json and starts a supervisor (`/usr/bin/python3 -I -c <supervise stub>` fed the helper source, new session, stdio closed) that starts the task in its own process group with cwd `<root>/<name>`, stdin closed, stdout.log and stderr.log, and records status.json |
| task-wait | the status after at most 2 s |
| task-stop | creates `tasks/<handle>/stop`, waits up to 8 s for the supervisor's final status; when the supervisor is gone, ends the recorded process group itself while its leader (PID, start time, boot id) or a member started since then with the task's `VERA_TASK_HANDLE` in its environment runs, and confirms none is left; a lost supervisor with nothing left is written `supervisor-lost` |
| task-status | the status, re-derived (supervisor alive, PID identity, boot id) |
| task-logs | the last bytes (at most 1 MiB each) of stdout.log and stderr.log |
| stop-owned | task-stop for every task under the root that is not final |
| service | `linger` (whether `/var/lib/systemd/linger/<user>` exists), `systemctl --user --no-ask-password <start or stop> -- UNIT` and `systemctl --user show -p LoadState,ActiveState,SubState,MainPID,UnitFileState,ExecMainStatus -- UNIT` (argv, no shell) |
| journal | `journalctl --user --no-pager -o json -n N -u UNIT` |

Task status: `starting`, `running`, `exited` (exitCode or signal), `budget-exceeded`, `output-limit`, `stopped`,
`start-failed`, `supervisor-lost` (supervisor gone, task gone, outcome unknown; while a group member still runs the task is `running` with `supervisorLost`, and pi-tool ends it), `lost-by-reboot` (boot id differs; never
signalled), `unknown`; a `starting` record whose supervisor is gone is `start-failed`. The supervisor ends the group with SIGTERM, then SIGKILL after 3 s, at the budget, the output
limit or a stop request, also when no SSH connection is open. A process group is only ever signalled when its leader's
`/proc/<pid>/stat` start time and the boot id equal the record, or, with the supervisor gone, when a member started since
the task carries the task's `VERA_TASK_HANDLE`; a process that cleared its environment is not recognised as a member.

## 6 Results

`format: 1`, `kind: pi-tool-result`, `tool`, `operation`, `runId`, `startedAt`, `finishedAt`, `status` (pass, fail,
blocked, incomplete, error), `errors` and `warnings` `{code, message}`, `board {alias, host, port, user, root,
hostKey}`, `identity`, `helper {version, sha256}`, `project {name, manifest, sha256}`, `lifecycle {phases, physical,
stopRequested}` and per operation: `candidate` (candidate.json path and plan), `applied`, `task {name, handle, pid,
argv, budgetS, state, exitCode, signal, durationS, stdout, stderr, actuates}`, `service {unit, loadState, activeState,
subState, mainPid, keepRunning, linger}`, `logs`, `remote {state}` with state `unchanged`, `changed`, `running`, `confirmed` (no process VERA started runs, also after
supervisor-lost or lost-by-reboot, whose task outcome is unknown) or `unknown`. candidate.json: `format 1`, `kind vera-pi-candidate`, `candidateId`, `board`, `project`, `remoteDir`,
`files [{path, sha256, size, mode, action new|changed|unchanged|conflict, base}]`, `remoteOnly`, `createdAt`.
Codes besides §4: `usage`, `registry`, `registry-changed`, `board-unknown`, `manifest`, `path`, `command-not-allowed`,
`task-unknown`, `service-not-allowed`, `helper-missing`, `helper-changed`, `identity-mismatch`, `root-invalid`,
`candidate-invalid`, `candidate-changed`, `conflict`, `connection-lost`, `stopped`, `supervisor-lost`, `lost-by-reboot`, `stop-unconfirmed`, `task-failed`, `service-failed`,
`remote-error`, `run-invalid`, `run-exists`.
