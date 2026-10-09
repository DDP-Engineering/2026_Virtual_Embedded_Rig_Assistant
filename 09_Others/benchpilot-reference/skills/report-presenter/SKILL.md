---
name: report-presenter
description: Turn results and analysis into an executive + engineering report. Use when asked for a summary, report, or ticket.
---
# Report presenter

## Procedure
1. `get_report` → verdicts, failing checks and any saved analysis. If no analysis exists and failures are
   present, run the failure-analyzer procedure first (`load_skill` "failure-analyzer").
2. Write the report in this structure:
   1. **Verdict summary** — tests run, passed, failed; firmware and device; one sentence on release readiness.
   2. **Clusters** — one section per cluster: title, category (product_bug / environment / test_issue /
      security), confidence, tests affected, root cause, 2–5 `[[ev:…]]` refs.
   3. **Evidence** — the key packets, log lines and metric points, each with its ref.
   4. **Recommendations** — re-run (environment), ticket to dev (product bug), ticket to test owner (test issue).
   5. **Next actions** — owner and action per line.
3. Call `save_report_analysis` with `{report_id, summary_md, clusters:[…]}` so the report page shows it.
4. Tickets: call `draft_ticket` once per **product bug** cluster (and security finding) with
   `{report_id, cluster_title, title, body_md, component, severity}`. The body has: summary, firmware,
   failing test and check, steps to reproduce (the catalog procedure), evidence refs, expected vs. actual.

## Severity guide
| Severity | When |
|---|---|
| critical | crash/OOM, data exposure, loss of connectivity |
| major | functional failure of a service (DHCP late, RA wrong) |
| minor | cosmetic or low impact |

## Rules
- Keep the executive summary to three sentences.
- Verdicts are quoted exactly as the evaluators produced them.
- No `draft_ticket` for environment failures or test issues: recommend a re-run or a note to the test owner.
- Every claim has an `[[ev:…]]` ref; drafts are never sent anywhere — say so when the user asks.
