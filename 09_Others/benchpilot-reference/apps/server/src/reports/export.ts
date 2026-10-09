// GET /reports/:id/export?format=md|html|junit. Deterministic part from the runner's builders; the AI analysis
// and ticket drafts are appended, clearly labelled. HTML is self-contained and print-friendly (P2 open issue 12).
import type { ReportDetail, TestRun } from "@benchpilot/shared";
import type { Catalog } from "../catalog/load.ts";
import type { Db } from "../db/index.ts";
import { buildJunitXml, buildReportMarkdown } from "../runner/report.ts";
import { notableEvents } from "../runner/timeline.ts";

const iso = (ts: number) => new Date(ts * 1000).toISOString().replace(".000Z", "Z");
const CATEGORY: Record<string, string> = { product_bug: "Product bug", environment: "Environment", test_issue: "Test issue", security: "Security" };

function events(db: Db, runs: TestRun[]) {
  return runs.flatMap((r) => notableEvents(db, r.id)).filter((e) => e.severity !== "info" || /changed state|Link is/i.test(e.message));
}

const simDuration = (catalog: Catalog) => (r: TestRun) => catalog.get(r.testId)?.duration.sim_s ?? r.endedAt - r.startedAt;

export function exportMarkdown(db: Db, report: ReportDetail): string {
  const out = [buildReportMarkdown(report, report.runs, events(db, report.runs)).trimEnd()];
  if (report.analysis) {
    out.push("", `## AI analysis${report.analysis.skill ? ` · ${report.analysis.skill}` : ""}`, "", `_Saved ${report.analysis.savedAt}. Written by the agent; verdicts above come from the catalog checks._`, "", report.analysis.summaryMd.trim());
    for (const c of report.analysis.clusters)
      out.push(
        "",
        `### ${c.title}`,
        "",
        `${CATEGORY[c.category] ?? c.category} · confidence ${c.confidence} · tests ${c.tests.join(", ") || "—"}`,
        "",
        c.rootCause,
        "",
        `Evidence: ${c.evidence.map((e) => `\`${e}\``).join(" ") || "—"}`,
        "",
        `Recommendation: ${c.recommendation}`,
      );
  }
  if (report.tickets.length) {
    out.push("", "## Ticket drafts (not sent)");
    for (const t of report.tickets) out.push("", `### ${t.id} · ${t.title}`, "", `Component ${t.component} · severity ${t.severity} · cluster “${t.clusterTitle}”`, "", t.bodyMd.trim());
  }
  return out.join("\n") + "\n";
}

export const exportJunit = (catalog: Catalog, report: ReportDetail) => buildJunitXml(report, report.runs, simDuration(catalog));

const h = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Inline markdown subset for agent text: **bold**, `code`, line breaks. Everything is escaped first. */
const md = (s: string) =>
  h(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[\[(ev:[^\]]+)\]\]/g, '<code class="ev">$1</code>')
    .replace(/\n/g, "<br>");

export function exportHtml(report: ReportDetail): string {
  const s = report.summary;
  const verdict = (v: string) => `<span class="v ${v}">${v.toUpperCase()}</span>`;
  const rows = report.runs
    .map((r) => {
      const failing = r.checks.filter((c) => !c.pass).map((c) => `${h(c.id)}: ${h(c.measured)} (expected ${h(c.expected)})`);
      return `<tr><td>${h(r.id)}</td><td>${h(r.testId)} ${h(r.testName)}</td><td>v${r.testVersion}</td><td>${verdict(r.verdict)}</td><td>${failing.join("<br>") || "—"}</td></tr>`;
    })
    .join("");
  const checks = report.runs
    .map(
      (r) =>
        `<h3>${h(r.id)} · ${h(r.testId)} ${h(r.testName)} ${verdict(r.verdict)}</h3><p class="muted">${iso(r.startedAt)} → ${iso(r.endedAt)} (test time) · dataset ${h(r.datasetId)}</p>` +
        `<table><tr><th>Check</th><th>Result</th><th>Measured</th><th>Expected</th><th>Evidence</th></tr>${r.checks
          .map((c) => `<tr><td>${h(c.id)} — ${h(c.title)}</td><td>${c.pass ? "pass" : "<strong>fail</strong>"}</td><td>${h(c.measured)}</td><td>${h(c.expected)}</td><td>${c.evidence.map((e) => `<code>${h(e)}</code>`).join(" ") || "—"}</td></tr>`)
          .join("")}</table>`,
    )
    .join("");
  const analysis = report.analysis
    ? `<h2>AI analysis${report.analysis.skill ? ` · ${h(report.analysis.skill)}` : ""}</h2><p class="muted">Written by the agent; verdicts come from the catalog checks.</p><p>${md(report.analysis.summaryMd)}</p>` +
      report.analysis.clusters
        .map(
          (c) =>
            `<div class="card"><h3>${h(c.title)}</h3><p class="muted">${h(CATEGORY[c.category] ?? c.category)} · confidence ${h(c.confidence)} · ${h(c.tests.join(", "))}</p><p>${md(c.rootCause)}</p><p><strong>Evidence:</strong> ${c.evidence.map((e) => `<code>${h(e)}</code>`).join(" ")}</p><p><strong>Recommendation:</strong> ${md(c.recommendation)}</p></div>`,
        )
        .join("")
    : "";
  const tickets = report.tickets.length
    ? `<h2>Ticket drafts (not sent)</h2>${report.tickets.map((t) => `<div class="card"><h3>${h(t.id)} · ${h(t.title)}</h3><p class="muted">${h(t.component)} · ${h(t.severity)}</p><pre>${h(t.bodyMd)}</pre></div>`).join("")}`
    : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${h(report.id)} · ${h(report.device)} fw ${h(report.fw)}</title>
<style>
body{font:14px/1.5 system-ui,sans-serif;color:#1c2024;background:#fff;max-width:1100px;margin:24px auto;padding:0 16px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 8px;border-bottom:1px solid #e3e5e8;padding-bottom:4px}h3{font-size:15px;margin:16px 0 4px}
table{border-collapse:collapse;width:100%;margin:8px 0}th,td{border:1px solid #e3e5e8;padding:4px 8px;text-align:left;vertical-align:top}th{background:#f6f7f8}
code{font:12px ui-monospace,monospace;background:#f2f3f5;padding:1px 4px;border-radius:3px;word-break:break-all}pre{white-space:pre-wrap;font:12px ui-monospace,monospace}
.muted{color:#60646c}.v{font-weight:600;padding:0 6px;border-radius:3px}.v.pass{background:#e6f6eb;color:#1b6b37}.v.fail{background:#fdecec;color:#a4262c}.v.error{background:#fff4d6;color:#8a5a00}
.card{border:1px solid #e3e5e8;border-radius:6px;padding:8px 12px;margin:8px 0}@media print{body{margin:0}}
</style></head><body>
<h1>${h(report.id)} — ${h(report.device)} fw ${h(report.fw)} ${verdict(report.verdict)}</h1>
<p class="muted">${h(report.kind)} report · testbench ${h(report.testbenchId)} · plan ${h(report.planId ?? "—")} · created ${h(report.createdAt)} · simulated testbench data (PoC)</p>
<p><strong>${s.passed} passed, ${s.failed} failed, ${s.errored} error(s)</strong> of ${s.total} · simulated duration ${s.simDurationS} s</p>
<h2>Results</h2><table><tr><th>Test run</th><th>Test</th><th>Version</th><th>Verdict</th><th>Failing checks</th></tr>${rows}</table>
<h2>Checks</h2>${checks}${analysis}${tickets}
</body></html>
`;
}
