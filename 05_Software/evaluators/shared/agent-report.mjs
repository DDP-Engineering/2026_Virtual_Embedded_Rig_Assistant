import { basename, dirname } from "node:path";
import { formatValue } from "./report-html.mjs";

const mean = (values) => {
  const numbers = values.filter((v) => typeof v === "number" && !Number.isNaN(v));
  return numbers.length ? numbers.reduce((a, b) => a + b, 0) / numbers.length : null;
};

/** Mean of a per-repeat metric over every repeat of every case; booleans count as 0 or 1. */
export function rate(cases, key) {
  return mean(
    cases.flatMap((c) =>
      c.repeats.map((r) => (typeof r.metrics[key] === "boolean" ? Number(r.metrics[key]) : r.metrics[key])),
    ),
  );
}

export const threshold = (name, value, op, limit, unit = "ratio") => ({
  name,
  value,
  op,
  limit,
  unit,
  pass: value !== null && (op === ">=" ? value >= limit : op === "<=" ? value <= limit : value === limit),
});

const compact = (value, limit = 400) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text && text.length > limit ? `${text.slice(0, limit)}…` : (text ?? "");
};

const show = (value, unit) => (typeof value === "number" ? formatValue(value, unit) : String(value));

function repeatBlocks(repeat, units) {
  const s = repeat.summary;
  const outcome = [
    ["Exit code", String(repeat.exitCode)],
    ["Stop reason", s.stopReason ?? "–"],
    ["Timed out", repeat.timedOut ? "yes" : "no"],
    ["First event", formatValue(repeat.timing.firstEventMs, "ms")],
    ["First token", formatValue(repeat.timing.firstTokenMs, "ms")],
    ["Total", formatValue(repeat.timing.totalMs, "ms")],
    ["Tokens in / out", `${s.usage.input} / ${s.usage.output}`],
    ...(repeat.invalidLines ? [["Invalid event lines", String(repeat.invalidLines)]] : []),
  ];
  return [
    { title: "Answer", text: s.answer },
    {
      title: "Metrics",
      table: {
        columns: ["Metric", "Value"],
        rows: Object.entries(repeat.metrics).map(([k, v]) => [k, show(v, units.get(k))]),
      },
    },
    {
      title: "Tool calls",
      list: s.tools.map((t) => `${t.name} ${compact(t.args)}${t.ok === false ? " — failed" : ""}`),
    },
    { title: "Citations", list: s.citations.map((c) => `${c.ref} — ${c.valid ? "valid" : "invalid"}`) },
    ...(s.approvals.length
      ? [
          {
            title: "Approvals",
            list: s.approvals.map((a) => `${a.tool} ${a.path ?? ""} — ${a.decision ?? "pending"}`),
          },
        ]
      : []),
    ...(s.errors.length ? [{ title: "Errors", list: s.errors.map((e) => `${e.code} ${e.messageKey}`) }] : []),
    { title: "Outcome", table: { columns: ["Field", "Value"], rows: outcome } },
    // Relative to the run folder, where report.html is written.
    { title: "Events", link: { label: repeat.eventsPath, href: repeat.eventsPath } },
  ];
}

/** Report model of an agent family run (see report-html.mjs). */
export function agentReportModel(run, spec = {}, runPath = "run.json") {
  const folder = dirname(runPath);
  const keys = [...new Set(run.cases.flatMap((c) => c.repeats.flatMap((r) => Object.keys(r.metrics))))];
  const id = run.identity;
  const units = new Map(run.aggregate.metrics.map((m) => [m.key, m.unit]));
  return {
    title: spec.title ?? `Evaluation: ${run.family}`,
    status: run.status,
    source: `${basename(folder)}/${basename(runPath)}`,
    identity: [
      ["Family", id.family],
      ["Model", `${id.provider}/${id.model}`],
      ["Provider origin", id.providerOrigin],
      ["Reasoning", id.reasoning],
      ["Approvals", id.approve],
      ["Repeats", String(id.repeats)],
      ["Cases", `${run.cases.length} from ${id.cases}`],
      ["Cases SHA-256", id.casesSha256],
      ["Harness hash", id.harnessHash],
      ["Commit", `${id.commit ?? "unknown"}${id.dirty ? " (dirty)" : ""}`],
      ["Platform", `${id.platform}, Node ${id.node}`],
      ["Started", run.startedAt],
      ["Duration", formatValue(run.durationMs, "ms")],
    ],
    compatibility: run.compatibility,
    thresholds: run.aggregate.thresholds,
    metrics: run.aggregate.metrics,
    tables: spec.tables?.(run) ?? [],
    caseColumns: ["Language", "Passed", ...keys],
    cases: run.cases.map((c) => ({
      id: c.id,
      status: c.pass ? "passed" : "failed",
      values: [
        c.language,
        `${c.repeats.filter((r) => r.pass).length}/${c.repeats.length}`,
        ...keys.map((key) => {
          const values = c.repeats.map((r) => r.metrics[key]);
          if (values.every((v) => typeof v === "boolean"))
            return `${values.filter(Boolean).length}/${values.length}`;
          return formatValue(mean(values), units.get(key));
        }),
      ],
      blocks: [
        { title: "Prompt", text: c.prompt },
        { title: "Expected", json: c.expect },
        ...c.repeats.map((r) => ({
          details: `Repeat ${r.repeat}: ${r.pass ? "passed" : "failed"}`,
          blocks: repeatBlocks(r, units),
        })),
      ],
    })),
  };
}
