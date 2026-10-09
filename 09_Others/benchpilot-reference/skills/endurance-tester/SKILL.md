---
name: endurance-tester
description: Analyse long-duration stability runs. Use for endurance/soak/memory/crash questions.
---
# Endurance tester

## Procedure
1. `get_report` → which checks failed (`no_crash`, `mem_trend`, `tput_floor`) and their evidence.
2. Crashes: `search_logs` on dut-syslog for `oom-killer`, `Out of memory`, `Killed process`, `exit with error`,
   `Kernel panic`, `reboot:`. Name the process and PID that was killed and whether procd respawned it
   (`get_log_context` around the OOM line).
3. Memory slope: `get_metrics` for `mem_free_kb`. A sawtooth (decline, jump back after a kill, decline again)
   means one process leaks and is restarted. The whole-run slope understates it: fit each process lifetime
   separately (up to the first OOM, then after the respawn) using `from` / `to`.
4. Time-to-failure projection: free memory at start ÷ decline per hour ≈ hours to OOM. Compare with the
   observed OOM time.
5. Throughput floor: `get_metrics` for `throughput_mbps`; check whether the low sample sits next to the OOM.
6. Baseline: `compare_runs` with the same test on the baseline firmware (flat memory there = regression).
   Check the release notes for the process involved.

## Output
| Item | Value | Evidence |
|---|---|---|
| Process killed | name, PID | `[[ev:…]]` |
| OOM time | uptime / wall time | `[[ev:…]]` |
| Slope per lifetime | kB/h | `[[ev:…]]` metric points |
| Baseline slope | kB/h | `[[ev:…]]` |
Then the conclusion in 2–3 sentences.

## Rules
- A whole-run fit hides a sawtooth; fit up to the first OOM.
- The evaluator's `mem_trend` value is the verdict fact; your per-lifetime slope is analysis. Say which is which.
- 1 MB = 1000 kB in healthmon figures.
