# Firmware Analysis & Test Planning

Install the official catalog package or review this folder, then enable `analysis-skills` in the
workbench. The package contains Markdown skills and templates.

`firmware-comparator` compares an explicitly selected baseline/candidate pair with `parse_log`,
documented conditions and criterion sources, and saves a cited session artifact. It never flashes,
captures or executes tests. Optional binary inspection requires two build folders and an already
enabled plugin offering an applicable safe size/symbol command.

Load the procedure through `load_skill {"name":"firmware-comparator"}` and its template through
`load_skill {"name":"firmware-comparator","file":"templates/comparison.md"}`.

`test-planner` turns a firmware change or saved comparison into one to five sourced manual cases,
including a baseline control when available. Missing identity, setup or criteria blocks readiness;
each case records its own status, preparation and results to collect. To use a saved comparison,
give its exact session artifact reference in the same session, including after reopening. Enabled plugin
commands appear only as optional future steps with their risk levels.

Load `load_skill {"name":"test-planner"}` and
`load_skill {"name":"test-planner","file":"templates/test-plan.md"}`.
Its six-section plan is saved as a unique bounded `test-plan-<target>.md` session artifact.

`tests/plugins/analysis-skills.test.ts` verifies installation and loading. In the repository,
`npm run eval:analysis-skills` measures routing and handoff through live providers.
