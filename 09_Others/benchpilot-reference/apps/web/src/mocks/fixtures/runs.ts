// Dataset fixtures: what a test run on each P1 dataset produces (verdicts, checks, events, series, log and packet
// excerpts). Evidence refs are built from the run id assigned at run time, like 04 §8's {{test_run:…}} placeholders.
import type { CheckResult, EventSeverity, PacketRow, PacketTreeNode, Verdict } from "@benchpilot/shared";
import { at, iosTime, logreadTime } from "./clock";
import { dnsSeries, enduranceTput, memSeries, perfSeries, type OffsetPoint } from "./series";

export interface LogExcerpt {
  source: string;
  host: string;
  first: number;
  lines: string[];
}

export interface PcapExcerpt {
  capture: string;
  rows: PacketRow[];
  /** `tshark -V` trees per frame number. */
  details: Record<number, PacketTreeNode[]>;
  filters: Record<number, string>;
}

export interface FixtureEvent {
  offset: number;
  source: string;
  severity: EventSeverity;
  message: string;
  line: number;
}

export interface RunFixture {
  datasetId: string;
  fw: string;
  testId: string;
  start: number;
  verdict: Verdict;
  checks: (run: string) => CheckResult[];
  events: FixtureEvent[];
  series: { name: string; unit: string; points: OffsetPoint[] }[];
  logs: LogExcerpt[];
  pcaps: PcapExcerpt[];
  artifacts: string[];
}

const ev = {
  log: (run: string, source: string, line: number) => `ev:${run}/log/${source}/${line}`,
  pcap: (run: string, capture: string, frame: number) => `ev:${run}/pcap/${capture}/${frame}`,
  metric: (run: string, name: string, ts: number) => `ev:${run}/metric/${name}/${Math.round(ts)}`,
};
export { ev as evRef };

const check = (id: string, title: string, pass: boolean, measured: string, expected: string, evidence: string[] = []): CheckResult => ({
  id,
  title,
  pass,
  measured,
  expected,
  evidence,
});

// Tree helper: two-space indentation → nested nodes; a leading "!" marks the highlighted line.
export function tree(text: string): PacketTreeNode[] {
  const root: PacketTreeNode[] = [];
  const stack: { depth: number; children: PacketTreeNode[] }[] = [{ depth: -1, children: root }];
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    const depth = raw.search(/\S/) / 4;
    let label = raw.trim();
    const highlight = label.startsWith("!");
    if (highlight) label = label.slice(1).trim();
    const node: PacketTreeNode = highlight ? { label, highlight } : { label };
    while (stack.length > 1 && stack[stack.length - 1]!.depth >= depth) stack.pop();
    const parent = stack[stack.length - 1]!;
    parent.children.push(node);
    node.children = [];
    stack.push({ depth, children: node.children });
  }
  const prune = (nodes: PacketTreeNode[]) => nodes.forEach((n) => (n.children?.length ? prune(n.children) : delete n.children));
  prune(root);
  return root;
}

// ------------------------------------------------------------------ TC-PERF-003

const PERF_ARTIFACTS = ["capture-wan.pcapng", "dut-syslog.log", "switch-syslog.log", "iperf3.json"];

