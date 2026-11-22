/**
 * Renders a family's report model into one self-contained HTML page: inline CSS and SVG, no script,
 * no network access, light and dark theme. A family turns its run.json into this model:
 *
 *   { title, status, source, identity: [[label, value]], compatibility: {...},
 *     thresholds: [{ name, value, limit, op, unit, pass }],
 *     metrics: [{ key, label, value, unit, better: "higher" | "lower" }],
 *     tables: [{ title, columns, rows }],
 *     caseColumns: [label], cases: [{ id, status, values: [...], blocks: [block] }] }
 *
 * A block is { title, text } | { title, json } | { title, list } | { title, table: { columns, rows } }
 * | { title, link: { label, href } } with a relative href (an events file beside the run).
 */

export const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const stable = (value) =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );

export function formatValue(value, unit) {
  if (value === null || value === undefined || Number.isNaN(value)) return "–";
  if (typeof value !== "number") return String(value);
  if (unit === "ratio") return `${(value * 100).toFixed(1)} %`;
  if (unit === "ms")
    return value >= 10_000 ? `${(value / 1000).toFixed(2)} s` : `${value.toFixed(value >= 100 ? 0 : 1)} ms`;
  if (unit === "s") return `${value.toFixed(2)} s`;
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(3);
}

/** Compares two report models: deltas only when their compatibility identities match. */
export function compareModels(model, reference) {
  const compatible = stable(model.compatibility) === stable(reference.compatibility);
  const mine = new Map(model.identity);
  const theirs = new Map(reference.identity);
  const differences = [...new Set([...mine.keys(), ...theirs.keys()])]
    .filter((key) => String(mine.get(key) ?? "") !== String(theirs.get(key) ?? ""))
    .map((key) => [key, mine.get(key) ?? "–", theirs.get(key) ?? "–"]);
  const byKey = new Map(reference.metrics.map((m) => [m.key, m]));
  const deltas = compatible
    ? model.metrics
        .filter(
          (m) =>
            byKey.has(m.key) && typeof m.value === "number" && typeof byKey.get(m.key).value === "number",
        )
        .map((m) => {
          const ref = byKey.get(m.key);
          const delta = m.value - ref.value;
          const better = m.better === "lower" ? delta < 0 : m.better === "higher" ? delta > 0 : null;
          // A measurement may carry its noise band; a change within it is not a change.
          const tolerance = Math.max(m.tolerance ?? 0, ref.tolerance ?? 0);
          return {
            ...m,
            reference: ref.value,
            delta,
            verdict: Math.abs(delta) <= tolerance ? "same" : better ? "better" : "worse",
          };
        })
    : [];
  return { compatible, differences, deltas };
}

const bar = (value) => {
  const width = Math.max(0, Math.min(1, value)) * 100;
  return `<svg class="bar" viewBox="0 0 100 8" width="100" height="8" aria-hidden="true"><rect width="100" height="8" rx="2" class="bar-bg"/><rect width="${width.toFixed(1)}" height="8" rx="2" class="bar-fg"/></svg>`;
};

const statusBadge = (status) =>
  `<span class="badge ${escapeHtml(String(status).toLowerCase())}">${escapeHtml(status)}</span>`;

const table = (columns, rows, className = "") =>
  `<div class="scroll"><table class="${className}"><thead><tr>${columns.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${cell?.html ?? escapeHtml(cell)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table></div>`;

const html = (value) => ({ html: value });

function block(item) {
  const title = item.title ? `<h4>${escapeHtml(item.title)}</h4>` : "";
  if ("text" in item) return `${title}<pre class="text">${escapeHtml(item.text || "(empty)")}</pre>`;
  if ("json" in item)
    return `${title}<pre class="json">${escapeHtml(JSON.stringify(item.json, null, 2))}</pre>`;
  if ("list" in item)
    return `${title}${item.list.length ? `<ol>${item.list.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}</ol>` : '<p class="muted">none</p>'}`;
  if ("table" in item) return `${title}${table(item.table.columns, item.table.rows)}`;
  if ("link" in item) {
    const href = String(item.link.href);
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//"))
      throw Error(`External link in report: ${href}`);
    return `${title}<p><a href="${escapeHtml(href)}">${escapeHtml(item.link.label)}</a></p>`;
  }
  throw Error(`Unknown report block: ${Object.keys(item).join(",")}`);
}

