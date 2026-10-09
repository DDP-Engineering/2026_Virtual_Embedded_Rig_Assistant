// TB-01 content per 03 §1 (testbench.yaml, docs/*). P2 writes the real files; these mirror them.
import type { TestbenchConfig, TestbenchDoc, Topology } from "@benchpilot/shared";

export const TB01_CONFIG: TestbenchConfig = {
  id: "TB-01",
  name: "AX3000 Virtual Lab",
  description: "Virtual testbench for RTR-AX3000 firmware validation",
  device: { model: "RTR-AX3000", firmware: ["2.0.4", "2.1.0"] },
  enabled_tools: [
    "search_testbench_docs", "read_testbench_doc", "list_tests", "get_test_definition", "propose_test_plan",
    "run_test_plan", "list_reports", "get_report", "search_logs", "get_log_context", "query_packets", "get_metrics",
    "get_timeline", "compare_runs", "compare_traffic_profiles", "get_test_history", "save_report_analysis", "draft_ticket",
  ],
  enabled_skills: [
    "test-planner", "firmware-comparator", "dhcp-ipv6-tester", "performance-analyst", "endurance-tester", "failure-analyzer", "report-presenter",
  ],
  enabled_tests: ["TC-DHCP-001", "TC-IPV6-002", "TC-PERF-003", "TC-END-004", "TC-DNS-005"],
  simulation: { pools: "data/pools.json" },
};

/** Addresses per 02 "Testbench world"; positions are the diagram layout stored in topology.yaml. */
export const TB01_TOPOLOGY: Topology = {
  nodes: [
    { id: "CAP-01", type: "probe", label: "CAP-01", addr: "capture probe", notes: "Writes capture-lan (VLAN10) and capture-wan (VLAN20)", position: { x: 250, y: 0 } },
    { id: "CLIENT-01", type: "client", label: "CLIENT-01", addr: "192.168.10.100", notes: "Wired LAN client (DHCP, iperf3 client)", position: { x: 0, y: 140 } },
    { id: "SW-01", type: "switch", label: "SW-01", addr: "lab switch", notes: "VLAN10 LAN, VLAN20 WAN, Gi1/0/24 mirror", position: { x: 250, y: 140 } },
    { id: "RTR-AX3000", type: "dut", label: "RTR-AX3000", addr: "192.168.10.1 · 198.51.100.2", notes: "DUT, OpenWrt-based firmware", position: { x: 520, y: 140 } },
    { id: "CLOUD", type: "cloud", label: "Vendor cloud", addr: "*.vendor.example", notes: "ntp, update (TLS), telemetry (2.1.0)", position: { x: 800, y: 140 } },
    { id: "CLIENT-02", type: "client", label: "CLIENT-02", addr: "192.168.10.101", notes: "Wi-Fi 5 GHz client (DNS test)", position: { x: 520, y: 300 } },
    { id: "SRV-01", type: "server", label: "SRV-01", addr: "198.51.100.10", notes: "iperf3 server", position: { x: 130, y: 300 } },
    { id: "DNS-UP", type: "server", label: "DNS-UP", addr: "198.51.100.53", notes: "Shared upstream resolver", position: { x: 330, y: 300 } },
  ],
  links: [
    { a: "CLIENT-01", b: "SW-01", port: "Gi1/0/2", vlan: 10, kind: "wired" },
    { a: "SW-01", b: "RTR-AX3000", port: "Gi1/0/1", vlan: 10, kind: "wired" },
    { a: "SW-01", b: "RTR-AX3000", port: "Gi1/0/5", vlan: 20, kind: "wired" },
    { a: "SRV-01", b: "SW-01", port: "Gi1/0/7", vlan: 20, kind: "wired" },
    { a: "DNS-UP", b: "SW-01", vlan: 20, kind: "wired" },
    { a: "SW-01", b: "CAP-01", port: "Gi1/0/24", kind: "mirror" },
    { a: "RTR-AX3000", b: "CLIENT-02", port: "5 GHz", kind: "wifi" },
    { a: "RTR-AX3000", b: "CLOUD", port: "WAN gw .1", kind: "uplink" },
  ],
  capture_points: [
    { name: "capture-lan", source: "SW-01 Gi1/0/24", vlan: 10 },
    { name: "capture-wan", source: "SW-01 Gi1/0/24", vlan: 20 },
  ],
};