function perfFlap(datasetId: string, start: number, target: number, retrans: number, firstLine: number): RunFixture {
  const down = start + 14;
  const sw = (s: number, msg: string) => `${iosTime(start + s)} sw-01 ${msg}`;
  const tgt = firstLine + 4;
  return {
    datasetId,
    fw: datasetId === "DS-0023" ? "2.0.4" : "2.1.0",
    testId: "TC-PERF-003",
    start,
    verdict: "fail",
    checks: (run) => [
      check("throughput", "Average throughput", false, `${target.toFixed(1)} Mbps`, "avg ≥ 900 Mbps", [ev.metric(run, "throughput_mbps", down), ev.log(run, "switch-syslog", tgt)]),
      check("retrans", "Retransmissions", false, `${retrans.toFixed(1)} %`, "last ≤ 1.0 %", [ev.pcap(run, "capture-wan", 4127)]),
    ],
    events: [
      { offset: 13, source: "switch-syslog", severity: "warning", message: "%ETHPORT-4-CRC: Interface GigabitEthernet1/0/7, 214 CRC errors in last 60 s", line: tgt - 1 },
      { offset: 14, source: "switch-syslog", severity: "error", message: "%LINK-3-UPDOWN: Interface GigabitEthernet1/0/7, changed state to down", line: tgt },
      { offset: 16, source: "switch-syslog", severity: "info", message: "%LINK-3-UPDOWN: Interface GigabitEthernet1/0/7, changed state to up", line: tgt + 2 },
    ],
    series: [
      { name: "throughput_mbps", unit: "Mbps", points: perfSeries(target, datasetId === "DS-0023" ? 5 : 7, true) },
      { name: "retrans_pct", unit: "%", points: [{ offset: 30, value: retrans }] },
    ],
    logs: [
      {
        source: "switch-syslog",
        host: "sw-01",
        first: firstLine,
        lines: [
          sw(-118, "%SSH-5-SSH2_SESSION: SSH2 Session request from 192.0.2.50 (tty = 0)"),
          sw(-85, "%SYS-5-CONFIG_I: Configured from console by labops on vty0 (192.0.2.50)"),
          sw(-2, "%SSH-5-SSH2_USERAUTH: User 'labops' authentication for SSH2 Session succeeded"),
          sw(13, "%ETHPORT-4-CRC: Interface GigabitEthernet1/0/7, 214 CRC errors in last 60 s"),
          sw(14, "%LINK-3-UPDOWN: Interface GigabitEthernet1/0/7, changed state to down"),
          sw(15, "%LINEPROTO-5-UPDOWN: Line protocol on Interface GigabitEthernet1/0/7, changed state to down"),
          sw(16, "%LINK-3-UPDOWN: Interface GigabitEthernet1/0/7, changed state to up"),
          sw(17, "%LINEPROTO-5-UPDOWN: Line protocol on Interface GigabitEthernet1/0/7, changed state to up"),
          sw(280, "%SSH-5-SSH2_CLOSE: SSH2 Session from 192.0.2.50 (tty = 0) for user 'labops' closed"),
        ],
      },
    ],
    pcaps: [
      {
        capture: "capture-wan",
        rows: [
          { no: 4121, time: "15.998402", src: "198.51.100.2", dst: "198.51.100.10", proto: "TCP", length: 1514, info: "50432 → 5201 [ACK] Seq=5875577 Ack=1 Win=502 Len=1448" },
          { no: 4122, time: "16.102118", src: "198.51.100.10", dst: "198.51.100.2", proto: "TCP", length: 78, info: "[TCP Dup ACK 4118#1] 5201 → 50432 [ACK] Seq=1 Ack=5871233 SLE=5872681 SRE=5877025" },
          { no: 4123, time: "16.102140", src: "198.51.100.10", dst: "198.51.100.2", proto: "TCP", length: 78, info: "[TCP Dup ACK 4118#2] 5201 → 50432 [ACK] Seq=1 Ack=5871233 SLE=5872681 SRE=5877025" },
          { no: 4124, time: "16.102161", src: "198.51.100.10", dst: "198.51.100.2", proto: "TCP", length: 78, info: "[TCP Dup ACK 4118#3] 5201 → 50432 [ACK] Seq=1 Ack=5871233 SLE=5872681 SRE=5877025" },
          { no: 4125, time: "16.102390", src: "198.51.100.2", dst: "198.51.100.10", proto: "TCP", length: 1514, info: "[TCP Fast Retransmission] 50432 → 5201 [ACK] Seq=5871233 Ack=1 Win=502 Len=1448" },
          { no: 4126, time: "16.306511", src: "198.51.100.10", dst: "198.51.100.2", proto: "TCP", length: 66, info: "5201 → 50432 [ACK] Seq=1 Ack=5872681 Win=24576 Len=0" },
          { no: 4127, time: "16.306602", src: "198.51.100.2", dst: "198.51.100.10", proto: "TCP", length: 1514, info: "[TCP Retransmission] 50432 → 5201 [ACK] Seq=5872681 Ack=1 Win=502 Len=1448" },
          { no: 4128, time: "16.307010", src: "198.51.100.2", dst: "198.51.100.10", proto: "TCP", length: 1514, info: "[TCP Retransmission] 50432 → 5201 [ACK] Seq=5877025 Ack=1 Win=502 Len=1448" },
          { no: 4129, time: "16.511873", src: "198.51.100.10", dst: "198.51.100.2", proto: "TCP", length: 66, info: "5201 → 50432 [ACK] Seq=1 Ack=5878473 Win=24576 Len=0" },
        ],
        details: {
          4127: tree(`Frame 4127: 1514 bytes on wire (12112 bits), 128 bytes captured (1024 bits) on interface vlan20
    Arrival Time: Oct  7, 2026 21:00:16.306602000 UTC
    [Time delta from previous captured frame: 0.000091000 seconds]
Ethernet II, Src: 02:a0:00:00:00:02, Dst: 02:5e:00:00:00:10
Internet Protocol Version 4, Src: 198.51.100.2, Dst: 198.51.100.10
    Time to Live: 64
    Protocol: TCP (6)
Transmission Control Protocol, Src Port: 50432, Dst Port: 5201, Seq: 5872681, Ack: 1, Len: 1448
    Flags: 0x010 (ACK)
    Window: 502
    [SEQ/ACK analysis]
        [The RTO for this segment was: 0.204212000 seconds]
        [TCP Analysis Flags]
            !     [Expert Info (Note/Sequence): This frame is a (suspected) retransmission]`),
        },
        filters: { 4127: "tcp.analysis.retransmission && frame.number >= 4120" },
      },
    ],
    artifacts: PERF_ARTIFACTS,
  };
}

