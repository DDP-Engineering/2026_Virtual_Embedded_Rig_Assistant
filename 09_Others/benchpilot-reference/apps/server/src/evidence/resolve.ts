// Resolves an evidence ref (01) to the DB row it points at. Used by tests now, by citations.ts and
// GET /api/evidence in P3. A ref is valid only if this returns non-null.
import { markdownSection, parseEvidenceRef, type CheckResult } from "@benchpilot/shared";
import type { Db } from "../db/index.ts";
import { getDoc } from "../db/repos/testbenches.ts";

/** Metric refs carry epoch seconds as text; matching tolerates float formatting (µs). */
const TS_EPS = 1e-6;

export type ResolvedEvidence =
  | { kind: "pcap"; testRunId: string; capture: string; frame: number; ts: number; src: string; dst: string; proto: string; info: string }
  | { kind: "log"; testRunId: string; source: string; line: number; ts: number; raw: string }
  | { kind: "metric"; testRunId: string; name: string; ts: number; value: number; unit: string }
  | { kind: "check"; testRunId: string; testId: string; check: CheckResult }
  | { kind: "doc"; testbenchId: string; path: string; heading: string | null; body: string };

export function resolveEvidence(db: Db, input: string): ResolvedEvidence | null {
  const ev = parseEvidenceRef(input);
  if (!ev) return null;
  switch (ev.kind) {
    case "pcap": {
      const r = db
        .prepare("SELECT ts, src, dst, proto, info FROM packets WHERE test_run_id = ? AND capture = ? AND frame_no = ?")
        .get(ev.testRunId, ev.capture, ev.frame) as { ts: number; src: string; dst: string; proto: string; info: string } | undefined;
      return r ? { kind: "pcap", testRunId: ev.testRunId, capture: ev.capture, frame: ev.frame, ...r } : null;
    }
    case "log": {
      const r = db
        .prepare("SELECT ts, raw FROM log_lines WHERE test_run_id = ? AND source = ? AND line_no = ?")
        .get(ev.testRunId, ev.source, ev.line) as { ts: number; raw: string } | undefined;
      return r ? { kind: "log", testRunId: ev.testRunId, source: ev.source, line: ev.line, ...r } : null;
    }
    case "metric": {
      const r = db
        .prepare("SELECT ts, value, unit FROM metrics WHERE test_run_id = ? AND name = ? AND ts BETWEEN ? AND ? ORDER BY abs(ts - ?) LIMIT 1")
        .get(ev.testRunId, ev.name, ev.ts - TS_EPS, ev.ts + TS_EPS, ev.ts) as { ts: number; value: number; unit: string } | undefined;
      return r ? { kind: "metric", testRunId: ev.testRunId, name: ev.name, ...r } : null;
    }
    case "check": {
      const r = db.prepare("SELECT test_id, checks_json FROM test_runs WHERE id = ?").get(ev.testRunId) as
        | { test_id: string; checks_json: string }
        | undefined;
      const check = r && (JSON.parse(r.checks_json) as CheckResult[]).find((c) => c.id === ev.checkId);
      return r && check ? { kind: "check", testRunId: ev.testRunId, testId: r.test_id, check } : null;
    }
    case "doc": {
      const doc = getDoc(db, ev.testbenchId, ev.path);
      if (!doc) return null;
      if (!ev.anchor) return { kind: "doc", testbenchId: ev.testbenchId, path: ev.path, heading: null, body: doc.content };
      const section = markdownSection(doc.content, ev.anchor);
      return section ? { kind: "doc", testbenchId: ev.testbenchId, path: ev.path, ...section } : null;
    }
  }
}
