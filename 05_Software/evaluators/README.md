# Evaluators

Independent harnesses that produce measurements, scores and reports about the product. A harness can
also apply documented thresholds, but it is not a unit or E2E suite: it does not run with `npm test`
or with `npm run test:e2e`. Functional tests are in [`../tests/`](../tests/README.md); the
environment, build and release tools are in [`../../02_Tools/`](../../02_Tools/README.md).
Run the commands from `05_Software` with the local Node.js: `python ../02_Tools/environment/npmw.py …`.

## Families

| Family | Folder | Command | Measures | Status |
|---|---|---|---|---|
| performance | [performance/](performance/README.md) | `npm run eval:performance` | Loading of saved sessions in an instrumented build | Measurement; calibration and gates are deferred. |
| retrieval | [retrieval/](retrieval/README.md) | `npm run eval:retrieval` | The product's real document search, recall@5 | Documented hybrid thresholds. |

The agent evaluators of epic #372 (grounding, safety, models, routing, compaction) are added here as
families with the same layout.

## Where everything lives

| What | Where | In Git |
|---|---|---|
| Harness code of a family | `evaluators/<family>/*.mjs`, entry point `run.mjs` | yes |
| Method, metrics, thresholds and limits | `evaluators/<family>/README.md` | yes |
| Frozen cases used only by the family | `evaluators/<family>/cases/` | yes |
| Accepted reference runs | `evaluators/<family>/baselines/<YYYY-MM-DD>-<platform>-<label>/` | yes, chosen deliberately |
| Code shared by several families | `evaluators/shared/` (created with the first shared module) | yes |
| Generated runs | [`../evaluation-outputs/<family>/<run-id>/`](../evaluation-outputs/README.md) | no |
| Scratch: profiles, databases, intermediate builds | a temporary folder of the harness, or `node_modules/.cache/evaluators/<family>/` | no |
| Tests of the harness code | `../tests/tooling/` and `../tests/integration/` | yes |

Rules:

- **One name per family everywhere:** the folder `evaluators/<family>/`, the npm script
  `eval:<family>` and the output folder `evaluation-outputs/<family>/`.
- **One folder per run:** `evaluation-outputs/<family>/<YYYYMMDD-HHMMSS>-<label>/`, holding `run.json`
  and the reports made from it. The harness creates missing parent folders and refuses an existing
  output file.
- **Baselines** hold `run.json` (the evidence the harness compares against), `NOTES.md` (host, why it
  was accepted, limits) and, when one exists, the report. A baseline is promoted from a run by
  copying it in a reviewed change; a run never promotes itself.
- **Harness identity** (`harnessHash`) covers only the harness code (`*.mjs` of the family folder),
  so adding a README change or a baseline does not make earlier runs incompatible.
- **Cases** belong to their family, also when a test of the harness reads them. Data shared with the
  functional tests, such as the demo workbench `tests/fixtures/workbenches/demo-board/`, stays in
  `tests/fixtures/`.
- Evaluators do not use `02_Tools/cache/`, which serves the environment, the build and the release.
  The area `node_modules/.cache/evaluators/` can be deleted whenever no evaluator is running.
- Evidence of functional tests and work packages (screenshots, receipts, logs per ticket) is not
  evaluator output: it goes to [`../test-outputs/<ticket>/`](../test-outputs/README.md).
