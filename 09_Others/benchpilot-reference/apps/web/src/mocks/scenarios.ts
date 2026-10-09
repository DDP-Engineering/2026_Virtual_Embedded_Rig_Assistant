// Demo scripts for 07 prompts 1–5, matched on the user prompt like 04 §8 replay fixtures.
// Texts reuse the mockup's copy; IDs and evidence refs come from the runs actually created.
import type { Cluster, ReportDetail, TestRun } from "@benchpilot/shared";
import { ProviderError, type RunResult, type TurnContext } from "./engine";
import { db } from "./store";

type Script = (ctx: TurnContext, text: string) => Promise<void>;

const fwIn = (text: string) => (/2\.0\.4/.test(text) && !/2\.1\.0/.test(text) ? "2.0.4" : "2.1.0");
const runOf = (runs: TestRun[], testId: string) => runs.find((r) => r.testId === testId);
const failing = (r: TestRun) => r.checks.find((c) => !c.pass) ?? r.checks[0]!;

function latestLiveReport(predicate: (r: ReportDetail) => boolean = () => true): ReportDetail | undefined {
  return [...db.reports.values()]
    .map((r) => r.detail)
    .filter((r) => r.kind === "live" && predicate(r))
    .sort((a, b) => b.id.localeCompare(a.id))[0];
}

/** Result table + per-failure notes, like the mockup's run summary. */
async function summarizeRun(ctx: TurnContext, result: RunResult, closing: string) {
  const passed = result.runs.filter((r) => r.verdict === "pass").length;
  const failed = result.runs.length - passed;
  const rows = result.runs.map((r) => {
    const c = failing(r);
    return `| ${r.testId} ${r.testName} | ${r.verdict.toUpperCase()} | ${c.measured} | ${c.expected} |`;
  });
  const notes: string[] = [];
  for (const r of result.runs.filter((x) => x.verdict !== "pass")) {
    const flap = r.testId === "TC-PERF-003" && r.checks[0]?.evidence.find((e) => e.includes("/switch-syslog/"));
    if (flap) notes.push(`- **${r.testId}:** the throughput drop lines up with a link-down on SW-01 Gi1/0/7 [[${flap}]]. The DUT logs are clean in that window, so this may be a lab issue.`);
    else if (r.testId === "TC-END-004") notes.push(`- **${r.testId}:** \`mesh-agent\` was killed by the OOM killer after 9 h 40 m [[ev:${r.id}/log/dut-syslog/1532]].`);
    else {
      const c = failing(r);
      notes.push(`- **${r.testId}:** ${c.title.toLowerCase()} measured ${c.measured}, expected ${c.expected}${c.evidence[0] ? ` [[${c.evidence[0]}]]` : ""}.`);
    }
  }
  await ctx.say(
    [
      `Run finished on RTR-AX3000 · fw ${result.fw}: **${passed} passed, ${failed} failed.**`,
      "",
      "| Test | Verdict | Measured | Threshold |",
      "|---|---|---|---|",
      ...rows,
      "",
      ...(notes.length ? [...notes, ""] : []),
      failed ? closing : "All tests passed.",
    ].join("\n"),
  );
}

// ------------------------------------------------------------------ prompt 1

