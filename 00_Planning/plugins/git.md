# Plugin `git` — version control of the workbench

PURPOSE: specify the official `git` plugin, which lets the agent inspect a workbench repository
freely and change it only with approval: status, history, diffs and blame without asking; staging,
commits, branches and remote operations under the risk rules.
DONE-WHEN: on Windows x64 and Linux x64 the agent answers "what changed since the last release tag"
from `git log` and `git diff` without approvals, commits a reviewed change after an approval, and
cannot run a repository-configured program (fsmonitor, hook, pager, external diff) or a blocked
command in any mode.
STATUS: implementation candidate 2026-11-04, AEGIS TASK-951445ca. Plugin format and rules: [architecture.md](architecture.md).
Work package: PLG-22 in [plan.md](plan.md).

## 1. Why a plugin and not a shell

VERA has no shell (ADR-0007, ADR-0016). Asked to run `git status`, the agent correctly refuses.
`git` is the most requested program after the bench tools, and a plugin gives it with typed risk:
read-only commands run without approval, changes ask, destructive ones need the typed confirmation,
and commands that run other programs are blocked.

## 2. Provisioning

| Platform | Install kind | Where |
|---|---|---|
| `windows-x64` | `find` | `PATH`; `C:/Program Files/Git/cmd/git.exe`; `%LOCALAPPDATA%/Programs/Git/cmd/git.exe` |
| `linux-x64`, `linux-arm64` | `find` | `PATH`; `/usr/bin/git` |

- Hint when missing: install Git for Windows, or the distribution's `git` package.
- Version probe: `git --version`, `git version (\d+\.\d+\.\d+)`. Supported from 2.40.
- Git is never downloaded: every developer machine has one, and the user's own credential setup
  must apply.

## 3. Repository-configured programs

A repository's own configuration can make Git run programs: `core.fsmonitor` even on `git status`,
hooks on `commit` and `merge`, `core.pager`, `diff.external`, `core.editor`. A workbench copied from
someone else carries its `.git/config` and hooks with it. The plugin neutralises these with a fixed
`prefix` (not part of the matched command line) and environment:

```
prefix: [-c, core.fsmonitor=false, -c, core.hooksPath=${pluginDir}/no-hooks, -c, core.pager=cat,
         -c, diff.external=, -c, core.quotePath=false, -c, protocol.ext.allow=never]
env:    { GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: never, GIT_PAGER: cat, PAGER: cat,
          GIT_EDITOR: ":", GIT_SEQUENCE_EDITOR: ":", GIT_OPTIONAL_LOCKS: "0" }
```

- `no-hooks/` ships an inert README.txt (no hook names) so the directory survives catalog zip packaging and Git hooks are disabled.
- Content filters (`filter.*`, used by Git LFS) stay enabled: LFS repositories need them, and their
  commands come from the user's global configuration.
- Credentials: prompts are disabled, so `fetch`, `pull` and `push` work only with a configured
  credential helper or SSH key; otherwise they fail with Git's own message.
- Residual risk: `diff.<driver>.textconv` and `filter.<driver>` commands defined in a
  repository-local config still run when `.gitattributes` names that driver, and `-c` cannot switch
  off every driver name. Git's `safe.directory` check refuses repositories owned by another user; a
  workbench copied from an untrusted source should be treated like any untrusted repository.

The literal `diff.external=` prefix alone is a fail-closed empty command and makes nonempty ordinary diffs fail. Implementation adds mandatory `--no-ext-diff` after diff/log/show and stash/reflog read subcommands, before original options and delimiters. It constructs the guarded invocation through the same parsed command boundary used by classification; raw agent values/order remain intact for approvals/logs. Bare stash show consequently uses Git's patch fallback; use --stat/-p to select an explicit shape. Native verification requires successful Git exit codes and actual reviewed patch text, not only transport success.

## 4. Manifest

```yaml
format: 1
id: git
version: 1.0.0
name: Git
description: Inspect and change the workbench's Git repository - status, history, diffs and blame freely; staging, commits, branches and remotes with approval. Use for any version-control question or task.
ecosystem: general
platforms: [windows-x64, linux-x64, linux-arm64]
programs:
  git:
    install:
      find: { windows: ["%PATH%", "C:/Program Files/Git/cmd/git.exe", "%LOCALAPPDATA%/Programs/Git/cmd/git.exe"], linux: ["$PATH", "/usr/bin/git"] }
      hint: Install Git for Windows or your distribution's git package.
    version: { args: [--version], match: 'git version (\d+\.\d+\.\d+)', range: ">=2.40" }
    prefix: [-c, core.fsmonitor=false, -c, "core.hooksPath=${pluginDir}/no-hooks", -c, core.pager=cat, -c, diff.external=, -c, core.quotePath=false, -c, protocol.ext.allow=never]
    env: { GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: never, GIT_PAGER: cat, PAGER: cat, GIT_EDITOR: ":", GIT_SEQUENCE_EDITOR: ":", GIT_OPTIONAL_LOCKS: "0" }
    timeout: 60
rules: # see §5
```

## 5. Rules

All matching rules apply and the highest risk wins, so a safe listing rule never hides a dangerous
flag: the escalation rules below catch the flag wherever it appears.

