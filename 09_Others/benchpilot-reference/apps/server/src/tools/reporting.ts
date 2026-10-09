// Reporting tools (04 §3): save_report_analysis and draft_ticket. The UI renders both from their tool args (01).
import type { Cluster } from "@benchpilot/shared";
import { z } from "zod";
import { addTicket, getAnalysis, saveAnalysis } from "../db/repos/analysis.ts";
import { getReport } from "../db/repos/runs.ts";
import { resolveEvidence } from "../evidence/resolve.ts";
import { defineTool, reportIdArg, type ToolContext } from "./registry.ts";

const ANALYSIS_SKILLS = ["failure-analyzer", "firmware-comparator", "report-presenter", "performance-analyst", "endurance-tester", "dhcp-ipv6-tester"];

const clusterSchema = z.object({
  title: z.string().min(1).max(160),
  category: z.enum(["product_bug", "environment", "test_issue", "security"]),
  confidence: z.enum(["high", "medium", "low"]),
  tests: z.array(z.string().max(40)).max(10),
  root_cause: z.string().min(1).max(1500),
  evidence: z.array(z.string().max(200)).max(10),
  recommendation: z.string().min(1).max(600),
});

export const saveReportAnalysis = defineTool({
  name: "save_report_analysis",
  group: "reporting",
  label: "Attach the AI analysis to a report.",
  description:
    "Attach (or replace) the AI analysis of a report: a markdown summary and failure clusters {title, category: product_bug|environment|test_issue|security, confidence, tests, root_cause, evidence: [ev refs], recommendation}. Evidence refs are validated; unresolvable ones are reported back. Does not change verdicts.",
  requiresApproval: false,
  schema: z.object({ report_id: reportIdArg, summary_md: z.string().min(1).max(4000), clusters: z.array(clusterSchema).min(1).max(8) }),
  async run({ report_id, summary_md, clusters }, ctx: ToolContext) {
    const report = getReport(ctx.db, report_id);
    if (!report || report.testbenchId !== ctx.testbench.id) return { error: `Report ${report_id} not found on ${ctx.testbench.id}.` };
    const invalid = [...new Set(clusters.flatMap((c) => c.evidence))].filter((ref) => !resolveEvidence(ctx.db, ref));
    const skill = [...ctx.loadedSkills()].reverse().find((s) => ANALYSIS_SKILLS.includes(s));
    const saved: Cluster[] = clusters.map((c) => ({
      title: c.title,
      category: c.category,
      confidence: c.confidence,
      tests: c.tests,
      rootCause: c.root_cause,
      evidence: c.evidence,
      recommendation: c.recommendation,
    }));
    const replaced = Boolean(getAnalysis(ctx.db, report_id));
    saveAnalysis(ctx.db, report_id, { summaryMd: summary_md, clusters: saved, ...(skill ? { skill } : {}), savedAt: new Date().toISOString() });
    return {
      saved: true,
      report_id,
      clusters: saved.length,
      ...(replaced ? { replaced_previous: true } : {}),
      ...(invalid.length ? { invalid_refs: invalid, note: "These refs do not resolve; they show as unverified. Use refs from tool results." } : {}),
    };
  },
  summarize: (r: { clusters: number; invalid_refs?: string[] }) => `saved · ${r.clusters} cluster${r.clusters === 1 ? "" : "s"}${r.invalid_refs ? ` · ${r.invalid_refs.length} invalid ref(s)` : ""}`,
});

export const draftTicket = defineTool({
  name: "draft_ticket",
  group: "reporting",
  label: "Create a ticket draft. Nothing is sent.",
  description: "Store a ticket draft for a cluster of a report (for product bugs, or test issues to the test owner). It is only stored; nothing is sent anywhere.",
  requiresApproval: false,
  schema: z.object({
    report_id: reportIdArg,
    cluster_title: z.string().min(1).max(160),
    title: z.string().min(1).max(160),
    body_md: z.string().min(1).max(6000),
    component: z.string().min(1).max(60),
    severity: z.enum(["critical", "major", "minor"]),
  }),
  async run(a, ctx: ToolContext) {
    const report = getReport(ctx.db, a.report_id);
    if (!report || report.testbenchId !== ctx.testbench.id) return { error: `Report ${a.report_id} not found on ${ctx.testbench.id}.` };
    const t = addTicket(ctx.db, {
      reportId: a.report_id,
      sessionId: ctx.sessionId,
      clusterTitle: a.cluster_title,
      title: a.title,
      bodyMd: a.body_md,
      component: a.component,
      severity: a.severity,
    });
    return { draft_id: t.id, report_id: a.report_id, stored: true, sent: false, note: "Stored as a draft. Not sent anywhere." };
  },
  summarize: (r: { draft_id: string }) => `draft ${r.draft_id}`,
});