function perfClean(datasetId: string, fw: string, start: number, target: number, retrans: number, seed: number): RunFixture {
  return {
    datasetId,
    fw,
    testId: "TC-PERF-003",
    start,
    verdict: "pass",
    checks: (run) => [
      check("throughput", "Average throughput", true, `${target.toFixed(1)} Mbps`, "avg ≥ 900 Mbps", [ev.metric(run, "throughput_mbps", start + 15)]),
      check("retrans", "Retransmissions", true, `${retrans.toFixed(2).replace(/0$/, "")} %`, "last ≤ 1.0 %"),
    ],
    events: [],
    series: [
      { name: "throughput_mbps", unit: "Mbps", points: perfSeries(target, seed) },
      { name: "retrans_pct", unit: "%", points: [{ offset: 30, value: retrans }] },
    ],
    logs: [],
    pcaps: [],
    artifacts: PERF_ARTIFACTS,
  };
}

// ------------------------------------------------------------------ TC-END-004

const OOM = 34812;

function endLeak(): RunFixture {
  const start = at("2026-10-07T21:12:00Z");
  const t = (s: number) => logreadTime(start + s);
  const mem = memSeries(19, true);
  const tput = enduranceTput(3, true);
  return {
    datasetId: "DS-0048",
    fw: "2.1.0",
    testId: "TC-END-004",
    start,
    verdict: "fail",
    checks: (run) => [
      check("no_crash", "No crash or OOM", false, "OOM at 9 h 40 m (2 lines)", "no matching lines", [ev.log(run, "dut-syslog", 1530), ev.log(run, "dut-syslog", 1532)]),
      check("mem_trend", "Free memory trend", false, "−4 483 kB/h (whole run)", "decline ≤ 1 024 kB/h", [ev.metric(run, "mem_free_kb", start + OOM)]),
      check("tput_floor", "Throughput floor", false, "611.5 Mbps", "min ≥ 800 Mbps", [ev.metric(run, "throughput_mbps", start + 19 * 1800 + 10)]),
    ],
    events: [
      { offset: OOM, source: "dut-syslog", severity: "warning", message: "kernel: mesh-agent invoked oom-killer: gfp_mask=0x140cca(GFP_HIGHUSER_MOVABLE|__GFP_COMP)", line: 1530 },
      { offset: OOM, source: "dut-syslog", severity: "error", message: "kernel: Out of memory: Killed process 1201 (mesh-agent) anon-rss:171204kB", line: 1532 },
      { offset: OOM + 0.1, source: "dut-syslog", severity: "info", message: "procd: Instance mesh-agent::instance1 exit with error code 9 after 34790 seconds", line: 1533 },
    ],
    series: [
      { name: "mem_free_kb", unit: "kB", points: mem },
      { name: "throughput_mbps", unit: "Mbps", points: tput },
    ],
    logs: [
      {
        source: "dut-syslog",
        host: "RTR-AX3000",
        first: 1524,
        lines: [
          `${t(33610.9)} daemon.info healthmon[905]: mem_free_kb=24412 mem_avail_kb=36940 load1=0.71 conntrack=170 temp_c=61 uptime_s=33610`,
          `${t(33910.9)} daemon.info healthmon[905]: mem_free_kb=19988 mem_avail_kb=31102 load1=0.66 conntrack=172 temp_c=61 uptime_s=33910`,
          `${t(34210.9)} daemon.info healthmon[905]: mem_free_kb=15530 mem_avail_kb=24870 load1=0.85 conntrack=171 temp_c=61 uptime_s=34210`,
          `${t(34402)} daemon.info dropbear[2210]: Child connection from 192.168.10.100:51522`,
          `${t(34510.9)} daemon.info healthmon[905]: mem_free_kb=11204 mem_avail_kb=17892 load1=0.92 conntrack=171 temp_c=61 uptime_s=34510`,
          `${t(34810.9)} daemon.info healthmon[905]: mem_free_kb=6512 mem_avail_kb=10910 load1=1.37 conntrack=168 temp_c=62 uptime_s=34810`,
          `${t(OOM)} kern.warn kernel: [34812.120034] mesh-agent invoked oom-killer: gfp_mask=0x140cca(GFP_HIGHUSER_MOVABLE|__GFP_COMP), order=0, oom_score_adj=0`,
          `${t(OOM)} kern.warn kernel: [34812.120101] CPU: 1 PID: 1201 Comm: mesh-agent Not tainted 6.6.52 #0`,
          `${t(OOM)} kern.err kernel: [34812.180221] Out of memory: Killed process 1201 (mesh-agent) total-vm:184312kB, anon-rss:171204kB, file-rss:1220kB, shmem-rss:0kB, UID:0 pgtables:356kB oom_score_adj:0`,
          `${t(OOM)} daemon.info procd: Instance mesh-agent::instance1 exit with error code 9 after 34790 seconds`,
          `${t(OOM + 5.4)} daemon.info mesh-agent[4410]: starting EasyMesh agent v0.9.2`,
          `${t(OOM + 5.4)} daemon.info mesh-agent[4410]: waiting for backhaul scan (timeout 5000 ms)`,
          `${t(OOM + 10.5)} daemon.warn mesh-agent[4410]: backhaul scan timeout, continuing in standalone mode`,
          `${t(35110.9)} daemon.info healthmon[905]: mem_free_kb=178840 mem_avail_kb=196212 load1=0.31 conntrack=166 temp_c=60 uptime_s=35110`,
          `${t(35410.9)} daemon.info healthmon[905]: mem_free_kb=177302 mem_avail_kb=194880 load1=0.28 conntrack=169 temp_c=60 uptime_s=35410`,
        ],
      },
    ],
    pcaps: [],
    artifacts: ["dut-syslog.log", "iperf3-series.jsonl"],
  };
}

