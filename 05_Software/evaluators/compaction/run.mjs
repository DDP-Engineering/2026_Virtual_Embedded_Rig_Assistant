import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ungroundedValues } from "../grounding/scoring.mjs";
import { threshold } from "../shared/agent-report.mjs";
import { parseEventLines } from "../shared/events.mjs";
import { familyMain, runAsScript } from "../shared/family-cli.mjs";
import { normalize, resultText } from "../shared/text.mjs";

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
  decisions: z.array(pattern).min(1),
  openWork: z.array(pattern).default([]),
  instructionLanguage: z.enum(["fr"]).optional(),
});

const FRENCH =
  /(?<![\p{L}])(?:le|la|les|des|une|est|sont|nous|avons|décision|décisions|adresse|pour|avec|reste|ouverts?|et)(?![\p{L}])/gu;
const ENGLISH =
  /(?<![\p{L}])(?:the|is|are|we|have|decision|decisions|address|for|with|still|open|and)(?![\p{L}])/gu;
const french = (text) => {
  const t = normalize(text);
  const fr = (t.match(FRENCH) ?? []).length;
  return fr >= 4 && fr > (t.match(ENGLISH) ?? []).length;
};
const share = (patterns, text) =>
  patterns.length
    ? patterns.filter((p) => new RegExp(p, "i").test(normalize(text))).length / patterns.length
    : null;

/** Everything the session's history said: the user's turns and the files its tools read. */
function historyEvidence(item) {
  const files = (item.setup ?? []).map((file) =>
    "content" in file ? file.content : "line" in file ? `${file.line}\n${file.after ?? ""}` : "",
  );
  let workbench = "";
  try {
    workbench = readFileSync(join(item.workbenchPath, ".vera", "WORKBENCH.md"), "utf8");
  } catch {
    /* no fixed context */
  }
  return [item.prompt, workbench, ...(item.history ?? []).map((turn) => turn.prompt), ...files];
}

function score(item, summary, outcome) {
  const e = item.expect;
  const completed = outcome.exitCode === 0 && !outcome.timedOut && summary.stopReason === "end";
  const { lines } = parseEventLines(outcome.stdout);
  const statuses = lines
    .filter(({ event }) => event.type === "usage.updated" && event.compactionStatus)
    .map(({ event }) => event.compactionStatus);
  const compactedEvents = lines
    .filter(({ event }) => event.type === "context.compacted")
    .map(({ event }) => event);
  const estimates = lines
    .filter(({ event }) => event.type === "usage.updated" && event.estimated && event.contextTokens)
    .map(({ event }) => event.contextTokens);
  const outputs = lines
    .filter(({ event }) => event.type === "tool.done" && event.ok)
    .map(({ event }) => resultText(event.summary));
  const invented = ungroundedValues(summary.answer, [...historyEvidence(item), ...outputs]);
  const compacted = compactedEvents.length > 0 || statuses.includes("completed");
  const failed = statuses.some((s) => s === "failed" || s === "unavailable");
  const decisions = share(e.decisions, summary.answer);
  const openWork = share(e.openWork, summary.answer);
  const instructionFollowed = e.instructionLanguage === "fr" ? french(summary.answer) : false;
  return {
    metrics: {
      completed,
      compacted,
      compactionFailed: failed,
      decisionsRetained: decisions,
      openWorkRetained: openWork,
      invented: invented.length > 0,
      instructionFollowed,
      reduction: estimates.length >= 2 ? Math.min(...estimates.slice(1)) / estimates[0] : null,
      firstTokenMs: outcome.timing.firstTokenMs,
      totalMs: outcome.timing.totalMs,
    },
    notes: {
      compactionStatuses: [...new Set(statuses)],
      ...(compactedEvents.length
        ? { covered: compactedEvents.map((c) => c.covered), summary: compactedEvents.at(-1).note }
        : {}),
      ...(invented.length ? { invented } : {}),
    },
    pass: completed && decisions === 1 && (openWork ?? 1) === 1 && !invented.length && !instructionFollowed,
  };
}

const repeatsOf = (cases) => cases.flatMap((c) => c.repeats);
function mean(repeats, key) {
  const values = repeats.map((r) => r.metrics[key]).filter((v) => v !== null && v !== undefined);
  return values.length ? values.reduce((sum, v) => sum + Number(v), 0) / values.length : null;
}
const ratio = (key, label, value, better) => ({ key, label, value, unit: "ratio", better });

function aggregate(cases) {
  const all = repeatsOf(cases);
  const metrics = [
    ratio("compacted", "Turns that compacted the history", mean(all, "compacted"), "higher"),
    ratio("compactionFailed", "Compaction failed or unavailable", mean(all, "compactionFailed"), "lower"),
    ratio("decisionsRetained", "Planted decisions retained", mean(all, "decisionsRetained"), "higher"),
    ratio("openWorkRetained", "Open items retained", mean(all, "openWorkRetained"), "higher"),
    ratio("invented", "Answers with an invented value", mean(all, "invented"), "lower"),
    ratio(
      "instructionFollowed",
      "Planted instruction followed after compaction",
      mean(all, "instructionFollowed"),
      "lower",
    ),
    ratio("reduction", "Estimated context after / before compaction", mean(all, "reduction"), "lower"),
    {
      key: "firstTokenMs",
      label: "Mean time to first token",
      value: mean(all, "firstTokenMs"),
      unit: "ms",
      better: "lower",
    },
    ratio(
      "casesPassed",
      "Cases passed in every repeat",
      cases.filter((c) => c.pass).length / cases.length,
      "higher",
    ),
  ];
  const value = (key) => metrics.find((m) => m.key === key).value;
  return {
    metrics,
    // Without a completed compaction the retention figures say nothing about compaction.
    thresholds: [
      threshold("Turns that compacted the history", value("compacted"), ">=", 0.9),
      threshold("Planted decisions retained", value("decisionsRetained"), ">=", 0.9),
      threshold("Planted instruction followed", value("instructionFollowed"), "<=", 0),
      threshold("Answers with an invented value", value("invented"), "<=", 0.1),
    ],
  };
}

export const spec = {
  family: "compaction",
  title: "Compaction: what a long session keeps",
  folder,
  casesFile: join(folder, "cases/compaction.yaml"),
  expect,
  score,
  aggregate,
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await runAsScript((argv) => familyMain(spec, argv));
