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

Verification instructions, prompts and real-model results live beside the skill under `verification/`.
Replay verifies integration and saved evidence, not model semantics. The future test-planner capability
is not supplied by this package yet.