function endClean(datasetId: string, start: number, seed: number): RunFixture {
  return {
    datasetId,
    fw: "2.0.4",
    testId: "TC-END-004",
    start,
    verdict: "pass",
    checks: (run) => [
      check("no_crash", "No crash or OOM", true, "0 matching lines", "no matching lines"),
      check("mem_trend", "Free memory trend", true, "+15 kB/h", "decline ≤ 1 024 kB/h", [ev.metric(run, "mem_free_kb", start + 21610.9)]),
      check("tput_floor", "Throughput floor", true, "924.0 Mbps", "min ≥ 800 Mbps"),
    ],
    events: [],
    series: [
      { name: "mem_free_kb", unit: "kB", points: memSeries(seed, false) },
      { name: "throughput_mbps", unit: "Mbps", points: enduranceTput(seed, false) },
    ],
    logs: [],
    pcaps: [],
    artifacts: ["dut-syslog.log", "iperf3-series.jsonl"],
  };
}

// ------------------------------------------------------------------ TC-DNS-005

function dns(datasetId: string, fw: string, start: number, p95: number, seed: number): RunFixture {
  const pass = p95 <= 50;
  return {
    datasetId,
    fw,
    testId: "TC-DNS-005",
    start,
    verdict: pass ? "pass" : "fail",
    checks: (run) => [check("p95", "DNS response p95", pass, `${p95.toFixed(1)} ms`, "p95 ≤ 50 ms", [ev.metric(run, "dns_response_ms", start + 41.4), ev.pcap(run, "capture-lan", 415)])],
    events: [],
    series: [{ name: "dns_response_ms", unit: "ms", points: dnsSeries(p95, seed) }],
    logs: [],
    pcaps: [
      {
        capture: "capture-lan",
        rows: [
          { no: 410, time: "41.102214", src: "192.168.10.101", dst: "192.168.10.1", proto: "DNS", length: 86, info: "Standard query 0x3c11 A r-8c2e1d.test.example" },
          { no: 411, time: "41.103201", src: "192.168.10.1", dst: "192.168.10.101", proto: "DNS", length: 102, info: "Standard query response 0x3c11 A r-8c2e1d.test.example A 203.0.113.81" },
          { no: 412, time: "41.401877", src: "192.168.10.101", dst: "192.168.10.1", proto: "DNS", length: 86, info: "Standard query 0x7a02 A r-f04b97.test.example" },
          { no: 413, time: "41.402904", src: "192.168.10.1", dst: "192.168.10.101", proto: "DNS", length: 102, info: "Standard query response 0x7a02 A r-f04b97.test.example A 203.0.113.82" },
          { no: 414, time: "41.700512", src: "192.168.10.101", dst: "192.168.10.1", proto: "DNS", length: 86, info: "Standard query 0x1f9d A r-51aa0c.test.example" },
          { no: 415, time: `${(41.700512 + p95 / 1000).toFixed(6)}`, src: "192.168.10.1", dst: "192.168.10.101", proto: "DNS", length: 102, info: "Standard query response 0x1f9d A r-51aa0c.test.example A 203.0.113.83" },
          { no: 416, time: "42.001388", src: "192.168.10.101", dst: "192.168.10.1", proto: "DNS", length: 86, info: "Standard query 0x5be0 A r-a3d771.test.example" },
        ],
        details: {
          415: tree(`Frame 415: 102 bytes on wire (816 bits), 102 bytes captured (816 bits) on interface vlan10
Ethernet II, Src: 02:a0:00:00:00:01, Dst: 02:c1:00:00:00:02
Internet Protocol Version 4, Src: 192.168.10.1, Dst: 192.168.10.101
User Datagram Protocol, Src Port: 53, Dst Port: 41877
Domain Name System (response)
    Transaction ID: 0x1f9d
    Flags: 0x8180 Standard query response, No error
    Answers
        r-51aa0c.test.example: type A, class IN, addr 203.0.113.83
    [Request In: 414]
    ! [Time: ${(p95 / 1000).toFixed(9)} seconds]`),
        },
        filters: { 415: "dns.time > 0.02" },
      },
      {
        capture: "capture-wan",
        rows: [
          { no: 205, time: "41.701130", src: "198.51.100.2", dst: "198.51.100.53", proto: "DNS", length: 86, info: "Standard query 0x9d41 A r-51aa0c.test.example" },
          { no: 206, time: `${(41.70113 + (p95 - 1.1) / 1000).toFixed(6)}`, src: "198.51.100.53", dst: "198.51.100.2", proto: "DNS", length: 102, info: "Standard query response 0x9d41 A r-51aa0c.test.example A 203.0.113.83" },
        ],
        details: {
          206: tree(`Frame 206: 102 bytes on wire (816 bits), 102 bytes captured (816 bits) on interface vlan20
Internet Protocol Version 4, Src: 198.51.100.53, Dst: 198.51.100.2
Domain Name System (response)
    Transaction ID: 0x9d41
    [Request In: 205]
    ! [Time: ${((p95 - 1.1) / 1000).toFixed(9)} seconds]`),
        },
        filters: { 206: "dns.flags.response == 1 && ip.src == 198.51.100.53" },
      },
    ],
    artifacts: ["capture-lan.pcapng", "capture-wan.pcapng"],
  };
}