const runPerformance: Script = async (ctx, text) => {
  const fw = fwIn(text);
  await ctx.skill("test-planner");
  await ctx.tool("search_testbench_docs", { query: `${fw} release notes` }, {
    summary: "3 results",
    ms: 112,
    preview: JSON.stringify([{ path: `docs/firmware/${fw}.md`, heading: "Changes", ev: `ev:TB-01/doc/docs/firmware/${fw}.md` }, { path: "docs/devices/rtr-ax3000.md", heading: "Services" }, { path: "docs/test-policy.md", heading: "Re-runs" }], null, 2),
  });
  await ctx.tool("list_tests", { area: ["performance", "stability"] }, { summary: "3 tests", ms: 38, preview: "TC-PERF-003 v4 · TC-DNS-005 v1 · TC-END-004 v2" });
  await ctx.tool("get_test_history", { test_id: "TC-END-004", limit: 8 }, { summary: "8 runs", ms: 41, preview: "fw 2.0.4: 8/8 pass · mem slope +0.0 MB/h" });
  await ctx.say(
    fw === "2.1.0"
      ? "Firmware 2.1.0 adds an EasyMesh agent (`mesh-agent`), updates odhcpd, and adds a cloud telemetry service [[ev:TB-01/doc/docs/firmware/2.1.0.md]]. For a performance pass I suggest three tests. I added the 12-hour endurance test because a new resident process is the most likely source of memory or stability regressions."
      : "Firmware 2.0.4 only has minor fixes [[ev:TB-01/doc/docs/firmware/2.0.4.md]]. For a performance pass I suggest the same three tests as the release suite, so the results stay comparable with 2.1.0.",
  );
  const d = await ctx.proposePlan({
    title: `Performance tests · fw ${fw}`,
    fw,
    rationale: "Performance suite plus a stability check for the new resident process.",
    items: [
      { testId: "TC-PERF-003", rationale: "Baseline throughput check, required for every release candidate." },
      { testId: "TC-DNS-005", rationale: "Resolver path is unchanged, but this test belongs to the performance suite." },
      {
        testId: "TC-END-004",
        rationale: fw === "2.1.0" ? "mesh-agent is a new resident process in 2.1.0, so memory and stability are the main risk." : "Stability baseline for the 2.1.0 comparison.",
      },
    ],
  });
  if (d.decision === "reject") {
    await ctx.say(`Understood, nothing will run.${d.comment ? ` Noted: “${d.comment}”.` : ""} Tell me what to change, for example a different firmware or fewer tests.`);
    return;
  }
  const result = await ctx.runPlan(d);
  await summarizeRun(ctx, result, "Do you want me to analyse the root cause of the failures?");
};

// ------------------------------------------------------------------ prompt 2

function clustersFor(report: ReportDetail): Cluster[] {
  const clusters: Cluster[] = [];
  const perf = runOf(report.runs, "TC-PERF-003");
  const end = runOf(report.runs, "TC-END-004");
  const dhcp = runOf(report.runs, "TC-DHCP-001");
  const ipv6 = runOf(report.runs, "TC-IPV6-002");
  const dns = runOf(report.runs, "TC-DNS-005");
  if (perf?.verdict === "fail") {
    const flap = perf.checks[0]!.evidence.find((e) => e.includes("/switch-syslog/"));
    clusters.push({
      title: "Lab switch port flap during the throughput test",
      category: "environment",
      confidence: "high",
      tests: ["TC-PERF-003"],
      rootCause:
        "SW-01 port Gi1/0/7 (the SRV-01 uplink) went down for 2 s exactly when iperf3 dropped to 0. The DUT never lost its WAN link. The same flap failed this test on fw 2.0.4 on Oct 2, and the lab log has an open ticket for this port.",
      evidence: [flap, `ev:${perf.id}/pcap/capture-wan/4127`, "ev:RUN-0023/log/switch-syslog/44", "ev:TB-01/doc/docs/lab-notes.md#2026-09-29"].filter(Boolean) as string[],
      recommendation: "Re-run TC-PERF-003 after LAB-311 is fixed. Don't file a firmware bug.",
    });
  }
  if (end?.verdict === "fail" || dhcp?.verdict === "fail") {
    const tests = [end, dhcp].filter((r) => r?.verdict === "fail").map((r) => r!.testId);
    clusters.push({
      title: dhcp?.verdict === "fail" ? "mesh-agent: memory leak to OOM, and it delays DHCP at boot" : "mesh-agent memory leak leads to OOM",
      category: "product_bug",
      confidence: "high",
      tests,
      rootCause: [
        end?.verdict === "fail" ? "Free memory falls 17.5 MB/h on 2.1.0 and stays flat on 2.0.4. At 9 h 40 m the kernel killed mesh-agent with 171 MB resident." : "",
        dhcp?.verdict === "fail" ? "At boot, mesh-agent blocks 5 s on a backhaul scan before dnsmasq starts, so the first DHCPACK comes 6.8 s after LAN up." : "",
        "mesh-agent is new in 2.1.0.",
      ]
        .filter(Boolean)
        .join(" "),
      evidence: [
        ...(end?.verdict === "fail" ? [end.checks.find((c) => c.id === "mem_trend")!.evidence[0]!, `ev:${end.id}/log/dut-syslog/1532`] : []),
        ...(dhcp?.verdict === "fail" ? [`ev:${dhcp.id}/log/dut-syslog/88`] : []),
        "ev:TB-01/doc/docs/firmware/2.1.0.md",
      ],
      recommendation: "Send to the mesh-agent team. A ticket draft is ready.",
    });
  }
  if (ipv6?.verdict === "fail")
    clusters.push({
      title: "odhcpd 2026.03.1 defaults disable the default route and RDNSS",
      category: "product_bug",
      confidence: "high",
      tests: ["TC-IPV6-002"],
      rootCause: "The updated odhcpd sets router lifetime 0 (ra_default=0) and drops the RDNSS option (dns_service=0), so IPv6 clients get no default route or DNS server.",
      evidence: [`ev:${ipv6.id}/log/dut-syslog/64`, `ev:${ipv6.id}/pcap/capture-lan/12`, "ev:TB-01/doc/docs/firmware/2.1.0.md"],
      recommendation: "Ticket to the platform team: restore ra_default=1 and dns_service=1 in the 2.1.0 defaults.",
    });
  if (dns?.verdict === "fail")
    clusters.push({
      title: "TC-DNS-005 measures the shared upstream resolver",
      category: "test_issue",
      confidence: "medium",
      tests: ["TC-DNS-005"],
      rootCause: "Slow answers are cache misses forwarded to DNS-UP; the DUT itself answers in about 1 ms. The p95 follows lab load on the shared resolver.",
      evidence: [`ev:${dns.id}/pcap/capture-lan/415`, `ev:${dns.id}/pcap/capture-wan/206`, "ev:TB-01/doc/docs/lab-notes.md#2026-10-03"],
      recommendation: "Ticket to the test owner (qa-perf): warm the cache or measure DUT-only latency.",
    });
  return clusters;
}

