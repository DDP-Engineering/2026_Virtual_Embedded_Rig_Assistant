---
name: git-branches
description: Inspect, switch and create branches, merge and rebase noninteractively while preserving conflicts. Use for Git branch workflows.
---

# git-branches

Look before changing anything: status --short --branch, branch --list -vv and log -n 20 --oneline --decorate. Create a branch with switch -c <new-branch> (checkout -b <new-branch> is the same), optionally followed by the revision it starts from; select an existing one with switch <branch>. Uncommitted changes travel with the switch when they do not conflict; when Git refuses, tell the user and offer a commit or stash instead of forcing it.

Merge with merge --no-edit <branch>; rebase with rebase <upstream>. There is no editor: do not pass -i, --interactive, -x or --exec. When Git reports conflicts, list the conflicting paths from status --short, explain both sides from diff, and let the user choose: resolve the files together, then add them and continue with merge --continue or rebase --continue, or give up with merge --abort or rebase --abort. Never rewrite history that was pushed.

Commands that can discard work ask the user to type a word outside Bypass: checkout <branch-or-path>, restore <path>, clean, reset --hard, switch --force, stash drop. Do not reach for them to get past a refusal; a failed operation is not permission to retry destructively. Finish by naming the branch you are on and the hashes involved (rev-parse --short HEAD). Publishing a branch is a separate request: see git-sync.
