import { basename, dirname } from "node:path";
import { threshold } from "../shared/agent-report.mjs";

const MODES = ["keyword", "semantic", "hybrid"];
const GROUPS = ["overall", "en", "ro"];

/** Report model (see shared/report-html.mjs) of a saved retrieval run. */
export function toReportModel(result, path = "run.json") {
  const id = result.identity ?? {};
  const limits = result.thresholds ?? {};
  const hybrid = result.metrics.hybrid;
  const questions = new Map();
  for (const mode of MODES)
    for (const row of result.metrics[mode].questions) {
      const entry = questions.get(row.id) ?? { row, hits: {} };
      entry.hits[mode] = row;
      questions.set(row.id, entry);
    }
  const place = (top5) =>
    top5.map((hit, index) => `${index + 1}. ${hit.path} ${JSON.stringify(hit.locator)}`);
  return {
    title: "Retrieval: recall@5 on the demo questions",
    status: result.pass ? "passed" : "failed",
    source: `${basename(dirname(path))}/${basename(path)}`,
    identity: [
      ["Embedding model", result.modelId],
      ["Questions SHA-256", result.fixtureSha256 ?? "–"],
      ["Harness hash", id.harnessHash ?? "–"],
      ["Commit", `${id.commit ?? "unknown"}${id.dirty ? " (dirty)" : ""}`],
      ["Chunks", String(result.chunks?.length ?? "–")],
      ["Started", id.startedAt ?? "–"],
    ],
    // Two embedding models are comparable on the same questions and harness (EVAL-07).
    compatibility: { fixtureSha256: result.fixtureSha256 ?? null, harnessHash: id.harnessHash ?? null },
    thresholds: GROUPS.filter((group) => limits[group] !== undefined).map((group) =>
      threshold(`Hybrid recall@5, ${group}`, hybrid[group].recallAt5, ">=", limits[group]),
    ),
    metrics: MODES.flatMap((mode) =>
      GROUPS.map((group) => ({
        key: `${mode}/${group}/recallAt5`,
        label: `${mode} recall@5, ${group}`,
        value: result.metrics[mode][group].recallAt5,
        unit: "ratio",
        better: "higher",
      })),
    ),
    tables: [
      {
        title: "Recall@5 per mode",
        columns: ["Mode", ...GROUPS.map((g) => `${g} (hits/total)`)],
        rows: MODES.map((mode) => [
          mode,
          ...GROUPS.map((g) => `${result.metrics[mode][g].hits}/${result.metrics[mode][g].total}`),
        ]),
      },
    ],
    caseColumns: ["Language", "Expected", ...MODES],
    cases: [...questions.values()].map(({ row, hits }) => ({
      id: row.id,
      status: hits.hybrid?.hit ? "passed" : "failed",
      values: [
        row.language,
        `${row.expected.path}${row.expected.page ? ` p. ${row.expected.page}` : ""}`,
        ...MODES.map((mode) => (hits[mode]?.hit ? "hit" : "miss")),
      ],
      blocks: [
        { title: "Expected", json: row.expected },
        ...MODES.map((mode) => ({ title: `${mode}: top 5`, list: place(hits[mode]?.top5 ?? []) })),
      ],
    })),
  };
}
