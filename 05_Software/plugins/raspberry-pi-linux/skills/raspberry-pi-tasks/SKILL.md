---
name: raspberry-pi-tasks
description: How to run the tasks of a project on a Raspberry Pi with pi-tool, follow their output, start, stop and read user services that start at boot and collect logs, and how Stop, a lost SSH connection and a reboot are reported. Use whenever a task runs project code or a service on a Raspberry Pi or another Linux board.
---
# raspberry-pi-tasks

Project code can actuate hardware: check the manifest's `hardware` and `actuates` and tell the user before running it.

## Tasks

- `pi-tool run-task --board pi --project blink/vera-pi.json --task run` sends the changed files, installs changed
  requirements, then starts the task under a supervisor on the board and waits for its end. One call per edit.
  `--arg VALUE` (at most 16) appends arguments to a task declaring `extraArgs: true`; they arrive literally.
- The task's output appears while it runs. The result holds `task.state`, `exitCode` or `signal`, `durationS`,
  `deploy.applied` (what was sent) and the output: all of a short one, else its beginning and end; `stdout.log`
  and `stderr.log` in the run folder hold the last 64 KiB.
- A task that runs longer than a few minutes goes in the background (`run_program` with `background: true`); read
  it with `program_output`. A program meant to run for good is a service, not a task.
- States: `exited` (pass when exit code 0, else fail `task-failed`), `budget-exceeded`, `output-limit` (ended by the
  board's supervisor, fail), `stopped`, `start-failed`, `supervisor-lost` and `lost-by-reboot` (outcome unknown,
  incomplete). Unknown is never success. `command-not-found`: `argv[0]` is neither a project file nor a program on
  the board; install it with `exec`.
- Stop: VERA's Stop asks the supervisor to end the task's process group and confirms the recorded PID (with start time
  and boot id) is gone: `remote.state` `confirmed`, or `unknown`. Processes are never killed by name.
- `connection-lost`: the task may still run under its budget. VERA's cleanup runs `stop-owned`; when that cannot reach
  the board the board is marked unknown. `pi-tool task-status --board pi --handle <h>` reports the real state later and
  `pi-tool stop-owned --board pi` stops every VERA task still running.
- After a reboot of the board, old tasks are `lost-by-reboot`; nothing is signalled.

## Services

A service is a systemd user unit the manifest lists (`service-not-allowed` otherwise); with `"file"` it names the
unit file the project deploys, and VERA installs that file into `~/.config/systemd/user/`. A unit file, with `%h`
for the home folder:

```ini
[Unit]
Description=Blink demo
[Service]
WorkingDirectory=%h/vera-projects/blink-demo
ExecStart=%h/vera-projects/blink-demo/.venv/bin/python app.py
Restart=on-failure
[Install]
WantedBy=default.target
```

- `pi-tool service-start --board pi --project blink/vera-pi.json --service blink-demo.service` sends the changed
  files, installs the unit file and restarts the service, so it runs the current code. `ExecStart` uses
  `/usr/bin/python3` instead when the project has no `requirements`.
- `keepRunning: true` means the service outlives the session: it is enabled at boot (the unit needs its `[Install]`
  section) and lingering is turned on for the user. Warning `keeps-running` confirms it; `no-linger` means lingering
  could not be turned on, and the message gives the `exec` command that does it. Stop does not end a service -
  `service-stop` does, and for a `keepRunning` service it also disables the start at boot.
- `service-status` gives load, active and sub state, main PID and result. `service-failed`: the unit is not
  installed (name its `file`), or did not become active; `collect-logs` shows why. A oneshot unit that ran and
  ended well passes with the warning `exited`.
- `pi-tool collect-logs --board pi --project blink/vera-pi.json --service blink-demo.service --handle <h> --lines 200`
  writes `journal-<unit>.jsonl` and `task-<handle>-*.log` into the run folder. `journal-empty`: Raspberry Pi OS
  keeps the journal in memory, so it is empty after a reboot, and the user must be in the `adm` group to read it.
- `pi-tool report --run <dir>...` summarizes run folders as JSON, Markdown and HTML.
