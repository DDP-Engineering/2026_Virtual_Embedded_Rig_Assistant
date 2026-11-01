# firmware-comparator — implementation plan

PURPOSE: build CAP-03 as a skill of the official `analysis-skills` plugin. Spec: [SPEC](SPEC.md);
shared rules: [contracts](../../contracts.md).
DONE-WHEN: the three tasks pass and the rubric results are recorded.
STATUS: planned 2026-11-01. Needs CAP-01, CAP-02, plugin store PLG-01 (#57) and plugin skills in the
agent PLG-04 (#60). Implementation follows the repository's AEGIS workflow.

## Task 1 — plugin and skill assets

- Create the skills-only plugin `analysis-skills` (proposed folder `05_Software/plugins/analysis-skills/`):
  `plugin.yaml` without `programs` or `rules`, `skills/firmware-comparator/SKILL.md` and
  `skills/firmware-comparator/templates/comparison.md`.
- `SKILL.md` names only existing tools: `load_skill`, `list`, `glob`, `grep`, `read`, `parse_log`,
  `decode_register`, `search_docs`, `read_doc`, `artifact_save` and, for step 8, `run_program`.
- Start from the procedure in `09_Others/benchpilot-reference/skills/firmware-comparator/SKILL.md`;
  drop its catalog, evaluator and traffic APIs.
- Tests: the plugin validates against the PLG-01 schema; the skill loads through `load_skill` with
  source `plugin`; the template has the seven sections of SPEC §3.

## Task 2 — replay test

- Use a copy of the extended fixture (contracts §5) with `analysis-skills` installed from its folder.
- Scripted replay: `parse_log` on both logs, `search_docs` for the release note, `artifact_save`.
  Assert the cited lines, the artifact name and its sections.

## Task 3 — rubric

- Run the seven rubric cases of SPEC §5 with a configured real model; record model and version,
  prompt, artifact and each criterion's result next to the skill.

NOTES:
- Commands: `npm test -- --run <test files>`, then `npm run verify` from `05_Software/`.
