import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { parse, stringify } from "yaml";
import { z } from "zod";
import { threshold } from "../shared/agent-report.mjs";
import { buildCli, runCli } from "../shared/agent-runner.mjs";
import { startEgressGuard } from "../shared/egress-guard.mjs";
import {
  defaultRunPath,
  gitState,
  harnessHash,
  reportPathFor,
  sha256,
  software,
} from "../shared/identity.mjs";
import { renderReport } from "../shared/report-html.mjs";
import { writeHardCorpus } from "./hard-corpus.mjs";

const folder = fileURLToPath(new URL(".", import.meta.url));
const CASES = join(folder, "cases/hard-layout.yaml");
const target = z.strictObject({ path: z.string().min(1), page: z.number().int().positive() });
const casesSchema = z.strictObject({
  schema: z.literal(1),
  questions: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        language: z.enum(["en", "ro"]),
        query: z.string().min(1),
        expected: target,
      }),
    )
    .min(1),
  strings: z.array(target.extend({ text: z.string().min(1) })),
  rows: z.array(z.strictObject({ path: z.string().min(1), cells: z.array(z.string().min(1)).min(2) })),
  needsOcr: z.array(z.string().min(1)),
});

const squash = (text) => String(text).replace(/\s+/g, " ").trim().toLowerCase();
const pageOf = (locator) => (locator?.type === "page" ? locator.page : null);

/**
 * `eval:retrieval layout [--model <id>]`: builds the hard-layout corpus, indexes and searches it with
 * the CLI (the product path), and checks extraction, table rows, OCR detection and recall@5.
 */
