# AGENTS.md

## Where AEGIS applies

Use the AEGIS workflow only to implement the product: production code and its tests, built from the
work packages in `00_Planning/plan/`. Documentation changed as part of such an implementation stays
in that task.

Do not open AEGIS tasks, journals or requirements for anything else: repository operations (Git,
remotes, labels, configuration, `02_Tools` setup), planning and architecture documents in
`00_Planning/`, standalone documentation, brainstorming, research or questions. Do those directly.

## Development compatibility policy

VERA is currently in development. Treat the current project layout, configuration and data
contracts as authoritative. Do not implement migrations, legacy-layout detection, backward
compatibility or fallback paths for earlier development versions unless the user explicitly
requests them. Update current code, tests, fixtures and documentation together.

## Implementation branch and commits

Implement work packages directly in the shared checkout on `master`.
Create one local commit per ticket after its implementation has passed the required validation.
The user has authorized these local commits; record that authorization in the task journal.
Use a recorded base commit and the complete uncommitted candidate for review and validation when
the working branch and the configured default branch are both `master`.
Remote publication still follows the repository's approval requirements.

## Automated implementation cycle

The user has authorized sequential implementation of all work packages in `00_Planning/plan/`.
The coordinating chat creates one Codex implementation chat per eligible ticket, on `master` in
autopilot, and may send follow-up instructions for progress and corrections. Keep only one
implementation chat active in the shared checkout. Implementation chats prepare and validate the
candidate, then hand it back without committing. The coordinating chat verifies the completed
candidate and makes the authorized local commit before starting the next eligible ticket.
Track completion using validated commits and task journals; an open Gitea issue alone does not mean
the work is unimplemented. The cycle ends after every planned work package and final verification.

## Validation and handover

Follow `02_Tools/verification-policy.md`, the project policy overriding generic
AEGIS full-suite-per-ticket rules. Per ticket use focused checks, explicit Done
criteria, static/strict checks and both independent reviews. Full testing runs only
at milestone gates, once, owned by the last ticket OR the coordinator. Reuse valid
proof; no routine handover retesting or historical-cache audits. Keep handover
concise and clean owned scratch data. Prioritize implementation; defer unrelated
refactoring and polish. Final release checks and publication authority still apply.

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
