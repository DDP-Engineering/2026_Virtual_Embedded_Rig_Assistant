---
name: git-sync
description: Clone a repository, fetch, pull and push, and bring submodules up to date. Use when work must be exchanged with a remote.
---

# git-sync

See where things stand first: remote -v and status --short --branch (it shows ahead and behind). Every command that contacts a remote needs approval outside Bypass.

To receive: fetch, then log --oneline HEAD..@{u} shows what is new; pull --ff-only brings it in when the local branch has no commits of its own, and pull --rebase when the user wants local commits replayed on top. Do not create merge commits the user did not ask for. To publish: push, or push -u origin <branch> the first time a branch is published. Never force a push unless the user asks for exactly that, and say what it overwrites.

To clone: clone --progress <url> <folder> into the workbench. SDK repositories with submodules (ESP-IDF, Zephyr modules, vendor HALs) are large: start the clone with background true and follow it with program_output, then run submodule update --init --recursive --progress the same way. submodule status lists what is checked out. A transfer may run for up to 30 minutes; one that stops moving over HTTP is ended after a minute.

Git cannot ask for a password here. When it answers "could not read Username", "Authentication failed" or "Permission denied (publickey)", stop and tell the user to sign in once in their own terminal (run the same fetch there, or use their credential manager or ssh-add), then try again. Never put a token or password into a URL or an argument.
