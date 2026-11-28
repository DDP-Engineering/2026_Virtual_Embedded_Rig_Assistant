# raspberry-pi-linux: pi-tool, the remote helper and their documents

Governs REQ-DATA-44547a17 and the raspberry-pi-linux requirements that name this spec. The registry kind
`linux-board` is part of `.agentic/specs/REQ-DATA-f2cbfc23.md` §1-2; the agent-socket hand-off is REQ-SEC-adb91424.

## 1 Shape

VERA runs on the desktop host; `pi-tool` (PEP 723, asyncssh 2.24.1) runs there and reaches the board over SSH as
`ssh` does. The board runs a stdlib-only remote helper `vera_pi_remote.py` (Python >= 3.9) that pi-tool installs by
itself when a call finds it missing or different. Supported matrix: Raspberry Pi OS 12 (Bookworm) 64-bit on a
Raspberry Pi with an unprivileged login user and a systemd user manager; other distributions and models are not
claimed. Not offered: passwords and passphrases, OS provisioning, firmware or bootloader changes.

## 2 Command line

```text
pi-tool capabilities
pi-tool check-host-key   --board A
pi-tool trust-host-key   --board A
pi-tool install-helper   --board A
pi-tool identify         --board A
pi-tool inspect-project  --project FILE
pi-tool compare          --board A --project FILE
pi-tool deploy           --board A --project FILE [--overwrite PATH]...
pi-tool deploy-candidate --board A --project FILE
pi-tool apply-candidate  --board A --candidate FILE [--overwrite PATH]...
pi-tool run-task         --board A --project FILE --task NAME [--arg VALUE]...
pi-tool exec             --board A --command LINE [--project FILE] [--budget SECONDS]
pi-tool task-status      --board A --handle H
pi-tool stop-owned       --board A
pi-tool service-status|service-start|service-stop --board A --project FILE --service UNIT
pi-tool collect-logs     --board A --project FILE [--service UNIT]... [--handle H]... [--lines N]
pi-tool fetch            --board A --path REMOTE [--project FILE]
pi-tool report           --run DIR...
```

Operations that leave files (deploy, deploy-candidate, apply-candidate, run-task, exec, install-helper, stop-owned,
service-start, service-stop, collect-logs, fetch, report) take `--results-dir DIR` (default `raspberry-pi-results`)
and `--run-id ID` and write `result.json` and `report.md` into a new run folder there (created exclusively, never
inside `.vera`); check-host-key, trust-host-key, identify, compare, task-status and service-status write no folder.
`--board` names a `linux-board` alias of `lab/resources.json` (`$PI_REGISTRY`); the approved registry hash
(`$VERA_REGISTRY_SHA256`) is re-checked. FILE options are paths inside the working directory. `--lines` 1...2000
(default 200); `--arg` at most 16, only for a task that declares `extraArgs: true`; `--overwrite` names files edited
on the board; `--budget` 1...3500 (default 120); `--command` 1...8192 characters. stdout holds one JSON document (at
most 11000 UTF-16 units, long lists cut); a task's or command's own output is passed on to stderr while it runs;
exit 0 pass, 1 fail, 2 blocked, 3 incomplete or error.

## 3 Project manifest `vera-pi.json`

```json
{
  "format": 1,
  "kind": "vera-pi-project",
  "name": "blink-demo",
  "files": ["app.py", "lib", "requirements.txt", "blink-demo.service"],
  "exclude": ["*.log"],
  "requirements": "requirements.txt",
  "hardware": { "actuates": true, "note": "drives the LED on GPIO17" },
  "tasks": {
    "selftest": { "argv": ["python3", "app.py", "--selftest"], "budgetS": 60, "outputLimitBytes": 1048576,
                  "extraArgs": false, "actuates": false, "note": "" }
  },
  "services": { "blink-demo.service": { "file": "blink-demo.service", "keepRunning": true, "actuates": true, "note": "" } }
}
```

