# Previous-session performance checks

Status2026-11-12: the user requested only a descriptive measurement of existing behavior for now.
The [completed Windows evaluation](eval-performance-outputs/session-loading-2026-11-12-windows.md) contains360
valid samples. Calibration/comparison commands below remain experimental and have no completed
native acceptance or established reference. Feature/milestone usage below is a deferred proposal,
not an active verification gate. No loader/rendering optimization was made.

PERF-01 / Gitea #91 measures saved-session selection in the real compiled Electron application.
Run from `05_Software`, with pinned dependencies and prepared local model resources already present.
Use an idle reference host with the normal VERA app and other test/build jobs stopped. Nothing is
downloaded. The runner owns a temporary build/profile/workbench and leaves desktop `out/` alone.

## Commands

The output parent directory must exist. Choose a new filename for every run: JSON and adjacent
`.json.md` summaries are exclusive-create and never overwritten.

```powershell
# Five measured samples per selected case; diagnostic without an explicit reference.
python ../02_Tools/npmw.py npm run perf:sessions -- run --mode quick --cases small,medium --scenarios first,warm --output ../02_Tools/cache/session-quick.json

# Thirty measured samples per case. Repeat the same candidate on the same idle host.
python ../02_Tools/npmw.py npm run perf:sessions -- run --mode full --output ../02_Tools/cache/session-full-a.json
python ../02_Tools/npmw.py npm run perf:sessions -- run --mode full --output ../02_Tools/cache/session-full-b.json

# Explicit calibration, with separately justified positive absolute budgets.
python ../02_Tools/npmw.py npm run perf:sessions -- calibrate --runs ../02_Tools/cache/session-full-a.json,../02_Tools/cache/session-full-b.json --budgets ../02_Tools/cache/session-budgets.json --output ../02_Tools/cache/session-reference.json

# New feature: measure and compare, or compare an existing report.
python ../02_Tools/npmw.py npm run perf:sessions -- run --mode quick --reference ../02_Tools/cache/session-reference.json --output ../02_Tools/cache/session-candidate.json
python ../02_Tools/npmw.py npm run perf:sessions -- compare --report ../02_Tools/cache/session-candidate.json --reference ../02_Tools/cache/session-reference.json --output ../02_Tools/cache/session-comparison.json
```

Cases: `small` (20 messages), `medium` (200), `large` (2,000), `payload` (200 with 64 KiB completed
tool previews). Scenarios: `first`, `warm`, `cross`. Defaults select all twelve combinations. The
manifest records exact message/item/event counts, byte sizes, content hashes and fixed seed.

Exit **0** means a complete diagnostic measurement or passing comparison; **1** means a failed
measurement, regression or budget exceedance; **2** means invalid arguments/evidence, incompatible
or missing reference, or preparation failure. Diagnostic success alone is not a performance pass.
Failed samples remain in reports and cannot be calibrated.

## Measurement and isolation

First-open samples each use a fresh process, an opened workbench and an unvisited target session.
Warm-reopen prepares A then B before measuring A. Cross-session prepares the small anchor before
selecting the target. Preparation is outside the session timer and recorded separately. The runner
does not flush or claim to control the OS disk cache. Fixture writers close before timing begins.

Timing starts before click dispatch and ends after selected identity/content checks, an unsent draft,
history access and two animation frames. Playwright interaction overhead is included. Correctness
checks on persisted conversation counts/cursor run outside the interval. Future pagination need not
render every historical message simultaneously to satisfy this measurement contract.
Complete canonical response hashes are checked outside the interval at both the main handler and
the renderer API boundary, including interior text and tool previews; reports retain hashes only.

Opt-in main probes measure event SQL reads, snapshot validation/reduction excluding those reads,
and the main IPC handler. The renderer measures its API round trip including response validation,
then presentation through the interaction checks in its own clock. These durations overlap; do not
sum them as disjoint phases. Payload-size serialization adds measurement overhead.

Main/renderer heartbeat gaps use a 20 ms timer and include scheduling overhead. They are not exact
Windows “not responding” durations. An external runner deadline can terminate its owned app tree
when application callbacks stop. Memory context is main RSS and summed Electron Tab working set
before/after a sample; growth alone does not establish a leak. External traffic is blocked from
instrumented startup and no turn is submitted. Probe composition is omitted from ordinary builds.

Reports identify the host by hash, OS/CPU/RAM/runtime, viewport/text scale, fixture/harness hashes,
commit, complete dirty candidate hash and compiled build hash. References are environment-specific;
candidate application code can change, but host/fixture/harness/build mode must match. Windows does
not establish native Ubuntu performance; WSL/VM evidence is labelled separately.

## Calibration and budgets

Quick reports median/maximum. Full reports median, nearest-rank p95 (`ceil(.95*n)-1`) and maximum.
Calibration requires two distinct complete full executions of the same source/build. For each
metric/case, relative tolerance is the greater of 10% and twice the inter-run median spread divided
by the pooled median. Absolute noise allowance is the largest of 5 units, twice the median spread
and twice the p95 spread (ms for durations, bytes for payload). Comparison allows the greater relative
or absolute allowance; full comparisons also check p95. All raw reference samples remain available.
Both modes compare maxima as well as medians. Controls record their configured injected stall
separately from compatibility identity, so an intentional negative control can use a normal reference.

Budgets are a JSON map keyed by case, for example `small/first`, containing positive numeric
`loadMs`, `mainGapMs` and `rendererGapMs`. Choose usability goals after observing variation and
record the rationale beside the reference. Absolute budgets check every sample, not only its median.
Calibration retains existing budget failures and does not approve a slow baseline. Reference updates
are explicit and justified during review; a feature check never promotes its candidate automatically.

Controls: `run --cases small --scenarios first --inject-stall-ms 1000` demonstrates stall/regression
detection with a reference; `--timeout 500 --inject-stall-ms 2500` exercises the external watchdog.
Use distinct report names. Retain reports outside routine E2E cleanup. Temporary profiles/build links
are removed only after their processes close; the shared node_modules/models link targets are untouched.

## Feature and milestone use

For persistence, snapshot/IPC, session hooks, sidebar selection and chat rendering changes, run the
affected quick cases against an explicit compatible reference. Escalate affected full cases when a
result regresses or approaches a budget. At existing milestone gates, one owner runs the complete
implemented matrix once per native platform. No extra complete functional suite or handover retest
is added. Existing slow cases require measured follow-up; this harness does not optimize the loader.
