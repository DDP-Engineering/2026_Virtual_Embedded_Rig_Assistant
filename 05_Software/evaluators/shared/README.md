# Shared evaluator modules

Code used by several families. Not a family and has no command of its own. Layout and rules:
[evaluators README](../README.md).

| Module | Role |
|---|---|
| [agent-runner.mjs](agent-runner.mjs) | Runs an agent family: builds the CLI, installs the family's plugins once, indexes each fixture workbench (with a case's setup files and plugin group) once, then runs `vera run --format jsonl` once per case and repeat on a fresh copy, with a time limit, `--approve none` and network tools off by default. Writes the events, `run.json` and `report.html`. |
| [family-cli.mjs](family-cli.mjs) | The `run`, `report` and `rescore` commands of an agent family (plus a family's own, such as `matrix`), their options and `VERA_EVAL_*` defaults, and `writeReport` for any family. |
| [cases.mjs](cases.mjs) | The case-file format (`schema: 1`) with the family's own `expect` schema; validates a file before any model call. |
| [events.mjs](events.mjs) | Reads the JSONL events and summarizes one run: tool calls, approvals, the answer, citations with `valid`, cumulative usage, compactions, stop reason, errors. |
| [model-proxy.mjs](model-proxy.mjs) | Loopback proxy used as the `custom` base URL: forwards only to the target origin, sets `reasoning_effort` like VERA does, and can record request bodies. |
| [egress-guard.mjs](egress-guard.mjs) | Loopback proxy given to every run through `NODE_USE_ENV_PROXY`: refuses requests to outside hosts and records them, unless a run passes `--web on`. |
| [text.mjs](text.mjs) | Normalization (decimal commas, dashes, "degrees C"), pattern matching, answer language, tool results as text. |
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

## Network and plugins

`--web off` (default) disables `web_search`, `web_read`, `web_download` and `parts_search` in the
run's workbench; `--web blocked` offers them but the egress guard refuses every outside request;
`--web on` uses the real network. A family can install official plugins (`runOptions` sets
`plugins`, installed once behind the guard, so their programs stay unprovisioned) and a case can
enable a group of them (`plugins:` in the case file).

## Rescoring

`rescore --input <run.json>` recomputes every metric from the saved events with the current scoring
code and writes `run-rescored.json` and its report beside the run; the model is not asked again.
Model request bodies are held in memory only. A family can retain its original measurement of
those requests for rescoring, as Wireshark does for its unchanged synthetic canaries.
