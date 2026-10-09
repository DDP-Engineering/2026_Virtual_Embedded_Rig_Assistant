// AI analysis on reports (reports.analysis_md + findings_json, 01) and ticket drafts (P3 table).
import type { Cluster, ReportAnalysis, TicketDraft, TicketSeverity } from "@benchpilot/shared";
import type { Db } from "../index.ts";
import { nextId } from "./counters.ts";

export function saveAnalysis(db: Db, reportId: string, a: ReportAnalysis): void {
  db.prepare("UPDATE reports SET analysis_md = ?, findings_json = ? WHERE id = ?").run(
    a.summaryMd,
    JSON.stringify({ clusters: a.clusters, skill: a.skill ?? null, savedAt: a.savedAt }),
    reportId,
  );
}

export function getAnalysis(db: Db, reportId: string): ReportAnalysis | null {
  const r = db.prepare("SELECT analysis_md, findings_json FROM reports WHERE id = ?").get(reportId) as
    | { analysis_md: string | null; findings_json: string | null }
    | undefined;
  if (!r?.findings_json) return null;
  const f = JSON.parse(r.findings_json) as { clusters: Cluster[]; skill: string | null; savedAt: string };
  return { summaryMd: r.analysis_md ?? "", clusters: f.clusters, ...(f.skill ? { skill: f.skill } : {}), savedAt: f.savedAt };
}

export function hasAnalysis(db: Db, reportId: string): boolean {
  const r = db.prepare("SELECT findings_json FROM reports WHERE id = ?").get(reportId) as { findings_json: string | null } | undefined;
  return Boolean(r?.findings_json);
}

interface TicketRow {
  id: string;
  report_id: string;
  cluster_title: string;
  title: string;
  body_md: string;
  component: string;
  severity: TicketSeverity;
  created_at: string;
}

const toTicket = (r: TicketRow): TicketDraft => ({
  id: r.id,
  reportId: r.report_id,
  clusterTitle: r.cluster_title,
  title: r.title,
  bodyMd: r.body_md,
  component: r.component,
  severity: r.severity,
  createdAt: r.created_at,
});

export function addTicket(
  db: Db,
  t: Omit<TicketDraft, "id" | "createdAt"> & { sessionId: string | null },
  now = new Date(),
): TicketDraft {
  const id = nextId(db, "DRAFT");
  db.prepare(
    "INSERT INTO ticket_drafts(id, report_id, session_id, cluster_title, title, body_md, component, severity, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(id, t.reportId, t.sessionId, t.clusterTitle, t.title, t.bodyMd, t.component, t.severity, now.toISOString());
  return toTicket(db.prepare("SELECT * FROM ticket_drafts WHERE id = ?").get(id) as TicketRow);
}

export function listTickets(db: Db, reportId: string): TicketDraft[] {
  return (db.prepare("SELECT * FROM ticket_drafts WHERE report_id = ? ORDER BY id").all(reportId) as TicketRow[]).map(toTicket);
}
