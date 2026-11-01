# ADR-0004: A workbench is a plain folder

Date: 2026-10-09
Status: Accepted; implemented with deviations (layout moved into `.vera/`; see Implementation status)

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

## Implementation status (2026-11-01)
- Deviation: the user-edited files live inside `.vera/`, not at the root: `.vera/workbench.yaml`,
  `.vera/WORKBENCH.md`, `.vera/.veraignore` and `.vera/skills/`
  (`src/libraries/core/src/workbench/service.ts:390-397`, `474-498`). Root files are not detected.
  `architecture/02-workbench.md` §1 and §8 describe this layout.
- Deviation: `.vera/` does not ignore itself completely. Its `.gitignore` is `*` with exceptions for
  `.gitignore`, `workbench.yaml`, `WORKBENCH.md`, `.veraignore` and `skills/**`
  (`workbench/service.ts:407-411`). Configuration can go into Git; runtime state cannot.
- Deviation: there is no fixed `docs/` folder. The `docs.include`/`docs.exclude` globs in
  `workbench.yaml` select documents, `docs/**` by default (`src/libraries/shared/src/workbench.ts:5-8,44`).
- Consequence changed: a copy without `.vera/` also loses the configuration and instructions, so it is
  no longer a workbench.
- As decided: format versioned by `format: 1` (`shared/src/workbench.ts:35`); network-share warning
  (`workbench/service.ts:106-108,518`); `.vera/lock` plus an OS named-pipe guard
  (`workbench/guard.ts`). A second process opens the workbench read-only instead of being refused
  (`workbench/service.ts:795-822`).
- Open: no `tools/` folder yet; only a `tools.disabled` key exists (`shared/src/workbench.ts:47`).
