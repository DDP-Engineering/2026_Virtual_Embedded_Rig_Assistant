# Shared evaluator modules

Code used by several families. Not a family and has no command of its own. Layout and rules:
[evaluators README](../README.md).

| Module | Role |
|---|---|
| [agent-runner.mjs](agent-runner.mjs) | Runs an agent family: builds the CLI, indexes each fixture workbench once, then runs `vera run --format jsonl` once per case and repeat on a fresh copy, with an isolated data folder, a time limit and `--approve none` by default. Writes the events, `run.json` and `report.html`. |
| [family-cli.mjs](family-cli.mjs) | The `run` and `report` commands of an agent family, their options and `VERA_EVAL_*` defaults, and `writeReport` for any family. |
| [cases.mjs](cases.mjs) | The case-file format (`schema: 1`) with the family's own `expect` schema; validates a file before any model call. |
| [events.mjs](events.mjs) | Reads the JSONL events and summarizes one run: tool calls, approvals, the answer, citations with `valid`, cumulative usage, compactions, stop reason, errors. |
| [model-proxy.mjs](model-proxy.mjs) | Loopback proxy used as the `custom` base URL: forwards only to the target origin, sets `reasoning_effort` like VERA does, and can record request bodies. |
| [identity.mjs](identity.mjs) | Harness hash (top-level `*.mjs` only), Git commit and dirty flag, run folder names, report paths. |
| [report-html.mjs](report-html.mjs) | Renders a report model into one self-contained HTML page (inline CSS and SVG, no script, light and dark) and compares two runs. |
| [agent-report.mjs](agent-report.mjs) | The report model of an agent run, and the `rate` and `threshold` helpers for a family's aggregate. |

## Writing an agent family

A family folder holds `run.mjs`, `README.md` and `cases/<name>.yaml`. `run.mjs` exports a `spec`
with `family`, `title`, `folder`, `casesFile`, the zod `expect` schema, `score(case, summary,
outcome)` returning `{ metrics, pass }` per repeat, `aggregate(cases)` returning the summary
`metrics` and `thresholds`, and optional `tables(run)`; it ends with
`runAsScript((argv) => familyMain(spec, argv))`. See [smoke/run.mjs](../smoke/run.mjs).

Score from the events, deterministically: tool order, approvals, the answer text and the `valid`
flag of each citation. The report shows only what the CLI printed, already masked by it.

## Compatibility

Two agent runs compare when they have the same family, harness hash, case file and case selection.
Model, reasoning level, provider and repeats may differ: comparing models is the point. Other
families define their own rule; the performance family still requires the same host, fixture,
harness and build mode.
