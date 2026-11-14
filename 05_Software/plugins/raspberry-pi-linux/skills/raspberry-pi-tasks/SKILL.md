---
name: raspberry-pi-tasks
description: How to run declared tasks, start, stop and read user services and collect logs on a Raspberry Pi with pi-tool, and how Stop, a lost SSH connection and a reboot are reported. Use whenever a task runs project code or a service on a Raspberry Pi or another Linux board.
---
# raspberry-pi-tasks

Only what `vera-pi.json` declares runs: its tasks and its listed user services. Project code can actuate hardware;
check the manifest's `hardware` and `actuates` and tell the user before running it.

## Tasks

- `pi-tool run-task --board pi --project blink/vera-pi.json --task selftest` starts the task under a supervisor on
  the board and waits for its end: `task.handle`, `task.pid`, `state`, `exitCode` or `signal`, `durationS`, and the
  stdout/stderr logs (also `stdout.log`, `stderr.log` in the run folder). `--arg VALUE` (at most 16) appends arguments
  only to a task declaring `extraArgs: true`; they arrive literally.
- States: `exited` (pass when exit code 0, else fail `task-failed`), `budget-exceeded`, `output-limit` (ended by the
  board's supervisor, fail), `stopped`, `start-failed`, `supervisor-lost` and `lost-by-reboot` (outcome unknown,
  incomplete). Unknown is never success.
- Stop: VERA's Stop asks the supervisor to end the task's process group and confirms the recorded PID (with start time
  and boot id) is gone: `remote.state` `confirmed`, or `unknown`. Processes are never killed by name.
- `connection-lost`: the task may still run under its budget. VERA's cleanup runs `stop-owned`; when that cannot reach
  the board the board is marked unknown. `pi-tool task-status --board pi --handle <h>` reports the real state later and
  `pi-tool stop-owned --board pi` stops every VERA task still running below the root.
- `supervisor-lost`: the board-side supervisor ended; pi-tool ends what is left of the task's process group and says so.
- After a reboot of the board, old tasks are `lost-by-reboot`; nothing is signalled. VERA never reboots a board.

## Services

- `service-status`, `service-start`, `service-stop --board pi --project blink/vera-pi.json --service blink-demo.service`
  act through `systemctl --user` on a unit the manifest lists (`service-not-allowed` otherwise). VERA never installs
  units, uses sudo or touches system services: the user creates the unit in `~/.config/systemd/user/` on the board.
- Results give load, active and sub state, main PID, `keepRunning` and `linger`. A `keepRunning` service stays active
  after the run (warning `keeps-running`) only when lingering is on for the user; otherwise systemd stops it shortly
  after VERA's SSH session ends (warning `no-linger`): the user runs `loginctl enable-linger <user>` on the board, VERA
  never does. Stop does not end a service - `service-stop` does.
- `pi-tool collect-logs --board pi --project blink/vera-pi.json --service blink-demo.service --handle <h> --lines 200`
  writes `journal-<unit>.jsonl` and `task-<handle>-*.log` into the run folder. `pi-tool report --run <dir>...`
  summarizes run folders as JSON, Markdown and HTML.