const analyse: Script = async (ctx, text) => {
  const id = /RPT-\d{4}/.exec(text)?.[0];
  const report = id ? db.reports.get(id)?.detail : latestLiveReport((r) => r.summary.failed > 0);
  if (!report) {
    await ctx.say(`I can't find ${id ?? "a finished live report"} yet. Approve a test plan first, then ask me to analyse its report.`);
    return;
  }
  if (report.summary.failed === 0) {
    await ctx.say(`All tests in ${report.id} passed, so there is nothing to triage.`);
    return;
  }
  await ctx.skill("failure-analyzer");
  const failed = report.runs.filter((r) => r.verdict !== "pass");
  await ctx.tool("get_report", { report_id: report.id }, {
    summary: `${failed.length} failed`,
    ms: 44,
    preview: failed.map((r) => `${r.testId} ${r.verdict} (${r.checks.filter((c) => !c.pass).map((c) => `${c.id}: ${c.measured}`).join("; ")})`).join("\n"),
  });
  const perf = runOf(failed, "TC-PERF-003");
  if (perf) {
    await ctx.tool("get_timeline", { test_run_id: perf.id, from: "21:00:00", to: "21:00:30" }, {
      summary: "7 events",
      ms: 63,
      preview: "21:00:13 sw-01 CRC errors Gi1/0/7\n21:00:14 sw-01 Gi1/0/7 down\n21:00:14–16 iperf3 0 bps\n21:00:16 sw-01 Gi1/0/7 up\n(dut-syslog: no events in window)",
    });
    await ctx.tool("search_logs", { test_run_id: perf.id, source: "switch-syslog", query: "GigabitEthernet1/0/7" }, { summary: "4 lines", ms: 21, preview: `L56–L60, see ev:${perf.id}/log/switch-syslog/57` });
    await ctx.tool("get_test_history", { test_id: "TC-PERF-003", limit: 8 }, { summary: "1 fail in 8", ms: 39, preview: "fw 2.0.4 · Oct 2 (RUN-0023): fail · same Gi1/0/7 flap" });
    await ctx.tool("search_testbench_docs", { query: "SW-01 Gi1/0/7" }, { summary: "1 result", ms: 18, preview: "lab-notes.md › 2026-09-29: CRC errors and link flaps, ticket LAB-311 open" });
  }
  const end = runOf(failed, "TC-END-004");
  if (end) {
    await ctx.tool("get_metrics", { test_run_id: end.id, name: "mem_free_kb" }, { summary: "145 points", ms: 52, preview: "slope_per_hour (to first OOM): −17 512 kB · min 6 512 kB at +9 h 40 m" });
    await ctx.tool("compare_runs", { a: end.id, b: "RUN-0040" }, { summary: "fw 2.1.0 vs 2.0.4", ms: 30, preview: "mem slope −17.5 MB/h vs +0.0 MB/h · OOM events 1 vs 0" });
  }
  const clusters = clustersFor(report);
  const kinds = new Set(clusters.map((c) => c.category));
  await ctx.say(
    kinds.has("environment") && kinds.has("product_bug")
      ? "Two independent causes. One is in the lab, one is in the firmware."
      : `I found ${clusters.length} ${clusters.length === 1 ? "cause" : "independent causes"}.`,
  );
  const summaryMd = clusters.map((c) => `- **${c.title}** (${c.category.replace("_", " ")}, ${c.confidence})`).join("\n");
  await ctx.tool("save_report_analysis", { report_id: report.id, summary_md: summaryMd, clusters }, { summary: "saved", ms: 12, preview: `Report ${report.id} updated` });
  db.saveAnalysis(report.id, { summaryMd, clusters, skill: "failure-analyzer", savedAt: new Date().toISOString() });
  const mesh = clusters.find((c) => c.title.startsWith("mesh-agent"));
  if (mesh) {
    const ticket = {
      clusterTitle: mesh.title,
      title: "mesh-agent leaks ~17.5 MB/h, OOM after 9 h 40 m on 2.1.0",
      component: "mesh-agent",
      severity: "major" as const,
      bodyMd: `## Summary\nOn fw 2.1.0, free memory falls about 17.5 MB/h during the 12 h endurance test until the OOM killer stops mesh-agent at 9 h 40 m.\n\n## Evidence\n${mesh.evidence.map((e) => `- ${e}`).join("\n")}\n\n## Expected\nFlat memory, as on 2.0.4.`,
    };
    await ctx.tool("draft_ticket", { report_id: report.id, cluster_title: ticket.clusterTitle, title: ticket.title, component: ticket.component, severity: ticket.severity, body_md: ticket.bodyMd }, {
      summary: "draft",
      ms: 9,
      preview: "Stored as draft. Not sent anywhere.",
    });
    db.addTicket(report.id, ticket);
  }
  await ctx.say(`Analysis saved to ${report.id}.${mesh ? " Ticket draft created for the mesh-agent leak." : ""}`);
};

