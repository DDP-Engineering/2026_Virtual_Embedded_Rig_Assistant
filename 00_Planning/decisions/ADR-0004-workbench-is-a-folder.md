# ADR-0004: A workbench is a plain folder

Date: 2026-10-09
Status: Accepted

## Context
A workbench gathers documents, skills, configuration and, later, tool descriptors for one board or
project. Engineers want to copy it, keep it in Git, hand it to a colleague, and open the same
documents with other programs.

## Decision
A workbench is a folder with `workbench.yaml`, `WORKBENCH.md`, `docs/`, `skills/` and, after 1.0,
`tools/`. Everything VERA derives or records at run time (index, sessions, artifacts, caches) lives in
`<workbench>/.vera/`, which ignores itself in Git. The format is versioned by `workbench.yaml`'s
`format` field.

## Alternatives considered
- Workbenches stored inside the app's data folder: easy to manage, but opaque to the user and hard to
  share or version.
- Runtime state in the app's data folder keyed by workbench id: keeps the folder clean, but moving or
  copying a workbench would lose its sessions.

## Consequences
- Copying the folder with `.vera/` moves sessions and artifacts too; without it, VERA rebuilds the
  index and starts with no sessions.
- `.vera/` is personal state; its own `.gitignore` keeps it out of a workbench kept in Git.
- SQLite needs local-disk locking: a workbench on a network share is unsupported in 1.0 and VERA warns.
- One VERA process per workbench, enforced by `.vera/lock`.
