// Test catalog (03 §2), skills (03 §3), tool registry (04 §3).
import type { Skill, TestDefinition, ToolMeta } from "@benchpilot/shared";

export const TESTS: TestDefinition[] = [
  {
    id: "TC-DHCP-001",
    name: "DHCP lease after boot",
    version: 3,
    area: ["dhcp", "boot"],
    owner: "qa-core",
    description: "LAN client must obtain a DHCP lease within 2 s after the DUT LAN interface comes up.",
    procedure:
      "1. Power-cycle DUT.\n2. Keep CLIENT-01 link up, DHCP client running.\n3. Measure from \"Interface 'lan' is now up\" (DUT syslog) to first DHCPACK on capture-lan.",
    inputs: ["capture-lan", "capture-wan", "dut-syslog"],
    duration: { sim_s: 40, demo_s: 8 },
    checks: [
      {
        id: "lease_time",
        type: "interval_between_events",
        title: "LAN up → first DHCPACK",
        start: { source: "dut-syslog", regex: "netifd: Interface 'lan' is now up" },
        end: { source: "capture-lan", display_filter: "dhcp.option.dhcp == 5" },
        max_s: 2.0,
      },
    ],
  },
  {
    id: "TC-IPV6-002",
    name: "IPv6 Router Advertisements",
    version: 2,
    area: ["ipv6"],
    owner: "qa-core",
    description: "The DUT must advertise itself as default router with RDNSS on the LAN.",
    procedure: "1. Reboot DUT.\n2. Capture LAN for 10 minutes with CLIENT-01 sending Router Solicitations.\n3. Inspect every Router Advertisement.",
    inputs: ["capture-lan", "dut-syslog"],
    duration: { sim_s: 600, demo_s: 8 },
    checks: [
      { id: "ra_present", type: "packet_count", title: "Router Advertisements sent", source: "capture-lan", display_filter: "icmpv6.type == 134", min: 2 },
      { id: "ra_lifetime", type: "packet_field_all", title: "Router lifetime > 0 in every RA", source: "capture-lan", display_filter: "icmpv6.type == 134", field: "icmpv6.nd.ra.router_lifetime", op: ">", value: 0 },
      { id: "rdnss", type: "packet_count", title: "RAs without RDNSS option", source: "capture-lan", display_filter: "icmpv6.type == 134 && !(icmpv6.opt.type == 25)", max: 0 },
    ],
  },
  {
    id: "TC-PERF-003",
    name: "TCP throughput",
    version: 4,
    area: ["performance"],
    owner: "qa-perf",
    description: "Single-stream NAT TCP throughput LAN → WAN must reach 900 Mbps with low retransmissions.",
    procedure: "1. Start iperf3 server on SRV-01.\n2. Run `iperf3 -c 198.51.100.10 -t 30 -J` from CLIENT-01.\n3. Record average throughput and retransmissions.",
    inputs: ["iperf3", "capture-wan", "dut-syslog", "switch-syslog"],
    duration: { sim_s: 30, demo_s: 8 },
    checks: [
      { id: "throughput", type: "metric_threshold", title: "Average throughput", metric: "throughput_mbps", agg: "avg", op: ">=", value: 900, unit: "Mbps" },
      { id: "retrans", type: "metric_threshold", title: "Retransmissions", metric: "retrans_pct", agg: "last", op: "<=", value: 1.0, unit: "%" },
    ],
  },
  {
    id: "TC-END-004",
    name: "Endurance 12 h",
    version: 2,
    area: ["stability"],
    owner: "qa-core",
    description: "12-hour soak with periodic traffic. No crash, no memory leak, throughput floor 800 Mbps.",
    procedure: "1. Run iperf3 bursts every 30 minutes for 12 hours.\n2. Collect healthmon every 5 minutes.\n3. Watch DUT syslog for crashes and restarts.",
    inputs: ["dut-syslog", "iperf3-series"],
    duration: { sim_s: 43200, demo_s: 40 },
    checks: [
      { id: "no_crash", type: "log_absent", title: "No crash or OOM", source: "dut-syslog", regex: "Out of memory|oom-killer|Kernel panic|reboot:" },
      { id: "mem_trend", type: "metric_trend", title: "Free memory trend", metric: "mem_free_kb", max_decline_per_hour: 1024 },
      { id: "tput_floor", type: "metric_threshold", title: "Throughput floor", metric: "throughput_mbps", agg: "min", op: ">=", value: 800, unit: "Mbps" },
    ],
  },
  {
    id: "TC-DNS-005",
    name: "DNS latency",
    version: 1,
    area: ["performance", "dns"],
    owner: "qa-perf",
    description: "DNS resolution through the DUT must be fast.",
    procedure: "Send 200 random-name queries from CLIENT-02 to the DUT resolver; p95 response time ≤ 50 ms.",
    inputs: ["capture-lan", "capture-wan"],
    duration: { sim_s: 60, demo_s: 8 },
    checks: [{ id: "p95", type: "metric_threshold", title: "DNS response p95", metric: "dns_response_ms", agg: "p95", op: "<=", value: 50, unit: "ms" }],
  },
];