const STYLE = `
:root{color-scheme:light dark;--bg:#f7f8f7;--panel:#fff;--text:#1d2420;--muted:#5d6b63;--line:#d9dfdb;
--pass:#1b7f4b;--fail:#b3261e;--warn:#8a5a00;--accent:#076e68;--bar-bg:#e3e8e5}
@media (prefers-color-scheme:dark){:root{--bg:#121614;--panel:#1a201d;--text:#e4ebe7;--muted:#9aa8a0;
--line:#2c3631;--pass:#5cc98d;--fail:#ff8a80;--warn:#f0c060;--accent:#5fc7bf;--bar-bg:#2c3631}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);
font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:1180px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:32px 0 8px}h3{font-size:15px;margin:20px 0 6px}
h4{font-size:13px;margin:14px 0 4px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
section{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:12px 16px;margin:12px 0}
.muted{color:var(--muted)}.scroll{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
th,td{text-align:left;padding:5px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-weight:600;color:var(--muted);font-size:12px}
.badge{display:inline-block;padding:1px 8px;border-radius:10px;font-size:12px;font-weight:600;border:1px solid currentColor}
.badge.passed,.badge.pass,.badge.better{color:var(--pass)}.badge.failed,.badge.fail,.badge.worse,.badge.invalid{color:var(--fail)}
.badge.measured,.badge.diagnostic,.badge.same{color:var(--muted)}
.banner{border-left:4px solid var(--warn);padding:8px 12px;background:var(--panel)}
pre{white-space:pre-wrap;word-break:break-word;background:var(--bg);border:1px solid var(--line);border-radius:6px;
padding:8px;margin:4px 0;font:12px/1.45 ui-monospace,Consolas,monospace;max-height:420px;overflow:auto}
details{border-top:1px solid var(--line);padding:6px 0}summary{cursor:pointer;font-weight:600}
a{color:var(--accent)}.bar{vertical-align:middle;margin-left:8px}.bar-bg{fill:var(--bar-bg)}.bar-fg{fill:var(--accent)}
`;

export function renderReport(model, reference) {
  const parts = [];
  parts.push(
    `<header><h1>${escapeHtml(model.title)} ${statusBadge(model.status)}</h1><p class="muted">${escapeHtml(model.source ?? "")}</p></header>`,
  );
  parts.push(`<section><h2>Run</h2>${table(["Field", "Value"], model.identity)}</section>`);
  if (reference) {
    const comparison = compareModels(model, reference);
    const rows = comparison.differences;
    parts.push(
      `<section><h2>Comparison with ${escapeHtml(reference.source ?? "reference")}</h2>${
        comparison.compatible
          ? ""
          : `<p class="banner">Incompatible runs: their harness, cases or environment differ, so no metric is compared.</p>`
      }${rows.length ? `<h3>Differences</h3>${table(["Field", "This run", "Reference"], rows)}` : '<p class="muted">Same run identity.</p>'}${
        comparison.deltas.length
          ? `<h3>Metrics</h3>${table(
              ["Metric", "This run", "Reference", "Change", ""],
              comparison.deltas.map((d) => [
                d.label,
                formatValue(d.value, d.unit),
                formatValue(d.reference, d.unit),
                `${d.delta > 0 ? "+" : ""}${formatValue(d.delta, d.unit)}`,
                html(statusBadge(d.verdict)),
              ]),
            )}`
          : ""
      }</section>`,
    );
  }
  if (model.thresholds?.length)
    parts.push(
      `<section><h2>Thresholds</h2>${table(
        ["Threshold", "Value", "Limit", "Result"],
        model.thresholds.map((t) => [
          t.name,
          formatValue(t.value, t.unit),
          `${t.op} ${formatValue(t.limit, t.unit)}`,
          html(statusBadge(t.pass ? "pass" : "fail")),
        ]),
      )}</section>`,
    );
  if (model.metrics?.length)
    parts.push(
      `<section><h2>Metrics</h2>${table(
        ["Metric", "Value"],
        model.metrics.map((m) => [
          m.label,
          html(
            `${escapeHtml(formatValue(m.value, m.unit))}${m.unit === "ratio" && typeof m.value === "number" ? bar(m.value) : ""}`,
          ),
        ]),
      )}</section>`,
    );
  for (const extra of model.tables ?? [])
    parts.push(`<section><h2>${escapeHtml(extra.title)}</h2>${table(extra.columns, extra.rows)}</section>`);
  if (model.cases?.length) {
    parts.push(
      `<section><h2>Cases</h2>${table(
        ["Case", "Status", ...(model.caseColumns ?? [])],
        model.cases.map((c) => [
          html(`<a href="#case-${escapeHtml(c.id)}">${escapeHtml(c.id)}</a>`),
          html(statusBadge(c.status)),
          ...(c.values ?? []),
        ]),
      )}</section>`,
    );
    for (const c of model.cases)
      parts.push(
        `<section id="case-${escapeHtml(c.id)}"><h3>${escapeHtml(c.id)} ${statusBadge(c.status)}</h3>${(
          c.blocks ?? []
        )
          .map((item) =>
            item.details
              ? `<details><summary>${escapeHtml(item.details)}</summary>${item.blocks.map(block).join("")}</details>`
              : block(item),
          )
          .join("")}</section>`,
      );
  }
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(model.title)}</title>
<style>${STYLE}</style>
</head>
<body><main>${parts.join("\n")}</main></body>
</html>
`;
}