const TESTBENCH_MD = `# TB-01 — AX3000 Virtual Lab

DUT: RTR-AX3000 Wi-Fi 6 router (OpenWrt-based firmware). Firmware under test: 2.1.0 (RC). Baseline: 2.0.4 (GA).

## Topology
CLIENT-01 (wired, 192.168.10.100) and CLIENT-02 (Wi-Fi 5 GHz, .101) on LAN VLAN10 via SW-01.
DUT WAN 198.51.100.2 on VLAN20; SRV-01 (iperf3 server, .10) and DNS-UP (.53) on VLAN20.
CAP-01 receives SW-01 mirror port Gi1/0/24 and writes capture-lan / capture-wan.

## Sources per run
dut-syslog (OpenWrt logread), switch-syslog (SW-01), capture-lan, capture-wan (pcapng), iperf3 JSON.
All hosts are NTP-synced: timestamps across sources are directly comparable.

## Conventions
- Verdicts come from the test catalog checks. Never restate a verdict differently.
- A failure is a product bug only if evidence points at the DUT. Check lab equipment (SW-01, SRV-01, DNS-UP) first.
- Cite evidence for every claim. Re-runs need a new approved plan.
- See test-policy.md for re-run and bug-filing rules; lab-notes.md for known lab issues.
`;

const TOPOLOGY_YAML = `nodes:
  - { id: RTR-AX3000, type: dut,    label: RTR-AX3000, addr: "192.168.10.1 / 198.51.100.2", pos: [520, 140] }
  - { id: CLIENT-01,  type: client, label: CLIENT-01,  addr: 192.168.10.100, pos: [0, 140] }
  - { id: CLIENT-02,  type: client, label: CLIENT-02,  addr: 192.168.10.101, pos: [520, 300] }
  - { id: SW-01,      type: switch, label: SW-01,      addr: lab switch, pos: [250, 140] }
  - { id: SRV-01,     type: server, label: SRV-01,     addr: 198.51.100.10, pos: [130, 300] }
  - { id: DNS-UP,     type: server, label: DNS-UP,     addr: 198.51.100.53, pos: [330, 300] }
  - { id: CAP-01,     type: probe,  label: CAP-01,     addr: capture probe, pos: [250, 0] }
  - { id: CLOUD,      type: cloud,  label: Vendor cloud, addr: "*.vendor.example", pos: [800, 140] }
links:
  - { a: CLIENT-01, b: SW-01, port: Gi1/0/2, vlan: 10 }
  - { a: SW-01, b: RTR-AX3000, port: Gi1/0/1, vlan: 10 }
  - { a: SW-01, b: RTR-AX3000, port: Gi1/0/5, vlan: 20 }
  - { a: SRV-01, b: SW-01, port: Gi1/0/7, vlan: 20 }
  - { a: DNS-UP, b: SW-01, vlan: 20 }
  - { a: SW-01, b: CAP-01, port: Gi1/0/24, kind: mirror }
  - { a: RTR-AX3000, b: CLIENT-02, port: 5 GHz, kind: wifi }
  - { a: RTR-AX3000, b: CLOUD, port: WAN gw .1, kind: uplink }
capture_points:
  - { name: capture-lan, source: SW-01 Gi1/0/24, vlan: 10 }
  - { name: capture-wan, source: SW-01 Gi1/0/24, vlan: 20 }
`;

const RTR_MD = `# RTR-AX3000

Fictional Wi-Fi 6 router used for this PoC.

## Hardware
- Dual-core 1.3 GHz SoC, 512 MB RAM
- 1× WAN + 4× LAN 1 GbE
- Wi-Fi 6, 2×2 on 2.4 GHz and 5 GHz

## Expected performance
- NAT TCP throughput ≥ 900 Mbps (LAN → WAN, single client)
- Idle free memory about 180 MB (\`mem_free_kb\` from healthmon)

## Services
dnsmasq (DHCPv4, DNS), odhcpd (RA, DHCPv6), dropbear, uhttpd, healthmon. From 2.1.0 also \`mesh-agent\`.
`;