export const testById = (id: string) => TESTS.find((t) => t.id === id);

const FAILURE_ANALYZER_BODY = `# Failure analyzer

## Procedure
1. \`get_report\` → list failed test runs and failing checks (verdicts are final; never re-judge them).
2. For each failure, collect signals:
   - \`get_timeline\` around the failing check's evidence window (±60 s) — all sources, not only the DUT.
   - \`search_logs\` for errors, restarts, link changes in dut-syslog AND switch-syslog.
   - \`get_test_history\` → did this test pass on the baseline firmware? Is it flaky?
   - \`search_testbench_docs\` for known lab issues and release-note items touching the component.
3. Classify with the rubric. 4. Group failures sharing a component or mechanism into one cluster.
5. Write findings; call \`save_report_analysis\`.

## Rubric
| Category | Typical signals |
|---|---|
| environment | lab equipment event (switch link flap, server issue) at the failure time; DUT logs clean; same failure seen on other firmware; known issue in lab-notes |
| product_bug | DUT-side evidence (crash, OOM, wrong protocol field, late service start); reproducible on this firmware; passes on baseline; release note touches the component |
| test_issue | ≥ 2 verdict flips in last 8 runs without firmware change; measurement depends on something outside the DUT; threshold vs. design mismatch |

## Output (per cluster)
**Cluster title** — category · confidence (high/medium/low) · tests affected
Root cause (1–3 sentences) · Evidence: 2–5 \`[[ev:…]]\` refs · Recommendation (re-run / ticket to dev / ticket to test owner).

## Rules
- Every factual claim has an \`[[ev:…]]\` ref from a tool result. No ref → say "unverified".
- Prefer the simplest explanation consistent with ALL evidence; state what would disprove it.
- Never call execution tools; recommend a re-run instead.
`;

function body(title: string, steps: string[], rules: string[]) {
  return `# ${title}\n\n## Procedure\n${steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n\n## Rules\n${rules.map((r) => `- ${r}`).join("\n")}\n`;
}