| Commands | Risk | Note |
|---|---|---|
| `--version`, `version`, `help`, `status`, `log`, `diff`, `show`, `blame`, `shortlog`, `describe`, `rev-parse`, `rev-list`, `ls-files`, `ls-tree`, `cat-file`, `grep`, `reflog`, `merge-base`, `name-rev` | `safe` | reads the repository |
| `branch` with no argument or `--list`, `-a`, `-r`, `-v`, `-vv`, `--show-current`, `--contains`, `--merged`, `--no-merged`; `tag` with no argument or `-l`, `--list`, `-n`; `remote` with no argument or `-v`; `stash list`, `stash show` | `safe` | listings |
| `add`, `commit`, `switch`, `merge`, `rebase` (non-interactive), `cherry-pick`, `revert`, `reset` (without `--hard`), `mv`, `rm`, `apply`, `am`, `stash` (push, pop, apply), `init`, `fetch`, `pull`, `clone`, `ls-remote`, `push`; `branch`, `tag` or `remote` with any other argument; any unmatched command | `device-write` (default) | changes the repository or contacts a remote. May change `.vera/` configuration and skills tracked in Git |
| `branch * {-d,-D,--delete,-m,-M,--move,-f,--force} *`, `tag * {-d,--delete,-f,--force} *`, `remote * {remove,rm,rename,set-url} *` | `device-write` | escalation over the listing rules |
| `reset * --hard *`, `clean`, `restore`, `checkout`, `switch * {--discard-changes,-f,--force} *`, `stash {drop,clear}`, `push * {-f,--force,--force-with-lease,--delete,--mirror,--prune} *`, `gc * --prune*`, `reflog {expire,delete}` | `irreversible` | discards uncommitted work, deletes untracked files or rewrites shared history; Git cannot restore it |
| `-c`, `-C`, `--git-dir`, `--work-tree`, `--exec-path`, `config`, `rebase * {-i,--interactive,-x,--exec} *`, `bisect`, `submodule * foreach *`, `filter-branch`, `filter-repo`, `grep * {-O,--open-files-in-pager} *`, `add * {-i,-p,--interactive,--patch,-e,--edit} *`, `mergetool`, `difftool`, `gui`, `citool`, `daemon`, `instaweb`, `send-email`, `credential*`, `hook` | `blocked` | interactive, runs other programs, changes Git configuration, or leaves the workbench (`cwd` is the only way to choose a repository) |

- `checkout` is `irreversible` as a whole: `git checkout <path>` discards changes with no flag that a
  rule could see. The skill uses `switch` for branches and `reset -- <path>` to unstage.
- `restore` is `irreversible` for the same reason: without `--staged` it discards working-tree
  changes.
- `push` without force flags is `device-write`: every push waits for approval outside `bypass`,
  because it publishes outside the machine.

The shipped `optionSyntax: git` projects case-sensitive command/option roles before generic matching while preserving original argv in approvals and run-record labels; execution inserts a mandatory no-ext-diff guard at the actual read-command boundary. Unknown command names are potential executable aliases/helpers and are blocked; unfamiliar options on known commands require approval. Listing options cannot lower a mutation. Explicit output files require approval; helper/viewer/signature/filter options, including accepted abbreviations, are blocked. Help listing is safe; opening a help topic launches a viewer and is blocked. Git's remaining user configuration (signing, merge/transport/credential helpers and implicit lazy fetch) is not sandboxed, alongside the textconv/filter residual risk above.

## 6. Skills

| Skill | Covers |
|---|---|
| `git-inspect` | bounded history (`log -n 20 --oneline --decorate`), `diff --stat` before per-file diffs, `blame -L`, comparing tags; cite commit hashes |
| `git-commit` | review `status` and `diff --staged`, stage explicit paths (never `add -A` without listing them), commit with `-m`; never amend or rewrite pushed history |
| `git-branches` | `switch`, `switch -c`, merges and rebases without `-i`; conflicts reported to the user, not resolved by discarding |

## 7. Interaction with VERA

- File changes made by Git do not pass through VERA's write queue and do not appear in the Changes
  panel; the run log keeps the command and its output. The document index sees them through its
  watcher.
- `cwd` passes the workbench path guard. In `bypass` the agent may set `cwd` to any folder, as file
  tools already may.
- Network: `fetch`, `pull`, `push`, `clone` and `ls-remote` contact the repository's remotes; this is
  an external program's egress (01 §8, last row).

## 8. Verification

- Matcher tests for every row of §5, including escalation over listing rules
  (`branch -a -D x` → `device-write`), `checkout -- f` and `restore f` → `irreversible`, and `-c` /
  `-C` / `config` → `blocked`.
- A fixture repository whose `.git/config` sets `core.fsmonitor`, `core.pager` and `diff.external` to
  a marker script, plus a `pre-commit` hook: `status`, `diff`, `log` and `commit` never run them.
- Smoke on Windows (Git for Windows) and Linux: inspect history without approvals, commit after an
  approval, a `fetch` without credentials fails cleanly within the timeout.

NOTES:
- Needs a program-level `prefix` (architecture §2.1); PLG-22 adds it to the manifest schema and the
  runner if PLG-01 and PLG-02 did not.
- `device-write` here means "an undoable change of stored state"; a dedicated level for repository
  and workspace changes is an open question for ADR-0018.
- Verify while implementing: Git for Windows runs `GIT_EDITOR=":"` through its bundled `sh`;
  `GCM_INTERACTIVE=never` suppresses Git Credential Manager windows.
