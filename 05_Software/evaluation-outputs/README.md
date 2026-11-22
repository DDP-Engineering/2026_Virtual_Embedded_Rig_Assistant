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
`evaluators/<family>/baselines/<YYYY-MM-DD>-<platform>-<label>/` in a reviewed change. Delete a run
when it is no longer needed; nothing else reads it.

Not here: scratch data (profiles, databases, intermediate builds) stays in each evaluator's own
temporary or ignored work area, and evidence of functional tests and work packages goes to
[`../test-outputs/`](../test-outputs/README.md).
