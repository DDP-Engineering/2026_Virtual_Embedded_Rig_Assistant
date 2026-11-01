import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { strToU8, zipSync } from "fflate";
import { expect, it } from "vitest";
import { z } from "zod";
import { validateCitations } from "../agent/citations.js";
import { ReplayGateway } from "../llm/replay.js";
import { SessionService } from "../sessions/service.js";
import { DocumentsRepository } from "../storage/repos/documents.js";
import { schemaSql } from "../storage/schema.js";
import { createToolContext } from "../tools/context.js";
import { ToolRegistry } from "../tools/registry.js";
import type { EmbeddingPort } from "./embedding.js";
import { documentKind } from "./ingest.js";
import { createDocumentProcessor } from "./processor.js";
import { DocumentKnowledge, fuseRanks, sectionParts } from "./search.js";

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
  /** Index a committed office fixture with the real in-process office extraction. */
  const addOffice = async (path: string, source: string | Uint8Array) => {
    const bytes =
      typeof source === "string"
        ? await readFile(join(software, "tests/fixtures/documents/office", source))
        : source;
    await writeFile(join(root, path), bytes);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const kind = documentKind(path);
    if (kind === "other") throw Error(`Not an indexable office path: ${path}`);
    const result = await createDocumentProcessor(async () => {
      throw Error("No PDF expected.");
    }, port)({ root, path, kind, sha256, signal, assertWritable: () => {} });
    if (result.status !== "indexed") throw Error(`${path} ${result.status}`);
    const doc = rows.save({
      path,
      kind,
      sha256,
      bytes: bytes.length,
      mtime: new Date().toISOString(),
      pages: result.pages ?? null,
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
  return { root, db, port, vectors, rows, knowledge, signal, add, addOffice, close };
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
    await h.add("docs/a.txt", "first\nsecond\n");
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
    expect(await service.openCitation(session.id, answer.id, "docs/a.txt#L1-L2")).toMatchObject({
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
// REQ-FUNC-724d3fcc
it("uses the workbench retrieval defaults when search_docs omits k or mode", async () => {
  const h = await harness();
  try {
    for (const name of ["a", "b", "c"]) await h.add(`docs/${name}.txt`, `I2C1_CR1 register ${name}`);
    const defaults = new DocumentKnowledge(h.root, h.db, undefined, () => ({ results: 2, mode: "keyword" }));
    // Keyword mode needs no embeddings, so this only succeeds when the default mode applies.
    expect((await defaults.search({ query: "I2C1_CR1" }, h.signal)).results).toHaveLength(2);
    expect((await defaults.search({ query: "I2C1_CR1", k: 1 }, h.signal)).results).toHaveLength(1);
    await expect(defaults.search({ query: "I2C1_CR1", mode: "semantic" }, h.signal)).rejects.toThrow(
      /Semantic/,
    );
    expect((await h.knowledge.search({ query: "I2C1_CR1" }, h.signal)).results).toHaveLength(3);
    const unset = new DocumentKnowledge(h.root, h.db, h.port, () => undefined);
    expect((await unset.search({ query: "I2C1_CR1" }, h.signal)).results).toHaveLength(3);
  } finally {
    await h.close();
  }
});

// REQ-FUNC-56b34eec REQ-FUNC-58cba7fd REQ-FUNC-bc730650
it("cites, reads and searches office documents by slide number and heading slug only", async () => {
  const h = await harness();
  try {
    await h.addOffice("docs/bringup.pptx", "bringup.pptx");
    await h.addOffice("docs/review.docx", "review.docx");
    await h.addOffice("docs/report.xlsx", "test-report.xlsx");
    const read = (args: Parameters<typeof h.knowledge.read>[0]) => h.knowledge.read(args, h.signal);
    expect(await read({ path: "docs/bringup.pptx", page: 2 })).toEqual({
      path: "docs/bringup.pptx",
      text: "Measurements\nVDD\n3.29 V",
      truncated: false,
      ref: "docs/bringup.pptx#p=2",
    });
    expect(await read({ path: "docs/bringup.pptx", page: 1, pageEnd: 2 })).toMatchObject({
      ref: "docs/bringup.pptx#p=1-2",
    });
    expect(await read({ path: "docs/review.docx", heading: "reset" })).toMatchObject({
      ref: "docs/review.docx#h=reset",
      text: expect.stringContaining("100 nF"),
    });
    expect(await read({ path: "docs/report.xlsx", heading: "timing" })).toMatchObject({
      ref: "docs/report.xlsx#h=timing",
      text: "Timing\n\nReset pulse\t200",
    });
    for (const args of [
      { path: "docs/bringup.pptx", page: 3 },
      { path: "docs/bringup.pptx", lineStart: 1 },
      { path: "docs/bringup.pptx", heading: "measurements" },
      { path: "docs/review.docx", heading: "absent" },
      { path: "docs/review.docx", page: 1 },
      { path: "docs/report.xlsx", lineStart: 1, lineEnd: 2 },
    ])
      await expect(read(args)).rejects.toThrow();
    const valid = [
      "docs/bringup.pptx#p=2",
      "docs/bringup.pptx#p=1-2",
      "docs/review.docx#h=power",
      "docs/review.docx#h=reset",
      "docs/report.xlsx#h=rail",
    ];
    const invalid = [
      "docs/bringup.pptx#p=3",
      "docs/bringup.pptx#p=2-3",
      "docs/bringup.pptx#h=measurements",
      "docs/bringup.pptx#L1-L1",
      "docs/review.docx#h=absent",
      "docs/review.docx#p=1",
      "docs/review.docx#L1-L1",
      "docs/report.xlsx#p=1",
    ];
    const messages = [
      {
        role: "toolResult" as const,
        toolName: "search_docs",
        toolCallId: "c",
        isError: false,
        timestamp: 0,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ results: [...valid, ...invalid].map((ref) => ({ ref })) }),
          },
        ],
      },
    ];
    expect(
      await validateCitations(
        h.root,
        [...valid, ...invalid].map((ref) => `[[${ref}]]`).join(" "),
        messages,
        undefined,
        (ref) => h.knowledge.validDocumentRef(ref),
      ),
    ).toEqual([
      ...valid.map((ref) => ({ ref, valid: true })),
      ...invalid.map((ref) => ({ ref, valid: false })),
    ]);
    const search = (query: string) => h.knowledge.search({ query, mode: "keyword", k: 5 }, h.signal);
    expect((await search("NRST capacitor")).results[0]).toMatchObject({ ref: "docs/review.docx#h=reset" });
    expect((await search("Measurements")).results[0]).toMatchObject({
      ref: "docs/bringup.pptx#p=2",
      locator: { type: "page", page: 2 },
    });
    expect((await search("SPEAKER")).results).toEqual([]);
  } finally {
    await h.close();
  }
});

const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const rels = (target: string, type: string) =>
  strToU8(
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/></Relationships>`,
  );
/** One worksheet named Timing with `rows` inline-string rows of about 40 characters. */
const timingWorkbook = (rows: number) =>
  zipSync({
    "_rels/.rels": rels("xl/workbook.xml", "officeDocument"),
    "xl/workbook.xml": strToU8(
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ${R}><sheets><sheet name="Timing" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": rels("worksheets/sheet1.xml", "worksheet"),
    "xl/worksheets/sheet1.xml": strToU8(
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${Array.from(
        { length: rows },
        (_, n) =>
          `<row r="${n + 1}"><c r="A${n + 1}" t="inlineStr"><is><t>signal ${n} ${"x".repeat(24)}</t></is></c><c r="B${n + 1}"><v>${n}</v></c></row>`,
      ).join("")}</sheetData></worksheet>`,
    ),
  });
