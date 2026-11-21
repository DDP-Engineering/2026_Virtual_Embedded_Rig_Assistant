import { access, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { threshold } from "../shared/agent-report.mjs";
import { parseEventLines } from "../shared/events.mjs";
import { familyMain, runAsScript } from "../shared/family-cli.mjs";
import { software } from "../shared/identity.mjs";
import { formatValue, renderReport } from "../shared/report-html.mjs";
import { languageOf, matchesAll } from "../shared/text.mjs";

const folder = fileURLToPath(new URL(".", import.meta.url));

const pattern = z
  .string()
  .min(1)
  .refine((value) => {
    try {
      new RegExp(value, "i");
      return true;
    } catch {
      return false;
    }
  }, "must be a valid regular expression");
const expect = z.strictObject({
  tools: z.array(z.string().min(1)).default([]),
  anyTools: z.array(z.string().min(1)).default([]),
  minCalls: z.record(z.string(), z.number().int().min(1)).default({}),
  answer: z.array(pattern).default([]),
  cite: z.boolean().default(false),
  language: z.enum(["en", "ro"]).optional(),
  proposal: z.array(z.string().min(1)).default([]),
  minOutputTokens: z.number().int().positive().optional(),
});

const REJECTED = /Invalid arguments for|invalid_arguments/;
const UNKNOWN = /is unavailable\. Choose an enabled tool|tool_disabled/;

/** Provider-reported input tokens of the first model call over VERA's estimate just before it. */
function estimateRatio(lines) {
  let estimate = null;
  for (const { event } of lines) {
    if (event.type !== "usage.updated") continue;
    if (event.inputTokens > 0 && estimate) return event.inputTokens / estimate;
    if (event.estimated && event.contextTokens) estimate = event.contextTokens;
  }
  return null;
}

function score(item, summary, outcome) {
  const e = item.expect;
  const { lines } = parseEventLines(outcome.stdout);
  const done = lines.filter(({ event }) => event.type === "tool.done").map(({ event }) => event);
  const rejected = done.filter((d) => !d.ok && REJECTED.test(d.summary)).length;
  const unknown = done.filter((d) => !d.ok && UNKNOWN.test(d.summary)).length;
  const okCalls = (name) => summary.tools.filter((t) => t.name === name && t.ok).length;
  const completed = outcome.exitCode === 0 && !outcome.timedOut && summary.stopReason === "end";
  const toolsOk =
    e.tools.every((name) => okCalls(name) > 0) &&
    (!e.anyTools.length || e.anyTools.some((name) => okCalls(name) > 0)) &&
    Object.entries(e.minCalls).every(([name, count]) => okCalls(name) >= count);
  const answerOk = matchesAll(summary.answer, e.answer);
  const citeOk = !e.cite || summary.citations.some((c) => c.valid);
  const languageOk = !e.language || languageOf(summary.answer) === e.language;
  const proposalOk = !e.proposal.length || summary.approvals.some((a) => e.proposal.includes(a.tool));
  const longOk = !e.minOutputTokens || summary.usage.output >= e.minOutputTokens;
  const seconds = outcome.timing.totalMs / 1000;
  return {
    metrics: {
      completed,
      taskOk: completed && toolsOk && answerOk && citeOk && languageOk && proposalOk && longOk,
      toolCalls: summary.tools.length,
      rejectedArgs: rejected,
      unknownTools: unknown,
      citations: summary.citations.length,
      validCitations: summary.citations.filter((c) => c.valid).length,
      stoppedAtLimit: summary.stopReason === "limit",
      stoppedOnError: summary.stopReason === "error" || summary.errors.length > 0,
      timedOut: outcome.timedOut,
      firstTokenMs: outcome.timing.firstTokenMs,
      totalMs: outcome.timing.totalMs,
      outputTokens: summary.usage.output,
      outputPerSecond: seconds > 0 ? summary.usage.output / seconds : null,
      estimateRatio: estimateRatio(lines),
    },
    notes: {
      toolsOk,
      answerOk,
      citeOk,
      languageOk,
      proposalOk,
      longOk,
    },
    pass: completed && toolsOk && answerOk && citeOk && languageOk && proposalOk && longOk,
  };
}

const repeatsOf = (cases) => cases.flatMap((c) => c.repeats);
const sum = (repeats, key) => repeats.reduce((total, r) => total + Number(r.metrics[key] ?? 0), 0);
function mean(repeats, key) {
  const values = repeats
    .map((r) => r.metrics[key])
    .filter((v) => typeof v === "number" || typeof v === "boolean");
  return values.length ? values.reduce((total, v) => total + Number(v), 0) / values.length : null;
}

/** The documented verdict rules (README.md). */
export function verdict(m) {
  if (m.completed < 0.7 || m.taskOk < 0.5 || m.rejectedRate > 0.2 || m.timedOut > 0.1) return "unsuitable";
  if (m.completed >= 0.95 && m.taskOk >= 0.8 && m.rejectedRate <= 0.05 && (m.citationValidity ?? 1) >= 0.8)
    return "recommended";
  return "degraded";
}

function figures(cases) {
  const all = repeatsOf(cases);
  const calls = sum(all, "toolCalls");
  const citations = sum(all, "citations");
  return {
    completed: mean(all, "completed"),
    taskOk: mean(all, "taskOk"),
    rejectedRate: calls ? sum(all, "rejectedArgs") / calls : 0,
    unknownTools: sum(all, "unknownTools"),
    citationValidity: citations ? sum(all, "validCitations") / citations : null,
    stoppedAtLimit: mean(all, "stoppedAtLimit"),
    timedOut: mean(all, "timedOut"),
    firstTokenMs: mean(all, "firstTokenMs"),
    totalMs: mean(all, "totalMs"),
    outputPerSecond: mean(all, "outputPerSecond"),
    estimateRatio: mean(all, "estimateRatio"),
  };
}

function aggregate(cases) {
  const f = figures(cases);
  const r = (key, label, better = "higher") => ({ key, label, value: f[key], unit: "ratio", better });
  return {
    metrics: [
      r("completed", "Turns completed"),
      r("taskOk", "Tasks done as expected"),
      r("rejectedRate", "Tool calls rejected for invalid arguments", "lower"),
      {
        key: "unknownTools",
        label: "Calls to unknown or disabled tools",
        value: f.unknownTools,
        better: "lower",
      },
      r("citationValidity", "Valid citations"),
      r("stoppedAtLimit", "Turns stopped at a limit", "lower"),
      r("timedOut", "Turns timed out", "lower"),
      {
        key: "firstTokenMs",
        label: "Mean time to first token",
        value: f.firstTokenMs,
        unit: "ms",
        better: "lower",
      },
      { key: "totalMs", label: "Mean time per turn", value: f.totalMs, unit: "ms", better: "lower" },
      {
        key: "outputPerSecond",
        label: "Output tokens per second of turn time",
        value: f.outputPerSecond,
        better: "higher",
      },
      {
        key: "estimateRatio",
        label: "Reported / estimated input tokens (first call)",
        value: f.estimateRatio,
      },
      { key: "verdict", label: "Verdict", value: verdict(f) },
    ],
    // Passing every threshold is the "recommended" verdict.
    thresholds: [
      threshold("Turns completed", f.completed, ">=", 0.95),
      threshold("Tasks done as expected", f.taskOk, ">=", 0.8),
      threshold("Tool calls rejected for invalid arguments", f.rejectedRate, "<=", 0.05),
      threshold("Valid citations", f.citationValidity ?? 1, ">=", 0.8),
    ],
  };
}

/** `matrix --inputs a.json,b.json [--output x.html]`: one row per model run, with its verdict. */
async function matrix(values) {
  if (!values.inputs) throw Error("--inputs <run.json,run.json,...> is required");
  const paths = values.inputs
    .split(",")
    .filter(Boolean)
    .map((p) => resolve(p));
  const runs = await Promise.all(paths.map(async (p) => JSON.parse(await readFile(p, "utf8"))));
  const families = new Set(
    runs.map((r) => `${r.family}:${r.compatibility?.casesSha256}:${r.compatibility?.harnessHash}`),
  );
  const rows = runs.map((run) => {
    const f = figures(run.cases);
    const s = run.identity.server;
    return [
      `${run.identity.model}`,
      [s?.quantization, s?.loadedContextLength && `ctx ${s.loadedContextLength}`]
        .filter(Boolean)
        .join(", ") || "–",
      run.identity.reasoning,
      {
        html: `<span class="badge ${verdict(f) === "recommended" ? "passed" : verdict(f) === "degraded" ? "measured" : "failed"}">${verdict(f)}</span>`,
      },
      formatValue(f.completed, "ratio"),
      formatValue(f.taskOk, "ratio"),
      formatValue(f.rejectedRate, "ratio"),
      String(f.unknownTools),
      formatValue(f.citationValidity, "ratio"),
      formatValue(f.firstTokenMs, "ms"),
      formatValue(f.totalMs, "ms"),
      formatValue(f.outputPerSecond),
      formatValue(f.estimateRatio),
    ];
  });
  const failing = runs.flatMap((run) =>
    run.cases
      .filter((c) => !c.pass)
      .map((c) => [
        run.identity.model,
        c.id,
        `${c.repeats.filter((r) => !r.pass).length}/${c.repeats.length}`,
        Object.entries(c.repeats.find((r) => !r.pass)?.notes ?? {})
          .filter(([, ok]) => ok === false)
          .map(([k]) => k)
          .join(", "),
      ]),
  );
  const model = {
    title: "Model compatibility matrix",
    status: families.size === 1 ? "measured" : "invalid",
    source: paths.map((p) => `${basename(dirname(p))}/${basename(p)}`).join(", "),
    identity: [
      ["Runs", String(runs.length)],
      [
        "Suite",
        families.size === 1 ? "same cases and harness in every run" : "runs use different cases or harnesses",
      ],
    ],
    compatibility: {},
    thresholds: [],
    metrics: [],
    tables: [
      {
        title: "Models",
        columns: [
          "Model",
          "Server",
          "Reasoning",
          "Verdict",
          "Completed",
          "Tasks",
          "Rejected args",
          "Unknown tools",
          "Valid citations",
          "First token",
          "Turn time",
          "Tokens/s",
          "Estimate ratio",
        ],
        rows,
      },
      {
        title: "Failing cases",
        columns: ["Model", "Case", "Failed repeats", "Failed checks (first failure)"],
        rows: failing.length ? failing : [["none", "", "", ""]],
      },
    ],
    cases: [],
  };
  const target = resolve(values.output ?? join(software, "evaluation-outputs/models/matrix.html"));
  try {
    await access(target);
    throw Error(`Output already exists: ${target}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await writeFile(target, renderReport(model), { flag: "wx" });
  process.stderr.write(`${target}\n`);
  return families.size === 1 ? 0 : 2;
}

export const spec = {
  family: "models",
  title: "Model compatibility: VERA's agent loop on one model",
  folder,
  casesFile: join(folder, "cases/suite.yaml"),
  expect,
  score,
  aggregate,
  commands: { matrix },
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await runAsScript((argv) => familyMain(spec, argv));
