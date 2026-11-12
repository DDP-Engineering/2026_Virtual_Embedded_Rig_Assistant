# Evaluation outputs

Generated runs of the [evaluators](../evaluators/README.md), one folder per family:

```
evaluation-outputs/
  performance/
  retrieval/
  embedding-comparison/
  firmware-comparator/
  test-planner/
```

Everything here except this README is ignored by Git, and the family folders are not tracked:
create `evaluation-outputs/<family>/` before the first run, because the evaluators do not create
parent folders. Give each run a unique name. The performance, retrieval and rubric evaluators refuse
an existing output; the historical embedding comparison overwrites it. Evidence that must be kept is
selected deliberately and added with `git add -f`, or retained with its explanation in
`06_SoftwareDocu/`. Delete a run when it is no longer needed; nothing else reads it.

Scratch data is not an output: profiles, databases and intermediate builds stay in each evaluator's
own temporary or ignored work area.