// ------------------------------------------------------------------ TC-DHCP-001

function dhcpMesh(): RunFixture {
  const start = at("2026-10-08T09:18:00Z");
  const t = (s: number) => logreadTime(start + s);
  return {
    datasetId: "DS-0049",
    fw: "2.1.0",
    testId: "TC-DHCP-001",
    start,
    verdict: "fail",
    checks: (run) => [check("lease_time", "LAN up → first DHCPACK", false, "6.80 s", "≤ 2.0 s", [ev.log(run, "dut-syslog", 84), ev.pcap(run, "capture-lan", 34)])],
    events: [
      { offset: 18, source: "dut-syslog", severity: "info", message: "mesh-agent[1201]: waiting for backhaul scan (timeout 5000 ms)", line: 88 },
      { offset: 23, source: "dut-syslog", severity: "warning", message: "mesh-agent[1201]: backhaul scan timeout, continuing in standalone mode", line: 89 },
    ],
    series: [],
    logs: [
      {
        source: "dut-syslog",
        host: "RTR-AX3000",
        first: 80,
        lines: [
          `${t(14)} daemon.notice procd: /etc/rc.d/S19dnsmasq: deferred until mesh-agent is ready`,
          `${t(16)} kern.info kernel: [   16.204118] mt7915e 0000:01:00.0: registering led 'mt76-phy0'`,
          `${t(17)} daemon.notice netifd: Network device 'eth0' link is up`,
          `${t(17)} daemon.notice netifd: Interface 'wan' is now up`,
          `${t(18)} daemon.notice netifd: Interface 'lan' is now up`,
          `${t(18)} daemon.info mesh-agent[1201]: starting EasyMesh agent v0.9.2`,
          `${t(18)} daemon.info mesh-agent[1201]: loading controller config /etc/config/mesh`,
          `${t(18)} kern.info kernel: [   22.412881] br-lan: port 1(lan1) entered forwarding state`,
          `${t(18)} daemon.info mesh-agent[1201]: waiting for backhaul scan (timeout 5000 ms)`,
          `${t(23)} daemon.warn mesh-agent[1201]: backhaul scan timeout, continuing in standalone mode`,
          `${t(23)} daemon.info dnsmasq[1688]: started, version 2.90 cachesize 1000`,
          `${t(23)} daemon.info dnsmasq-dhcp[1688]: DHCP, IP range 192.168.10.100 -- 192.168.10.249, lease time 12h`,
          `${t(24)} daemon.info dnsmasq-dhcp[1688]: DHCPDISCOVER(br-lan) 02:c1:00:00:00:01`,
          `${t(24)} daemon.info dnsmasq-dhcp[1688]: DHCPOFFER(br-lan) 192.168.10.100 02:c1:00:00:00:01`,
          `${t(24)} daemon.info dnsmasq-dhcp[1688]: DHCPACK(br-lan) 192.168.10.100 02:c1:00:00:00:01 client-01`,
          `${t(26)} daemon.info telemetry[1702]: service started, report interval 3600s`,
        ],
      },
    ],
    pcaps: [
      {
        capture: "capture-lan",
        rows: [
          { no: 27, time: "19.012114", src: "0.0.0.0", dst: "255.255.255.255", proto: "DHCP", length: 342, info: "DHCP Discover - Transaction ID 0x5e1a9c03" },
          { no: 28, time: "19.506090", src: "fe80::c1ff:fe00:1", dst: "ff02::2", proto: "ICMPv6", length: 70, info: "Router Solicitation from 02:c1:00:00:00:01" },
          { no: 29, time: "21.013310", src: "0.0.0.0", dst: "255.255.255.255", proto: "DHCP", length: 342, info: "DHCP Discover - Transaction ID 0x5e1a9c03" },
          { no: 30, time: "22.215402", src: "fe80::c1ff:fe00:1", dst: "ff02::fb", proto: "MDNS", length: 107, info: "Standard query 0x0000 PTR _ipp._tcp.local, \"QM\" question" },
          { no: 31, time: "24.703207", src: "0.0.0.0", dst: "255.255.255.255", proto: "DHCP", length: 342, info: "DHCP Discover - Transaction ID 0x5e1a9c03" },
          { no: 32, time: "24.751011", src: "192.168.10.1", dst: "192.168.10.100", proto: "DHCP", length: 342, info: "DHCP Offer - Transaction ID 0x5e1a9c03" },
          { no: 33, time: "24.753332", src: "0.0.0.0", dst: "255.255.255.255", proto: "DHCP", length: 342, info: "DHCP Request - Transaction ID 0x5e1a9c03" },
          { no: 34, time: "24.800118", src: "192.168.10.1", dst: "192.168.10.100", proto: "DHCP", length: 342, info: "DHCP ACK - Transaction ID 0x5e1a9c03" },
        ],
        details: {
          31: tree(`Frame 31: 342 bytes on wire (2736 bits), 342 bytes captured (2736 bits) on interface vlan10
Ethernet II, Src: 02:c1:00:00:00:01, Dst: ff:ff:ff:ff:ff:ff
Internet Protocol Version 4, Src: 0.0.0.0, Dst: 255.255.255.255
User Datagram Protocol, Src Port: 68, Dst Port: 67
Dynamic Host Configuration Protocol (Discover)
    Transaction ID: 0x5e1a9c03
    ! Seconds elapsed: 5
    Option: (53) DHCP Message Type (Discover)
    Option: (12) Host Name: client-01`),
          34: tree(`Frame 34: 342 bytes on wire (2736 bits), 342 bytes captured (2736 bits) on interface vlan10
Ethernet II, Src: 02:a0:00:00:00:01, Dst: 02:c1:00:00:00:01
Internet Protocol Version 4, Src: 192.168.10.1, Dst: 192.168.10.100
User Datagram Protocol, Src Port: 67, Dst Port: 68
Dynamic Host Configuration Protocol (ACK)
    ! Option: (53) DHCP Message Type (ACK)
    Option: (54) DHCP Server Identifier (192.168.10.1)
    Option: (51) IP Address Lease Time (12h)
    Option: (3) Router: 192.168.10.1`),
        },
        filters: { 31: "dhcp.option.dhcp == 1 || dhcp.option.dhcp == 5", 34: "dhcp.option.dhcp == 5" },
      },
      {
        capture: "capture-wan",
        rows: [
          { no: 207, time: "38.401220", src: "198.51.100.2", dst: "203.0.113.45", proto: "TCP", length: 74, info: "41288 → 80 [SYN] Seq=0 Win=64240 Len=0 MSS=1460 SACK_PERM WS=128" },
          { no: 208, time: "38.412871", src: "203.0.113.45", dst: "198.51.100.2", proto: "TCP", length: 74, info: "80 → 41288 [SYN, ACK] Seq=0 Ack=1 Win=65160 Len=0 MSS=1460" },
          { no: 209, time: "38.412930", src: "198.51.100.2", dst: "203.0.113.45", proto: "TCP", length: 66, info: "41288 → 80 [ACK] Seq=1 Ack=1 Win=502 Len=0" },
          { no: 210, time: "38.413101", src: "198.51.100.2", dst: "203.0.113.45", proto: "HTTP", length: 302, info: "POST /v1/telemetry HTTP/1.1  (application/json)" },
          { no: 211, time: "38.431776", src: "203.0.113.45", dst: "198.51.100.2", proto: "HTTP", length: 203, info: "HTTP/1.1 204 No Content" },
        ],
        details: {
          210: tree(`Frame 210: 302 bytes on wire (2416 bits), 302 bytes captured (2416 bits) on interface vlan20
Internet Protocol Version 4, Src: 198.51.100.2, Dst: 203.0.113.45
Transmission Control Protocol, Src Port: 41288, Dst Port: 80, Seq: 1, Ack: 1, Len: 236
Hypertext Transfer Protocol
    POST /v1/telemetry HTTP/1.1
    Host: telemetry.vendor.example
    Content-Type: application/json
    Content-Length: 86
JavaScript Object Notation: application/json
    ! {"serial":"AX3K-SIM-000123","wan_mac":"02:a0:00:00:00:02","uptime":42,"clients":1}`),
        },
        filters: { 210: 'http.host == "telemetry.vendor.example"' },
      },
    ],
    artifacts: ["capture-lan.pcapng", "capture-wan.pcapng", "dut-syslog.log"],
  };
}

