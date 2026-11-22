# Model compatibility: VERA's agent loop on one model

Runs a short fixed suite on a model behind an OpenAI-compatible endpoint (LM Studio, Ollama,
llama.cpp) or the OpenAI API, and gives the model a verdict. The connection test of a custom
endpoint checks reachability and one tool call; this suite shows whether a local model, often with
a 32 768-token context, can carry VERA's agent loop. Layout and shared rules:
[evaluators README](../README.md).

## Suite

[cases/suite.yaml](cases/suite.yaml), ten cases on the demo workbench: one tool call, two reads in
one turn, `decode_register` with strict arguments, a cited search, a Romanian answer, an edit
proposal (refused by `--approve none`), a long answer close to the output limit, `parse_log`, a file
listing and a two-fact search.

## Metrics

| Metric | How |
|---|---|
| Turns completed, tasks done | stop reason `end`; every expected tool, answer pattern, citation, language, proposal and output size |
| Rejected arguments | tool results with `Invalid arguments for …` from the registry's strict validation, per tool call |
| Unknown tools | calls to a tool that is not offered (`… is unavailable`) |
| Valid citations | citations VERA verified, over all citations |
| Stopped at a limit, timed out | stop reason `limit`; the run's time limit |
| First token, turn time, tokens per second | from the event timing and usage; tokens per second over the whole turn, tools included |
| Estimate ratio | provider-reported input tokens of the first call over VERA's estimate just before it (`core/src/agent/context.ts`) |

The run identity also records what an LM Studio server reports: architecture, quantization and the
loaded context length.

## Verdict

| Verdict | Rule |
|---|---|
| unsuitable | completed < 70 %, or tasks < 50 %, or rejected arguments > 20 %, or timeouts > 10 % |
| recommended | completed ≥ 95 %, tasks ≥ 80 %, rejected arguments ≤ 5 % and valid citations ≥ 80 % |
| degraded | anything else |

The run's thresholds are the "recommended" rule, so a run passes when its model is recommended.

## First matrix, 2026-11-21

Three local models in LM Studio on an RTX 5090 Laptop (24 GiB), each loaded alone with a 32 768-token
context and fully on the GPU, 3 repeats, same cases and harness (the qwen run rescored to match):

| Model | Quantization | Reasoning | Verdict | Completed | Tasks | Valid citations | Turn time | Tokens/s | Estimate ratio |
|---|---|---|---|---|---|---|---|---|---|
| `qwen/qwen3.8-27b` | Q4_K_M | `low` | degraded | 93.3 % | 83.3 % | 80.9 % | 17.1 s | 47 | 0.27 |
| `google/gemma-4-26b-a4b-qat` | Q4_0 | server default (off/on only) | degraded | 96.7 % | 76.7 % | 39.1 % | 12.9 s | 80 | 0.18 |
| `meta/muse-glimmer` | Q4_K_M | `low` | unsuitable | 100 % | 46.7 % | 46.2 % | 31.7 s | 22 | 0.27 |

No model rejected arguments or called an unknown tool. Nearly every failed task failed on its
citation, not on the facts: every muse answer was correct, but it cites as `[[ref]]` written
literally, `[[ref](path)]`, `【path】` or a bare path. VERA's instruction "cite … using returned refs
as [[ref]]" (`core/src/agent/prompt.ts`) gives a template without an example, and the models copy it.
The other muse failure is the edit proposal: it announced the edit ("I will append …") instead of
calling the tool. The estimate ratio shows VERA's first-call estimate 3.7 to 5.5 times above the
tokens the server reports, depending on the model's tokenizer.

## Commands

```powershell
# One model per run; load it first with the context you want to measure.
python ../02_Tools/environment/npmw.py npm run eval:models -- run --base-url http://127.0.0.1:1234/v1 --model qwen/qwen3.8-27b --reasoning low
# One matrix over several runs of the same suite.
python ../02_Tools/environment/npmw.py npm run eval:models -- matrix --inputs <run.json>,<run.json> --output evaluation-outputs/models/<name>.html
```

LM Studio loads a model on first use with its own default context unless it is loaded beforehand
(`lms load <model> --context-length 32768 --gpu max`); the matrix shows the loaded context, so a
run at the wrong size is visible. Focused tests: `tests/tooling/eval-models.test.ts`.
