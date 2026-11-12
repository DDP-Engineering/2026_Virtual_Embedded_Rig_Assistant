import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DocumentKnowledge, DocumentsRepository, EmbeddingHost, schemaSql } from "@vera/core";
import Database from "better-sqlite3";
import { loadCorpus } from "../retrieval-support/corpus.mjs";
import { summarize, validateFixture } from "../retrieval-support/evaluation.mjs";

export async function evaluate(software, scratch) {
  const workbench = join(software, "tests/fixtures/workbenches/demo-board");
  const corpus = await loadCorpus(workbench, pathToFileURL(join(scratch, "pdf-worker.mjs")));
  const fixture = validateFixture(
    await readFile(join(software, "tests/fixtures/retrieval/demo-board.yaml"), "utf8"),
    corpus.chunks,
  );
  const model = JSON.parse(await readFile(join(software, "src/models/model-manifest.json"), "utf8"));
  const host = new EmbeddingHost(
    pathToFileURL(join(scratch, "embedding-worker.mjs")),
    join(software, "src/models"),
    model,
  );
  const db = new Database(":memory:");
  try {
    db.pragma("foreign_keys=ON");
    db.exec(schemaSql);
    const repository = new DocumentsRepository(db),
      signal = new AbortController().signal;
    const vectors = await host.embed(
      workbench,
      corpus.chunks.map((c) => c.text),
      signal,
    );
    for (const source of corpus.sources) {
      const chunks = corpus.chunks.filter((c) => c.path === source.path);
      const doc = repository.save({
        ...source,
        kind: source.path.endsWith(".pdf") ? "pdf" : source.path.endsWith(".md") ? "markdown" : "text",
        mtime: "2026-10-12T00:00:00Z",
        pages: null,
        status: "indexed",
        error: null,
        indexedAt: null,
      });
      // Evaluation exercises current persistence/search; full extraction reads are covered by ingest/replay.
      repository.replaceChunks(
        doc.id,
        chunks.map(({ text, locator }) => ({ text, locator })),
        {
          modelId: host.modelId,
          vectors: chunks.map((c) => vectors[c.id - 1]),
          extraction: { kind: "text", lines: [] },
        },
      );
    }
    const knowledge = new DocumentKnowledge(workbench, db, host),
      metrics = {};
    const locatorKey = (row) => JSON.stringify([row.path, row.locator]);
    const byLocator = new Map(corpus.chunks.map((c) => [locatorKey(c), c.id]));
    if (byLocator.size !== corpus.chunks.length)
      throw Error("Demo corpus locators ceased to identify individual chunks; rebaseline explicitly.");
    for (const mode of ["keyword", "semantic", "hybrid"]) {
      const rankings = [];
      for (const question of fixture.questions) {
        const result = await knowledge.search({ query: question.query, k: 20, mode }, signal);
        rankings.push(
          result.results.map((r) => {
            const id = byLocator.get(locatorKey(r));
            if (!id) throw Error("Unknown product result locator");
            return id;
          }),
        );
      }
      metrics[mode] = summarize(fixture.questions, corpus.chunks, rankings);
    }
    const pass =
      metrics.hybrid.overall.recallAt5 >= 0.85 &&
      metrics.hybrid.en.recallAt5 >= 0.95 &&
      metrics.hybrid.ro.recallAt5 >= 0.75;
    return {
      schema: 1,
      pass,
      modelId: host.modelId,
      thresholds: { overall: 0.85, en: 0.95, ro: 0.75 },
      sources: corpus.sources,
      chunks: corpus.chunks,
      metrics,
    };
  } finally {
    await host.dispose();
    db.close();
  }
}
