---
name: git-commit
description: Review, stage explicit paths and commit a workbench change after approval. Use when asked to save changes in Git.
---

# git-commit

Start with status --short --branch, diff --stat and the relevant per-file diffs. Check existing staged work using diff --staged --stat and diff --staged. Preserve unrelated user work. Explain exactly which files belong in the requested commit.

Stage explicit reviewed paths with add -- <path1> <path2>. Never use add -A without listing and reviewing every included path first. Re-read status and diff --staged before commit. Use commit -m <clear-message>; closed stdin and GIT_EDITOR=: do not support interactive editing. Each mutation waits for the applicable approval. Verify the result using log -n 1 --oneline and status --short; cite the resulting commit hash.

Never amend or rewrite pushed/published history. Do not push unless explicitly requested: pushes contact a remote and require their own approval outside Bypass. Use reset -- <path> to unstage, preserving the working file. Report conflicts and unexpected staged changes rather than discarding them. No checkout/restore/clean/hard reset shortcuts.

Git changes bypass VERA's write queue and Changes panel, including tracked .vera configuration or skills. Commands/output remain in run logs, and the document-index watcher observes the files. Hooks are disabled by the plugin; content filters and repository-local textconv remain a residual execution risk. User-configured signing/credentials and transport keep normal Git semantics.
