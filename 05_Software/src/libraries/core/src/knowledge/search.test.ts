import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { validateCitations } from "../agent/citations.js";
import { ReplayGateway } from "../llm/replay.js";
import { SessionService } from "../sessions/service.js";
import { DocumentsRepository } from "../storage/repos/documents.js";
import { schemaSql } from "../storage/schema.js";
import { createToolContext } from "../tools/context.js";
import { ToolRegistry } from "../tools/registry.js";
import type { EmbeddingPort } from "./embedding.js";
import { createDocumentProcessor } from "./processor.js";
import { DocumentKnowledge, fuseRanks } from "./search.js";

const software = fileURLToPath(new URL("../../../../../", import.meta.url));
async function harness() {
  const root = await mkdtemp(join(tmpdir(), "vera-search-")),
    db = new Database(":memory:");
  db.pragma("foreign_keys=ON");
  db.exec(schemaSql);
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
// REQ-FUNC-51165496
it("preserves prior opening-bracket paths in precise read and search refs", async () => {
  const h = await harness();
  try {
    await h.add("docs/board[revA.md", "# Power\nBracketproof1234\n");
    const ref = "docs/board[revA.md#h=power";
    expect(await h.knowledge.read({ path: "docs/board[revA.md", heading: "power" }, h.signal)).toMatchObject({
      ref,
    });
    expect(
      (await h.knowledge.search({ query: "Bracketproof1234", mode: "keyword" }, h.signal)).results,
    ).toMatchObject([{ ref }]);
    expect(await h.knowledge.validDocumentRef(ref)).toBe(true);
  } finally {
    await h.close();
  }
});
it("validates all issued document kinds against current extraction bounds independent of output budgets", async () => {
  const h = await harness();
  try {
    expect(h.knowledge.validDocumentRef).toBeTypeOf("function");
    await h.add("docs/a.pdf", "fixture PDF source", ["first page ".repeat(1400), "second page content"]);
    await h.add("docs/a.md", "# Alimentare ă\n3.3 V\n# Alimentare ă\n" + "large section ".repeat(1100));
    await h.add("docs/a.html", "<h1>Reset</h1><p>Assert.</p><h1>Reset</h1><p>Release.</p>");
    await h.add("docs/a.log", "first\r\nsecond\r\n");
    const valid = [
      "docs/a.pdf#p=1",
      "docs/a.pdf#p=1-2",
      "docs/a.pdf#p=2-2",
      "docs/a.md#h=alimentare-ă",
      "docs/a.md#h=alimentare-ă-1",
      "docs/a.html#h=reset",
      "docs/a.html#h=reset-1",
      "docs/a.log#L1-L2",
    ];
    const invalid = [
      "docs/a.pdf#p=3",
      "docs/a.pdf#p=1-3",
      "docs/a.pdf#p=2-1",
      "docs/a.md#h=absent",
      "docs/a.html#h=reset-2",
      "docs/a.log#L1-L3",
      "docs/a.md#p=1",
      "docs/a.pdf#h=reset",
      "docs/a.log#h=first",
      "../docs/a.pdf#p=1",
      "missing.pdf#p=1",
      "docs/a.pdf#p=9007199254740992",
    ];
    const issued = [...valid, ...invalid];
    const messages = [
      {
        role: "toolResult" as const,
        toolName: "search_docs",
        toolCallId: "c",
        isError: false,
        timestamp: 0,
        content: [
          { type: "text" as const, text: JSON.stringify({ results: issued.map((ref) => ({ ref })) }) },
        ],
      },
    ];
    const check = (refs: string[]) =>
      validateCitations(h.root, refs.map((ref) => `[[${ref}]]`).join(" "), messages, undefined, (ref) =>
        h.knowledge.validDocumentRef(ref),
      );
    expect(await check(issued)).toEqual([
      ...valid.map((ref) => ({ ref, valid: true })),
      ...invalid.map((ref) => ({ ref, valid: false })),
    ]);
    expect(await check(["docs/a.pdf#p=2", "docs/a.md#h=reset"])).toEqual([
      { ref: "docs/a.pdf#p=2", valid: false },
      { ref: "docs/a.md#h=reset", valid: false },
    ]);
    messages[0]!.isError = true;
    expect((await check(valid)).every((c) => !c.valid)).toBe(true);
    messages[0]!.isError = false;
    await writeFile(join(h.root, ".vera/.veraignore"), "docs/a.html\n");
    expect((await check(["docs/a.html#h=reset"]))[0]?.valid).toBe(false);
    await writeFile(join(h.root, ".vera/.veraignore"), "");
    await symlink(
      join(h.root, "docs"),
      join(h.root, "redirect"),
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(await h.knowledge.validDocumentRef("redirect/a.pdf#p=1")).toBe(false);
    expect(await h.knowledge.validDocumentRef("redirect/a.md#h=alimentare-ă")).toBe(false);
    await writeFile(join(h.root, "docs/a.md"), "# Alimentare ă\nchanged");
    expect((await check(["docs/a.md#h=alimentare-ă"]))[0]?.valid).toBe(false);
    await rm(join(h.root, "docs/a.pdf"));
    expect((await check(["docs/a.pdf#p=1"]))[0]?.valid).toBe(false);
    h.db
      .prepare("DELETE FROM document_extractions WHERE doc_id=(SELECT id FROM documents WHERE path=?)")
      .run("docs/a.html");
    expect(await h.knowledge.validDocumentRef("docs/a.html#h=reset")).toBe(false);
    await h.add("docs/a.html", "<h1>Reset</h1><p>Assert.</p>");
    h.db.prepare("UPDATE documents SET status='pending' WHERE path=?").run("docs/a.html");
    expect(await h.knowledge.validDocumentRef("docs/a.html#h=reset")).toBe(false);
  } finally {
    await h.close();
  }
});
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
    await writeFile(join(h.root, ".vera/.veraignore"), "docs/a.log\n");
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
      await readFile(join(software, "tests/fixtures/llm-scripts/search-read-document.jsonl")),
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

it("SessionService persists every issued citation kind and invalid chips through session replay", async () => {
  const h = await harness();
  let service: SessionService | undefined;
  try {
    await h.add("docs/a.pdf", "PDF source", [
      "A valid first page with enough characters.",
      "A valid second page with enough characters.",
    ]);
    await h.add("docs/a.md", "# Power\n3.3V\n");
    await h.add("docs/a.html", "<h1>Reset</h1><p>Assert.</p>");
    await h.add("docs/a.log", "first\nsecond\n");
    await mkdir(join(h.root, "scripts"));
    await writeFile(
      join(h.root, "scripts/citations-all.jsonl"),
      await readFile(join(software, "tests/fixtures/llm-scripts/citations-all.jsonl")),
    );
    service = new SessionService({
      db: h.db,
      root: h.root,
      gateway: new ReplayGateway({ dir: join(h.root, "scripts"), now: () => Date.now() }),
      clock: { now: () => new Date(), sleep: async () => {} },
      model: () => "replay/citations-all",
      prompt: () => "system",
    });
    await service.waitReady();
    const session = service.create();
    service.send(session.id, "Citation kinds");
    expect(await service.waitIdle(session.id)).toEqual({ stopReason: "end" });
    const snapshot = service.get(session.id).snapshot;
    const answer = snapshot.items.filter((i) => i.kind === "assistant").at(-1);
    expect(answer?.kind).toBe("assistant");
    if (answer?.kind !== "assistant") throw Error("Missing answer");
    expect(answer.citations).toHaveLength(13);
    expect(answer.citations.filter((c) => c.valid)).toHaveLength(6);
    expect(answer.citations.filter((c) => !c.valid)).toHaveLength(7);
    expect(answer.citations.slice(0, 6).every((c) => c.valid)).toBe(true);
    // REQ-FUNC-28ad0001: real session provenance, locator and snippet; no client content.
    expect(await service.openCitation(session.id, answer.id, "docs/a.pdf#p=1")).toMatchObject({
      kind: "pdf",
      page: 1,
      snippet: "A valid first page with enough characters.",
    });
    expect(await service.openCitation(session.id, answer.id, "docs/a.pdf#p=1-2")).toMatchObject({
      kind: "pdf",
      page: 1,
      pageEnd: 2,
    });
    expect(await service.openCitation(session.id, answer.id, "docs/a.md#h=power")).toMatchObject({
      kind: "markdown",
      anchor: "power",
    });
    expect(await service.openCitation(session.id, answer.id, "docs/a.log#L1-L2")).toMatchObject({
      kind: "text",
      start: 1,
      end: 2,
    });
    expect(await service.openCitation(session.id, answer.id, "artifact:summary.md")).toMatchObject({
      kind: "artifact",
      path: "summary.md",
    });
    await expect(service.openCitation(session.id, answer.id, "docs/a.pdf#p=3")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(service.openCitation(session.id, "foreign-message", "docs/a.pdf#p=1")).rejects.toMatchObject(
      { code: "NOT_FOUND" },
    );
    await expect(
      service.openCitation(service.create().id, answer.id, "artifact:summary.md"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const replayed: unknown[] = [];
    const unsubscribe = service.subscribe(session.id, 0, (_seq, event) => replayed.push(event));
    unsubscribe();
    expect(replayed).toContainEqual(
      expect.objectContaining({ type: "message.done", citations: answer.citations, text: answer.text }),
    );
    await writeFile(join(h.root, "docs/a.pdf"), "Changed PDF source");
    await expect(service.openCitation(session.id, answer.id, "docs/a.pdf#p=1")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  } finally {
    await service?.close();
    await h.close();
  }
});