- `name` `^[a-z0-9][a-z0-9-]{0,63}$`: the remote project folder `<root>/<name>`.
- `files`: 1...512 paths relative to the manifest's folder, `/`-separated; a folder entry takes every regular file
  below it. Segments named `.venv`, `__pycache__` or `.git`, and segments matching an `exclude` entry (at most 32
  names or `fnmatch` patterns), are skipped. A segment is 1...128 characters without control characters, `/` or `\`,
  never `.` or `..`; the first segment never starts with `.vera-pi`; at most 8 segments. Spaces and shell characters
  are ordinary characters. Links, devices and files outside the folder are refused; a name whose letter case differs
  from the file on disk is refused with the disk's spelling. At most 512 files, 16 MiB each, 64 MiB in total. The
  mode sent is `0755` for a file with an executable bit (on Windows: a `.sh` file, one starting with `#!` or an ELF
  binary), else `0644`. A file whose first line starts with `#!` and ends in CR LF is sent with every CR LF replaced
  by LF (size and SHA-256 are those of the sent bytes; warning `line-ends`).
- `requirements`: a listed pip requirements file. When it is new or changed, deploy, run-task and service-start run
  `python3 -m venv --system-site-packages .venv` (once) and `.venv/bin/python -m pip install -r <file>` in the
  board's project folder as a supervised command `setup` (budget 1800 s) and record the file's SHA-256 in
  `.venv/.vera-requirements`; a failure ends `setup-failed` before any task starts.
