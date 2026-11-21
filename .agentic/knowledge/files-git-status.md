# Files Git status

## Routing

Select for the Files Git overlay, its workbench opt-in, change rows, refresh, and Desktop's unattended local Git reads. Start at `main/git/read.ts` and `renderer/components/documents/git-status.tsx` under `05_Software/src/apps/desktop/src/`. [Docs panel](document-viewer-docs-panel.md) owns ordinary Files paths and actions. [Document viewer](document-viewer.md) owns the central tab strip beside Chat.

## Purpose and boundaries

Desktop main owns Git discovery, bounded read commands, working-tree scope and presentation. Each opted-in Files view owns one status subscription. The agent, plugins, indexing, retrieval, and session Changes have separate ownership.

## Public interface

- `interface.git_status` is a boolean in workbench format 1, default false, changed with Edit Workbench → Interface → Save. Opening an enabled Files view calls `git.status` with `workbenchId`, `indexLease`, a UUID `viewId`, and `action` of `open`, `refresh`, or `close`. Status arrives as a workbench `git.status` event with the same identity.
- A ready status includes `branch.kind` of `named`, `unborn`, or `detached`, the branch label (a short object ID when detached), scoped `changed` and `conflicts` counts, and `entries`. Each Git entry's `path` is a workbench-relative Files identity and `displayPath` its Display label. `staged` compares index with HEAD, and `unstaged` compares disk with index. Null means unchanged for that comparison. `?` is an untracked working-tree entry. `conflict` describes the unmerged path independently of the comparison codes.
- An in-scope rename has two entries, each with `rename.role` of `source` or `destination` and an opaque `rename.path` for the other endpoint. Both paths contribute to `changed`. Git only sees the scoped pathspec for rename detection, so a boundary-crossing move shows the locally visible addition or deletion. `virtual` identifies a missing worktree file. Its tree row has no normal file actions. Availability states are `no-repository`, `missing-git`, `unsupported`, and `failed`.
- For subsequent comparisons and history, add named operations inside the existing main-only boundary. Use the active workbench ID and lease, decode the Files identity in main, constrain every literal path to the discovered scope, and recheck current ownership before publishing. Treat rename metadata as presentation and query input, then revalidate it for the requested comparison. Ordinary file actions and the file menu's row handler live in `docs-tree.tsx`. Use that menu for real and virtual Git actions and the existing central document tabs for viewer identity. Clean tracked paths are absent from status, so history needs an explicit tracked-path read.

## Invariants

- Windows resolves Git from Program Files or the HKLM Git for Windows installation. Linux uses `/usr/bin/git`. Git 2.40 or later runs with absolute executable paths, no shell, a private current directory outside the repository and a fresh allowlist environment. Prompts, optional Git locks and Git transport/lazy fetch are disabled.
- Bounded repository config bytes feed a Git stdin-only config parse with includes disabled. Actual reads use a private metadata directory with a generated config. Only checked filemode, ignore-case, symlink and line-ending settings survive. Repository config is never reopened by Git as the config of that metadata directory. This prevents a config swap between safety inspection and launch from enabling repository-defined code. Hooks point to an absent private path, fsmonitor and global/system configuration are disabled, and the generated config has no external diff, textconv, filter, or remote definitions.
- The private metadata contains bounded HEAD, current loose ref, packed refs, index and local exclude/attribute rules. The objects view links only `pack` and two-hex-digit loose object directories. Original `objects/info` never backs the private object directory. Gitfiles, config includes/filters, extensions and unsupported metadata layouts fail closed. The trusted installation and local filesystem remain the native runtime trust roots. Git reads repository objects as data.
- The cached index listing has no worktree scan. It rejects outer tracked paths beneath embedded repositories before the status scan. Git excludes gitlinks and untracked embedded repositories. The status projection validates paths and checks ancestors before publishing. Path labels use the same opaque Display identities as ordinary Files and the current Display-mask policy. On Windows the exact physical spelling distinguishes a file from its absent case-only rename source. The private HEAD determines symbolic versus detached state.

## Key behaviors

- One logical refresh runs the fixed Git operations for the entire workbench, uses NUL-delimited output and caps time, bytes, entry counts and metadata before projection.
- Nonrecursive watches are scoped to relevant workbench directories, current Git metadata, and containing ignore and attribute files. They prune ignored subtrees and Git boundaries, leave tracked paths observable, and report limited watch coverage. Content-only worktree changes to already untracked files do not trigger a scan. A bounded debounce and one queued rerun handle bursts. New watch coverage is followed by a bounded reconciliation read before publication. The watcher selects the current branch ref even when branches share one refs directory. The view owner is rechecked before sending and its cancellation drains the process before private metadata cleanup.
- The existing Files tree shows accessible comparison labels and folder counts, including collapsed folders. Git changes only shows changed paths and their ancestors. Missing files remain navigable by keyboard and inert to ordinary open or menu actions. When a regular file replaces their former directory, missing descendants display beside it with relative labels. In combined search, full relative labels match and ordinary file actions require metadata from the regular Files listing or name search.

## Files

| Area | Source and tests |
| --- | --- |
| Read boundary and scope | `main/git/{read,repository,index-scope,status}.ts`, `main/git/safe-status.test.ts` |
| Refresh and lease | `main/git/{watch,status-service}.ts`, `main/git/status-service.test.ts` |
| Typed IPC and Display | `shared/src/git-status.ts`, `main/display-documents.ts`, adjacent tests |
| Files and preferences | `renderer/components/documents/{docs-tab,docs-tree,git-status,git-tree}`, `workbench-interface.tsx`, `docs-tree.test.ts` and `workbench-interface.test.ts` |

## Change map

- Change allowed commands and storage layouts through GitReader and its fixture tests.
- Change status admission or refresh through GitStatusService, GitWatch and their lease tests.
- Change tree row behavior through the existing roving tree, Git row projection and accessible component tests.

Git status and pathspec semantics are defined by the [porcelain status documentation](https://git-scm.com/docs/git-status) and [Git environment documentation](https://git-scm.com/docs/git).
