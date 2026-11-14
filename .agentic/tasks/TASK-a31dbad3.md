# TASK-a31dbad3 - IOT-08 raspberry-pi-linux plugin: verified SSH projects, tasks and user services on a Raspberry Pi, plus the epic's integrated acceptance (#121)

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-DATA-44547a17, REQ-DATA-6c8b61c9, REQ-SEC-da232972, REQ-FUNC-9ea5add1, REQ-SEC-0513894a, REQ-SEC-adb91424, REQ-SEC-6b76749c, REQ-FUNC-ac086c52, REQ-SEC-255ef057, REQ-FUNC-38952891, REQ-SEC-c2cd454d, REQ-FUNC-379be3d8, REQ-SEC-90a99d8d, REQ-FUNC-d7e0c14e, REQ-SEC-9e1f9401, REQ-FUNC-cf78987c, REQ-REL-4569ba1a, REQ-REL-0b7928f1, REQ-REL-8352b260, REQ-REL-d58d8abe, REQ-FUNC-53db2460, REQ-FUNC-12ea8292, REQ-FUNC-ea84ae6e, REQ-SEC-69c28e7f, REQ-TEST-031f6831, REQ-SEC-f5c114de, REQ-FUNC-de5e43b9
parent:
branch: feature/113-arduino-iot
base: 13d3987c619d47893e5a58e119b8f34c8eadf594
opened: 2026-11-14

Edit Frame, Requirement coverage and Design directly. Write State, Log and
Rulings with `python .agentic/aegis.py` (advance, pause, log, ruling, verdict);
end each session with `advance` or `pause`.

## Done checklist (current stage)

- [x] diff reviewed against scope, requirements, design, error paths,
      portability, security and unrequested work
- [x] knowledge pages of changed components current with the reviewed code
- [x] project and environment context reconciled with the candidate
- [x] requirements re-read: status, prose, verification, paths and links true
- [x] manual or inspection verification recorded where applicable
- [x] explicit review approved, when enabled
- [x] final `check --strict --run` result logged truthfully after the last edit
- [x] remaining warnings and pre-existing failures explained
- [x] `report` appended

## Frame

Problem: VERA cannot deploy, run or observe projects on a Raspberry Pi. OBSERVED: no plugin under
`05_Software/plugins/` speaks SSH; LAB-01's registry (`shared/src/lab-resources.ts`) has the kinds visa, bus-adapter
and ble-device only; the runner's environment allowlist (`core/src/plugins/runner.ts` INHERITED) does not pass
`SSH_AUTH_SOCK`, so no plugin can reach the system SSH agent on Linux. The epic's integrated acceptance (ticket section
"Acceptanță integrată deținută de IOT-08", T08-F) is not written.