// ------------------------------------------------------------------ prompt 3

const compare: Script = async (ctx) => {
  await ctx.skill("firmware-comparator");
  await ctx.tool("search_testbench_docs", { query: "2.1.0 changes" }, { summary: "3 results", ms: 17, preview: "mesh-agent added · odhcpd 2026.03.1 · telemetry service" });
  await ctx.tool("get_test_history", { test_id: "TC-DHCP-001" }, { summary: "8 runs", ms: 35, preview: "fw 2.0.4: 8/8 pass · lease 1.2–1.6 s · no runs on 2.1.0" });
  await ctx.say("DHCP and IPv6 have no results on 2.1.0 yet, and both areas changed in this release. I'll run those two tests first, then compare against the 2.0.4 baseline.");
  const d = await ctx.proposePlan({
    title: "Changed components · fw 2.1.0",
    fw: "2.1.0",
    rationale: "Cover the components changed in 2.1.0 before comparing with 2.0.4.",
    items: [
      { testId: "TC-DHCP-001", rationale: "mesh-agent now starts during boot, in front of dnsmasq." },
      { testId: "TC-IPV6-002", rationale: "odhcpd was updated in 2.1.0 with new defaults." },
    ],
  });
  if (d.decision === "reject") {
    await ctx.say("Understood, nothing will run. I can still compare the results we already have; ask me again when you're ready.");
    return;
  }
  const result = await ctx.runPlan(d);
  const dhcp = runOf(result.runs, "TC-DHCP-001");
  const ipv6 = runOf(result.runs, "TC-IPV6-002");
  await ctx.tool("compare_runs", { a: result.reportId, b: "RPT-0008" }, {
    summary: `${result.runs.filter((r) => r.verdict === "fail").length} regressions`,
    ms: 41,
    preview: [dhcp && `TC-DHCP-001: 1.39 s → ${dhcp.checks[0]!.measured}`, ipv6 && "TC-IPV6-002: lifetime 1800 → 0, RDNSS missing"].filter(Boolean).join(" · "),
  });
  await ctx.tool("compare_traffic_profiles", { fw_a: "2.0.4", fw_b: "2.1.0" }, {
    summary: "1 new endpoint",
    ms: 88,
    preview: "+ telemetry.vendor.example:80 HTTP (plaintext) · unchanged: ntp, update (TLS)",
  });
  const rpt9 = db.reports.get("RPT-0009")?.detail;
  const rows = [
    dhcp && `| DHCP lease after boot | 1.39 s | ${dhcp.checks[0]!.measured} | ${dhcp.verdict.toUpperCase()} regression |`,
    ipv6 && "| IPv6 RA router lifetime | 1800 s | 0 s | FAIL regression |",
    ipv6 && "| IPv6 RDNSS option | present | missing | FAIL regression |",
    rpt9 && runOf(rpt9.runs, "TC-END-004")?.verdict === "fail" && "| Endurance 12 h | stable | OOM 9 h 40 m | FAIL regression |",
    rpt9 && runOf(rpt9.runs, "TC-PERF-003")?.verdict === "fail" && "| TCP throughput | 933.0 Mbps | 845.0 Mbps | Lab issue, re-run needed |",
  ].filter(Boolean);
  const bullets = [
    dhcp && `- **The DHCP delay has the same root component as the OOM.** mesh-agent blocks for 5 s "waiting for backhaul scan" before dnsmasq starts [[ev:${dhcp.id}/log/dut-syslog/88]], so the client needs three DISCOVERs [[ev:${dhcp.id}/pcap/capture-lan/31]].`,
    ipv6 && `- **The odhcpd update changed defaults:** router lifetime 0 and no RDNSS, so clients get no default route or DNS over IPv6 [[ev:${ipv6.id}/log/dut-syslog/64]] [[ev:${ipv6.id}/pcap/capture-lan/12]].`,
    dhcp && `- **Security finding:** the new telemetry service sends the serial number and WAN MAC over plaintext HTTP to telemetry.vendor.example [[ev:${dhcp.id}/pcap/capture-wan/210]].`,
  ].filter(Boolean);
  await ctx.say(["| Area | 2.0.4 | 2.1.0 | Assessment |", "|---|---|---|---|", ...rows, "", ...bullets].join("\n"));

  const clusters = clustersFor(db.reports.get(result.reportId)!.detail);
  if (dhcp)
    clusters.push({
      title: "Telemetry sends device identifiers over plaintext HTTP",
      category: "security",
      confidence: "high",
      tests: ["TC-DHCP-001"],
      rootCause: "The new cloud telemetry service posts the serial number and WAN MAC to telemetry.vendor.example on port 80 without TLS, shortly after boot.",
      evidence: [`ev:${dhcp.id}/pcap/capture-wan/210`, "ev:TB-01/doc/docs/firmware/2.1.0.md"],
      recommendation: "Ticket to the cloud team: move telemetry to HTTPS and review the payload.",
    });
  const summaryMd = "2.1.0 vs 2.0.4: regressions in mesh-agent (DHCP delay) and odhcpd (IPv6 RA), plus a plaintext telemetry finding.";
  await ctx.tool("save_report_analysis", { report_id: result.reportId, summary_md: summaryMd, clusters }, { summary: "saved", ms: 14, preview: `Report ${result.reportId} updated` });
  db.saveAnalysis(result.reportId, { summaryMd, clusters, skill: "firmware-comparator", savedAt: new Date().toISOString() });
  if (ipv6) {
    const ticket = {
      clusterTitle: "odhcpd 2026.03.1 defaults disable the default route and RDNSS",
      title: "2.1.0: odhcpd sends RA with router lifetime 0 and no RDNSS",
      component: "odhcpd",
      severity: "major" as const,
      bodyMd: `## Summary\nAfter the odhcpd 2026.03.1 update, Router Advertisements carry router lifetime 0 and no RDNSS option.\n\n## Evidence\n- ev:${ipv6.id}/log/dut-syslog/64\n- ev:${ipv6.id}/pcap/capture-lan/12\n\n## Expected\nLifetime 1800 s and RDNSS present, as on 2.0.4.`,
    };
    await ctx.tool("draft_ticket", { report_id: result.reportId, cluster_title: ticket.clusterTitle, title: ticket.title, component: ticket.component, severity: ticket.severity, body_md: ticket.bodyMd }, {
      summary: "draft",
      ms: 8,
      preview: "Stored as draft. Not sent anywhere.",
    });
    db.addTicket(result.reportId, ticket);
  }
  await ctx.say(
    "**2.1.0 is not release-ready.** There are two product-bug clusters (mesh-agent, odhcpd) and one security finding. Throughput needs a clean re-run once the lab switch port is fixed.",
  );
};

