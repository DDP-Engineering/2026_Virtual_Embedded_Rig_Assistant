import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { ReplayGateway } from "../llm/replay.js";
import { SessionService } from "../sessions/service.js";
import { migrations } from "../storage/migrate.js";
import { DocumentsRepository } from "../storage/repos/documents.js";
import { createToolContext } from "../tools/context.js";
import { ToolRegistry } from "../tools/registry.js";
import type { EmbeddingPort } from "./embedding.js";
import { createDocumentProcessor } from "./processor.js";
import { DocumentKnowledge, fuseRanks } from "./search.js";

const software = fileURLToPath(new URL("../../../../", import.meta.url));
async function harness() {
  const root = await mkdtemp(join(tmpdir(), "vera-search-")),
    db = new Database(":memory:");
  db.pragma("foreign_keys=ON");
  for (const m of migrations) db.exec(m.sql);
  await mkdir(join(root, "docs"));
  await mkdir(join(root, ".vera"));
  const vectors = new Map<number, number>();
  const port: EmbeddingPort = {
    modelId: "fixture",
    embed: async (_r, texts) =>
      texts.map(() => {
        const v = new Float32Array(384);
        v[0] = 1;
        return v;
      }),
    rank: async (_r, _epoch, rows) =>
      (typeof rows === "function" ? rows() : (rows ?? []))
        .map((r) => ({ id: r.id, score: vectors.get(r.id) ?? 1 }))
        .sort((a, b) => b.score - a.score || a.id - b.id)
        .slice(0, 50),
    release: async () => {},
  };
  const rows = new DocumentsRepository(db),
    knowledge = new DocumentKnowledge(root, db, port),
    signal = new AbortController().signal;
  const add = async (path: string, text: string, pages?: string[]) => {
    await writeFile(join(root, path), text);
    const sha256 = createHash("sha256").update(text).digest("hex");
    const kind = pages ? "pdf" : path.endsWith(".md") ? "markdown" : path.endsWith(".html") ? "html" : "text";
    const result = await createDocumentProcessor(
      async () => ({ kind: "pdf", pages: pages ?? [] }),
      port,
    )({ root, path, kind, sha256, signal, assertWritable: () => {} });
    const doc = rows.save({
      path,
      kind,
      sha256,
      bytes: Buffer.byteLength(text),
      mtime: new Date().toISOString(),
      pages: pages?.length ?? null,
      status: "indexed",
      error: null,
      indexedAt: null,
    });
    rows.replaceChunks(doc.id, result.chunks ?? [], result.derived);
    return doc;
  };
  const close = async () => {
    db.close();
    await rm(root, { recursive: true, force: true });
  };
  return { root, db, port, vectors, rows, knowledge, signal, add, close };
}
it("pins one-based fusion ties/dedup, modes, pre-top50 glob filtering and bounded snippets", async () => {
  expect(
    fuseRanks([
      [2, 1, 1],
      [1, 2],
    ]),
  ).toEqual([
    { id: 1, score: 1 / 61 + 1 / 62 },
    { id: 2, score: 1 / 61 + 1 / 62 },
  ]);
  const h = await harness();
  try {
    expect(await h.knowledge.search({ query: "x" }, h.signal)).toMatchObject({
      results: [],
      message: expect.stringMatching(/grep/),
    });
    await h.add("docs/a.txt", "prefix ".repeat(90) + "I2C1_CR1 defining page");
    await h.add("docs/b.txt", "I2C1_CR1 unrelated peripheral");
    const hits = await h.knowledge.search({ query: "I2C1_CR1" }, h.signal);
    expect(hits.results).toHaveLength(2);
    expect(hits.results.every((r) => r.snippet.length <= 300 && Number.isFinite(r.score))).toBe(true);
    for (const mode of ["keyword", "semantic", "hybrid"] as const)
      expect(
        (await h.knowledge.search({ query: "I2C1_CR1", mode, pathGlob: "docs/b.*", k: 1 }, h.signal))
          .results[0]?.path,
      ).toBe("docs/b.txt");
    await expect(h.knowledge.search({ query: "x", k: 21 }, h.signal)).rejects.toThrow();
    await expect(h.knowledge.search({ query: "x", pathGlob: "../**" }, h.signal)).rejects.toThrow();
    await expect(new DocumentKnowledge(h.root, h.db).search({ query: "x" }, h.signal)).rejects.toThrow(
      /Semantic/,
    );
    for (let n = 0; n < 55; n++) await h.add(`docs/extra${n}.txt`, "I2C1_CR1 defining register");
    await h.add("docs/last.txt", "I2C1_CR1 defining register");
    expect(
      (await h.knowledge.search({ query: "I2C1_CR1", mode: "keyword", pathGlob: "docs/last.txt" }, h.signal))
        .results[0]?.path,
    ).toBe("docs/last.txt");
  } finally {
    await h.close();
  }
});
it("returns full extraction with exact reduced refs; rejects mixed/out-of-range/stale/ignored/oversized reads", async () => {
  const h = await harness();
  try {
    await h.add("docs/a.pdf", "fixture PDF source", [
      "First page " + "a".repeat(7000),
      "Second page " + "b".repeat(7000),
    ]);
    expect(await h.knowledge.read({ path: "docs/a.pdf", page: 1, pageEnd: 2 }, h.signal)).toMatchObject({
      ref: "docs/a.pdf#p=1",
      truncated: true,
    });
    await expect(h.knowledge.read({ path: "docs/a.pdf", page: 3 }, h.signal)).rejects.toThrow(/outside/);
    await expect(h.knowledge.read({ path: "docs/a.pdf", page: 1, heading: "x" }, h.signal)).rejects.toThrow(
      /family/,
    );
    await expect(h.knowledge.read({ path: "docs/a.pdf", pageEnd: 2 }, h.signal)).rejects.toThrow(/require/);
    await h.add("docs/a.md", "# Power\nVoltage is 3.3 V.\n## Reset\nWait10ms.");
    expect(await h.knowledge.read({ path: "docs/a.md", heading: "reset" }, h.signal)).toMatchObject({
      text: "## Reset\nWait10ms.",
      ref: "docs/a.md#h=reset",
    });
    await h.add("docs/a.html", "<h1>Power</h1><p>3.3 V</p>");
    expect(await h.knowledge.read({ path: "docs/a.html", heading: "power" }, h.signal)).toMatchObject({
      ref: "docs/a.html#h=power",
    });
    await h.add("docs/a.log", Array.from({ length: 4 }, () => "c".repeat(4000)).join("\n"));
    expect(await h.knowledge.read({ path: "docs/a.log", lineStart: 1, lineEnd: 4 }, h.signal)).toMatchObject({
      ref: "docs/a.log#L1-L2",
      truncated: true,
    });
    await expect(h.knowledge.read({ path: "../escape", lineStart: 1 }, h.signal)).rejects.toThrow();
    await writeFile(join(h.root, ".veraignore"), "docs/a.log\n");
    await expect(h.knowledge.read({ path: "docs/a.log" }, h.signal)).rejects.toThrow();
    await writeFile(join(h.root, "docs/a.pdf"), "changed");
    expect(await h.knowledge.validPdfRef("docs/a.pdf#p=1")).toBe(false);
    await expect(h.knowledge.read({ path: "docs/a.pdf", page: 1 }, h.signal)).rejects.toThrow(/changed/);
    await h.add("docs/large.pdf", "other PDF source", ["x".repeat(13000)]);
    expect(await h.knowledge.validPdfRef("docs/large.pdf#p=1")).toBe(true);
    expect(await h.knowledge.validPdfRef("docs/large.pdf#p=2")).toBe(false);
    await expect(h.knowledge.read({ path: "docs/large.pdf", page: 1 }, h.signal)).rejects.toThrow(/12000/);
    const ctx = createToolContext(h.root);
    ctx.knowledge = h.knowledge;
    const registry = new ToolRegistry();
    expect(
      await registry.execute(ctx, "read_doc", { path: "docs/a.md", heading: "reset" }, h.signal, [
        "read_doc",
      ]),
    ).toMatchObject({ isError: true });
    expect(await registry.execute(ctx, "search_docs", { query: "x", k: 0 }, h.signal)).toMatchObject({
      isError: true,
    });
  } finally {
    await h.close();
  }
});
it("replays search/read PDF and persists a valid issued page citation while rejecting invented refs", async () => {
  const h = await harness();
  let service: SessionService | undefined;
  try {
    await h.add("docs/vera-demo-01-reference-manual.pdf", "PDF fixture", [
      "I2C1_CR1 enables the I2C peripheral and reset control.",
    ]);
    await mkdir(join(h.root, "scripts"));
    await writeFile(
      join(h.root, "scripts/documents.jsonl"),
      await readFile(join(software, "fixtures/llm-scripts/search-read-document.jsonl")),
    );
    const gateway = new ReplayGateway({ dir: join(h.root, "scripts"), now: () => Date.now() });
    service = new SessionService({
      db: h.db,
      root: h.root,
      gateway,
      clock: { now: () => new Date(), sleep: async () => {} },
      model: () => "replay/documents",
      prompt: () => "system",
      embeddings: h.port,
    });
    await service.waitReady();
    const session = service.create();
    service.send(session.id, "Search the I2C register");
    expect(await service.waitIdle(session.id)).toEqual({ stopReason: "end" });
    const snapshot = service.get(session.id).snapshot;
    const answer = snapshot.items.filter((i) => i.kind === "assistant").at(-1);
    expect(JSON.stringify(snapshot)).toContain('"valid":true');
    expect(answer && "text" in answer ? answer.text : "").toContain(
      "docs/vera-demo-01-reference-manual.pdf#p=1",
    );
    expect(JSON.stringify(snapshot)).toContain('"valid":false');
  } finally {
    await service?.close();
    await h.close();
  }
});
