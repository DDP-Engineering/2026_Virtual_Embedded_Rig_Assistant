---
name: test-planner
description: Select and justify a test suite for a firmware/device. Use when asked to run, plan, or choose tests.
---
# Test planner

## Procedure
1. Identify the device and the target firmware. If the user names no firmware, use the release candidate
   named in TESTBENCH.md and say so.
2. Read the release notes of the target firmware: `search_testbench_docs` (e.g. query "2.1.0 release notes"),
   then `read_testbench_doc` on the firmware page. List every changed component (new services, updated
   daemons, changed defaults).
3. `list_tests` (optionally with `area`) and `get_test_definition` for candidates. Map each changed component
   to test areas:
   | Change touches | Areas to cover |
   |---|---|
   | boot sequence, new daemons started at boot | boot, dhcp |
   | odhcpd, RA/DHCPv6 defaults | ipv6 |
   | data path, NAT, drivers, CPU load | performance |
   | long-running services, memory | stability |
   | dnsmasq, resolver | dns |
4. Add baseline-relevant tests for the requested scope even when nothing changed there (regression guard).
   Use `get_test_history` to note tests that are flaky or recently failing.
5. Estimate the duration: sum of `duration.sim_s` of the chosen tests (simulated time) and say how long the
   demo run takes.
6. Call `propose_test_plan` with `{title, device, fw, items:[{test_id, rationale}], rationale}`.
   Each item rationale names the release-note item or risk it covers.
7. Wait for the decision. If the user edits the plan (items or firmware), acknowledge the edited plan
   explicitly before doing anything else.

## Output
- A short paragraph: what changed in the firmware and which risks the plan covers.
- The plan itself is shown by the approval card; do not repeat it as a table.

## Rules
- Never call `run_test_plan` before the plan is approved; after approval run exactly the approved plan.
- Prefer few, targeted tests; explain every inclusion and every notable exclusion.
- Re-runs need a new plan; never reuse a plan that already ran.
- Cite release-note items with their `[[ev:…]]` doc refs.
