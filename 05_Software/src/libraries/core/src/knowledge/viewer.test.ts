// REQ-FUNC-28ad0001
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { migrations } from "../storage/migrate.js";
import { DocumentsRepository } from "../storage/repos/documents.js";
import { createDocumentProcessor } from "./processor.js";
import { DocumentViewer } from "./viewer.js";

it("opens exact page ranges, duplicate heading anchors and unindexed file-tool lines; refuses stale/invalid sources", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-viewer-"));
  const db = new Database(":memory:");
  for (const m of migrations) db.exec(m.sql);
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