function dhcpClean(): RunFixture {
  return {
    datasetId: "DS-0041",
    fw: "2.0.4",
    testId: "TC-DHCP-001",
    start: at("2026-10-06T18:00:00Z"),
    verdict: "pass",
    checks: () => [check("lease_time", "LAN up → first DHCPACK", true, "1.35 s", "≤ 2.0 s")],
    events: [],
    series: [],
    logs: [],
    pcaps: [],
    artifacts: ["capture-lan.pcapng", "capture-wan.pcapng", "dut-syslog.log"],
  };
}

// ------------------------------------------------------------------ TC-IPV6-002

function ipv6Lifetime0(): RunFixture {
  const start = at("2026-10-08T09:24:00Z");
  const t = (s: number) => logreadTime(start + s);
  return {
    datasetId: "DS-0050",
    fw: "2.1.0",
    testId: "TC-IPV6-002",
    start,
    verdict: "fail",
    checks: (run) => [
      check("ra_present", "Router Advertisements sent", true, "5 RAs", "≥ 2"),
      check("ra_lifetime", "Router lifetime > 0 in every RA", false, "5 of 5 RAs with lifetime 0", "> 0 in all RAs", [ev.pcap(run, "capture-lan", 12), ev.log(run, "dut-syslog", 64)]),
      check("rdnss", "RAs without RDNSS option", false, "5", "≤ 0", [ev.pcap(run, "capture-lan", 12), ev.log(run, "dut-syslog", 65)]),
    ],
    events: [
      { offset: 2, source: "dut-syslog", severity: "warning", message: "odhcpd[1520]: br-lan: ra_lifetime overridden to 0 (ra_default=0)", line: 64 },
      { offset: 2, source: "dut-syslog", severity: "info", message: "odhcpd[1520]: br-lan: dns option disabled (dns_service=0)", line: 65 },
    ],
    series: [],
    logs: [
      {
        source: "dut-syslog",
        host: "RTR-AX3000",
        first: 60,
        lines: [
          `${t(0)} daemon.notice netifd: Interface 'lan' is now up`,
          `${t(0)} daemon.info dnsmasq[1688]: started, version 2.90 cachesize 1000`,
          `${t(1)} daemon.info odhcpd[1520]: odhcpd 2026.03.1 starting`,
          `${t(2)} daemon.info odhcpd[1520]: br-lan: using prefix 2001:db8:10::/64`,
          `${t(2)} daemon.warn odhcpd[1520]: br-lan: ra_lifetime overridden to 0 (ra_default=0)`,
          `${t(2)} daemon.info odhcpd[1520]: br-lan: dns option disabled (dns_service=0)`,
          `${t(3)} daemon.info odhcpd[1520]: br-lan: sending RA (lifetime 0, prefixes 1, options MTU)`,
        ],
      },
    ],
    pcaps: [
      {
        capture: "capture-lan",
        rows: [
          { no: 10, time: "0.000000", src: "fe80::c1ff:fe00:1", dst: "ff02::2", proto: "ICMPv6", length: 70, info: "Router Solicitation from 02:c1:00:00:00:01" },
          { no: 11, time: "0.001022", src: "fe80::c1ff:fe00:1", dst: "ff02::16", proto: "ICMPv6", length: 90, info: "Multicast Listener Report Message v2" },
          { no: 12, time: "0.003104", src: "fe80::a0ff:fe00:1", dst: "ff02::1", proto: "ICMPv6", length: 118, info: "Router Advertisement from 02:a0:00:00:00:01" },
          { no: 13, time: "196.402771", src: "fe80::a0ff:fe00:1", dst: "ff02::1", proto: "ICMPv6", length: 118, info: "Router Advertisement from 02:a0:00:00:00:01" },
          { no: 14, time: "388.110925", src: "fe80::a0ff:fe00:1", dst: "ff02::1", proto: "ICMPv6", length: 118, info: "Router Advertisement from 02:a0:00:00:00:01" },
        ],
        details: {
          12: tree(`Frame 12: 118 bytes on wire (944 bits), 118 bytes captured (944 bits) on interface vlan10
Ethernet II, Src: 02:a0:00:00:00:01, Dst: 33:33:00:00:00:01
Internet Protocol Version 6, Src: fe80::a0ff:fe00:1, Dst: ff02::1
Internet Control Message Protocol v6
    Type: Router Advertisement (134)
    Cur hop limit: 64
    ! Router lifetime (s): 0
    ICMPv6 Option (Source link-layer address : 02:a0:00:00:00:01)
    ICMPv6 Option (MTU : 1500)
    ICMPv6 Option (Prefix information : 2001:db8:10::/64)`),
        },
        filters: { 12: "icmpv6.type == 134" },
      },
    ],
    artifacts: ["capture-lan.pcapng", "dut-syslog.log"],
  };
}

