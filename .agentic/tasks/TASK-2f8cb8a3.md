# TASK-2f8cb8a3 - Requirement register review against the current app (2026-11-15)

stage: done
type: change
path: quick
interaction: autopilot
requirements: REQ-DATA-0f278063, REQ-DATA-4451f705, REQ-DATA-b40d3f9b, REQ-DATA-fd1933a1, REQ-FUNC-37261edc, REQ-FUNC-4c3f4f0c, REQ-FUNC-b975a8b5, REQ-FUNC-fd5a2a7b, REQ-NFR-5a0d14ee, REQ-PLAT-a68b2d5b, REQ-REL-39e8cc78, REQ-REL-45112294, REQ-SEC-2ccecd75, REQ-SEC-6c43bda5, REQ-UX-0f1a32c4, REQ-UX-2697c05c, REQ-UX-27a41e3d, REQ-UX-28a74094, REQ-UX-2c674629, REQ-UX-3d0691bc, REQ-UX-4a040004, REQ-UX-4bea0002, REQ-UX-4bea0005, REQ-UX-4bea0007, REQ-UX-5e8e2eba, REQ-UX-6340c035, REQ-UX-7f289a2c, REQ-UX-91b1b112, REQ-UX-9a97f953, REQ-UX-b7eabce7, REQ-UX-bc9adf3a, REQ-UX-d87fc848
parent:
branch: feature/261-plugin-management
base: e45d74cb852311f5facfb8b18c184f7989306cda
opened: 2026-11-15

Edit Frame, Requirement coverage and Design directly. Write State, Log and
Rulings with `python .agentic/aegis.py` (advance, pause, log, ruling, verdict);
end each session with `advance` or `pause`.

## Done checklist (current stage)

- [ ] diff reviewed against scope, requirements, design, error paths,
      portability, security and unrequested work
- [ ] knowledge pages of changed components current with the reviewed code
- [ ] project and environment context reconciled with the candidate
- [ ] requirements re-read: status, prose, verification, paths and links true
- [ ] manual or inspection verification recorded where applicable
- [ ] explicit review approved, when enabled
- [ ] final `check --strict --run` result logged truthfully after the last edit
- [ ] remaining warnings and pre-existing failures explained
- [ ] `report` appended

## Frame

Problem: the requirement register (1398 active requirements, 77 specs, 35 knowledge pages) had drifted from the app after the plugin epic and the UI rework of 2026-11-15 (stated by the user: requirements and tests must match the current app).
Desired outcome: every active requirement, spec and knowledge page describes current behavior; obsolete behavior is retired, never deleted; linked tests exist and match.
Actors: the maintainer reading the register; AEGIS check.
Primary scenario: mechanical link check of all requirements, then a read-only semantic review per category against the code, then in-place updates and retirements, then aligned e2e tests.
Examples:
Counterexamples:
In scope: .agentic/requirements, .agentic/specs, .agentic/knowledge, e2e specs that used removed UI.
Out of scope: other tasks' journals (never edited); product behavior changes.
Constraints:
Success signals:
Evidence: scratchpad review files per category (observed); aegis check stale-paths 20 -> 0 (observed).
Assumptions:
Unknowns:
Decision-blocking questions:
Proposed behaviors:
Path and reason:

## Requirement coverage


## Design


## Log

- 2026-11-15 frame: journal opened
- 2026-11-15 frame: Mechanical check of all 1416 requirements; 8 read-only reviewers (functional x2, ux, reliability, security, data+nfr, platform+test, specs+knowledge); applied 31 updates and 3 retirements (REQ-FUNC-66b6fda6, REQ-UX-194ecc98, REQ-UX-b0da5193), 47 spec/knowledge passages, demo spec kept with a retirement note; REQ-UX-b7eabce7 linked to tests/tooling/i18n.test.ts.
- 2026-11-15 frame: completed; next build (7 Done checklist item(s) left unticked)
- 2026-11-15 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-15 validate: completed; next done (9 Done checklist item(s) left unticked; review verdicts not both approved)

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-2f8cb8a3.md
changed: register review: 32 requirements updated, 3 retired, 47 spec/knowledge passages; 9 e2e specs aligned; container-query layout fix
evidence:
issues:
spec_compliance:
implementation_quality:
review_round:
