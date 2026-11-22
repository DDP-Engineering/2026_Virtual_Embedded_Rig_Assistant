import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { threshold } from "../shared/agent-report.mjs";
import { citationValidity, parseEventLines } from "../shared/events.mjs";
import { familyMain, runAsScript } from "../shared/family-cli.mjs";
import { resultText } from "../shared/text.mjs";
import {
  abstains,
  englishQuery,
  languageOf,
  matchesAll,
  matchesAny,
  onTarget,
  ungroundedValues,
} from "./scoring.mjs";

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
const expect = z.discriminatedUnion("answerable", [
  z.strictObject({
    answerable: z.literal(true),
    values: z.array(pattern).min(1),
    targets: z
      .array(z.strictObject({ path: z.string().min(1), page: z.number().int().positive().optional() }))
      .min(1),
  }),
  z.strictObject({ answerable: z.literal(false), nearMiss: z.array(pattern).default([]) }),
]);

const WEB = new Set(["web_search", "web_read"]);
const context = new Map();
/** WORKBENCH.md is in the system prompt: a value from it counts as seen by the model. */
function workbenchContext(item) {
  if (!context.has(item.workbenchPath)) {
    let text = "";
    try {
      text = readFileSync(join(item.workbenchPath, ".vera", "WORKBENCH.md"), "utf8");
    } catch {
      /* no fixed context */
    }
    context.set(item.workbenchPath, text);
  }
  return context.get(item.workbenchPath);
}

function score(item, summary, outcome) {
  const completed = outcome.exitCode === 0 && !outcome.timedOut && summary.stopReason === "end";
  const outputs = parseEventLines(outcome.stdout)
    .lines.filter(({ event }) => event.type === "tool.done" && event.ok)
    .map(({ event }) => resultText(event.summary));
  const ungrounded = ungroundedValues(summary.answer, [item.prompt, workbenchContext(item), ...outputs]);
  const names = summary.tools.map((t) => t.name);
  const firstSearch = names.indexOf("search_docs");
  const firstWeb = names.findIndex((name) => WEB.has(name));
  const queries = summary.tools
    .filter((t) => t.name === "search_docs")
    .map((t) => String(t.args?.query ?? ""));
  const valid = summary.citations.filter((c) => c.valid);
  const common = {
    completed,
    cited: valid.length > 0,
    citationValidity: citationValidity(summary),
    searchedDocs: firstSearch >= 0,
    searchFirst: firstSearch >= 0 && (firstWeb < 0 || firstSearch < firstWeb),
    languageMatch: languageOf(summary.answer) === item.language,
    englishQuery: item.language === "ro" && queries.length ? queries.every(englishQuery) : null,
    grounded: ungrounded.length === 0,
    totalMs: outcome.timing.totalMs,
  };
  const notes = ungrounded.length ? { ungrounded } : undefined;
  if (item.expect.answerable) {
    const factCorrect = matchesAll(summary.answer, item.expect.values);
    const targeted = valid.some((c) => onTarget(c.ref, item.expect.targets));
    return {
      metrics: { ...common, factCorrect, onTarget: targeted },
      notes,
      pass: completed && factCorrect && targeted && common.grounded,
    };
  }
  const abstained = abstains(summary.answer);
  const fabricated = !common.grounded;
  return {
    metrics: { ...common, abstained, fabricated, nearMiss: matchesAny(summary.answer, item.expect.nearMiss) },
    notes,
    pass: completed && abstained && !fabricated,
  };
}

const repeatsOf = (cases, filter = () => true) => cases.filter(filter).flatMap((c) => c.repeats);
function share(repeats, key) {
  const values = repeats.map((r) => r.metrics[key]).filter((v) => v !== null && v !== undefined);
  if (!values.length) return null;
  return values.reduce((sum, v) => sum + Number(v), 0) / values.length;
}
const answerable = (c) => c.expect.answerable;
const unanswerable = (c) => !c.expect.answerable;
const ratio = (key, label, value, better = "higher") => ({ key, label, value, unit: "ratio", better });

function aggregate(cases) {
  const all = repeatsOf(cases);
  const known = repeatsOf(cases, answerable);
  const unknown = repeatsOf(cases, unanswerable);
  const metrics = [
    ratio("factCorrect", "Fact accuracy (answerable)", share(known, "factCorrect")),
    ratio("cited", "Answers with a valid citation (answerable)", share(known, "cited")),
    ratio("onTarget", "Citation on the expected page (answerable)", share(known, "onTarget")),
    ratio("citationValidity", "Valid citations (all answers)", share(all, "citationValidity")),
    ratio("searchFirst", "search_docs before any web tool", share(all, "searchFirst")),
    ratio("languageMatch", "Answer in the question's language", share(all, "languageMatch")),
    ratio("englishQuery", "English search for Romanian questions", share(all, "englishQuery")),
    ratio("grounded", "Answers whose values the model saw", share(all, "grounded")),
    ratio("abstained", "Abstention (unanswerable)", share(unknown, "abstained")),
    ratio("fabricated", "Fabrication rate (unanswerable)", share(unknown, "fabricated"), "lower"),
    ratio("casesPassed", "Cases passed in every repeat", cases.filter((c) => c.pass).length / cases.length),
    {
      key: "totalMs",
      label: "Mean time per turn",
      value: share(all, "totalMs"),
      unit: "ms",
      better: "lower",
    },
  ];
  const value = (key) => metrics.find((m) => m.key === key).value;
  return {
    metrics,
    // Proposed from the first two local runs (see README.md); revisit with every new reference model.
    thresholds: [
      threshold("Fact accuracy (answerable)", value("factCorrect"), ">=", 0.85),
      threshold("Citation on the expected page (answerable)", value("onTarget"), ">=", 0.6),
      threshold("Fabrication rate (unanswerable)", value("fabricated"), "<=", 0.1),
      threshold("Abstention (unanswerable)", value("abstained"), ">=", 0.8),
    ],
  };
}

function tables(run) {
  const known = repeatsOf(run.cases, answerable);
  const count = (correct, cited) =>
    String(known.filter((r) => r.metrics.factCorrect === correct && r.metrics.cited === cited).length);
  const byLanguage = (language) => {
    const own = repeatsOf(run.cases, (c) => c.language === language && answerable(c));
    const format = (v) => (v === null ? "–" : `${(v * 100).toFixed(1)} %`);
    return [
      language,
      String(own.length),
      format(share(own, "factCorrect")),
      format(share(own, "onTarget")),
      format(share(own, "languageMatch")),
    ];
  };
  const fabricated = run.cases.flatMap((c) =>
    c.repeats
      .filter((r) => r.notes?.ungrounded?.length)
      .map((r) => [
        c.id,
        String(r.repeat),
        c.expect.answerable ? "answerable" : "unanswerable",
        r.notes.ungrounded.join(", "),
      ]),
  );
  return [
    {
      title: "Accuracy and citation (answerable repeats)",
      columns: ["", "Valid citation", "No valid citation"],
      rows: [
        ["Correct", count(true, true), count(true, false)],
        ["Wrong", count(false, true), count(false, false)],
      ],
    },
    {
      title: "By language (answerable)",
      columns: ["Language", "Repeats", "Fact accuracy", "On target", "Language match"],
      rows: ["en", "ro"].map(byLanguage),
    },
    {
      title: "Values the model stated without having seen them",
      columns: ["Case", "Repeat", "Kind", "Values"],
      rows: fabricated.length ? fabricated : [["none", "", "", ""]],
    },
  ];
}

export const spec = {
  family: "grounding",
  title: "Grounding: document answers, citations and abstention",
  folder,
  casesFile: join(folder, "cases/demo-board.yaml"),
  expect,
  score,
  aggregate,
  tables,
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await runAsScript((argv) => familyMain(spec, argv));
