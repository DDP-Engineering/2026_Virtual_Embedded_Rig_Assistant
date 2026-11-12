// REQ-TEST-58d27601 REQ-TEST-c0e68f23 REQ-TEST-7cc7bf91
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

export const metrics = [
  "loadMs",
  "storageMs",
  "snapshotMs",
  "mainHandlerMs",
  "ipcMs",
  "presentationMs",
  "mainGapMs",
  "rendererGapMs",
  "payloadBytes",
];
export const budgetMetrics = ["loadMs", "mainGapMs", "rendererGapMs"];
export const scenarios = ["first", "warm", "cross"];
export const hash = (value) =>
  createHash("sha256")
    .update(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value))
    .digest("hex");
export const canonicalJson = (value) =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
export const contentHash = (value) => hash(canonicalJson(value));
const validNumber = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0;
export function stats(values, full = false) {
  if (!values.length || !values.every(validNumber)) throw Error("invalid samples");
  const sorted = [...values].sort((a, b) => a - b),
    n = sorted.length;
  return {
    count: n,
    median: (sorted[Math.floor((n - 1) / 2)] + sorted[Math.floor(n / 2)]) / 2,
    max: sorted[n - 1],
    ...(full ? { p95: sorted[Math.ceil(n * 0.95) - 1] } : {}),
  };
}
export function validateReport(report) {
  if (
    report?.format !== 1 ||
    !["quick", "full"].includes(report.mode) ||
    !report.identity ||
    !report.source ||
    !/^[a-f0-9]{64}$/.test(report.identity.fixtureHash ?? "") ||
    !/^[a-f0-9]{64}$/.test(report.identity.harnessHash ?? "")
  )
    throw Error("invalid report identity");
  const count = report.mode === "full" ? 30 : 5;
  if (
    !/^[a-f0-9-]{36}$/.test(report.runId ?? "") ||
    !/^[a-f0-9]{40}$/.test(report.source.commit ?? "") ||
    !/^[a-f0-9]{64}$/.test(report.source.candidateHash ?? "") ||
    !/^[a-f0-9]{64}$/.test(report.source.buildHash ?? "") ||
    typeof report.source.dirty !== "boolean"
  )
    throw Error("missing source provenance");
  const env = report.identity.environment;
  if (
    !env ||
    !/^[a-f0-9]{64}$/.test(env.host ?? "") ||
    !["win32", "linux"].includes(env.os) ||
    typeof env.release !== "string" ||
    typeof env.cpu !== "string" ||
    !validNumber(env.ramBytes) ||
    env.ramBytes === 0 ||
    !Number.isInteger(env.cores) ||
    env.cores < 1 ||
    !["electron", "chromium", "node"].every((key) => typeof env.runtime?.[key] === "string") ||
    typeof env.nodeRunner !== "string" ||
    report.identity.buildMode !== "compiled-test-session-performance" ||
    JSON.stringify(report.identity.viewport) !== "[1440,900]" ||
    report.identity.scale !== 1 ||
    hash(report.fixture) !== report.identity.fixtureHash
  )
    throw Error("incomplete environment or fixture identity");
  if (
    report.repetitions !== count ||
    !Array.isArray(report.cases) ||
    !report.cases.length ||
    new Set(report.cases).size !== report.cases.length ||
    !report.cases.every((key) => /^(small|medium|large|payload)\/(first|warm|cross)$/.test(key))
  )
    throw Error("invalid cases or repetitions");
  if (!Array.isArray(report.samples) || report.samples.length !== report.cases.length * count)
    throw Error("incomplete samples");
  for (const key of report.cases) {
    const samples = report.samples.filter((sample) => sample.case === key);
    if (
      samples.length !== count ||
      new Set(samples.map((s) => s.index)).size !== count ||
      samples.some((s) => !Number.isInteger(s.index) || s.index < 0 || s.index >= count)
    )
      throw Error("incomplete case");
    for (const sample of samples) validateSample(sample);
  }
  return report;
}
export function validateSample(sample) {
  if (
    sample.ok !== true ||
    !metrics.every((key) => validNumber(sample.metrics?.[key])) ||
    sample.metrics.payloadBytes < 1 ||
    sample.correct !== true ||
    sample.externalTraffic !== 0 ||
    sample.providerRequests !== 0
  )
    throw Error("failed or invalid sample");
  for (const phase of ["before", "after"])
    for (const process of ["main", "renderer"])
      if (
        !validNumber(sample.memory?.[phase]?.[process]?.rssBytes) ||
        sample.memory[phase][process].rssBytes === 0
      )
        throw Error("missing memory evidence");
}
export function summarize(report) {
  return Object.fromEntries(
    report.cases.map((key) => {
      const samples = report.samples.filter((s) => s.case === key);
      const good = samples.filter((s) => s.ok);
      return [
        key,
        {
          failed: samples.length - good.length,
          metrics: Object.fromEntries(
            metrics.map((metric) => [
              metric,
              good.length
                ? stats(
                    good.map((s) => s.metrics[metric]),
                    report.mode === "full",
                  )
                : null,
            ]),
          ),
        },
      ];
    }),
  );
}
function compatible(a, b) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw Error("incompatible environment, fixture or harness");
}
function checkBudgets(budgets, cases) {
  for (const key of cases)
    for (const metric of budgetMetrics) {
      if (!validNumber(budgets?.[key]?.[metric]) || budgets[key][metric] === 0)
        throw Error("missing positive absolute budget");
    }
}
export function calibrate(runs, budgets) {
  if (runs.length < 2) throw Error("two full reference runs required");
  if (new Set(runs.map((run) => run.runId)).size !== runs.length)
    throw Error("distinct reference executions required");
  for (const run of runs) {
    validateReport(run);
    if (run.mode !== "full") throw Error("full reference required");
    compatible(run.identity, runs[0].identity);
    compatible(run.cases, runs[0].cases);
    compatible(run.source, runs[0].source);
  }
  checkBudgets(budgets, runs[0].cases);
  const reference = {
    format: 1,
    kind: "session-performance-reference",
    identity: runs[0].identity,
    cases: runs[0].cases,
    budgets,
    runs,
    thresholds: {},
  };
  for (const key of reference.cases) {
    reference.thresholds[key] = {};
    for (const metric of metrics) {
      const values = runs.map((run) =>
        stats(
          run.samples.filter((s) => s.case === key).map((s) => s.metrics[metric]),
          true,
        ),
      );
      const combined = stats(
        runs.flatMap((r) => r.samples.filter((s) => s.case === key).map((s) => s.metrics[metric])),
        true,
      );
      const spread = Math.max(...values.map((s) => s.median)) - Math.min(...values.map((s) => s.median));
      const tails = Math.max(...values.map((s) => s.p95)) - Math.min(...values.map((s) => s.p95));
      reference.thresholds[key][metric] = {
        ...combined,
        relative: Math.max(0.1, (spread * 2) / Math.max(1, combined.median)),
        noise: Math.max(5, spread * 2, tails * 2),
      };
    }
  }
  reference.existingBudgetFailures = absoluteFailures(
    runs.flatMap((r) => r.samples),
    budgets,
  );
  return reference;
}
function absoluteFailures(samples, budgets) {
  const failures = [];
  for (const sample of samples)
    for (const metric of budgetMetrics) {
      if (sample.metrics[metric] > budgets[sample.case][metric])
        failures.push({
          case: sample.case,
          metric,
          actual: sample.metrics[metric],
          limit: budgets[sample.case][metric],
          kind: "budget",
        });
    }
  return failures;
}
export function compare(report, reference) {
  validateReport(report);
  if (
    reference?.format !== 1 ||
    reference.kind !== "session-performance-reference" ||
    !Array.isArray(reference.runs)
  )
    throw Error("invalid reference");
  // Recompute from original complete runs: edited summaries cannot bypass calibration.
  const verified = calibrate(reference.runs, reference.budgets);
  compatible(reference.identity, verified.identity);
  compatible(report.identity, verified.identity);
  if (report.cases.some((key) => !verified.cases.includes(key)))
    throw Error("reference does not cover selected cases");
  const summary = summarize(report),
    failures = absoluteFailures(report.samples, verified.budgets),
    differences = [];
  for (const key of report.cases)
    for (const metric of metrics)
      for (const percentile of report.mode === "full" ? ["median", "p95", "max"] : ["median", "max"]) {
        const baseline = verified.thresholds[key][metric],
          actual = summary[key].metrics[metric][percentile];
        const limit =
          baseline[percentile] + Math.max(baseline[percentile] * baseline.relative, baseline.noise);
        differences.push({
          case: key,
          metric,
          percentile,
          reference: baseline[percentile],
          actual,
          delta: actual - baseline[percentile],
          limit,
        });
        if (actual > limit)
          failures.push({ case: key, metric, percentile, actual, limit, kind: "regression" });
      }
  return { status: failures.length ? "failed" : "passed", failures, differences, summary };
}
export async function saveReport(path, report) {
  const summary = report.kind ? report.summary : summarize(report);
  await writeFile(path, `${JSON.stringify({ ...report, ...(summary ? { summary } : {}) }, null, 2)}\n`, {
    flag: "wx",
  });
  const lines = [
    "# Session performance",
    "",
    `Status: ${report.comparison?.status ?? report.status ?? (report.kind ? "calibrated reference" : "diagnostic")}.`,
    "",
    "| Case | Samples | Failed | Median ms | p95 ms | Max ms |",
    "|---|---:|---:|---:|---:|---:|",
  ];
  for (const [key, value] of Object.entries(summary ?? {}))
    lines.push(
      `| ${key} | ${value.metrics.loadMs?.count ?? 0} | ${value.failed} | ${value.metrics.loadMs?.median.toFixed(1) ?? "—"} | ${value.metrics.loadMs?.p95?.toFixed(1) ?? "—"} | ${value.metrics.loadMs?.max.toFixed(1) ?? "—"} |`,
    );
  if (report.existingBudgetFailures?.length)
    lines.push(
      "",
      `Existing budget failures: ${report.existingBudgetFailures.length}. Reference creation does not accept these delays.`,
    );
  const differences = report.comparison?.failures ?? report.failures ?? report.existingBudgetFailures ?? [];
  if (differences.length) {
    lines.push("", "| Case | Metric | Kind | Actual | Limit |", "|---|---|---|---:|---:|");
    for (const item of differences)
      lines.push(
        `| ${item.case} | ${item.metric}${item.percentile ? ` ${item.percentile}` : ""} | ${item.kind} | ${item.actual.toFixed(2)} | ${item.limit.toFixed(2)} |`,
      );
  }
  const compared = report.comparison?.differences ?? report.differences ?? [];
  if (compared.length) {
    lines.push(
      "",
      "| Case | Metric | Reference | Candidate | Delta | Limit |",
      "|---|---|---:|---:|---:|---:|",
    );
    for (const item of compared)
      lines.push(
        `| ${item.case} | ${item.metric} ${item.percentile} | ${item.reference.toFixed(2)} | ${item.actual.toFixed(2)} | ${item.delta.toFixed(2)} | ${item.limit.toFixed(2)} |`,
      );
  }
  await writeFile(`${path}.md`, `${lines.join("\n")}\n`, { flag: "wx" });
}
