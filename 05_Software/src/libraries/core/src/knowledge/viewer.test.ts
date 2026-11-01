// REQ-FUNC-28ad0001
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { DocumentsRepository } from "../storage/repos/documents.js";
import { schemaSql } from "../storage/schema.js";
import { documentKind } from "./ingest.js";
import { createDocumentProcessor } from "./processor.js";
import { DocumentViewer } from "./viewer.js";

it("opens exact page ranges, duplicate heading anchors and unindexed file-tool lines; refuses stale/invalid sources", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-viewer-"));
  const db = new Database(":memory:");
  db.exec(schemaSql);
  await mkdir(join(root, "docs"));
  await mkdir(join(root, ".vera"));
  const rows = new DocumentsRepository(db);
  const add = async (path: string, text: string, kind: "pdf" | "markdown" | "html" | "text") => {
    await writeFile(join(root, path), text);
    const sha256 = createHash("sha256").update(text).digest("hex");
    const result = await createDocumentProcessor(async () => ({
      kind: "pdf",
      pages: ["Page one text, power supply 3.3 V", "Page two text, reset sequence"],
    }))({ root, path, kind, sha256, signal: new AbortController().signal, assertWritable: () => {} });
    const doc = rows.save({
      path,
      kind,
      sha256,
      bytes: Buffer.byteLength(text),
      mtime: new Date().toISOString(),
      pages: kind === "pdf" ? 2 : null,
      status: "indexed",
      error: null,
      indexedAt: null,
    });
    rows.replaceChunks(doc.id, result.chunks ?? [], result.derived);
  };
  try {
    const viewer = new DocumentViewer(root, db);
    await add("docs/a.pdf", "PDF fixture", "pdf");
    await add("docs/a.md", "# Power\nFirst\n# Power\nSecond\n", "markdown");
    await add("docs/a.html", "<h1>Reset</h1><p>Assert.</p><script>secret()</script>", "html");
    expect(await viewer.open("docs/a.pdf#p=1-2", "Page one")).toMatchObject({
      kind: "pdf",
      page: 1,
      pageEnd: 2,
      pages: ["Page one text, power supply 3.3 V", "Page two text, reset sequence"],
      snippet: "Page one",
    });
    expect(await viewer.open("docs/a.md#h=power-1")).toMatchObject({
      kind: "markdown",
      anchor: "power-1",
      sections: [{ slug: "power" }, { slug: "power-1" }],
    });
    expect(await viewer.open("docs/a.html#h=reset")).toMatchObject({
      kind: "html",
      anchor: "reset",
      sections: [{ text: "Reset\n\nAssert." }],
    });
    await writeFile(join(root, "boot.log"), "first\r\nsecond\r\nthird\r\n");
    expect(await viewer.open("boot.log#L2-L3")).toMatchObject({
      kind: "text",
      start: 2,
      end: 3,
      lines: ["first", "second", "third"],
    });
    for (const ref of [
      "docs/a.pdf#p=3",
      "docs/a.pdf#h=power",
      "docs/a.md#h=absent",
      "boot.log#L1-L4",
      "../outside#L1-L1",
      "missing#L1-L1",
    ])
      await expect(viewer.open(ref)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await writeFile(join(root, "docs/a.md"), "# Changed\n");
    await expect(viewer.open("docs/a.md#h=power")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await writeFile(join(root, "binary.log"), new Uint8Array([0, 1, 2]));
    await expect(viewer.open("binary.log#L1-L1")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await writeFile(join(root, ".vera/.veraignore"), "boot.log\n");
    await expect(viewer.open("boot.log#L1-L1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  } finally {
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});

// REQ-UX-64738341 REQ-FUNC-56b34eec
it("opens office extractions as slides and sections and bounds Docs search refs by their structure", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-viewer-office-"));
  const db = new Database(":memory:");
  db.exec(schemaSql);
  await mkdir(join(root, "docs"));
  await mkdir(join(root, ".vera"));
  const rows = new DocumentsRepository(db);
  const add = async (path: string, fixture: string) => {
    const bytes = await readFile(
      new URL(`../../../../../tests/fixtures/documents/office/${fixture}`, import.meta.url),
    );
    await writeFile(join(root, path), bytes);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const kind = documentKind(path);
    if (kind === "other") throw Error(path);
    const result = await createDocumentProcessor(async () => {
      throw Error("No PDF expected.");
    })({ root, path, kind, sha256, signal: new AbortController().signal, assertWritable: () => {} });
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
  };
  try {
    const viewer = new DocumentViewer(root, db);
    await add("docs/bringup.pptx", "bringup.pptx");
    await add("docs/review.docx", "review.docx");
    await add("docs/timing.ods", "timing.ods");
    expect(await viewer.open("docs/bringup.pptx#p=2")).toEqual({
      kind: "presentation",
      path: "docs/bringup.pptx",
      ref: "docs/bringup.pptx#p=2",
      snippet: "",
      slides: ["Bring-up plan\nPower the 3.3 V rail first", "Measurements\nVDD\n3.29 V"],
      page: 2,
      pageEnd: 2,
    });
    expect(await viewer.open("docs/review.docx#h=reset")).toMatchObject({
      kind: "document",
      anchor: "reset",
      sections: [{ slug: "" }, { slug: "power" }, { slug: "reset" }],
    });
    expect(await viewer.openPath("docs/timing.ods")).toMatchObject({
      kind: "spreadsheet",
      anchor: null,
      sections: [{ slug: "clocks", path: ["Clocks"] }],
    });
    for (const ref of [
      "docs/bringup.pptx#p=3",
      "docs/bringup.pptx#h=measurements",
      "docs/bringup.pptx#L1-L1",
      "docs/review.docx#p=1",
      "docs/review.docx#h=absent",
      "docs/review.docx#L1-L1",
    ])
      await expect(viewer.open(ref)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await viewer.currentBounds("docs/bringup.pptx")).toEqual({
      kind: "presentation",
      pages: 2,
      lines: 0,
      slugs: new Set(),
    });
    expect(await viewer.currentBounds("docs/review.docx")).toEqual({
      kind: "document",
      pages: 0,
      lines: 0,
      slugs: new Set(["", "power", "reset"]),
    });
  } finally {
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});

// REQ-UX-9be5fd96 REQ-FUNC-73136b97
it("opens #h= at the untitled leading section and bounds Docs search by its empty slug", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-viewer-lead-"));
  const db = new Database(":memory:");
  db.exec(schemaSql);
  await mkdir(join(root, "docs"));
  await mkdir(join(root, ".vera"));
  const rows = new DocumentsRepository(db);
  const add = async (path: string, text: string) => {
    await writeFile(join(root, path), text);
    const sha256 = createHash("sha256").update(text).digest("hex");
    const result = await createDocumentProcessor(async () => {
      throw Error("No PDF expected.");
    })({ root, path, kind: "html", sha256, signal: new AbortController().signal, assertWritable: () => {} });
    const doc = rows.save({
      path,
      kind: "html",
      sha256,
      bytes: Buffer.byteLength(text),
      mtime: new Date().toISOString(),
      pages: null,
      status: "indexed",
      error: null,
      indexedAt: null,
    });
    rows.replaceChunks(doc.id, result.chunks ?? [], result.derived);
  };
  try {
    const viewer = new DocumentViewer(root, db);
    await add("docs/intro.html", "<p>Intro text.</p><h1>Reset</h1><p>Assert.</p>");
    await add("docs/titled.html", "<h1>Power</h1><p>Text.</p>");
    expect(await viewer.open("docs/intro.html#h=")).toMatchObject({
      kind: "html",
      anchor: "",
      sections: [{ slug: "", text: "Intro text." }, { slug: "reset" }],
    });
    await expect(viewer.open("docs/titled.html#h=")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await viewer.currentBounds("docs/intro.html"))?.slugs).toEqual(new Set(["", "reset"]));
  } finally {
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});
