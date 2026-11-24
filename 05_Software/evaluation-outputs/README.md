# Evaluation outputs

Generated runs of the [evaluators](../evaluators/README.md), and nothing else: one folder per family,
one folder per run.

```
evaluation-outputs/
  <family>/                       # performance, retrieval, ...
    <YYYYMMDD-HHMMSS>-<label>/    # one run
      run.json                    # the complete run, the input of every report and comparison
      run.json.md, report.html    # reports made from run.json
```

Everything here except this README is ignored by Git. The harnesses create the folders and refuse
an existing output file. A run worth keeping is promoted to
`evaluators/<family>/baselines/<YYYY-MM-DD>-<platform>-<label>/` in a reviewed change. Before deleting
or renaming a run, check whether a report, comparison or task journal links to it.

Keep completed snapshots chosen for comparison under the same family, one dated folder per run.
Use `YYYY-MM-DD-<label>` for manually named runs and add `HHMMSS` to distinguish same-day runs.
Keep the same descriptive label when repeating the same setup. Retain `run.json` and the matching
report together, including when the run falls below a threshold. A dated local index, when present,
lists the retained runs by family and date. Archive intermediate attempts separately.
Reports prepared for users go in [`06_SoftwareDocu/`](../../06_SoftwareDocu/README.md).

Not here: scratch data (profiles, databases, intermediate builds) stays in each evaluator's own
temporary or ignored work area, and evidence of functional tests and work packages goes to
[`../test-outputs/`](../test-outputs/README.md).
