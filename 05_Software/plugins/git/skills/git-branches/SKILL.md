---
name: git-branches
description: Inspect, switch and create branches, merge and rebase noninteractively while preserving conflicts. Use for Git branch workflows.
---

# git-branches

Inspect status --short --branch, branch --list and a bounded log -n 20 --oneline --decorate before changing branches. Use switch <branch> to select an existing branch or switch -c <new-branch> for a new one. Review the starting revision and local changes with the user. Changes require approval outside Bypass; read-only listings do not.

Use merge --no-edit <branch> for an approved merge and rebase <upstream> for an approved noninteractive rebase. Do not pass -i/--interactive or -x/--exec, signing/helper strategy overrides or executable aliases. Do not rewrite pushed history. If Git reports conflicts, report the exact paths, state and next choices to the user. Do not discard changes to resolve a conflict; never use forced switch, checkout, restore, clean or reset --hard as a shortcut. Do not auto-continue an unfamiliar existing rebase todo with executable commands. A failed operation is not permission to retry destructively.

Summarise the resulting branch and cite the relevant hashes from log/rev-parse. Remote operations require separate approval; do not publish without a user request. Git changes bypass the write queue/Changes panel; run logs record actions and the index watcher observes files. Fixed hooks/fsmonitor/pager/external-diff guards are not a sandbox: local textconv/filter and other user Git configuration retain their documented risks.
