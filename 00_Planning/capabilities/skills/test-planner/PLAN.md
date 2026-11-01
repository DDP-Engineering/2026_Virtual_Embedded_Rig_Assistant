# test-planner — implementation plan

PURPOSE: build CAP-04 as the second skill of the `analysis-skills` plugin. Spec: [SPEC](SPEC.md);
shared rules: [contracts](../../contracts.md).
DONE-WHEN: the three tasks pass and the rubric results are recorded.
STATUS: planned 2026-11-01. Needs CAP-03, which creates the `analysis-skills` plugin. Implementation
follows the repository's AEGIS workflow.

## Task 1 — skill assets

- Add `skills/test-planner/SKILL.md` and `skills/test-planner/templates/test-plan.md` to
  `analysis-skills`.
- `SKILL.md` names only existing tools: `load_skill`, `list`, `glob`, `grep`, `read`, `search_docs`,
  `read_doc`, `decode_register`, `todo` and `artifact_save`. It names plugin commands only as optional
  plan steps and never calls `run_program`.
- Start from `09_Others/benchpilot-reference/skills/test-planner/SKILL.md`; keep its
  evidence → risk → targeted cases structure; drop its catalog, simulation and execution APIs.
- Tests: the skill loads with source `plugin`; the template has the six sections and the TP case
  fields of SPEC §3.

## Task 2 — replay test

- Fixture copy with `analysis-skills` installed. Scripted replay: `search_docs`, `todo`,
  `artifact_save`. Assert citations, the baseline control case, the optional plugin step with its
  risk level and the artifact name.

## Task 3 — rubric

- Run the seven rubric cases of SPEC §5 with a configured real model and record the results next to
  the skill.

NOTES:
- Commands: `npm test -- --run <test files>`, then `npm run verify` from `05_Software/`.