export async function runLayout(values) {
  const text = await readFile(CASES, "utf8");
  const cases = casesSchema.parse(parse(text));
  const output = resolve(values.output ?? defaultRunPath("retrieval", `layout-${values.model ?? "default"}`));
  try {
    await access(output);
    throw Error(`Output already exists: ${output}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const cli = values.cli ? resolve(values.cli) : buildCli();
  const parent = resolve(values.scratch ?? join(software, "node_modules/.cache/evaluators/retrieval"));
  await mkdir(parent, { recursive: true });
  const scratch = await mkdtemp(join(parent, "layout-"));
  const guard = await startEgressGuard();
  const env = { ...process.env, ...guard.env };
  const startedAt = new Date().toISOString();
  try {
    const workbench = join(scratch, "workbench");
    const data = join(scratch, "data");
    await writeHardCorpus(workbench);
    if (values.model) {
      const file = join(workbench, ".vera", "workbench.yaml");
      const config = parse(await readFile(file, "utf8"));
      config.embeddings = { model: values.model };
      await writeFile(file, stringify(config));
    }
    const indexed = await runCli(cli, ["index", "--workbench", workbench, "--data", data], {
      timeoutMs: 600_000,
      env,
    });
    if (indexed.exitCode !== 0) throw Error(`vera index failed: ${indexed.stderr.slice(-2000)}`);
    const documents = JSON.parse(indexed.stdout.trim().split("\n").at(-1)).documents;
    const db = new Database(join(workbench, ".vera", "vera.db"), { readonly: true });
    const chunks = db
      .prepare(
        "SELECT d.path AS path, c.locator_json AS locator, c.text AS text FROM chunks c JOIN documents d ON d.id = c.doc_id",
      )
      .all()
      .map((row) => ({ path: row.path, page: pageOf(JSON.parse(row.locator)), text: squash(row.text) }));
    const modelId = db.prepare("SELECT DISTINCT model_id FROM embeddings LIMIT 1").pluck().get() ?? null;
    db.close();
    const strings = cases.strings.map((s) => ({
      ...s,
      found: chunks.some((c) => c.path === s.path && c.page === s.page && c.text.includes(squash(s.text))),
    }));
    const rows = cases.rows.map((r) => ({
      ...r,
      together: chunks.some(
        (c) => c.path === r.path && r.cells.every((cell) => c.text.includes(squash(cell))),
      ),
    }));
    const status = new Map(documents.map((d) => [d.path, d.status]));
    const ocr = [
      ...new Set([
        ...cases.needsOcr,
        ...documents.filter((d) => d.status === "needs_ocr").map((d) => d.path),
      ]),
    ].map((path) => ({
      path,
      expected: cases.needsOcr.includes(path),
      reported: status.get(path) === "needs_ocr",
    }));
    const questions = [];
    for (const q of cases.questions) {
      const searched = await runCli(
        cli,
        [
          "search",
          "--workbench",
          workbench,
          "--data",
          data,
          "--query",
          q.query,
          "--k",
          "5",
          "--mode",
          "hybrid",
        ],
        { timeoutMs: 120_000, env },
      );
      const results =
        searched.exitCode === 0 ? JSON.parse(searched.stdout.trim().split("\n").at(-1)).results : [];
      const top5 = results.slice(0, 5).map((r) => ({ path: r.path, page: pageOf(r.locator) }));
      questions.push({
        ...q,
        top5,
        hit: top5.some((r) => r.path === q.expected.path && r.page === q.expected.page),
        error: searched.exitCode === 0 ? null : searched.stderr.slice(-500),
      });
    }
    const share = (items, key) => (items.length ? items.filter((i) => i[key]).length / items.length : null);
    const ocrCorrect = ocr.filter((o) => o.expected === o.reported).length / ocr.length;
    const recall = (language) =>
      share(language ? questions.filter((q) => q.language === language) : questions, "hit");
    const result = {
      kind: "vera-retrieval-layout",
      format: 1,
      identity: {
        harnessHash: await harnessHash([folder]),
        casesSha256: sha256(text),
        modelId,
        requestedModel: values.model ?? "default",
        ...gitState(),
        startedAt,
      },
      compatibility: { casesSha256: sha256(text), harnessHash: await harnessHash([folder]) },
      documents: documents.map((d) => ({ path: d.path, status: d.status, pages: d.pages })),
      strings,
      rows,
      ocr,
      questions,
      metrics: {
        stringsFound: share(strings, "found"),
        rowsTogether: share(rows, "together"),
        ocrCorrect,
        recallAt5: recall(),
        recallAt5En: recall("en"),
        recallAt5Ro: recall("ro"),
      },
    };
    result.thresholds = [
      threshold("Expected text extracted", result.metrics.stringsFound, ">=", 0.85),
      threshold("Scans reported as needing OCR", ocrCorrect, ">=", 1),
      threshold("Hybrid recall@5", result.metrics.recallAt5, ">=", 0.75),
    ];
    result.pass = result.thresholds.every((t) => t.pass);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
    await writeFile(reportPathFor(output), renderReport(toLayoutReportModel(result, output)), { flag: "wx" });
    process.stdout.write(`${JSON.stringify({ pass: result.pass, modelId, metrics: result.metrics })}\n`);
    return result.pass ? 0 : 1;
  } finally {
    await guard.close();
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

/** Report model (see shared/report-html.mjs) of a hard-layout run. */
export function toLayoutReportModel(result, path = "run.json") {
  const yes = (value) => (value ? "yes" : "no");
  const m = result.metrics;
  const ratio = (key, label) => ({ key, label, value: m[key], unit: "ratio", better: "higher" });
  return {
    title: "Retrieval: hard-layout corpus",
    status: result.pass ? "passed" : "failed",
    source: `${basename(dirname(path))}/${basename(path)}`,
    identity: [
      ["Embedding model", result.identity.modelId ?? "–"],
      ["Requested model", result.identity.requestedModel],
      ["Cases SHA-256", result.identity.casesSha256],
      ["Harness hash", result.identity.harnessHash],
      ["Commit", `${result.identity.commit ?? "unknown"}${result.identity.dirty ? " (dirty)" : ""}`],
      ["Started", result.identity.startedAt],
    ],
    compatibility: result.compatibility,
    thresholds: result.thresholds,
    metrics: [
      ratio("stringsFound", "Expected text extracted on its page"),
      ratio("rowsTogether", "Table rows kept in one chunk"),
      ratio("ocrCorrect", "OCR detection correct"),
      ratio("recallAt5", "Hybrid recall@5"),
      ratio("recallAt5En", "Hybrid recall@5, English"),
      ratio("recallAt5Ro", "Hybrid recall@5, Romanian"),
    ],
    tables: [
      {
        title: "Documents",
        columns: ["Document", "Status", "Pages"],
        rows: result.documents.map((d) => [d.path, d.status, String(d.pages ?? "–")]),
      },
      {
        title: "Extraction",
        columns: ["Document", "Page", "Text", "Found"],
        rows: result.strings.map((s) => [s.path, String(s.page), s.text, yes(s.found)]),
      },
      {
        title: "Table rows",
        columns: ["Document", "Cells", "In one chunk"],
        rows: result.rows.map((r) => [r.path, r.cells.join(" | "), yes(r.together)]),
      },
      {
        title: "OCR detection",
        columns: ["Document", "Expected needs_ocr", "Reported"],
        rows: result.ocr.map((o) => [o.path, yes(o.expected), yes(o.reported)]),
      },
    ],
    caseColumns: ["Language", "Expected", "Top 5"],
    cases: result.questions.map((q) => ({
      id: q.id,
      status: q.hit ? "passed" : "failed",
      values: [
        q.language,
        `${q.expected.path} p. ${q.expected.page}`,
        q.top5.map((r) => `${r.path} p. ${r.page}`).join("; "),
      ],
      blocks: [{ title: "Query", text: q.query }, ...(q.error ? [{ title: "Error", text: q.error }] : [])],
    })),
  };
}
