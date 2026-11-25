# Evaluators

Independent harnesses that produce measurements, scores and reports about the product. A harness can
also apply documented thresholds, but it is not a unit or E2E suite: it does not run with `npm test`
or with `npm run test:e2e`. Functional tests are in [`../tests/`](../tests/README.md); the
environment, build and release tools are in [`../../02_Tools/`](../../02_Tools/README.md).
Run the commands from `05_Software` with the local Node.js: `python ../02_Tools/environment/npmw.py …`.

## Families

| Family | Folder | Command | Measures | Status |
|---|---|---|---|---|
| compaction | [compaction/](compaction/README.md) | `npm run eval:compaction` | What a long session keeps after VERA compacts its history | Compacted, decisions retained, planted instruction, invented values. |
| grounding | [grounding/](grounding/README.md) | `npm run eval:grounding` | Document answers: facts, citations on target, language, abstention, fabricated values | Proposed thresholds (accuracy, target, fabrication, abstention). |
| models | [models/](models/README.md) | `npm run eval:models` | One model's fit for VERA's agent loop; `matrix` compares models | Verdict: recommended, degraded or unsuitable. |
| routing | [routing/](routing/README.md) | `npm run eval:routing` | Skill and program choice over 23 official plugins, port guessing, read-only discipline | Skill first, guessed ports, read-only faults. |
| safety | [safety/](safety/README.md) | `npm run eval:safety` | Planted instructions, web query leakage and secret egress, with the network blocked | Canary leaks 0; followed instructions and web leaks ≤ 10 %. |
| performance | [performance/](performance/README.md) | `npm run eval:performance` | Loading of saved sessions in an instrumented build; `agent-load`: indexing throughput and VERA's time per model call | Measurements; session-loading calibration deferred, agent-load compared within its noise band. |
| retrieval | [retrieval/](retrieval/README.md) | `npm run eval:retrieval` | The product's real document search, recall@5, per embedding model; `layout`: a hard-layout corpus through the CLI | Documented thresholds. |
| smoke | [smoke/](smoke/README.md) | `npm run eval:smoke` | The shared agent runner end to end on two cases | Gate: every turn completes. |
| wireshark | [wireshark/](wireshark/README.md) | `npm run eval:wireshark` | Typed tool use, filter recovery, exact frames, data volume and disclosure in synthetic capture workflows | Frozen-case checks and guarded model probes. |

The agent families (compaction, grounding, models, routing, safety, smoke, wireshark) run on the
[shared modules](shared/README.md).

## Commands and reports

Every family has `run` and `report`. A run writes `run.json` and a self-contained `report.html`
(inline CSS and SVG, no script, no network) into its own run folder; `report` renders a saved run
again, and with `--reference <run.json>` compares it with another run. Incompatible runs (another
harness, case file or environment, depending on the family) are reported as such and their metrics
are not compared.

```powershell
python ../02_Tools/environment/npmw.py npm run eval:<family> -- report --input evaluation-outputs/<family>/<run-id>/run.json [--reference <run.json>] [--output <new.html>]
```

Agent families also have `rescore --input <run.json>`, which recomputes the metrics from the saved
events with the current scoring code, without asking the model again.

Exit codes: `0` passed or measured, `1` a threshold failed, `2` invalid arguments, cases or evidence.

## Agent families and models

Agent families drive the headless CLI, `vera run --format jsonl`, with `--approve none` by default:
every write, download or program run that the model proposes is recorded and refused, so nothing
touches the workbench copy beyond reads, and no hardware. The model is one of:

- `--provider replay`: the scripts in the family's `cases/replay/`, deterministic and free; for tests.
- `--provider custom --base-url <url> --model <id>`: any OpenAI-compatible endpoint, through a
  loopback proxy that forwards only to that origin. `--reasoning off|low|medium|high|xhigh` sets the
  reasoning level the way VERA does for a custom endpoint; without it the server default applies.
- `--provider openai --model <id>`: the OpenAI API, key from `OPENAI_API_KEY` or `--key-env`.

`VERA_EVAL_BASE_URL`, `VERA_EVAL_MODEL`, `VERA_EVAL_REASONING`, `VERA_EVAL_PROVIDER` and
`VERA_EVAL_KEY_ENV` set the defaults for a series of runs. Repeats default to 3.

**Default local model (2026-11-21):** LM Studio on `127.0.0.1:1234` (also `192.168.1.13`),
`qwen/qwen3.8-27b` Q4_K_M with a 32 768-token context, fully on the GPU (an RTX 5090 Laptop with
24 GiB: about 22 GiB at 32 K, 26 GiB at 64 K, which would spill into RAM), and reasoning `low`. 32 K
matches VERA's default context window for a custom endpoint; `low` keeps the reasoning inside VERA's
4 096-token output limit, which the server default (`xhigh`) can exhaust. Load it with
`lms load qwen/qwen3.8-27b --context-length 32768 --gpu max --ttl 3600`.

## Where everything lives

| What | Where | In Git |
|---|---|---|
| Harness code of a family | `evaluators/<family>/*.mjs`, entry point `run.mjs` | yes |
| Method, metrics, thresholds and limits | `evaluators/<family>/README.md` | yes |
| Frozen cases used only by the family | `evaluators/<family>/cases/` | yes |
| Accepted reference runs | `evaluators/<family>/baselines/<YYYY-MM-DD>-<platform>-<label>/` | yes, chosen deliberately |
| Code shared by several families | [`evaluators/shared/`](shared/README.md) | yes |
| Generated runs | [`../evaluation-outputs/<family>/<run-id>/`](../evaluation-outputs/README.md) | no |
| Reports prepared for users (HTML, PPTX, DOCX) | [`06_SoftwareDocu/`](../../06_SoftwareDocu/README.md), relative to the repository root | yes, chosen deliberately |
| Scratch: profiles, databases, intermediate builds | a temporary folder of the harness, or `node_modules/.cache/evaluators/<family>/` | no |
| Tests of the harness code | `../tests/tooling/` and `../tests/integration/` | yes |

Rules:

- **One name per family everywhere:** the folder `evaluators/<family>/`, the npm script
  `eval:<family>` and the output folder `evaluation-outputs/<family>/`.
- **One folder per run:** `evaluation-outputs/<family>/<YYYYMMDD-HHMMSS>-<label>/`, holding `run.json`
  and the reports made from it. The harness creates missing parent folders and refuses an existing
  output file.
- **Date reports and evidence:** use a leading `YYYY-MM-DD` and a descriptive label for manually
  named run folders and reports. Add `HHMMSS` when needed to distinguish runs on the same date.
  Keep the harness's timestamp on automatically named runs. A run's standard `run.json` and
  `report.html` inherit the date from their parent folder.
- **Keep a comparable history:** retain selected complete runs with their `run.json` and report
  under the same family. Reuse the label for the same setup, for example
  `evaluation-outputs/compaction/YYYY-MM-DD-qwen-32k/`. Record changes to the cases, model or settings
  before interpreting differences between dates. Archive intermediate attempts separately from this history.
- **Use the repository-relative report destination:** save an HTML, PPTX or DOCX prepared for a user
  in `06_SoftwareDocu/YYYY-MM-DD-<subject>.<ext>`. Keep harness-generated reports and raw evidence in
  their run folders. Use repository-relative links from a presentation report to its evidence when practical.
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
