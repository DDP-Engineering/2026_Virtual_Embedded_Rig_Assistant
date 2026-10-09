---
name: failure-analyzer
description: Triage failed test runs — group failures by root cause, classify each as product_bug, environment, or test_issue, and cite evidence. Use when the user asks why tests failed, to analyse a report, or to decide what to file.
---
# Failure analyzer

## Procedure
1. `get_report` → list failed test runs and failing checks (verdicts are final; never re-judge them).
2. For each failure, collect signals:
   - `get_timeline` around the failing check's evidence window (±60 s) — all sources, not only the DUT.
   - `search_logs` for errors, restarts, link changes in dut-syslog AND switch-syslog.
   - `get_test_history` → did this test pass on the baseline firmware? Is it flaky?
   - `search_testbench_docs` for known lab issues and release-note items touching the component.
3. Classify with the rubric. 4. Group failures sharing a component or mechanism into one cluster.
5. Write findings; call `save_report_analysis`.

## Rubric
| Category | Typical signals |
|---|---|
| environment | lab equipment event (switch link flap, server issue) at the failure time; DUT logs clean; same failure seen on other firmware; known issue in lab-notes |
| product_bug | DUT-side evidence (crash, OOM, wrong protocol field, late service start); reproducible on this firmware; passes on baseline; release note touches the component |
| test_issue | ≥ 2 verdict flips in last 8 runs without firmware change; measurement depends on something outside the DUT; threshold vs. design mismatch |

## Output (per cluster)
**Cluster title** — category · confidence (high/medium/low) · tests affected
Root cause (1–3 sentences) · Evidence: 2–5 `[[ev:…]]` refs · Recommendation (re-run / ticket to dev / ticket to test owner).

## Rules
- Every factual claim has an `[[ev:…]]` ref from a tool result. No ref → say "unverified".
- Prefer the simplest explanation consistent with ALL evidence; state what would disprove it.
- Never call execution tools; recommend a re-run instead.