- `tasks`: at most 16 names `^[a-z0-9][a-z0-9-]{0,31}$`; `argv` 1...32 strings of 1...1024 characters without NUL;
  `argv[0]` is a deployed project file with an executable bit, an absolute path, or a program found on the task's
  `PATH` (`command-not-found` otherwise). `budgetS` 1...3500, default 600 (pi-tool waits at most 30 s more, inside
  VERA's 3600 s run limit); `outputLimitBytes` 1024...16 MiB, default 1 MiB (stdout and stderr together).
- `services`: at most 8 unit names `^[A-Za-z0-9][A-Za-z0-9_.@-]{0,118}\.service$`, user units only; `file` names a
  listed project file that service-start installs as the unit.
- `hardware`, `actuates` and `note` classify project code that may move, switch or drive hardware; they are shown by
  inspect-project and repeated in results. Unknown fields anywhere are refused (`manifest`).

## 4 SSH

Connection: TCP to `host:port` (port 22 unless the entry names one; connect and login timeout 15 s, keepalive
5 s x 3), user from the entry, `~/.ssh/config` never read, no host certificates, no password, keyboard-interactive,
GSS, agent or X11 forwarding, port forwarding, PTY or interactive shell.

Host key, in this order: (1) `hostKeys` of the entry, then only those fingerprints count (`trust: pinned`); (2) the
fingerprint pi-tool saved for `<host lower-case>:<port>` in `lab/linux-board-keys.json` next to the registry
(`saved`); (3) the keys `~/.ssh/known_hosts` holds for the host (`known_hosts`, hashed entries included); (4) a
host seen for the first time is accepted and saved (`first-use`, warning `host-key-saved`). A key that is not the
trusted one ends `host-key-changed` before authentication; `trust-host-key` saves the key presented now
(`host-key-pinned` when the entry pins `hostKeys`). pi-tool asks for the algorithms of the trusted keys first, then
Ed25519, ECDSA, RSA, and before it calls a key changed it asks for each other kind once. check-host-key never logs
in and saves nothing.

Login is public key only: the keys of the SSH agent (`SSH_AUTH_SOCK`; on Windows without it Pageant when pywin32
is present, else `\\.\pipe\openssh-ssh-agent`) when one answers, then the private keys of `~/.ssh` that load without
a passphrase (`id_ed25519`, `id_ecdsa`, `id_rsa`, then every other file with a `.pub` beside it), at most six in
all; `agentKey` restricts login to that one agent key. `$PI_SSH_DIR` replaces `~/.ssh` (tests). Refusal codes: 
`host-key-changed` (reported before a key problem), `no-key`, `agent-unavailable` and `agent-key-missing` (only
with `agentKey`), `auth-failed`, `unreachable`, `timeout`; `no-key` and `auth-failed` name the command that
authorizes a key on the board.

Remote commands are exactly two constant strings for the bundled helper version `V` and SHA-256 `H`:
`/usr/bin/python3 -I -c '<install stub(V, H)>'` and `/usr/bin/python3 -I -c '<run stub(V, H)>'`. Neither contains a
value from the agent, the manifest or the registry. The install stub reads the helper bytes from stdin (at most
512 KiB), refuses them unless their SHA-256 is `H`, and writes `~/.local/share/vera-pi/V/vera_pi_remote.py` (folders
0700, file 0600, written aside and renamed). The run stub reads that file, answers `helper-missing` or
`helper-changed` unless its SHA-256 is `H`, otherwise executes it, which reads one request line (JSON, at most
1 MiB) and `payloadBytes` raw bytes from stdin and writes one JSON response. On `helper-missing` or `helper-changed`
pi-tool runs the install stub once and repeats the call (warning `helper-installed`).

## 5 Remote helper operations

Every request carries `root` (null for `~/vera-projects`) and `expect {user, serial?, machineId?, model?}`. Before
any operation the helper checks the login user (`pwd` name equals `user`, uid != 0) and each declared identity value
(`/proc/device-tree/serial-number` or `/sys/firmware/devicetree/base/serial-number`, `/etc/machine-id`,
`/proc/device-tree/model`): a value that differs or is unreadable is `identity-mismatch`. The root is created
(0755) when missing and must be a directory, not a link and below no link, owned by the uid and not world-writable
(`root-invalid`). VERA's own state is `<root>/.vera-pi/` (0700): `candidates/<id>/`, `tasks/<handle>/`,
`projects/<name>.json`.

| op | effect |
|---|---|
| identify | facts: model, serial, machineId, os (ID, VERSION_ID, PRETTY_NAME), machine, kernel, python, user, uid, home, bootId, helper version; the root check with its path; health: temperatureC, throttled (`vcgencmd get_throttled` decoded into `now` and `sinceBoot`), memory and disk in MB, load1, cpus, uptimeS, tasksRunning |
| plan | per file the action new, changed, unchanged or conflict (neither the sent nor the last applied hash), the current and last applied hash, `modeDiffers`; remote-only files (at most 512, `.venv`, `__pycache__`, `.git` skipped); the virtual environment's state. Changes nothing |
| stage | creates `candidates/<id>/` exclusively, removes its own partial folder when staging fails, writes the payload files there, checks each hash, and once the new candidate.json is written removes the project's earlier candidates. A file marked `sent: false` travels without bytes and is refused (`candidate-changed`) when the board would need them |
| apply | checks every staged hash (`candidate-changed`) and every target's base hash (`conflict`) first, then renames the new, changed and overwritten files into place (parents 0755, no link followed), sets the mode of unchanged files that differ, writes `projects/<name>.json` and removes the staging; it deletes no project file |
| deploy | stage and apply in one call; a conflict is replaced only when `overwrite` names it |
| task-start | creates `tasks/<handle>/` with request.json, removes the folders of finished tasks beyond the newest 20, and starts a supervisor (`/usr/bin/python3 -I -c <supervise stub>` fed the helper source, new session, stdio closed) that starts the task in its own process group: `argv` in the project folder, or `shell` (a command line handed to `/bin/bash -c`, else `/bin/sh -c`) in the project folder or the home folder. Environment: `PATH` with the project's `.venv/bin` first, `~/.local/bin` and the sbin folders, `VIRTUAL_ENV`, `PYTHONUNBUFFERED=1`, `DEBIAN_FRONTEND=noninteractive` |
| task-wait | the status after at most 2 s; with `offsets` it returns as soon as a log grew, with the new text of each log (at most 32 KiB, never cut inside a UTF-8 character) and the next offsets |
| task-stop | creates `tasks/<handle>/stop`, waits up to 8 s for the supervisor's final status; when the supervisor is gone, ends the recorded process group itself while its leader (PID, start time, boot id) or a member started since then with the task's `VERA_TASK_HANDLE` in its environment runs, and confirms none is left |
| task-status | the status, re-derived (supervisor alive, PID identity, boot id) |
| task-logs | the last bytes (at most 1 MiB each) of stdout.log and stderr.log and, for a longer log, its first 4 KiB |
| stop-owned | task-stop for every task under the root that is not final |
| read-file | one regular file of at most 8 MiB as the login user may read it (absolute, `~/`, or relative to the project or home folder): path, size, SHA-256, base64 data |
| service | start: copies the manifest's unit `file` from the project folder to `~/.config/systemd/user/UNIT` when it differs (`daemon-reload`), turns lingering on for a `keepRunning` service (`loginctl enable-linger`, else `sudo -n loginctl enable-linger USER`), `systemctl --user restart -- UNIT` and for `keepRunning` `enable`; stop: `stop` and for `keepRunning` `disable`; always `systemctl --user show -p LoadState,ActiveState,SubState,MainPID,UnitFileState,ExecMainStatus,Result -- UNIT` (argv, no shell) |
| journal | `journalctl --no-pager -o json -n N --user -u UNIT`, and when that prints nothing `--user-unit=UNIT` (the system journal, for a board whose journal is kept in memory) |

Task status: `starting`, `running`, `exited` (exitCode or signal), `budget-exceeded`, `output-limit`, `stopped`,
`start-failed`, `supervisor-lost` (supervisor gone, task gone, outcome unknown; while a group member still runs the
task is `running` with `supervisorLost`, and pi-tool ends it), `lost-by-reboot` (boot id differs; never signalled),
`unknown`; a `starting` record whose supervisor is gone is `start-failed`. The supervisor ends the group with
SIGTERM, then SIGKILL after 3 s, at the budget, the output limit or a stop request, also when no SSH connection is
open. A process group is only ever signalled when its leader's `/proc/<pid>/stat` start time and the boot id equal
the record, or, with the supervisor gone, when a member started since the task carries the task's
`VERA_TASK_HANDLE`; a process that cleared its environment is not recognised as a member.

pi-tool's own sequence: deploy, run-task and service-start call plan and, when a file is new or changed or a mode
differs, deploy with the bytes of only those files; then the `setup` command when the requirements changed; then
the task or service. A conflict that `--overwrite` does not name stays on the board with the warning `conflict`.

## 6 Results

`format: 1`, `kind: pi-tool-result`, `tool`, `operation`, `runId` (when a run folder exists), `startedAt`,
`finishedAt`, `status` (pass, fail, blocked, incomplete, error), `errors` and `warnings` `{code, message}`, `board
{alias, host, port, user, root, hostKey}`, `hostKey {type, fingerprint, trusted, trust}`, `identity`, `health`,
`helper {version, sha256}`, `project {name, manifest, sha256}`, `lifecycle {phases, physical, stopRequested}` and
per operation: `deploy {remoteDir, counts, applied, modeFixed, conflicts, files, remoteOnly}`, `candidate`
(candidate.json path and plan), `applied`, `setup` and `task {name, handle, pid, argv or command, budgetS, state,
exitCode, signal, durationS, stdout, stderr, actuates}` (stdout and stderr hold `bytes`, `file`, `truncated` and
`text`: the whole of a log up to 4000 characters, else its beginning and end), `service {unit, loadState,
activeState, subState, mainPid, file, installed, keepRunning, linger}`, `file {remote, path, size, sha256,
preview}`, `logs`, `remote {state}` with state `unchanged`, `changed`, `running`, `confirmed` (no process VERA
started runs, also after supervisor-lost or lost-by-reboot, whose task outcome is unknown) or `unknown`.
candidate.json: `format 1`, `kind vera-pi-candidate`, `candidateId`, `board`, `project`, `remoteDir`, `files
[{path, sha256, size, mode, action new|changed|unchanged|conflict, base}]`, `remoteOnly`, `createdAt`.
Codes besides §4: `usage`, `registry`, `registry-changed`, `board-unknown`, `host-key-pinned`, `manifest`, `path`,
`command-not-found`, `not-deployed`, `task-unknown`, `service-not-allowed`, `helper-changed`, `identity-mismatch`,
`root-invalid`, `candidate-invalid`, `candidate-changed`, `conflict`, `setup-failed`, `connection-lost`, `stopped`,
`supervisor-lost`, `lost-by-reboot`, `stop-unconfirmed`, `task-failed`, `service-failed`, `remote-error`,
`run-invalid`, `run-exists`. Warnings: `host-key-new`, `host-key-saved`, `helper-installed`, `conflict`,
`line-ends`, `staging-left`, `under-voltage`, `hot`, `disk-low`, `keeps-running`, `no-linger`, `exited`,
`journal-empty`, `resource-unknown`, `retry`.
