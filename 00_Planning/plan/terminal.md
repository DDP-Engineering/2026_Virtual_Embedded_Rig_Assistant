# TERM - Shell commands and the user terminal

PURPOSE: let the agent run and monitor shell commands and give the user an interactive terminal.
SPEC: Gitea epic [#311](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/311)
and its children are authoritative for deliverables and Done criteria.
STATE: implementation authorized 2026-11-16, sequentially in the shared checkout on `master`,
one AEGIS implementation chat and one local commit per ticket, without pushing or full suites.

## Order

| Order | Package | Issue | Result | State |
|---|---|---|---|---|
| 1 | TERM-01 | [#312](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/312) | Built-in shell commands, shell settings, clean environment and background monitoring | TASK-002d804f candidate validated; coordinator commit pending |
| 2 | TERM-02 | [#313](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/313) | Command approvals, allowed prefixes and destructive-pattern refusal | planned |
| 3 | TERM-03 | [#314](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/314) | Additional workbench folders, file-tool access and immediate removal | planned |
| 4 | TERM-04 | [#315](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/315) | Commands, live output, stop and full logs in Runs | planned |
| 5 | TERM-05 | [#316](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/316) | Interactive terminal tabs, per-terminal read consent and packaged native runtime | planned |

TERM-01 depends on BYP-01 #309, implemented in local commit 62630967. TERM-02 and TERM-03 follow
TERM-01; TERM-04 follows both; TERM-05 is last. Only one implementation chat is active at a time.

## Shared decisions

- `run_command {command, cwd, timeout, background}` uses the existing runner, handles,
  `program_output`, `program_stop` and workbench-owned `.vera/runs` logs.
- Windows selects PowerShell 7, otherwise Windows PowerShell, with no profile, noninteractive
  execution and UTF-8 output. Linux selects `bash -lc`, otherwise `sh -c`. A setting overrides it.
- Read-only hides commands; Ask asks every time; Auto-edit accepts saved command prefixes;
  Bypass does not ask. Destructive commands always ask outside Bypass and cannot gain a prefix.
- Additional folders are user-selected absolute paths in workbench format 1. Bypass permits any
  accessible working folder. Application-data exclusions and revocation remain authoritative.
- Commands inherit the user's environment without VERA provider keys or stored credentials.
  Output follows Program runs secret masking. Agent stdin remains closed.
- Commands stop with their session and app exit. The agent polls for completion or readiness.
- The user terminal uses xterm.js and node-pty, supports several tabs and a keyboard shortcut.
  The agent may only read recent output with consent per terminal; it never types into it.
- Interface, help and release notes use English, Romanian, German and French. Each package adds
  a CHANGELOG line and a user-visible release-note entry, merging related notes if limits require.
- Stored formats stay at version 1; no migration or compatibility code.

## Verification

- Focused shell resolution, quoting, UTF-8, environment, timeout, stdin EOF and process-tree proof
  on Windows and Linux, including foreground node output and background readiness/stop.
- Mode, prefix-boundary and destructive-pattern tests; real approval/save/remove flows.
- Added-folder read/run success, unlisted-folder refusal and immediate removal.
- Runs live output, stop and viewer proof; terminal input, resize, read consent and packaging proof.
- Required static/strict checks and two independent reviews per ticket; reuse passing proof.
- No complete app, official-plugin or E2E suites until the user requests the final epic gate.
  WSL2 Linux proof does not establish native Ubuntu acceptance; report platform limitations honestly.

## Out of scope

Shell sandboxes, containers, remote SSH shells, automatic completion notifications and agent input
into the user's terminal.

## TERM-01 candidate proof

TASK-002d804f, base `2e3da767bbbd60256f8f9da7d69ae609390890e3`: focused command/shell/approval,
session/prompt/settings and localized components; immediate runner/transport/CLI consumers; real
Windows and WSL2 pinned Node 24.21.0 process proof. Original logs and receipts are under
`05_Software/evaluation-outputs/term01/platform/`. Native Ubuntu acceptance remains unavailable.
Independent reviews and final strict/static results are recorded in the task journal. The coordinator
owns the local commit and issue closure. Prefix grants, additional folders, Runs enhancements and the
interactive terminal remain in subsequent TERM packages.