// ------------------------------------------------------------------ prompt 4

const rerun: Script = async (ctx) => {
  await ctx.skill("test-planner");
  await ctx.tool("get_report", { report_id: "RPT-0009" }, { summary: "TC-PERF-003 fail", ms: 29, preview: "throughput 845.0 Mbps < 900 · retrans 3.8 % > 1.0 %" });
  await ctx.say("A clean re-run on the same firmware separates a lab problem from a firmware one. Re-runs need a new approved plan.");
  const d = await ctx.proposePlan({
    title: "Re-run · TC-PERF-003 · fw 2.1.0",
    fw: "2.1.0",
    rationale: "Confirm the environment diagnosis for RPT-0009.",
    items: [{ testId: "TC-PERF-003", rationale: "Same test and firmware as RPT-0009. A pass confirms the switch port flap caused the failure." }],
  });
  if (d.decision === "reject") {
    await ctx.say("Understood, nothing will run.");
    return;
  }
  const result = await ctx.runPlan(d);
  const perf = runOf(result.runs, "TC-PERF-003");
  if (perf?.verdict === "pass")
    await ctx.say(
      `TC-PERF-003 passed at ${perf.checks[0]!.measured} with ${perf.checks[1]!.measured} retransmissions [[${perf.checks[0]!.evidence[0]}]]. This confirms the lab diagnosis: the failure in RPT-0009 came from the SW-01 port flap, not from firmware 2.1.0.`,
    );
  else await summarizeRun(ctx, result, "The failure reproduced, so the environment diagnosis needs another look.");
};

