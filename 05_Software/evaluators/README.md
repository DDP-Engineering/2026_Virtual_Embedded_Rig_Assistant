# Evaluators

Independent harnesses that produce measurements, scores and reports about the product. A harness can
also apply documented thresholds, but it is not a unit or E2E suite: it does not run with `npm test`
or with `npm run test:e2e`. Functional tests are in [`../tests/`](../tests/README.md); the
environment, build and release tools are in [`../../02_Tools/`](../../02_Tools/README.md).

Each harness owns its entry point, its implementation and any data or modules of its own. Shared
test data, for example the fictional demo and the retrieval questions, stays in `tests/fixtures/`.
Run the commands from `05_Software` with the local Node.js:
`python ../02_Tools/environment/npmw.py …`.

| Folder | Family | Entry point | Status |
|---|---|---|---|
| [eval-performance-harness/](#performance) | Loading of saved sessions | `npm run perf:sessions` | Current measurement (PERF-01); calibration and gates are deferred. |
| [eval-retrieval-harness/](#retrieval) | The product's real search | `npm run eval:retrieval` | Documented hybrid thresholds. |
| [retrieval-support/](retrieval-support/README.md) | Modules of the retrieval evaluation | — | Imported by the retrieval harness. |

## Scratch and outputs

- **Scratch** (profiles, databases, intermediate builds) belongs to each harness: either a temporary
  folder of its own, deleted at the end, or the ignored area
  `node_modules/.cache/evaluators/<family>/`. Evaluators do not use `02_Tools/cache/`, which serves
  the environment, the build and the release.
- Saved **outputs** go to [`../evaluation-outputs/<family>/`](../evaluation-outputs/README.md), with
  a unique name for each run. Create the family folder before the first run, because the evaluators
  do not create parent folders. The folder is ignored by Git; evidence to keep is selected
  explicitly.
- The area `node_modules/.cache/evaluators/` can be deleted whenever no evaluator is running.
- Historical reports that were already accepted stay in `06_SoftwareDocu/` with their original
  hashes and provenance; they were not moved. Moving the performance harness did change its identity
  (`harnessHash`), and `compare` and `calibrate` need identical identities: new runs cannot use the
  retained run of 2026-11-12 as a compatible reference.

| Family | Scratch | Output |
|---|---|---|
| performance | temporary folder `vera-session-performance-*`, deleted at the end | `--output <new file>`, required |
| retrieval | `node_modules/.cache/evaluators/retrieval/` or `--scratch <parent>`; the run's folder is deleted in `finally` | `--output <new file>`, optional |

## Performance

`perf:sessions run|calibrate|compare --output <new file> [options]` measures the loading of saved
sessions in an instrumented build, compares a run with a reference and calibrates references. The
harness files are [perf-sessions.mjs](eval-performance-harness/perf-sessions.mjs) (the entry point),
[runner.mjs](eval-performance-harness/runner.mjs), [report.mjs](eval-performance-harness/report.mjs)
and [fixtures.mjs](eval-performance-harness/fixtures.mjs), which generates the synthetic sessions.
The runner uses the network guard of the E2E suite, `tests/e2e/network-guard.ts`. The method, the
results and the limits are in
[06_SoftwareDocu/session-performance.md](../../06_SoftwareDocu/session-performance.md).
Their focused tests are `tests/tooling/session-performance*.test.ts`.

## Retrieval

[eval-retrieval.mjs](eval-retrieval-harness/eval-retrieval.mjs) bundles
[product-eval.mjs](eval-retrieval-harness/product-eval.mjs) and exercises the real search service,
with isolated databases and workers, on the demo and the 28 fixed questions, in the `keyword`,
`semantic` and `hybrid` modes. It needs the local model already prepared (`npm run prepare:model`)
and does not download it. The hybrid thresholds are a recall@5 of at least `0.85` overall, `0.95`
for English and `0.75` for Romanian.

```powershell
python ../02_Tools/environment/npmw.py npm run eval:retrieval
mkdir evaluation-outputs/retrieval -Force
python ../02_Tools/environment/npmw.py npm run eval:retrieval -- --output evaluation-outputs/retrieval/<run>.json
```

`--scratch <parent>` chooses the parent of the temporary folder; `--output <new file>` saves the
complete report and refuses an existing file.
