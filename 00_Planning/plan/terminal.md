# TERM — Shell commands for the agent and a terminal for the user

PURPOSE: let the agent run shell commands and long-running programs (for example "start VERA in dev mode" or a
project's tests) on Windows and Linux, watch their output and stop them; and give the user a terminal panel in
VERA itself.
STATE: planned 2026-11-16. Product code follows AEGIS, one work package per task.

## Today (2026-11-16)

- The agent runs only programs that an enabled plugin declares: `run_program {program, args, cwd, timeout,
  background}` (`core/src/plugins/program-tools.ts`). It never uses a shell; `findProgram` refuses an undeclared
  program, so `npm`, `node`, `python`, `git`, `dotnet` or `make` cannot run.
- The runner already provides what a terminal needs: a foreground run returns the exit code, the last 12,000
  characters and the full log path; a background run returns a handle; `program_output {handle, waitMs, until}`
  reads new output and can wait up to 30 s or until a regular expression matches ("listening on"); `program_stop`
  kills the whole process tree (`process-tree.ts`); ANSI escapes are stripped (`run-output.ts`); runs appear in the
  Runs tab. Processes start without a console window and with stdin closed (`node-process-host.ts`).
- The working directory of a run must be a workbench folder; the [bypass plan](bypass-full-access.md) lifts that in
  Bypass.
- There is no terminal panel for the user.

## Decisions (2026-11-16)

- **A built-in `run_command` tool, not a plugin.** It runs a command string in the platform shell, under the
  session's permission mode, reusing the runner, the background handles, `program_output`, `program_stop` and the
  Runs tab. Plugins keep declared programs with argument rules.
- **Shell per platform:** Windows uses PowerShell 7 (`pwsh`) when installed, otherwise Windows PowerShell 5.1,
  with `-NoProfile -NonInteractive -Command` and UTF-8 output; `.cmd` and `.bat` (such as `npm.cmd`) work. Linux
  uses `bash -lc` so the user's PATH (nvm, pyenv) loads, otherwise `sh -c`. A setting can name another shell.
- **Working directory:** the workbench, a folder added to the workbench ("Additional folders" in Edit workbench),
  or, in Bypass, any folder.
- **Permission modes:**
  - Read-only: `run_command` is not offered.
  - Ask: every command asks; the approval card shows the command, the folder and the shell.
  - Auto-edit: a command runs without asking when it matches one of the workbench's allowed command prefixes
    (added with "Always allow" on the approval card, for example `npm test`, `python -m pytest`); others ask.
  - Bypass: commands run without asking.
  - In Ask and Auto-edit, a command matching a destructive pattern (recursive delete, `git push --force`,
    `git reset --hard`, format or disk tools) always asks and is never covered by an allowed prefix.
- **Clean environment:** the child process inherits the user's environment without VERA's provider keys and
  stored credentials; output follows the Program runs area of [secret masking](secret-masking.md).
- **Monitoring:** `background: true` returns a handle; the agent watches with `program_output` (`until` for a
  readiness line) and ends it with `program_stop`. Runs stop with the session, when the app closes, and when the
  user presses Stop in the Runs tab. The agent is not notified when a run ends; it reads.
- **Not interactive in the agent tool:** stdin stays closed, so a prompt fails fast instead of hanging; the help
  tells the agent to use non-interactive flags.
- **A terminal panel for the user** comes last: a Terminal tab in the right panel (xterm.js with node-pty), opened
  in the workbench folder, one or more tabs, where the user types. The agent can read a terminal's recent output
  with `terminal_read` when the user allows it per terminal; it never types into the user's terminal. node-pty is a
  native module built for Windows x64 and Linux x64 in the delivery.

## Work packages

| WP | Title | Result |
|---|---|---|
| TERM-01 | `run_command` tool | Shell resolution per platform and the shell setting; foreground with timeout, truncated output and the full log in `.vera/runs`; background handles shared with `program_output` and `program_stop`; clean environment; process tree stopped on session end and app exit; system prompt and agent help |
| TERM-02 | Approvals and allowed commands | Mode rules above; the approval card with command, folder and shell; "Always allow" adding a prefix to the workbench's allowed commands (`.vera/workbench.yaml`, format 1); destructive patterns; Edit workbench > Agent lists and removes allowed prefixes |
| TERM-03 | Additional folders | Edit workbench > General: folders added by the user (absolute paths) that `run_command` and the file tools may use in Ask and Auto-edit; shown in the workbench overview |
| TERM-04 | Runs tab for commands | Commands listed with their folder, live output, exit code, duration and Stop; a finished run's full log opens in the viewer |
| TERM-05 | Terminal panel | Terminal tab with xterm.js and node-pty in the right panel, several tabs, opened in the workbench; `terminal_read` for the agent with the user's per-terminal permission; node-pty in the Windows and Linux packages |

Order: TERM-01, then TERM-02 and TERM-03 (independent), then TERM-04; TERM-05 last and separately deliverable.
Help pages (Chat and sessions, Permissions, Keyboard shortcuts for the terminal) and the interface texts in en, ro,
de and fr are updated inside each work package; a CHANGELOG line and release-notes entry per user-visible package.

## Verification

- Unit: shell resolution on each platform; quoting of the command for `pwsh`, Windows PowerShell and `bash`; the
  environment without VERA secrets; mode rules, allowed prefixes and destructive patterns (a destructive command is
  never allowed by a prefix).
- Integration: `run_command` runs `node -e` in the foreground with exit code and output; a background server
  prints a readiness line that `program_output` with `until` waits for; `program_stop` kills the server and its
  children on Windows (job tree) and Linux (process group); a prompt waiting on stdin fails instead of hanging.
- E2E (native, Windows and Linux): "start the dev server of this repository" in Bypass starts it in a second
  repository, waits for the readiness line and stops it from the Runs tab; Ask shows the approval card and "Always
  allow" lets the next `npm test` run without asking in Auto-edit; the Terminal tab runs a command typed by the user.

## Out of scope

- A sandbox, container or VM for commands; remote shells over SSH; notifying the agent when a background run
  ends; the agent typing into the user's terminal.