const issuedBy = (refs: string[]) => [
  {
    role: "toolResult" as const,
    toolName: "search_docs",
    toolCallId: "c",
    isError: false,
    timestamp: 0,
    content: [{ type: "text" as const, text: JSON.stringify({ results: refs.map((ref) => ({ ref })) }) }],
  },
];

// REQ-FUNC-2a51bc39 REQ-FUNC-845e3114
it("issues and validates #h= refs for untitled leading sections of HTML and office sources", async () => {
  const h = await harness();
  try {
    await h.add("docs/intro.html", "<p>PREAMBLE_TOKEN intro text.</p><h1>Reset</h1><p>Assert.</p>");
    await h.add("docs/titled.html", "<h1>Power</h1><p>TITLED_TOKEN text.</p>");
    await h.add("docs/a.md", "PREFACE_TOKEN line\n# Power\n3.3 V\n");
    await h.add("docs/a.pdf", "fixture PDF source", [
      "first page power supply text",
      "second page reset text",
    ]);
    await h.addOffice("docs/plain.docx", "plain.docx");
    await h.addOffice("docs/bringup.pptx", "bringup.pptx");
    const first = async (query: string) =>
      (await h.knowledge.search({ query, mode: "keyword", k: 5 }, h.signal)).results[0]?.ref;
    expect(await first("PREAMBLE_TOKEN")).toBe("docs/intro.html#h=");
    expect(await first("SWD clock")).toBe("docs/plain.docx#h=");
    expect(await first("PREFACE_TOKEN")).toMatch(/^docs\/a\.md#L1-L\d+$/);
    expect(await first("TITLED_TOKEN")).toBe("docs/titled.html#h=power");
    for (const args of [{ path: "docs/intro.html", heading: "" }, { path: "docs/intro.html" }])
      expect(await h.knowledge.read(args, h.signal)).toMatchObject({
        ref: "docs/intro.html#h=",
        text: expect.stringContaining("PREAMBLE_TOKEN"),
      });
    for (const args of [{ path: "docs/plain.docx", heading: "" }, { path: "docs/plain.docx" }])
      expect(await h.knowledge.read(args, h.signal)).toMatchObject({
        ref: "docs/plain.docx#h=",
        text: expect.stringContaining("4 MHz"),
      });
    const valid = ["docs/intro.html#h=", "docs/plain.docx#h="];
    const invalid = ["docs/titled.html#h=", "docs/a.md#h=", "docs/a.pdf#h=", "docs/bringup.pptx#h="];
    const check = (refs: string[], issued: string[]) =>
      validateCitations(
        h.root,
        refs.map((ref) => `[[${ref}]]`).join(" "),
        issuedBy(issued),
        undefined,
        (ref) => h.knowledge.validDocumentRef(ref),
      );
    expect(await check([...valid, ...invalid], [...valid, ...invalid])).toEqual([
      ...valid.map((ref) => ({ ref, valid: true })),
      ...invalid.map((ref) => ({ ref, valid: false })),
    ]);
    expect(await check(["docs/intro.html#h="], [])).toEqual([{ ref: "docs/intro.html#h=", valid: false }]);
  } finally {
    await h.close();
  }
});

// REQ-FUNC-3b70651a
it("reads sections over the output budget in line-bounded parts that rebuild the section", async () => {
  const h = await harness();
  try {
    await h.addOffice("docs/report.xlsx", timingWorkbook(1000));
    await h.add("docs/one-line.html", `<p>${"long line words ".repeat(1900)}</p>`);
    await h.add("docs/short.html", "<h1>Rail</h1><p>3.3 V</p>");
    const sectionText = (path: string, slug: string) => {
      const stored = h.db
        .prepare(
          "SELECT extraction_json FROM document_extractions WHERE doc_id=(SELECT id FROM documents WHERE path=?)",
        )
        .pluck()
        .get(path) as string;
      return (JSON.parse(stored).sections as { slug: string; text: string }[]).find((s) => s.slug === slug)
        ?.text;
    };
    type Part = { text: string; part: number; parts: number; truncated: boolean; ref: string };
    const readAll = async (path: string, heading: string) => {
      const first = (await h.knowledge.read({ path, heading }, h.signal)) as Part;
      const parts = [first];
      for (let part = 2; part <= first.parts; part++)
        parts.push((await h.knowledge.read({ path, heading, part }, h.signal)) as Part);
      return parts;
    };
    for (const [path, slug, ref] of [
      ["docs/report.xlsx", "timing", "docs/report.xlsx#h=timing"],
      ["docs/one-line.html", "", "docs/one-line.html#h="],
    ] as const) {
      const parts = await readAll(path, slug);
      expect(parts.length).toBeGreaterThan(1);
      expect(parts.map((p) => p.text).join("")).toBe(sectionText(path, slug));
      parts.forEach((p, i) => {
        expect(p).toMatchObject({ part: i + 1, parts: parts.length, truncated: i < parts.length - 1, ref });
        expect(p.text.length).toBeLessThanOrEqual(12000);
        expect(JSON.stringify({ text: p.text }).length).toBeLessThanOrEqual(28000);
      });
      if (path.endsWith(".xlsx")) expect(parts.slice(0, -1).every((p) => p.text.endsWith("\n"))).toBe(true);
    }
    expect(await h.knowledge.read({ path: "docs/short.html", heading: "rail" }, h.signal)).toMatchObject({
      text: "Rail\n\n3.3 V",
      part: 1,
      parts: 1,
      truncated: false,
      ref: "docs/short.html#h=rail",
    });
  } finally {
    await h.close();
  }
});

// REQ-FUNC-91405ce5
it("rejects parts outside the section or outside heading reads with actionable errors", async () => {
  const h = await harness();
  try {
    await h.addOffice("docs/report.xlsx", timingWorkbook(1000));
    await h.add("docs/a.pdf", "fixture PDF source", [
      "first page power supply text",
      "second page reset text",
    ]);
    const { parts } = (await h.knowledge.read({ path: "docs/report.xlsx", heading: "timing" }, h.signal)) as {
      parts: number;
    };
    for (const part of [0, parts + 1])
      await expect(
        h.knowledge.read({ path: "docs/report.xlsx", heading: "timing", part }, h.signal),
      ).rejects.toThrow(`1-${parts}`);
    for (const args of [
      { path: "docs/a.pdf", page: 1, part: 1 },
      { path: "docs/a.pdf", part: 1 },
      { path: "docs/report.xlsx", lineStart: 1, part: 1 },
    ])
      await expect(h.knowledge.read(args, h.signal)).rejects.toThrow(/heading/);
  } finally {
    await h.close();
  }
});

// REQ-FUNC-3b70651a
it("splits sections into budgeted parts without stub heading parts, broken surrogates or oversized JSON", () => {
  const within = (part: string) =>
    part.length <= 12000 &&
    JSON.stringify({ text: part }).length <= 28000 &&
    !/[\uD800-\uDBFF]$|^[\uDC00-\uDFFF]/.test(part);
  const titled = `Title\n\n${"a".repeat(30000)}`;
  const twoLines = `${"a".repeat(3000)}\n${"b".repeat(10000)}`;
  const mixed = `T\n${"x".repeat(11997)}\u{1F600}tail`;
  const cases = [
    titled,
    twoLines,
    mixed,
    `${"x".repeat(11999)}\u{1F600}tail`,
    "\u0001".repeat(10000),
    `\n${"a".repeat(20000)}`,
    `${"row\tvalue\n".repeat(3000)}`,
  ];
  // A line that fits a part by itself is never cut, even when it ends the window early.
  expect(sectionParts(twoLines).map((p) => p.length)).toEqual([3001, 10000]);
  // A rejected newline still leaves the surrogate guard in force.
  expect(sectionParts(mixed)[0]).toHaveLength(11999);
  for (const text of cases) {
    const parts = sectionParts(text);
    expect(parts.join("")).toBe(text);
    expect(parts.every(within)).toBe(true);
  }
  // A heading line before one long paragraph stays with the paragraph's first part.
  expect(sectionParts(titled)[0]?.startsWith("Title\n\naaaa")).toBe(true);
  expect(sectionParts(`${"x".repeat(11999)}\u{1F600}tail`)[0]).toHaveLength(11999);
  expect(sectionParts("\u0001".repeat(10000))[0]).toHaveLength(4664);
  // Rows end their parts at a newline.
  expect(sectionParts("row\tvalue\n".repeat(3000)).every((p) => p.endsWith("\n"))).toBe(true);
  expect(sectionParts("")).toEqual([""]);
});

it("guides models that fill every optional argument: per-field descriptions, kind-specific locator errors and glob hints", async () => {
  const h = await harness();
  try {
    await h.addOffice("docs/plain.docx", "plain.docx");
    await h.add("docs/a.pdf", "fixture PDF source", [
      "first page power supply text",
      "second page reset text",
    ]);
    const every = { page: 1, pageEnd: 1, heading: "", lineStart: 1, lineEnd: 100, part: 1 };
    await expect(h.knowledge.read({ path: "docs/plain.docx", ...every }, h.signal)).rejects.toThrow(
      'Use one locator family. docs/plain.docx is a document read by heading ("" for text before the first heading); remove page, pageEnd, lineStart, lineEnd.',
    );
    await expect(h.knowledge.read({ path: "docs/a.pdf", ...every }, h.signal)).rejects.toThrow(
      "Use one locator family. docs/a.pdf is a PDF read by page; remove heading, lineStart, lineEnd, part.",
    );
    expect(
      await h.knowledge.search({ query: "SWD clock", mode: "keyword", pathGlob: "*" }, h.signal),
    ).toEqual({
      results: [],
      message:
        'No indexed document matched pathGlob "*". Globs are relative to the workbench root, so "*" matches only top-level files; use a pattern such as "docs/**", or omit pathGlob to search every document.',
    });
    expect(
      (await h.knowledge.search({ query: "SWD clock", mode: "keyword", pathGlob: "docs/**" }, h.signal))
        .results,
    ).toHaveLength(1);
    const { readDocSchema, searchDocsSchema } = await import("./search.js");
    for (const schema of [readDocSchema, searchDocsSchema]) {
      const json = z.toJSONSchema(schema) as { properties: Record<string, { description?: string }> };
      for (const [name, field] of Object.entries(json.properties))
        expect(field.description, `${name} description`).toMatch(/\w/);
    }
  } finally {
    await h.close();
  }
});

// RULING-005 (TASK-f09609fd)
it("falls back to keyword results when the indexer cannot rank, and still fails other ranking errors", async () => {
  const h = await harness();
  try {
    await h.add("docs/a.md", "# Power\nThe board uses a 3.3 V supply.\n");
    const failing = (error: Error): EmbeddingPort => ({
      modelId: "fixture",
      embed: async () => [],
      rank: async () => {
        throw error;
      },
      release: async () => {},
    });
    const stopped = new DocumentKnowledge(
      h.root,
      h.db,
      failing(Object.assign(Error("Indexing stopped."), { retry: true })),
    );
    for (const mode of ["hybrid", "semantic"] as const) {
      const found = await stopped.search({ query: "supply", mode }, h.signal);
      expect(found.results.map((r) => r.path)).toEqual(["docs/a.md"]);
      expect(found.message).toMatch(/semantic ranking is unavailable/i);
    }
    const broken = new DocumentKnowledge(h.root, h.db, failing(Error("Embedding worker failed.")));
    await expect(broken.search({ query: "supply", mode: "hybrid" }, h.signal)).rejects.toThrow(
      "Embedding worker failed.",
    );
  } finally {
    await h.close();
  }
});
