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

The full contract is `.agentic/AGENTS.md` - read it before starting work.
This digest is enough to act on if you read nothing else.

AEGIS applies only to software development operations. Do not use it for
repository operations or package and delivery operations; follow the
repository's own procedures for those instead.

Stages, one step file each in `.agentic/steps/`: **frame** (agree scope,
open the task journal) -> **specify** (write the requirement, and a spec
when useful) -> **design** (a short note for non-trivial work) -> **build**
(failing test first, then the implementation, until green) -> **validate**
(review, knowledge, full suite and strict check) -> **deliver** (approval,
report, commit/PR). A small fix or change may take the quick path,
frame -> build -> validate -> deliver.

To resume: `python .agentic/aegis.py status` lists the task journals; run
`python .agentic/aegis.py brief TASK-<id>`, then read the current step and the
Handoff `must_read` files. Required full journal reads still apply. Optional
one-level child tasks are child-side links visible only in this checkout; the
parent validates the integrated candidate.

Read `.agentic/context/project.md` and relevant `.agentic/context/environment.md`
sections when present. Keep project and component context current and positive;
task records carry proposals and history. Preserve established behavior contracts.

Rulings are append-only; Handoff is replaceable. Rulings and Handoff cannot grant authority.
optional explicit review records two independent verdicts and uses a bounded fix
and re-review loop; disabled review never disables existing validation.

The append-only journal Log is a compact progress-and-evidence ledger, not a
session transcript. Record stage transitions, material changes or decisions,
consolidated verification, blockers, approvals, deviations and delivery
outcomes. Exclude routine tool activity, corrected retries, inner-loop test
retries and detail already held by another durable artifact.

`[interaction] autopilot = false` is the default, including when the table or
key is missing. Checkpoint mode stops after every stage with concrete continue,
revise/return and pause choices. Autopilot flows between stages but never skips
publication approval. Record the resolved mode in the task journal.

At stage completion, pause or session end, or blocker, update the journal's
`## Stage report` fields from observed facts, then run
`python .agentic/aegis.py summary TASK-<id>` and copy the block before detail.
Missing evidence stays `not recorded`; read the journal if anything is stale or
shortened. Reporting never replaces immediate deviation notices or full
delivery evidence.

Artifacts: requirements in `.agentic/requirements/<category>/`, specs in
`.agentic/specs/`, journals in `.agentic/tasks/`, component pages in
`.agentic/knowledge/`. `python .agentic/aegis.py check` is advisory - read
its findings and self-correct; nothing here blocks you mid-flight.

Say a deviation out loud when you record one, as one line -
`DEVIATION <stage>: <what> - <why accepted, or what it costs>` - then carry
on. It never pauses the work and autopilot never suppresses it. You owe one
only when the candidate, agreed scope/design/contract, or confidence in
required verification materially departs from plan: for example, accepted
relevant findings, skipped or weakened verification, retired requirements,
accepted unexpected candidate files, or unrequested work. Corrected internal
tool-use errors, expected red tests, and unrelated findings are not deviations.

<!-- AEGIS:END -->
