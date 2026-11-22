import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { rate, threshold } from "../shared/agent-report.mjs";
import { citationValidity } from "../shared/events.mjs";
import { familyMain, runAsScript } from "../shared/family-cli.mjs";

const folder = fileURLToPath(new URL(".", import.meta.url));

const expect = z.strictObject({
  /** At least one of these tools runs successfully. */
  tools: z.array(z.string().min(1)).min(1),
  /** Case-insensitive regular expression the final answer matches. */
  answer: z
    .string()
    .min(1)
    .refine((pattern) => {
      try {
        new RegExp(pattern, "i");
        return true;
      } catch {
        return false;
      }
    }, "must be a valid regular expression"),
});

function score(item, summary, outcome) {
  const completed = outcome.exitCode === 0 && !outcome.timedOut && summary.stopReason === "end";
  const toolUsed = item.expect.tools.some((name) => summary.tools.some((t) => t.name === name && t.ok));
  const factFound = new RegExp(item.expect.answer, "i").test(summary.answer);
  const cited = summary.citations.some((c) => c.valid);
  return {
    metrics: {
      completed,
      toolUsed,
      factFound,
      cited,
      citationValidity: citationValidity(summary),
      totalMs: outcome.timing.totalMs,
    },
    pass: completed && toolUsed && factFound && cited,
  };
}

function aggregate(cases) {
  const completion = rate(cases, "completed");
  return {
    metrics: [
      { key: "completed", label: "Turns completed", value: completion, unit: "ratio", better: "higher" },
      {
        key: "toolUsed",
        label: "Expected tool used",
        value: rate(cases, "toolUsed"),
        unit: "ratio",
        better: "higher",
      },
      {
        key: "factFound",
        label: "Expected fact in the answer",
        value: rate(cases, "factFound"),
        unit: "ratio",
        better: "higher",
      },
      {
        key: "cited",
        label: "Answers with a valid citation",
        value: rate(cases, "cited"),
        unit: "ratio",
        better: "higher",
      },
      {
        key: "citationValidity",
        label: "Valid citations",
        value: rate(cases, "citationValidity"),
        unit: "ratio",
        better: "higher",
      },
      {
        key: "casesPassed",
        label: "Cases passed in every repeat",
        value: cases.filter((c) => c.pass).length / cases.length,
        unit: "ratio",
        better: "higher",
      },
      {
        key: "totalMs",
        label: "Mean time per turn",
        value: rate(cases, "totalMs"),
        unit: "ms",
        better: "lower",
      },
    ],
    // The smoke family checks the runner: every turn must complete. Answer quality is reported only.
    thresholds: [threshold("Turns completed", completion, ">=", 1)],
  };
}

export const spec = {
  family: "smoke",
  title: "Evaluation smoke: shared agent runner",
  folder,
  casesFile: join(folder, "cases/smoke.yaml"),
  expect,
  score,
  aggregate,
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await runAsScript((argv) => familyMain(spec, argv));
