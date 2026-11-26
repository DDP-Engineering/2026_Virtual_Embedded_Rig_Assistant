// REQ-FUNC-28ad0001
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { DocumentsRepository } from "../storage/repos/documents.js";
import { schemaSql } from "../storage/schema.js";
import { readBytes } from "../workbench/read-bytes.js";
import { documentKind } from "./ingest.js";
import { createDocumentProcessor } from "./processor.js";
import { DocumentViewer } from "./viewer.js";

it("compacts verified large indexed and line citations before transport and binds their original source revision", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-large-citation-"));
  const db = new Database(":memory:");
  db.exec(schemaSql);
  const path = "large.txt",
    text = `${"x".repeat(6 * 1024 * 1024)}\r\nTARGET\rLAST\n`;
  try {
    await writeFile(join(root, path), text);
    const fixedTime = new Date("2026-11-17T00:00:00.000Z");
    await utimes(join(root, path), fixedTime, fixedTime);
    const hash = createHash("sha256").update(text).digest("hex");
    const doc = new DocumentsRepository(db).save({
      path,
      kind: "text",
      sha256: hash,
      bytes: Buffer.byteLength(text),
      mtime: new Date().toISOString(),
      pages: null,
      status: "indexed",
      error: null,
      indexedAt: null,
    });
    db.prepare("INSERT INTO document_extractions(doc_id,extraction_json) VALUES(?,?)").run(
      doc.id,
      JSON.stringify({ kind: "text", lines: [text.slice(0, 6 * 1024 * 1024), "TARGET", "LAST"] }),
    );
    const viewer = new DocumentViewer(root, db);
    const result = await viewer.open(`${path}#L2-L3`, "issued snippet");
    expect(result).toMatchObject({
      kind: "text",
      path,
      ref: `${path}#L2-L3`,
      snippet: "issued snippet",
      lines: [],
      start: 2,
      end: 3,
      byteSource: { lines: 3, size: Buffer.byteLength(text), utf8Log: false },
    });
    expect(JSON.stringify(result).length).toBeLessThan(1000);
    if (result.kind !== "text" || !result.byteSource) throw Error("Missing compact source");
    expect((await readBytes(root, path, 0, 4)).revision).toBe(result.byteSource.revision);
    expect(await viewer.openPath(path)).toMatchObject({ lines: [], byteSource: { lines: 3 } });
    const fractionalTime = 1794873600 + 0.75 / 1000;
    await utimes(join(root, path), fractionalTime, fractionalTime);
    const fractional = await viewer.openPath(path);
    expect(fractional.kind === "text" && fractional.byteSource?.modified).toBe(
      (await stat(join(root, path))).mtime.toISOString(),
    );
    await utimes(join(root, path), fixedTime, fixedTime);
    const baseline = await viewer.open(`${path}#L2-L3`);
    if (baseline.kind !== "text" || !baseline.byteSource) throw Error("Missing baseline source");
    const before = await stat(join(root, path));
    await writeFile(join(root, path), text.replace("TARGET", "CHANGE"));
    await utimes(join(root, path), before.atime, before.mtime);
    expect((await stat(join(root, path))).mtimeMs).toBe(before.mtimeMs);
    expect((await readBytes(root, path, 0, 4)).revision).not.toBe(baseline.byteSource.revision);
    await expect(viewer.open(`${path}#L2-L3`)).rejects.toMatchObject({ code: "NOT_FOUND" });
    // More than one NUL in a hundred bytes of the sample: binary to the file tools, a log to parse_log.
    const log = `${"\0".repeat(200)}${"x".repeat(6 * 1024 * 1024)}control\n`;
    await writeFile(join(root, "control.log"), log);
    await expect(viewer.open("control.log#L1-L1")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await viewer.open("control.log#L1-L1", "", false, true)).toMatchObject({
      lines: [],
      byteSource: { utf8Log: true, lines: 1 },
    });
    const managedLog = ".vera/runs/build.log";
    await mkdir(join(root, ".vera/runs"), { recursive: true });
    await writeFile(join(root, managedLog), text);
    const logged = await viewer.open(`${managedLog}#L2-L3`);
    expect(logged).toMatchObject({ lines: [], byteSource: { encoding: "utf-8", lines: 3 } });
    if (logged.kind !== "text" || !logged.byteSource) throw Error("Missing managed source");
    expect((await readBytes(root, managedLog, 0, 4)).revision).toBe(logged.byteSource.revision);
  } finally {
    db.close();
    await rm(root, { recursive: true, force: true });
  }
}, 15_000);

it("opens exact page ranges, duplicate heading anchors and unindexed file-tool lines; refuses stale/invalid sources", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-viewer-"));
  const db = new Database(":memory:");
  db.exec(schemaSql);
  await mkdir(join(root, "docs"));
  await mkdir(join(root, ".vera"));
  const rows = new DocumentsRepository(db);
  const add = async (path: string, text: string | Buffer, kind: "pdf" | "markdown" | "html" | "text") => {
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
    await add("docs/wide.txt", Buffer.from("\uFEFFTensiune 3,3 V\r\nReset", "utf16le"), "text");
    await add("docs/legacy.txt", Buffer.from("Voltage \x80\nReset", "latin1"), "text");
    for (const [path, first] of [
      ["docs/wide.txt", "Tensiune 3,3 V"],
      ["docs/legacy.txt", "Voltage €"],
    ] as const) {
      const lines = [first, "Reset"];
      expect(await viewer.open(`${path}#L1-L1`)).toMatchObject({ lines, start: 1, end: 1 });
      expect(await viewer.openPath(path)).toMatchObject({ lines });
    }
    await mkdir(join(root, ".vera/runs"));
    await writeFile(join(root, ".vera/runs/build.log"), "Build output\nDone\n");
    expect(await viewer.open(".vera/runs/build.log#L1-L1")).toMatchObject({
      lines: ["Build output", "Done"],
    });
    await expect(viewer.openPath(".vera/runs/build.log")).rejects.toMatchObject({ code: "NOT_FOUND" });
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