const LAB_EQUIPMENT_MD = `# Lab equipment

## SW-01
Managed switch. VLAN10 LAN: Gi1/0/1 DUT-LAN1, Gi1/0/2 CLIENT-01. VLAN20 WAN: Gi1/0/5 DUT-WAN, Gi1/0/7 SRV-01.
Gi1/0/24 mirrors both VLANs to CAP-01. Logs to the lab syslog host (switch-syslog).

## CAP-01
Capture probe. Writes \`capture-lan.pcapng\` (VLAN10) and \`capture-wan.pcapng\` (VLAN20), snaplen 128.

## SRV-01
WAN-side iperf3 server, 198.51.100.10.

## DNS-UP
Upstream resolver, 198.51.100.53. Shared with other lab benches.
`;

const FW_210_MD = `# Firmware 2.1.0 (release candidate)

## Changes
- Added EasyMesh agent (\`mesh-agent\`), enabled by default.
- odhcpd updated to 2026.03.1 (new defaults: \`ra_default\`, \`dns_service\`).
- New cloud telemetry service (opt-out in UI).

## Fixes
- Guest Wi-Fi isolation restored after reboot.
- LED schedule ignored the configured time zone.
- uhttpd session timeout too short on slow clients.
`;

const FW_204_MD = `# Firmware 2.0.4 (GA)

## Fixes
- 5 GHz DFS channel return after a radar event.
- WPS button debounce.
- Minor web UI translation fixes.
`;

const LAB_NOTES_MD = `# Lab maintenance log

## 2026-09-14
Replaced the power strip under the TB-01 rack. No downtime for the DUT.

## 2026-09-18
CAP-01 time sync checked against the lab NTP server: offset under 1 ms.

## 2026-09-22
SRV-01 iperf3 updated to 3.16. Baseline throughput re-measured on fw 2.0.4: 934 Mbps.

## 2026-09-26
CAP-01 disk cleanup, 412 GB freed.

## 2026-09-29
SW-01 Gi1/0/7 (SRV-01 uplink): intermittent CRC errors and link flaps reported; cable reseated, ticket LAB-311 open.

## 2026-10-01
SRV-01 kernel updated to 6.6.52.

## 2026-10-03
DNS-UP is a shared lab resolver; upstream latency varies 30–70 ms with lab load.

## 2026-10-06
Badge reader at the lab door replaced. No impact on benches.
`;

const TEST_POLICY_MD = `# Test policy

## Verdicts
Verdicts come from the catalog checks only. A failed check fails the test.

## Triage
- **Environment failure** (lab equipment, network, power): re-run the test, no bug.
- **Test issue** (measurement or threshold problem): ticket to the test owner.
- **Product bug** (evidence points at the DUT): ticket with evidence to the component team.

## Flaky tests
A test is flaky when it has at least 2 verdict flips in its last 8 runs with no firmware change.

## Re-runs
Re-runs need a new approved plan. Keep the failed report for traceability.
`;

const DOCS: [string, string, string][] = [
  ["docs/TESTBENCH.md", "TB-01 — AX3000 Virtual Lab", TESTBENCH_MD],
  ["docs/topology.yaml", "topology.yaml", TOPOLOGY_YAML],
  ["docs/devices/rtr-ax3000.md", "RTR-AX3000", RTR_MD],
  ["docs/devices/lab-equipment.md", "Lab equipment", LAB_EQUIPMENT_MD],
  ["docs/firmware/2.0.4.md", "Firmware 2.0.4 (GA)", FW_204_MD],
  ["docs/firmware/2.1.0.md", "Firmware 2.1.0 (release candidate)", FW_210_MD],
  ["docs/lab-notes.md", "Lab maintenance log", LAB_NOTES_MD],
  ["docs/test-policy.md", "Test policy", TEST_POLICY_MD],
];

export function tb01Docs(testbenchId = "TB-01", firstId = 1): TestbenchDoc[] {
  return DOCS.map(([path, title, content], i) => ({ id: firstId + i, testbenchId, path, title, content, pinned: path === "docs/TESTBENCH.md" }));
}

/** Starting point for the wizard's "Start from template" (`empty` template). */
export function testbenchMdTemplate(name: string, model: string) {
  return `# ${name}\n\nDUT: ${model}.\n\n## Topology\nDescribe clients, switches, servers and capture points.\n\n## Sources per run\nList the logs and captures each run produces.\n\n## Conventions\n- Verdicts come from the test catalog checks. Never restate a verdict differently.\n- Cite evidence for every claim. Re-runs need a new approved plan.\n`;
}
