# CLAUDE.md

## Where AEGIS applies

Use the AEGIS workflow only to implement the product: production code and its tests, built from the
work packages in `00_Planning/plan/`. Documentation changed as part of such an implementation stays
in that task.

Do not open AEGIS tasks, journals or requirements for anything else: repository operations (Git,
remotes, labels, configuration, `02_Tools` setup), planning and architecture documents in
`00_Planning/`, standalone documentation, brainstorming, research or questions. Do those directly.

<!-- AEGIS:BEGIN (managed by .agentic/aegis.py init) -->

## Project rules

- **Pre-release until 1.0.0:** no data migrations, no compatibility with earlier builds and no
  readers for older formats; stored format versions stay `1`. VERA still changes a lot, and
  compatibility code would grow its complexity enormously. Details: `AGENTS.md`, "Pre-release policy".
- **English** for code, comments, commit messages, `CHANGELOG.md` and internal documents; user-facing
  text (interface, help, release notes) in English, Romanian, German and French.
- A notable change adds one line under `## [Unreleased]` in `CHANGELOG.md`; a user-visible one also
  adds an entry to `05_Software/release-notes/unreleased.yaml` (`01_Documentation/Releases.md`).
- Code style: `01_Documentation/Code_Style.md`. No license headers in files (`REUSE.toml`).
- Repository layout, commits and validation: `AGENTS.md`.

## AEGIS workflow

This repository uses AEGIS to guide software implementation, one feature,
fix or change per task. Before changing the product, read
`.agentic/AGENTS.md`; it routes you to one step file per stage.

- New work: run `python .agentic/aegis.py status` (an open task may cover
  it), then follow `.agentic/steps/1_frame.md`.
- An existing task: run `python .agentic/aegis.py brief TASK-<id>` and read
  what its `Read next` line names.

Stages: frame -> specify -> design -> build -> validate -> done; the quick
path is frame -> build -> validate -> done. The CLI writes the journal state:
`advance` finishes a stage, `pause` stops for the user, `log` and `ruling`
record events and decisions. End every session with `advance` or `pause`.

AEGIS guides and never blocks; `python .agentic/aegis.py check` is advisory.
Commits, pushes, merges, tickets, releases and packaging follow the
repository's own procedures, not AEGIS.

Say a deviation when you record one, as one line -
`DEVIATION <stage>: <what> - <why accepted, or what it costs>` - then carry on.

<!-- AEGIS:END -->
