// GET /evidence?ref= (05 §6, P2 open issue 4): the resolved row plus its context — ±15 packets and the
// `tshark -V` tree for pcap, ±10 lines for logs, the series with a baseline for metrics, the section for docs.
import path from "node:path";
import type { EvidenceResponse, PacketRow, PacketTreeNode, TestbenchConfig } from "@benchpilot/shared";
import { trendPerLifetime } from "../analysis/trend.ts";
import type { Db } from "../db/index.ts";
import { getTestRun } from "../db/repos/runs.ts";
import { getDoc, getTestbenchConfig } from "../db/repos/testbenches.ts";
import { metricSeries } from "../queries.ts";
import { capturePath } from "../tools/packets.ts";
import { tsharkLines } from "../tshark.ts";
import { resolveEvidence } from "./resolve.ts";

const PACKET_CONTEXT = 15;
const LOG_CONTEXT = 10;
const MAX_TREE_LINES = 600;

/** Lines of `tshark -V` worth drawing the eye to (analysis flags and the fields the catalog checks read). */
const HIGHLIGHT = /Expert Info|Retransmission|Dup ACK|Router lifetime|Recursive DNS|DHCP Message Type|Lease Time|Time: |\[Time:|Response In|Host: |POST /;

/** `tshark -V` text → tree by indentation (4 spaces per level). */
export function parsePacketTree(lines: string[]): PacketTreeNode[] {
  const root: PacketTreeNode[] = [];
  const stack: { depth: number; children: PacketTreeNode[] }[] = [{ depth: -1, children: root }];
  for (const raw of lines) {
    if (!raw.trim()) continue;
    const depth = Math.floor((raw.length - raw.trimStart().length) / 4);
    const label = raw.trim();
    const node: PacketTreeNode = HIGHLIGHT.test(label) ? { label, highlight: true } : { label };
    while (stack.at(-1)!.depth >= depth) stack.pop();
    const parent = stack.at(-1)!;
    parent.children.push(node);
    node.children = [];
    stack.push({ depth, children: node.children });
  }
  const prune = (nodes: PacketTreeNode[]) =>
    nodes.forEach((n) => {
      if (n.children?.length) prune(n.children);
      else delete n.children;
    });
  prune(root);
  return root;
}

export interface EvidenceDeps {
  db: Db;
  runtimeDir: string;
  tsharkPath: string;
}

const runLabel = (r: { id: string; testId: string; fw: string }) => `${r.id} (${r.testId}, fw ${r.fw})`;

function baselineRun(db: Db, tb: TestbenchConfig | null, testId: string, fw: string): { id: string; fw: string } | null {
  const base = tb?.device.firmware[0];
  if (!base || base === fw) return null;
  return (
    (db.prepare("SELECT id, fw FROM test_runs WHERE test_id = ? AND fw = ? AND verdict = 'pass' ORDER BY started_at DESC LIMIT 1").get(testId, base) as
      | { id: string; fw: string }
      | undefined) ?? null
  );
}

const mbPerHour = (kbPerHour: number) => `${kbPerHour < 0 ? "−" : "+"}${Math.abs(kbPerHour / 1000).toFixed(1)} MB/h`;

export async function evidenceContext(deps: EvidenceDeps, ref: string): Promise<EvidenceResponse | null> {
  const { db } = deps;
  const r = resolveEvidence(db, ref);
  if (!r) return null;

  if (r.kind === "doc") {
    const doc = getDoc(db, r.testbenchId, r.path)!;
    const short = r.path.replace(/^docs\//, "");
    return {
      kind: "doc",
      ref,
      title: r.heading ? `${short} › ${r.heading}` : short,
      testbenchId: r.testbenchId,
      path: r.path,
      heading: r.heading,
      markdown: doc.content,
      ...(r.heading ? { highlight: r.body } : {}),
    };
  }

  const run = getTestRun(db, r.testRunId)!;
  switch (r.kind) {
    case "pcap": {
      const first = (db.prepare("SELECT MIN(ts) AS t FROM packets WHERE test_run_id = ? AND capture = ?").get(run.id, r.capture) as { t: number }).t;
      const rows = (
        db
          .prepare("SELECT frame_no, ts, src, dst, proto, length, info FROM packets WHERE test_run_id = ? AND capture = ? AND frame_no BETWEEN ? AND ? ORDER BY frame_no")
          .all(run.id, r.capture, r.frame - PACKET_CONTEXT, r.frame + PACKET_CONTEXT) as { frame_no: number; ts: number; src: string; dst: string; proto: string; length: number; info: string }[]
      ).map((p): PacketRow => ({ no: p.frame_no, time: (p.ts - first).toFixed(6), src: p.src, dst: p.dst, proto: p.proto, length: p.length, info: p.info }));
      const file = capturePath(deps.runtimeDir, run, r.capture);
      let detail: PacketTreeNode[] = [{ label: `Frame ${r.frame}: ${r.proto} ${r.src} → ${r.dst} · ${r.info}` }];
      if (file) {
        try {
          // -c N stops reading after frame N, so the tree costs at most one pass over N frames.
          const out = await tsharkLines(deps.tsharkPath, ["-r", file, "-V", "-c", String(r.frame), "-Y", `frame.number == ${r.frame}`], { maxLines: MAX_TREE_LINES });
          if (out.lines.length) detail = parsePacketTree(out.lines);
        } catch {
          // Keep the one-line summary; the packet list still renders.
        }
      }
      const art = run.artifacts.find((a) => a.name === r.capture);
      return {
        kind: "pcap",
        ref,
        title: `${r.capture}.pcapng · frame ${r.frame} · ${runLabel(run)}`,
        testRunId: run.id,
        capture: r.capture,
        frame: r.frame,
        rows,
        detail,
        filter: `frame.number == ${r.frame}`,
        downloadUrl: `/api/runs/${run.id}/artifacts/${encodeURIComponent(path.posix.basename(art?.path ?? `${r.capture}.pcapng`))}`,
      };
    }
    case "log": {
      const lines = db
        .prepare("SELECT line_no, raw, host FROM log_lines WHERE test_run_id = ? AND source = ? AND line_no BETWEEN ? AND ? ORDER BY line_no")
        .all(run.id, r.source, r.line - LOG_CONTEXT, r.line + LOG_CONTEXT) as { line_no: number; raw: string; host: string | null }[];
      const host = lines.find((l) => l.line_no === r.line)?.host ?? "";
      return {
        kind: "log",
        ref,
        title: `${r.source} · ${host} · ${runLabel(run)}`,
        testRunId: run.id,
        source: r.source,
        host,
        lines: lines.map((l) => ({ no: l.line_no, text: l.raw })),
        target: r.line,
      };
    }
    case "metric": {
      const series = metricSeries(db, run.id, r.name)!;
      const tb = getTestbenchConfig(db, run.testbenchId);
      const base = baselineRun(db, tb, run.testId, run.fw);
      const baseSeries = base ? metricSeries(db, base.id, r.name) : null;
      let note: string | undefined;
      if (r.name.startsWith("mem_")) {
        const killed = db.prepare("SELECT raw FROM log_lines WHERE test_run_id = ? AND raw LIKE '%Killed process%' LIMIT 1").get(run.id) as { raw: string } | undefined;
        const proc = killed && /Killed process \d+ \(([^)]+)\)/.exec(killed.raw)?.[1];
        if (proc) {
          const seg = trendPerLifetime(db, run.id, r.name, proc).find((s) => s.end === "oom-kill");
          if (seg)
            note = `Fitted up to the OOM kill of ${proc} (PID ${seg.pid}): ${mbPerHour(seg.slopePerHour)}. A whole-run fit gives ${mbPerHour(series.stats.slope_per_hour)} because ${proc} restarts.${baseSeries ? ` Baseline ${base!.id} (fw ${base!.fw}): ${mbPerHour(baseSeries.stats.slope_per_hour)}.` : ""}`;
        }
      }
      return {
        kind: "metric",
        ref,
        title: `${r.name} · ${runLabel(run)}`,
        testRunId: run.id,
        series,
        markerTs: r.ts,
        ...(baseSeries
          ? { baseline: { label: `${base!.id} · fw ${base!.fw}`, points: baseSeries.points.map((p) => ({ ts: p.ts - baseSeries.startTs + series.startTs, value: p.value })) } }
          : {}),
        ...(note ? { note } : {}),
      };
    }
    case "check":
      return { kind: "check", ref, title: `${run.testId} · ${r.check.title} · ${run.id}`, testRunId: run.id, testId: r.testId, check: r.check };
  }
}
