# Git

Git lets the agent inspect and change the workbench Git repository. It reads status, history, diffs, blame and branch, tag, remote and stash listings freely; staging, committing, branch work and contacting remotes wait for your approval. Interactive editors, pagers and hooks are switched off, so every command runs without prompts.

## What it needs

- **Git 2.40 or newer**, which you install yourself (Git for Windows, or your distribution's git package). VERA finds it on PATH, in the standard Git for Windows folders or at `/usr/bin/git`, and never downloads it. Use **Check dependencies** on the plugin page after installing.
- For fetch, pull, push and clone: your own configured credentials or SSH keys. VERA does not add credentials, and Git does not prompt for them.
- No required plugins, hardware or configuration parameters.

## How to use it

- "What changed since the last release tag?" (skill `git-inspect`)
- "Who last changed lines 40 to 60 of src/main.c?"
- "Commit the changes to src/uart.c and src/uart.h with the message 'Fix UART overrun handling'." (skill `git-commit`)
- "Create a branch feature/adc-calibration from main and switch to it." (skill `git-branches`)
- "Merge feature/adc-calibration into main."
- "Clone the SDK repository into sdk/ and fetch its submodules." (skill `git-sync`)
- "It worked in v1.2.0 and the ADC reads zero now. Find the commit that broke it." (skill `git-bisect`)
- "Which revision is this build, and what changed since the last release?" (skill `git-release`)

The agent stages only the paths you agreed on, writes the message with `commit -m` and cites the resulting commit hash. It does not push unless you ask, never rewrites pushed history and reports merge or rebase conflicts to you instead of discarding changes.

## Risk and approvals

The risk labels are reused for repository state:

- Safe, runs without asking: status, log, diff, show, blame, describe, grep and the other read commands, listing branches, tags, remotes, stashes, worktrees and submodules, and reading one configuration key.
- Device-write: commands that change stored state or contact a remote, such as add, commit, switch, merge, rebase, reset, fetch, pull, clone and push, creating a branch with `checkout -b`, unstaging with `restore --staged`, the steps of a bisect, setting `user.name` or `user.email`, and any command that writes output to a file. Ask and Auto-edit modes ask before each one.
- Irreversible: commands that can discard work or rewrite history, such as checkout of a branch or a path, restore of a file, clean, a hard reset, deleting a stash, and force or deletion pushes. VERA asks you to type the command's name, except in Bypass.
- Blocked in every mode: other configuration changes, executable aliases and unknown command names, interactive commands, `bisect run` and explicit program execution.

## Limits

- Windows x64, Linux x64 and Linux arm64.
- A clone, fetch, pull, push or submodule update may run for 30 minutes, and a transfer over HTTP that stops moving is ended after one minute. Every other command has one minute.
- Git is not sandboxed: content filters such as LFS and repository-local textconv or filter drivers can still run programs. Treat an untrusted repository with care.
- Git changes do not appear in VERA's Changes panel; the run log records each command and its output.
