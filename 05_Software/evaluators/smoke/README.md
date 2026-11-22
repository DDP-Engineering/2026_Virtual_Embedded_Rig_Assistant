# Smoke evaluation: the shared agent runner

Two short cases on the demo workbench that exercise the whole agent path of the
[shared runner](../shared/README.md): indexing, `vera run`, tools, a verified citation, the events
and the HTML report. Run it first on a new model or endpoint, before a longer family. Layout and
shared rules: [evaluators README](../README.md).

| Case | Prompt asks for | Expected |
|---|---|---|
| `board-voltage` | the supply voltage in `board.txt` | `read` runs; the answer says 3.3 V with a valid citation |
| `sensor-address` | the sensor's seven-bit I2C address | `search_docs` runs; the answer says 0x48 with a valid citation |

## Metrics and threshold

Per repeat: the turn completed (`end`, exit code 0, no timeout), an expected tool ran successfully,
the answer matches the expected fact, at least one citation is valid, the share of valid citations,
and the turn time. A case passes when all of these hold in every repeat.

The only threshold is **turns completed = 100 %**: the smoke family checks the runner and the
endpoint, not answer quality, which it reports without gating.

## Commands

```powershell
# Deterministic, no model: the scripts in cases/replay/.
python ../02_Tools/environment/npmw.py npm run eval:smoke -- run --provider replay --repeats 1

# A local model through LM Studio (see the evaluators README for the recommended settings).
python ../02_Tools/environment/npmw.py npm run eval:smoke -- run --base-url http://127.0.0.1:1234/v1 --model qwen/qwen3.8-27b --reasoning low

# Report again, optionally compared with an earlier run.
python ../02_Tools/environment/npmw.py npm run eval:smoke -- report --input evaluation-outputs/smoke/<run-id>/run.json --reference <run.json> --output <new.html>
```

Its end-to-end test on replay is `tests/integration/eval-smoke.test.ts`.
