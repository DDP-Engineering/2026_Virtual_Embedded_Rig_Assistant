# Evaluation outputs

Generated runs of the [evaluators](../evaluators/README.md), one folder per family, and the proof
of work packages, one folder per ticket:

```
evaluation-outputs/
  performance/
  retrieval/
  <ticket>/        # for example term05/, view06/, mask05/
```

Everything here except this README is ignored by Git, and the family folders are not tracked:
create `evaluation-outputs/<family>/` before the first run, because the evaluators do not create
parent folders. Give each run a unique name; the evaluators refuse an existing output. Evidence that must be kept is
selected deliberately and added with `git add -f`, or retained with its explanation in
`06_SoftwareDocu/`. Delete a run when it is no longer needed; nothing else reads it.

Scratch data is not an output: profiles, databases and intermediate builds stay in each evaluator's
own temporary or ignored work area.
