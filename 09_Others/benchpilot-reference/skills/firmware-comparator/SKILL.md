---
name: firmware-comparator
description: 'Compare two firmware versions: verdicts, metrics, traffic profile. Use for "what changed", regressions, release readiness.'
---
# Firmware comparator

## Procedure
1. Pick the two versions (default: release candidate vs. GA baseline from TESTBENCH.md).
   `list_reports` with `fw` for each version to find the most recent reports.
2. Verdicts and metrics: `compare_runs` with the two reports (or two test runs of the same test).
   For each test note: verdict on each firmware, test version, and the per-check measured delta.
3. Traffic profile: `compare_traffic_profiles` with `fw_a` (old) and `fw_b` (new). Look for:
   - endpoints added or removed (host, IP, port, transport);
   - plaintext application protocols (`encrypted` false: HTTP, DNS, NTP) — especially new ones;
   - new ports or new destinations outside the lab.
   Confirm interesting rows with `query_packets` (e.g. `http.request` or `tls.handshake.extensions_server_name`).
4. Correlate every delta with a release-note item (`search_testbench_docs`, `read_testbench_doc`).
   A delta with no matching release note is itself a finding.
5. Summarise release readiness.

## Definitions
- **Regression** = pass on the old firmware + fail on the new firmware, for the same test version.
- **Improvement** = the reverse. A test version change makes the comparison invalid; say so.
- Run-to-run noise: compare with `get_test_history` before calling a metric delta significant.

## Output
| Area | Old fw | New fw | Delta | Release note | Assessment |
|---|---|---|---|---|---|
Then a short list of findings, each with 1–3 `[[ev:…]]` refs.

## Rules
- Plaintext traffic carrying device identifiers (serial, MAC) is a security finding; cite the packet.
- Missing results on one firmware: propose a plan first (test-planner); never guess.
- Verdicts come from the evaluators; never restate a verdict differently.
