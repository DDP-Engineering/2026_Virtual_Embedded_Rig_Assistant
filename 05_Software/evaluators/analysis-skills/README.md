# Analysis Skills evaluation

Run the same fictional I2C fixture with the real VERA gateway, skill catalog, worker, persistent
session service and artifact store. The first turn saves a comparison. The next turn opens the
same session through a new service and reads the exact report reference to prepare a manual plan.
A separate execution-only prompt tests that the agent does not substitute a plan. The fixture
uses local, unindexed documents and only read and session-report tools.

Set `VERA_ANALYSIS_DISCOVER_REPORT=1` to omit the exact reference from the planning prompt. The
evaluator then requires `artifact_list` to find the saved comparison before the verified `read`.

From `05_Software` on the Windows development host:

```powershell
python ../02_Tools/environment/npmw.py npm run typecheck
python ../02_Tools/environment/npmw.py node ../02_Tools/build/build-cli.mjs
python ../02_Tools/environment/npmw.py npm run eval:analysis-skills -- local qwen/qwen3.8-27b
python ../02_Tools/environment/npmw.py npm run eval:analysis-skills -- hosted
```

Local defaults to `http://192.168.1.13:1234/v1`. Override with `VERA_ANALYSIS_LM_STUDIO`.
Hosted uses the existing encrypted VERA ChatGPT subscription and prefers `gpt-6.1-sol`
when available. Use an optional model argument or `VERA_ANALYSIS_PROFILE` to select a
different subscribed profile that already has authorization. The evaluator uses the normal
encrypted credential store and provider refresh path. The fictional workbench and its sessions stay
in the run folder. The tool list offers no device, write or web operations.

Each `run.json` records model identity, actual calls and outcomes, the report and plan bytes, and
checks for skill choice, issued citations, the read of the report at the saved hash, individual
case readiness and execution-only routing. A failed check or provider error exits nonzero.
Run folders live under `evaluation-outputs/analysis-skills/`.
