import { basename, dirname } from "node:path";
import { formatValue } from "../shared/report-html.mjs";

const SHOWN = ["loadMs", "firstScreenMs"];

/** Report model (see shared/report-html.mjs) of a saved session-loading measurement. */
export function toReportModel(report, path = "run.json") {
  const source = `${basename(dirname(path))}/${basename(path)}`;
  if (!Array.isArray(report.samples) || !report.summary)
    return {
      title: "Performance: loading of saved sessions",
      status: report.status ?? "invalid",
      source,
      identity: [["Kind", report.kind ?? "unknown"]],
      compatibility: report.identity ?? {},
      metrics: [],
      tables: [],
      cases: [
        { id: "document", status: report.status ?? "measured", values: [], blocks: [{ json: report }] },
      ],
    };
  const env = report.identity.environment ?? {};
  const summary = report.summary;
  const statKeys = report.mode === "full" ? ["median", "p95", "max"] : ["median", "max"];
  const metrics = report.cases.flatMap((key) =>
    SHOWN.filter((metric) => summary[key]?.metrics?.[metric]).map((metric) => ({
      key: `${key}/${metric}/median`,
      label: `${key} ${metric} median`,
      value: summary[key].metrics[metric].median,
      unit: "ms",
      better: "lower",
    })),
  );
  const comparison = report.comparison;
  return {
    title: "Performance: loading of saved sessions",
    status: comparison?.status ?? report.status,
    source,
    identity: [
      ["Run", report.runId],
      ["Mode", `${report.mode}, ${report.repetitions} samples per case`],
      ["Status", report.status],
      ["Commit", `${report.source?.commit ?? "unknown"}${report.source?.dirty ? " (dirty)" : ""}`],
      ["Build hash", report.source?.buildHash ?? "–"],
      ["Harness hash", report.identity.harnessHash],
      ["Fixture hash", report.identity.fixtureHash],
      ["Build mode", String(report.identity.buildMode ?? "–")],
      [
        "Host",
        [env.os, env.release, env.cpu, env.ramBytes && `${(env.ramBytes / 2 ** 30).toFixed(1)} GiB`]
          .filter(Boolean)
          .join(", ") || "–",
      ],
    ],
    // Measurements compare only on the same host, fixture, harness and build mode (as `compare`).
    compatibility: report.identity,
    thresholds: [],
    metrics,
    tables: comparison?.failures?.length
      ? [
          {
            title: "Comparison failures",
            columns: ["Failure"],
            rows: comparison.failures.map((failure) => [
              typeof failure === "string" ? failure : JSON.stringify(failure),
            ]),
          },
        ]
      : [],
    caseColumns: ["Samples", "Failed", ...SHOWN.map((m) => `${m} median`)],
    cases: report.cases.map((key) => {
      const entry = summary[key];
      const samples = report.samples.filter((s) => s.case === key);
      return {
        id: key.replace("/", "-"),
        status: entry.failed ? "failed" : "measured",
        values: [
          String(samples.length),
          String(entry.failed),
          ...SHOWN.map((m) => formatValue(entry.metrics[m]?.median ?? null, "ms")),
        ],
        blocks: [
          {
            title: `${key}: all metrics`,
            table: {
              columns: ["Metric", "Count", ...statKeys],
              rows: Object.entries(entry.metrics)
                .filter(([, stats]) => stats)
                .map(([metric, stats]) => [
                  metric,
                  String(stats.count),
                  ...statKeys.map((k) => formatValue(stats[k], metric.endsWith("Ms") ? "ms" : undefined)),
                ]),
            },
          },
        ],
      };
    }),
  };
}