export const SKILLS: Skill[] = [
  {
    name: "test-planner",
    description: "Select and justify a test suite for a firmware/device. Use when asked to run, plan, or choose tests.",
    body: body(
      "Test planner",
      [
        "Read the release notes of the target firmware with `search_testbench_docs`.",
        "Map each changed component to test areas (`list_tests` with `area`).",
        "Include baseline-relevant tests for the requested scope, even if unchanged.",
        "Estimate the duration from each test's `duration.sim_s`.",
        "Call `propose_test_plan` with a rationale per item.",
      ],
      ["Never call `run_test_plan` before the plan is approved.", "Prefer few, targeted tests; explain every inclusion."],
    ),
  },
  {
    name: "firmware-comparator",
    description: "Compare two firmware versions: verdicts, metrics, traffic profile. Use for \"what changed\", regressions, release readiness.",
    body: body(
      "Firmware comparator",
      [
        "`compare_runs` for the same tests on both firmware versions.",
        "`compare_traffic_profiles` for new or removed endpoints, plaintext protocols, new ports.",
        "Correlate each delta with a release-note item.",
        "Regression = pass on the old firmware and fail on the new one, for the same test version.",
      ],
      ["Plaintext traffic carrying identifiers is a security finding.", "Missing results on the new firmware: propose a plan first."],
    ),
  },
  {
    name: "dhcp-ipv6-tester",
    description: "Deep analysis of DHCPv4 and IPv6 RA/ND behaviour. Use for DHCP/IPv6 failures or questions.",
    body: body(
      "DHCP and IPv6 tester",
      [
        "DORA timing and retries: `dhcp.option.dhcp == 1..5`.",
        "Router Advertisements: `icmpv6.type == 133/134`, `icmpv6.nd.ra.router_lifetime`, `icmpv6.opt.type == 25` (RDNSS).",
        "Correlate with dnsmasq, odhcpd and netifd lines in dut-syslog.",
      ],
      ["Use display filters and time windows; never dump whole captures."],
    ),
  },
  {
    name: "performance-analyst",
    description: "Analyse throughput, retransmissions, latency. Use for performance failures.",
    body: body(
      "Performance analyst",
      [
        "Read the iperf3 interval shape: a sudden drop and recovery, or a gradual decline.",
        "Count `tcp.analysis.retransmission` and `tcp.analysis.duplicate_ack` in the window.",
        "Correlate dips with link events in both dut-syslog and switch-syslog via `get_timeline`.",
      ],
      ["A dip with a lab link event and clean DUT logs points at the environment."],
    ),
  },
  {
    name: "endurance-tester",
    description: "Analyse long-duration stability runs. Use for endurance/soak/memory/crash questions.",
    body: body(
      "Endurance tester",
      [
        "Fit the memory slope with `get_metrics` (per process lifetime when it restarts).",
        "Search OOM, respawn and reboot lines; name the process.",
        "Project the time to failure from the slope.",
        "Compare the slope with the baseline firmware.",
      ],
      ["A whole-run fit hides a sawtooth; fit up to the first OOM."],
    ),
  },
  {
    name: "failure-analyzer",
    description:
      "Triage failed test runs — group failures by root cause, classify each as product_bug, environment, or test_issue, and cite evidence. Use when the user asks why tests failed, to analyse a report, or to decide what to file.",
    body: FAILURE_ANALYZER_BODY,
  },
  {
    name: "report-presenter",
    description: "Turn results and analysis into an executive + engineering report. Use when asked for a summary, report, or ticket.",
    body: body(
      "Report presenter",
      [
        "Verdict summary first: tests, passed, failed.",
        "One section per cluster with its category, evidence and recommendation.",
        "Next actions with owners.",
        "Call `save_report_analysis`; call `draft_ticket` only for product bugs.",
      ],
      ["Keep the executive summary to three sentences."],
    ),
  },
];

export const TOOLS: ToolMeta[] = [
  { name: "load_skill", group: "skills", description: "Load a skill's full instructions.", requiresApproval: false },
  { name: "search_testbench_docs", group: "knowledge", description: "Full-text search over testbench documents.", requiresApproval: false },
  { name: "read_testbench_doc", group: "knowledge", description: "Read a document or one of its sections.", requiresApproval: false },
  { name: "list_tests", group: "catalog", description: "List catalog tests with recent verdicts.", requiresApproval: false },
  { name: "get_test_definition", group: "catalog", description: "Procedure and machine checks of a test.", requiresApproval: false },
  { name: "propose_test_plan", group: "execution", description: "Show a plan and wait for your decision.", requiresApproval: true },
  { name: "run_test_plan", group: "execution", description: "Run an approved plan on the testbench.", requiresApproval: true },
  { name: "list_reports", group: "history", description: "List report headers by firmware or kind.", requiresApproval: false },
  { name: "get_report", group: "history", description: "Test runs, checks and existing analysis of a report.", requiresApproval: false },
  { name: "get_test_history", group: "history", description: "Verdicts and measurements across runs.", requiresApproval: false },
  { name: "search_logs", group: "logs", description: "Search DUT and switch syslog.", requiresApproval: false },
  { name: "get_log_context", group: "logs", description: "Lines around a cited log line.", requiresApproval: false },
  { name: "query_packets", group: "packets", description: "Run a Wireshark display filter on a capture.", requiresApproval: false },
  { name: "get_metrics", group: "metrics", description: "Downsampled time series with min, max, p95 and slope.", requiresApproval: false },
  { name: "get_timeline", group: "correlation", description: "Merge events from all sources in a time window.", requiresApproval: false },
  { name: "compare_runs", group: "compare", description: "Diff two runs or reports.", requiresApproval: false },
  { name: "compare_traffic_profiles", group: "compare", description: "Diff endpoints and protocols between firmware versions.", requiresApproval: false },
  { name: "save_report_analysis", group: "reporting", description: "Attach the AI analysis to a report.", requiresApproval: false },
  { name: "draft_ticket", group: "reporting", description: "Create a ticket draft. Nothing is sent.", requiresApproval: false },
];
