# Analysis skills

Official format1 skills-only plugin for captured engineering evidence. Install this folder through
VERA's plugin review, or install its official catalog archive, then enable `analysis-skills` in the
workbench. It has no programs, provisioning or rules. Local packaging includes it in the bundled catalog;
nothing is automatically installed and no hosted publication is needed.

`firmware-comparator` compares an explicitly selected baseline/candidate pair with `parse_log`,
documented conditions and criterion sources, and saves a cited session artifact. It never flashes,
captures or executes tests. Optional binary inspection requires two build folders and an already
enabled plugin offering an applicable safe size/symbol command.

Load the procedure through `load_skill {"name":"firmware-comparator"}` and its template through
`load_skill {"name":"firmware-comparator","file":"templates/comparison.md"}`.

`test-planner` turns a firmware change or captured failure into one to five sourced manual cases,
including a baseline control when available. Missing identity, setup or criteria blocks readiness;
the plan records preparation and results to collect without executing anything. Enabled plugin
commands appear only as optional future steps with their risk levels.

Load `load_skill {"name":"test-planner"}` and
`load_skill {"name":"test-planner","file":"templates/test-plan.md"}`.
Its six-section plan is saved as a unique bounded `test-plan-<target>.md` session artifact.

Verification instructions, prompts and real-model results live beside each skill under `verification/`.
Replay verifies integration and saved evidence, not model semantics.
