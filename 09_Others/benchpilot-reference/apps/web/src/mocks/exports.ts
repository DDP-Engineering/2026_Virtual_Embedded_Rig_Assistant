// Client-side stand-ins for GET /reports/:id/export?format=md|html|junit (the server generates them in P4b).
import type { ExportFormat, ReportDetail } from "@benchpilot/shared";
import type { Download } from "@/api/client";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function markdown(r: ReportDetail) {
  const lines = [
    `# ${r.id} · ${r.device} · fw ${r.fw}`,
    "",
    `Testbench ${r.testbenchId} · ${r.kind} · ${r.createdAt} · **${r.verdict.toUpperCase()}**`,
    "",
    `Tests ${r.summary.total} · passed ${r.summary.passed} · failed ${r.summary.failed}`,
    "",
    "| Test | Version | Verdict | Failing check |",
    "|---|---|---|---|",
    ...r.runs.map((run) => {
      const c = run.checks.find((x) => !x.pass);
      return `| ${run.testId} ${run.testName} | v${run.testVersion} | ${run.verdict.toUpperCase()} | ${c ? `${c.id}: ${c.measured} (expected ${c.expected})` : "—"} |`;
    }),
  ];
  if (r.analysis) {
    lines.push("", "## AI analysis", "", r.analysis.summaryMd);
    for (const c of r.analysis.clusters)
      lines.push("", `### ${c.title}`, `${c.category} · ${c.confidence} · ${c.tests.join(", ")}`, "", c.rootCause, "", `Evidence: ${c.evidence.join(", ")}`, "", `Next: ${c.recommendation}`);
  }
  return lines.join("\n") + "\n";
}

function html(r: ReportDetail) {
  const rows = r.runs
    .map((run) => {
      const c = run.checks.find((x) => !x.pass);
      return `<tr><td>${esc(run.testId)} ${esc(run.testName)}</td><td>v${run.testVersion}</td><td class="${run.verdict}">${run.verdict.toUpperCase()}</td><td>${c ? esc(`${c.measured} (expected ${c.expected})`) : "—"}</td></tr>`;
    })
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${r.id}</title>
<style>body{font:14px/1.5 system-ui,sans-serif;margin:32px;color:#142022}table{border-collapse:collapse;width:100%}td,th{border:1px solid #dce2e2;padding:6px 8px;text-align:left}.pass{color:#15803d}.fail{color:#b91c1c}@media print{body{margin:0}}</style>
</head><body><h1>${r.id} · ${esc(r.device)} · fw ${esc(r.fw)}</h1><p>${r.testbenchId} · ${r.kind} · ${r.createdAt} · <b class="${r.verdict}">${r.verdict.toUpperCase()}</b></p>
<table><thead><tr><th>Test</th><th>Version</th><th>Verdict</th><th>Failing check</th></tr></thead><tbody>${rows}</tbody></table>
${r.analysis ? `<h2>AI analysis</h2>${r.analysis.clusters.map((c) => `<h3>${esc(c.title)}</h3><p>${esc(c.category)} · ${esc(c.confidence)}</p><p>${esc(c.rootCause)}</p><p>Next: ${esc(c.recommendation)}</p>`).join("")}` : ""}
</body></html>`;
}

function junit(r: ReportDetail) {
  const cases = r.runs
    .map((run) => {
      const failed = run.checks.filter((c) => !c.pass);
      const body = failed.length
        ? `<failure message="${esc(failed.map((c) => `${c.id}: ${c.measured} (expected ${c.expected})`).join("; "))}"/>`
        : "";
      return `    <testcase classname="${r.testbenchId}.${run.testId}" name="${esc(run.testName)} v${run.testVersion}" time="${run.endedAt - run.startedAt}">${body}</testcase>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="${r.id}" tests="${r.summary.total}" failures="${r.summary.failed}">\n  <testsuite name="${r.id} fw ${r.fw}" tests="${r.summary.total}" failures="${r.summary.failed}">\n${cases}\n  </testsuite>\n</testsuites>\n`;
}

export function exportReport(r: ReportDetail, format: ExportFormat): Download {
  const [body, type, ext] =
    format === "md" ? [markdown(r), "text/markdown", "md"] : format === "html" ? [html(r), "text/html", "html"] : [junit(r), "application/xml", "junit.xml"];
  const url = URL.createObjectURL(new Blob([body], { type }));
  return { url, filename: `${r.id}.${ext}`, revoke: () => URL.revokeObjectURL(url) };
}
