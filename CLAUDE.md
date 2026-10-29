# CLAUDE.md

## Where AEGIS applies

Use the AEGIS workflow only to implement the product: production code and its tests, built from the
work packages in `00_Planning/plan/`. Documentation changed as part of such an implementation stays
in that task.

Do not open AEGIS tasks, journals or requirements for anything else: repository operations (Git,
remotes, labels, configuration, `02_Tools` setup), planning and architecture documents in
`00_Planning/`, standalone documentation, brainstorming, research or questions. Do those directly.

<!-- AEGIS:BEGIN (managed by .agentic/aegis.py init) -->

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
