---
name: git-commit
description: Review, stage explicit paths and commit a workbench change after approval. Use when asked to save changes in Git.
---

# git-commit

Start with status --short --branch and diff --stat, read the diffs of the files in question, and check work that is already staged with diff --staged --stat. Match the repository's message style: log -n 10 --format=%s. Leave the user's unrelated changes alone and say which files the commit takes.

Stage by name: add -- <path1> <path2>. Do not stage build outputs, firmware binaries, logs or secrets (build/, .pio/, *.bin, *.elf, *.hex, .env); when status shows them untracked, propose a .gitignore line instead. Commit with commit -m <message>. A message with a body is one -m argument with line breaks in it: a subject of about 70 characters, an empty line, then why the change was made. When every file is already tracked, commit -m <message> -- <path1> <path2> stages and commits in one approval. Verify with log -n 1 --oneline and status --short, and give the user the commit hash.

If Git says the author identity is unknown, ask the user for the name and e-mail and set them with config user.name <name> and config user.email <email>. Other configuration is the user's to change in a terminal. Never amend or rewrite commits that were pushed, and do not push unless asked. To unstage use restore --staged <path> or reset -- <path>; neither touches the file. Report unexpected staged changes and conflicts instead of discarding work: no checkout -- <path>, restore <path>, clean or reset --hard as a shortcut.

Git changes do not appear in the Changes panel; the run log records each command and its output.