Desired outcome (STATED ticket IOT-08 and the coordinator's brief):
- An official plugin `raspberry-pi-linux` with connection profile, identify, inspect-project, deploy-candidate,
  run-task, service-status/start/stop and collect-logs/report. VERA stays on the desktop host and connects to the Pi;
  no linux-arm64 VERA build is claimed.
- SSH verifies the host key (a changed key is a verifiable conflict, never accepted automatically), the expected board
  identity, the user and the remote root. Keys are references to the system SSH agent; no password in argv, no
  disabled host-key check, no root login.
- A remote helper with finite operations at a verified version serves the selected project; installing it is an
  explicit separate action, no curl-pipe-shell. No arbitrary SSH shell for the agent: operations and paths validated,
  arguments never interpolated into a free shell command.
- Deploy builds a candidate in the declared remote root, checks hashes, permissions and concurrency, then applies only
  approved files; no recursive delete, no `--delete` sync. Only listed services, preferring user services; no general
  sudo or system change. Project code may actuate hardware and is classified and authorized explicitly.
- Tasks have a remote PID/handle and a remote budget, not only a local ssh process. Stop or disconnection tries to end
  the owned task and confirms the state; services configured to stay active are reported so; processes are never
  killed by a common name.
- T08-F: an integrated acceptance summary reusing the valid evidence of IOT-01...07, separating offline tests, real
  tools, test services and real hardware, with every open hardware/cloud blocker named.

Actors: the user (pins the host key, loads the key into the system SSH agent, creates the remote root and any user
unit, approves deploys and runs), the agent (runs `pi-tool`), VERA's program tools, approval gate, lease registry and
runner, the system SSH agent, the Pi's sshd, systemd user manager and the project code.

Primary scenario: the user declares a `linux-board` entry in `lab/resources.json` (host, port, user, pinned host-key
fingerprint, board serial or machine id, remote root). The agent runs check-host-key, install-helper (approved),
identify, inspect-project on a fixture project, deploy-candidate (staged and compared on the Pi), apply-candidate
(approved), run-task for a finite task (handle, PID, budget, logs), service-start/status/stop on a listed user unit,
collect-logs and report.

Examples: STATED T08-A...T08-F. T08-A: a changed host key or a wrong root is refused. T08-B: the fixture deploy with
hashes and conflict detection does not touch other projects or unapproved files. T08-D: arguments/paths with spaces,
a shell-injection attempt, sudo and an unlisted service are refused without lateral execution. T08-E: Stop, SSH loss
and an external reboot leave no false success; remote processes stopped/confirmed or marked unknown. Example needing a
value the user has not given: the real Pi's `<board serial>` and `<host key fingerprint>`.

Counterexamples: STATED - no real Pi is connected, so no real-board proof is claimed (T08-A/B/C/E stay open); no mock
presented as board proof; raw remote GPIO/I2C/SPI, OS provisioning, Pi firmware/bootloader and reboot/shutdown are
excluded.

In scope: the package (manifest, README, skills, PEP 723 local helper `pi-tool` on pinned asyncssh, a stdlib-only remote
helper); registry kind `linux-board`; the agent-socket hand-off for this program; catalog and pack entries; tests with a
local asyncssh SSH server and agent (STATED allowed by the brief) whose exec requests run in a real Linux shell (WSL on
Windows, the host on Linux); the integrated acceptance summary; AEGIS records, knowledge, plan row 8 and STATE.

Out of scope: real Raspberry Pi runs (STATED: none connected); installing anything into WSL or the system, non-PyPI
downloads, connecting to a real remote host (STATED: ask first; not needed); system services and sudo (STATED);
native Ubuntu proof (STATED: not run); rerunning the IOT-01...07 suites (STATED brief: reuse their evidence).

Constraints: no commit/push; LF; exact pins; formats stay 1; one lease registry (LAB-01); no second credential
mechanism; new UI text in en/ro/de; good enough over perfect, 1-2 review rounds, focused tests (STATED brief).

Success signals: T08-A/B/C/D/E software parts shown against the local SSH server with the remote helper on real Linux
(WSL); T08-F summary written; typecheck, lint, check:i18n and focused tests green; plan row 8 `built` with the real
Pi blockers open.

Evidence: OBSERVED asyncssh 2.24.1 (PyPI wheel read in the scratchpad): `known_hosts` may be a callable returning
trusted key lists, and an empty value loads `~/.ssh/known_hosts` (connection.py 3554-3566), so pinning must pass a
callable plus `SSHClient.validate_host_public_key`; `config=None` skips `~/.ssh/config`; on Windows the agent is Pageant
or the pipe `\\.\pipe\openssh-ssh-agent`, or `SSH_AUTH_SOCK` (agent_win32.py). OBSERVED prototype (scratchpad
proto/smoke.py): an asyncssh client authenticated through a test agent on a named pipe against an asyncssh server with
a pinned key, and the exec request ran in WSL Ubuntu 24.04 (x86_64, systemd user manager `running`, boot_id readable).
OBSERVED `program-request.ts` hashes workbench files named in argv and re-verifies them at apply; `runner.ts` gives a
supervised run a control folder with `stop`, grace and a cleanup run (LAB-01).

Assumptions: Raspberry Pi OS 12 (Bookworm) 64-bit has `/usr/bin/python3` >= 3.11, `/usr/bin/systemctl` and a systemd user
manager for the login user, and `/proc/device-tree/serial-number` (INFERRED from Raspberry Pi OS defaults; not verified
on a board here).

Unknowns: the behavior on a real Pi (UNKNOWN until a board is connected); whether the user's Pi has lingering enabled
for user services after logout (UNKNOWN; reported by service-status, never changed).

Decision-blocking questions: none. The brief settles scope, testing and the no-real-host rule.

Proposed behaviors (not accepted until specify):
- Registry kind `linux-board` keyed `ssh:<host>:<port>`, leased with `--board`, cleanup `stop-owned`.
- Host key pinned by SHA-256 fingerprints in the registry entry; `check-host-key` shows the presented key without
  authenticating; any mismatch is `host-key-changed` before authentication.
- Every remote call is a constant command (`/usr/bin/python3 -I -c '<stub>'`) with the request on stdin; the stub runs
  the installed helper only when its SHA-256 equals the bundled one.
- Deploy in two steps: deploy-candidate stages and compares, apply-candidate applies the approved candidate.json.
- A detached remote supervisor owns each task: handle, PID, start time and boot id, budget and output limit.

Path and reason: full.

| Criterion | Holds? | Evidence |
|---|---|---|
| no new externally observable behavior | no | new plugin |
| no new interface or data format | no | registry kind, project manifest, candidate and result formats |
| no new dependency | no | asyncssh pin |
| an existing requirement already covers the behavior | no | no SSH requirement |
| no security or data-handling change | no | SSH agent hand-off, remote execution |

## Requirement coverage

| Behavior | Requirement | State |
|---|---|---|
| pi-tool contract: operations, inputs, remote calls, results and exit codes | REQ-DATA-44547a17 | new |
| Declare a Raspberry Pi as a linux-board registry entry keyed by host and port | REQ-DATA-6c8b61c9 | new |
| Refuse a host key that is not pinned before authenticating | REQ-SEC-da232972 | new |
| Show the host key a board presents without authenticating | REQ-FUNC-9ea5add1 | new |
| Authenticate only with a key held by the system SSH agent | REQ-SEC-0513894a | new |
| Hand the SSH agent socket only to programs that declare it | REQ-SEC-adb91424 | new |
| Send only constant remote commands and keep arguments on stdin | REQ-SEC-6b76749c | new |
| Install the remote helper only as an explicit operation | REQ-FUNC-ac086c52 | new |
| Run only an installed helper whose SHA-256 matches the bundled helper | REQ-SEC-255ef057 | new |
| Identify the board, operating system, architecture, user and remote root | REQ-FUNC-38952891 | new |
| Refuse a remote root that is missing, linked, foreign-owned or writable by others | REQ-SEC-c2cd454d | new |
| Inspect a project manifest and its files offline | REQ-FUNC-379be3d8 | new |
| Refuse unsafe project paths and task commands | REQ-SEC-90a99d8d | new |
| Stage a deploy candidate and compare it with the remote project | REQ-FUNC-d7e0c14e | new |
| Apply only the files of the approved candidate | REQ-SEC-9e1f9401 | new |
| Run a declared task under a remote supervisor with a handle, PID and budget | REQ-FUNC-cf78987c | new |
| End a task at its budget or output limit on the board | REQ-REL-4569ba1a | new |
| Stop the owned task when VERA stops the run | REQ-REL-0b7928f1 | new |
| Report the task unknown when the SSH connection is lost | REQ-REL-8352b260 | new |
| Report tasks of an earlier boot as lost by reboot without signalling | REQ-REL-d58d8abe | new |
| Show, start and stop only listed user services | REQ-FUNC-53db2460 | new |
| Collect bounded task and service logs | REQ-FUNC-12ea8292 | new |
| Report runs as JSON, Markdown and HTML | REQ-FUNC-ea84ae6e | new |
| Rate pi-tool operations by their effect on the board | REQ-SEC-69c28e7f | new |
| Test pi-tool against a local SSH server with the remote helper on real Linux | REQ-TEST-031f6831 | new |
| Pass SSH_AUTH_SOCK in the environment of a program declaring sshAgent | REQ-SEC-f5c114de | revised |
| scpi helper ignores linux-board entries | REQ-FUNC-de5e43b9 | revised |

Spec REQ-DATA-44547a17 holds the contract; REQ-DATA-f2cbfc23 §1-2 gains kind linux-board and its key.

## Design

**Approach**: a new official plugin `raspberry-pi-linux` in the sibling pattern (ble-tools: a registry kind leased with
`--board`, LAB-01 stop request, grace and a `stop-owned` cleanup; wokwi: a candidate file bound by VERA's approval
hash). The local helper `pi-tool` (PEP 723: asyncssh 2.24.1, cryptography 49.0.0, typing-extensions 4.16.0) owns the
SSH connection; the board runs only the stdlib remote helper `scripts/remote/vera_pi_remote.py`, installed once by the
explicit `install-helper`. Host-key pinning uses a callable `known_hosts` plus `validate_host_public_key`, so OpenSSH
files are never read and nothing is accepted on first use (REQ-SEC-da232972); authentication is agent-only with
`config=None` (REQ-SEC-0513894a). Every exec request is one of two constant commands with the request on stdin
(REQ-SEC-6b76749c), so no agent text meets the remote shell; the run stub verifies the installed helper's SHA-256 before
executing it (REQ-SEC-255ef057). Rejected: the system `ssh.exe`/`ssh` client - host-key results only as stderr text,
per-platform option quirks and an argv command string. Rejected: sending the helper source on every call (no install)
- the ticket asks for an explicit install, and the task supervisor must outlive the SSH session.

**Interfaces and data**: spec REQ-DATA-44547a17 (command line, manifest, remote protocol and operations, results);
spec REQ-DATA-f2cbfc23 §1-2 (kind `linux-board`, key `ssh:<host>:<port>`). Host change outside the plugin: program field
`sshAgent: true` (shared schema), refused for non-official plugins in program-tools, and `RunRequest.inherit` so the
runner copies `SSH_AUTH_SOCK` into that run and its cleanup only (REQ-SEC-adb91424, REQ-SEC-f5c114de revised). The
scpi helper skips linux-board entries (REQ-FUNC-de5e43b9 revised).

**Deploy**: deploy-candidate stages into `<root>/.vera-pi/candidates/<id>/` and classifies against the target and the
last applied record; apply-candidate (candidate.json bound by approval) verifies all staged and base hashes before
renaming anything, never deletes project files, and removes only its own staged files (REQ-FUNC-d7e0c14e,
REQ-SEC-9e1f9401). Concurrency: VERA's board lease across VERA processes plus the base-hash check against anything else.

**Tasks**: a detached supervisor (new session) owns the task's process group, enforces budget and output limit on the
board, honours a `stop` file and records PID, `/proc` start time and boot id; signals go to the group only after that
identity matches (REQ-FUNC-cf78987c, REQ-REL-4569ba1a, REQ-REL-0b7928f1, REQ-REL-d58d8abe). pi-tool polls with
task-wait, forwards VERA's stop request, and reports `connection-lost` with remote state unknown, after which VERA's
cleanup `stop-owned` reconnects (REQ-REL-8352b260).

**Testing**: `tests/support/pi-test-sshd.py` (asyncssh server, real `sh -c` in WSL or on the Linux host) and
`pi-test-agent.py` (agent protocol on a named pipe or Unix socket); services use a runtime unit in
`$XDG_RUNTIME_DIR/systemd/user` of the WSL user manager, removed after the test. Offline cases (package, rules,
manifest, refusals) run everywhere (REQ-TEST-031f6831).

Diagrams: [diagram_TASK-a31dbad3.md](diagram_TASK-a31dbad3.md)

**Risks**: WSL is not a Pi (no device tree, x86_64): identity is proven with machine id there, the serial/model path only
by unit-level reasoning until a board exists; the WSL user manager is shared with the user's other WSL work, so the
test unit name is random and removed.


## Log

- 2026-11-14 frame: journal opened
- 2026-11-14 frame: completed; next specify - scope recorded (autopilot) (7 Done checklist item(s) left unticked)
- 2026-11-14 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-14 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-14 build: red: vitest lab-resources/plugins/runner exit 1 - linux-board kind, sshAgent field and run-level inherit missing (REQ-DATA-6c8b61c9, REQ-SEC-adb91424, REQ-SEC-f5c114de)
- 2026-11-14 build: red: vitest scpi-instruments -t 'Linux board' exit 1 - the scpi helper rejects a registry holding a linux-board entry (REQ-FUNC-de5e43b9)
- 2026-11-14 build: DEVIATION build: the remote helper and pi-tool were written and smoke-run against the test server before raspberry-pi-linux.test.ts existed, so most plugin requirements have no separate red line - the suite then ran against the finished helper; the host-side increments (registry kind, sshAgent, inherit, scpi skip) had red lines
- 2026-11-14 build: green: vitest tests/integration/raspberry-pi-linux.test.ts exit 0, 35 passed (SSH block on WSL Ubuntu 24.04 via the asyncssh test server; plugin requirements)
- 2026-11-14 build: green: vitest lab-resources, plugins, runner, program-credentials exit 0, 83 passed; scpi-instruments -t 'Linux board' exit 0 (REQ-DATA-6c8b61c9, REQ-SEC-adb91424, REQ-SEC-f5c114de, REQ-FUNC-de5e43b9)
- 2026-11-14 build: DEVIATION design: the Mermaid diagrams (structure, sequence, state) were drawn during build, after the design note - they illustrate the unchanged Design text
- 2026-11-14 build: green: vitest tests/integration/raspberry-pi-linux.test.ts exit 0, 37 passed after the self-review fixes (refusal keeps physical unchanged; apply pre-checks parent folders; silent task for the start-time case; taskRunning waits for a new task folder)
- 2026-11-14 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-14 validate: review round 1: spec approved (non-blocking: verification texts overstate tests for REQ-FUNC-379be3d8, REQ-REL-d58d8abe, REQ-DATA-44547a17, REQ-DATA-6c8b61c9 and others; agent refusal can hide a changed host key; spec f2cbfc23 duplicated text; scpi comment). Quality changes_required: BLOCKING keepRunning service without linger stops after the SSH session; non-blocking: refusal after a started task maps to unchanged, a task stuck in starting never settles, supervisor-lost ignores surviving group members, staged candidates accumulate, Windows-built ELF deploys 0644
- 2026-11-14 validate: returned to build - review round 1 findings
- 2026-11-14 build: green: round 1 fixes - vitest raspberry-pi-linux exit 0, 39 passed (linger reported with no-linger warning; refusal after a started task/service is unknown; starting record names its supervisor; group members after a lost supervisor are found and ended by pi-tool; staging prunes earlier candidates and its own partial folder; ELF deploys 0755; host-key conflict reported before agent problems; spec/requirement texts corrected); lint, check:i18n, typecheck exit 0
- 2026-11-14 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-14 validate: review round 2: spec approved, quality approved (non-blocking: a lost supervisor's record stays running so a later PID wrap could make an unrelated same-user group look like a member and be signalled; prune runs before the new staging succeeds; a helper killed between the starting record and the supervisor record leaves starting; leftovers after the write loop). Fixing the first two plus record wording after approval - the edit invalidates the verdicts, so a focused round 3 follows
- 2026-11-14 validate: returned to build - post-approval fixes: member identity by VERA_TASK_HANDLE, persisted supervisor-lost, prune after staging
- 2026-11-14 build: green: post-approval fixes - vitest raspberry-pi-linux exit 0, 39 passed (members need the task's VERA_TASK_HANDLE; supervisor-lost persisted; prune after the new candidate is complete; collect-logs count asserted); typecheck exit 0
- 2026-11-14 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-14 validate: review round 3: quality approved; spec changes_required (spec §5 stage row described the old prune order). Round 4 (spec text only, no code change since round 3's quality approval): spec approved. DEVIATION validate: four review rounds instead of the brief's 1-2 - round 3 checked post-approval safety fixes (member identity by VERA_TASK_HANDLE), round 4 a spec wording correction; costs review time only
- 2026-11-14 validate: final: python .agentic/aegis.py check --task TASK-a31dbad3 --strict --run exit 0; lint, typecheck, i18n ok, errors=0. This task's warnings: 15 uncovered-source (README, skills, entry script, __init__, copied workspace/lifecycle, fixtures, two test files), 1 secret-in-diff (a fake 'password' field in a lab-resources refusal case), 1 ticket-ref (REQ-SEC-f5c114de names REQ-SEC-adb91424); the rest belong to other tasks. Last focused run: raspberry-pi-linux 39 passed; neighbouring suites 227 passed before the plugin-only fixes
- 2026-11-14 validate: completed; next done

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-a31dbad3.md
changed: raspberry-pi-linux plugin, linux-board registry kind, sshAgent/inherit, scpi skip, acceptance summary, plan row 8
evidence: aegis check --task TASK-a31dbad3 --strict --run exit 0; vitest raspberry-pi-linux 39 passed
issues: real Raspberry Pi proof (T08-A/B/C/E) and native Ubuntu open; no board, Bus Pirate, BLE fixture, Pi or Wokwi token connected
spec_compliance: approved
implementation_quality: approved
review_round: 4

## Delivery report (2026-11-14)

- stage: validate; type: feature; path: full; branch: feature/113-arduino-iot
- requirements:
  - REQ-DATA-44547a17 - pi-tool contract: operations, inputs, remote calls, results and exit codes
  - REQ-DATA-6c8b61c9 - Declare a Raspberry Pi as a linux-board registry entry keyed by host and port
  - REQ-SEC-da232972 - Refuse a host key that is not pinned before authenticating
  - REQ-FUNC-9ea5add1 - Show the host key a board presents without authenticating
  - REQ-SEC-0513894a - Authenticate only with a key held by the system SSH agent
  - REQ-SEC-adb91424 - Hand the SSH agent socket only to programs that declare it
  - REQ-SEC-6b76749c - Send only constant remote commands and keep arguments on stdin
  - REQ-FUNC-ac086c52 - Install the remote helper only as an explicit operation
  - REQ-SEC-255ef057 - Run only an installed helper whose SHA-256 matches the bundled helper
  - REQ-FUNC-38952891 - Identify the board, operating system, architecture, user and remote root
  - REQ-SEC-c2cd454d - Refuse a remote root that is missing, linked, foreign-owned or writable by others
  - REQ-FUNC-379be3d8 - Inspect a project manifest and its files offline
  - REQ-SEC-90a99d8d - Refuse unsafe project paths and task commands
  - REQ-FUNC-d7e0c14e - Stage a deploy candidate and compare it with the remote project
  - REQ-SEC-9e1f9401 - Apply only the files of the approved candidate
  - REQ-FUNC-cf78987c - Run a declared task under a remote supervisor with a handle, PID and budget
  - REQ-REL-4569ba1a - End a task at its budget or output limit on the board
  - REQ-REL-0b7928f1 - Stop the owned task when VERA stops the run
  - REQ-REL-8352b260 - Report the task unknown when the SSH connection is lost
  - REQ-REL-d58d8abe - Report tasks of an earlier boot as lost by reboot without signalling
  - REQ-FUNC-53db2460 - Show, start and stop only listed user services
  - REQ-FUNC-12ea8292 - Collect bounded task and service logs
  - REQ-FUNC-ea84ae6e - Report runs as JSON, Markdown and HTML
  - REQ-SEC-69c28e7f - Rate pi-tool operations by their effect on the board
  - REQ-TEST-031f6831 - Test pi-tool against a local SSH server with the remote helper on real Linux
  - REQ-SEC-f5c114de - Give programs a minimal environment
  - REQ-FUNC-de5e43b9 - Ignore other identity kinds in the scpi helper's registry reader
- deviations: 3 recorded
  - build: the remote helper and pi-tool were written and smoke-run against the test server before raspberry-pi-linux.test.ts existed, so most plugin requirements have no separate red line - the suite then ran against the finished helper; the host-side increments (registry kind, sshAgent, inherit, scpi skip) had red lines
  - design: the Mermaid diagrams (structure, sequence, state) were drawn during build, after the design note - they illustrate the unchanged Design text
  - validate: four review rounds instead of the brief's 1-2 - round 3 checked post-approval safety fixes (member identity by VERA_TASK_HANDLE), round 4 a spec wording correction; costs review time only
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=4
- diff vs task base 13d3987: 75 file(s) changed, 5841 line(s) added
- checks: errors=0 warnings=68 notes=27
- checklist: 9/9 done