// ------------------------------------------------------------------ prompt 5

const dnsReliability: Script = async (ctx) => {
  await ctx.skill("failure-analyzer");
  await ctx.tool("get_test_history", { test_id: "TC-DNS-005", limit: 8 }, { summary: "3 fail in 8 · 6 flips", ms: 37, preview: "p95 ms: 45 47 54 44 56 48 52 46 · fw 2.0.4 throughout" });
  const dnsRun = db.runsOfTest("TC-DNS-005").at(-1)!.run;
  await ctx.tool("query_packets", { test_run_id: dnsRun.id, capture: "capture-lan", display_filter: "dns.time > 0.02" }, {
    summary: "60 rows",
    ms: 340,
    preview: "All 60 slow answers are first lookups of a name. Cached answers: dns.time 0.6–1.5 ms.",
  });
  await ctx.tool("query_packets", { test_run_id: dnsRun.id, capture: "capture-wan", display_filter: "dns.flags.response == 1 && ip.src == 198.51.100.53" }, {
    summary: "60 rows",
    ms: 296,
    preview: "60 upstream answers from DNS-UP · 24–52 ms · DUT forwarding overhead ≈ 1 ms",
  });
  await ctx.tool("search_testbench_docs", { query: "DNS-UP latency" }, { summary: "1 result", ms: 16, preview: "lab-notes.md › 2026-10-03: DNS-UP is a shared lab resolver; upstream latency varies 30–70 ms" });
  await ctx.say(
    [
      "**TC-DNS-005 is not a reliable test.** I classify it as a test issue, high confidence.",
      "",
      "- It failed 3 of the last 8 nightly runs on unchanged firmware 2.0.4, with 6 verdict flips. By the test policy that is flaky [[ev:RUN-0039/check/p95]].",
      `- In ${dnsRun.id}, the DUT answers cached names in about 1 ms. Every slow answer is a cache miss forwarded to DNS-UP: frame 415 took ${dnsRun.checks[0]!.measured} on the LAN [[ev:${dnsRun.id}/pcap/capture-lan/415]], and almost all of that was spent upstream [[ev:${dnsRun.id}/pcap/capture-wan/206]].`,
      "- DNS-UP is a shared lab resolver whose latency varies with lab load [[ev:TB-01/doc/docs/lab-notes.md#2026-10-03]].",
      "",
      "The p95 therefore measures the lab resolver, not the router. Recommendation: ticket to the test owner (qa-perf) to warm the cache before measuring, or to measure DUT-only latency.",
    ].join("\n"),
  );
};

// ------------------------------------------------------------------ verification helpers (P4a only)

const mockError: Script = async (ctx) => {
  await ctx.say("Let me check the latest report.");
  throw new ProviderError("Provider error: the model endpoint returned 529 (overloaded). Simulated by the P4a mock.");
};

const fallback: Script = async (ctx) => {
  await ctx.say("No scripted response for this prompt (demo replay mode). Try one of the suggested prompts.");
};

export function pickScript(text: string): Script {
  if (/^\/mock-error/i.test(text)) return mockError;
  if (/root cause|analy[sz]/i.test(text)) return analyse;
  if (/compare|release.?ready|what changed/i.test(text)) return compare;
  if (/re-?run/i.test(text)) return rerun;
  if (/reliable|flaky|TC-DNS-005/i.test(text)) return dnsReliability;
  if (/performance|perf tests|throughput tests/i.test(text)) return runPerformance;
  return fallback;
}