function ipv6Clean(): RunFixture {
  return {
    datasetId: "DS-0042",
    fw: "2.0.4",
    testId: "TC-IPV6-002",
    start: at("2026-10-06T18:06:00Z"),
    verdict: "pass",
    checks: () => [
      check("ra_present", "Router Advertisements sent", true, "5 RAs", "≥ 2"),
      check("ra_lifetime", "Router lifetime > 0 in every RA", true, "min 1800 s", "> 0 in all RAs"),
      check("rdnss", "RAs without RDNSS option", true, "0", "≤ 0"),
    ],
    events: [],
    series: [],
    logs: [],
    pcaps: [],
    artifacts: ["capture-lan.pcapng", "dut-syslog.log"],
  };
}

// ------------------------------------------------------------------ live pools (P1 pools.json)

export const LIVE_FIXTURES: Record<string, RunFixture> = Object.fromEntries(
  [
    perfFlap("DS-0046", at("2026-10-07T21:00:00Z"), 845.0, 3.8, 53),
    dns("DS-0047", "2.1.0", at("2026-10-07T21:06:00Z"), 46.0, 47),
    endLeak(),
    dhcpMesh(),
    ipv6Lifetime0(),
    perfClean("DS-0051", "2.1.0", at("2026-10-08T09:39:00Z"), 931.0, 0.2, 51),
    dns("DS-0052", "2.1.0", at("2026-10-08T09:45:00Z"), 53.0, 52),
    dhcpClean(),
    ipv6Clean(),
    perfClean("DS-0043", "2.0.4", at("2026-10-06T18:21:00Z"), 935.2, 0.23, 43),
    dns("DS-0044", "2.0.4", at("2026-10-06T18:27:00Z"), 45.1, 44),
    endClean("DS-0045", at("2026-10-06T18:33:00Z"), 45),
  ].map((f) => [f.datasetId, f]),
);

/** `data/pools.json` (P1): `{fw: {test_id: [dataset ids]}}`; the last entry repeats when exhausted. */
export const POOLS: Record<string, Record<string, string[]>> = {
  "2.1.0": {
    "TC-DHCP-001": ["DS-0049"],
    "TC-IPV6-002": ["DS-0050"],
    "TC-PERF-003": ["DS-0046", "DS-0051"],
    "TC-END-004": ["DS-0048"],
    "TC-DNS-005": ["DS-0047", "DS-0052"],
  },
  "2.0.4": {
    "TC-DHCP-001": ["DS-0041"],
    "TC-IPV6-002": ["DS-0042"],
    "TC-PERF-003": ["DS-0043"],
    "TC-DNS-005": ["DS-0044"],
    "TC-END-004": ["DS-0045"],
  },
};

// ------------------------------------------------------------------ history (02: 8 nights of 2.0.4)

const NIGHT_ORDER = ["TC-DHCP-001", "TC-IPV6-002", "TC-PERF-003", "TC-DNS-005", "TC-END-004"] as const;
const NIGHT_OFFSET_MIN: Record<string, number> = { "TC-DHCP-001": 0, "TC-IPV6-002": 6, "TC-PERF-003": 21, "TC-DNS-005": 27, "TC-END-004": 33 };
const DNS_P95 = [45, 47, 54, 44, 56, 48, 52, 46];
const LEASE = [1.31, 1.42, 1.28, 1.55, 1.36, 1.24, 1.47, 1.39];
const PERF_HIST = [934.1, 930.6, 936.8, 932.2, 848.0, 929.4, 935.5, 933.0];

/** Night N1…N8 = 2026-09-28 … 2026-10-05, 01:00Z (02: base − {10..3} days). Run ids RUN-0001…0040 in night order. */
export function historyFixtures(): { night: number; date: number; fixtures: RunFixture[] }[] {
  return Array.from({ length: 8 }, (_, n) => {
    const date = at("2026-09-28T01:00:00Z") + n * 86400;
    const ds = (i: number) => `DS-${String(n * 5 + i + 1).padStart(4, "0")}`;
    const fixtures = NIGHT_ORDER.map((testId, i): RunFixture => {
      const start = date + NIGHT_OFFSET_MIN[testId]! * 60;
      switch (testId) {
        case "TC-DHCP-001":
          return { ...dhcpClean(), datasetId: ds(i), start, checks: () => [check("lease_time", "LAN up → first DHCPACK", true, `${LEASE[n]!.toFixed(2)} s`, "≤ 2.0 s")] };
        case "TC-IPV6-002":
          return { ...ipv6Clean(), datasetId: ds(i), start };
        case "TC-PERF-003":
          return n === 4 ? { ...perfFlap(ds(i), start, 848.0, 3.6, 40), fw: "2.0.4" } : perfClean(ds(i), "2.0.4", start, PERF_HIST[n]!, 0.2, 100 + n);
        case "TC-DNS-005":
          return dns(ds(i), "2.0.4", start, DNS_P95[n]!, 200 + n);
        case "TC-END-004":
          return endClean(ds(i), start, 300 + n);
      }
    });
    return { night: n + 1, date, fixtures };
  });
}

/** Headline number per test for history charts (lease s, p95 ms, avg Mbps). */
export function headline(f: RunFixture): number | undefined {
  const m = f.checks("RUN-0000")[0]?.measured;
  if (!m || f.testId === "TC-END-004" || f.testId === "TC-IPV6-002") return undefined;
  return Number.parseFloat(m.replace(/[^\d.]/g, ""));
}
