import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, open, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type EventEnvelope, eventEnvelopeSchema } from "@vera/shared";
import { afterEach, expect, it } from "vitest";
import { SettingsService } from "../settings/service.js";
import { DocumentsRepository } from "../storage/repos/documents.js";
import { WorkbenchService } from "../workbench/service.js";
import { type DocumentProcessor, PDF_LIMIT, TEXT_LIMIT } from "./ingest.js";
import { KeywordSearch } from "./keyword.js";
import { createDocumentProcessor } from "./processor.js";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.reverse().splice(0)) await close();
});
async function harness(processDocument?: DocumentProcessor) {
  const root = await mkdtemp(join(tmpdir(), "vera-ingest-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const folder = join(root, "bench");
  await mkdir(folder);
  const files = {
    read: async (path: string) => {
      try {
        return await readFile(path, "utf8");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw e;
      }
    },
    writeAtomic: async (path: string, text: string) => {
      await writeFile(path, text);
    },
    backup: async () => true,
  };
  const settings = new SettingsService({
    files,
    paths: { userData: root, settings: join(root, "settings.json"), logs: join(root, "logs") },
    uuid: randomUUID,
    changed: () => {},
  });
  await settings.load();
  cleanup.push(() => settings.close());
  const events: EventEnvelope[] = [];
  const service = new WorkbenchService(
    {
      files,
      settings,
      pid: process.pid,
      appVersion: "0.0.0",
      now: () => new Date(),
      token: randomUUID,
      isProcessAlive: (pid) => pid === process.pid,
      changed: (event) => {
        events.push(eventEnvelopeSchema.parse(event));
      },
    },
    processDocument,
  );
  cleanup.push(() => service.close());
  await service.create(folder, "Ingest");
  const db = service.getDatabase();
  const row = () =>
    db.prepare("SELECT * FROM documents WHERE path='docs/board.md'").get() as
      | { sha256: string; status: string }
      | undefined;
  return { root, folder, service, db, events, row };
}

it("publishes processor chunks and locators atomically with indexed status", async () => {
  const h = await harness(async () => ({
    status: "indexed",
    chunks: [
      {
        text: "Board > Power\n3.3 V supply",
        locator: { type: "heading", path: ["Board", "Power"], slug: "power", start: 2, end: 3 },
      },
      {
        text: "second paragraph",
        locator: { type: "heading", path: ["Board", "Power"], slug: "power", start: 4, end: 4 },
      },
    ],
  }));
  await writeFile(join(h.folder, "docs/board.md"), "# Board\n## Power\n3.3 V supply\nsecond paragraph");
  await h.service.reindexDocuments();
  expect(h.row()).toMatchObject({ status: "indexed" });
  const chunks = h.db.prepare("SELECT ordinal,text,locator_json,chars FROM chunks ORDER BY ordinal").all();
  expect(chunks).toHaveLength(2);
  expect(chunks[0]).toEqual({
    ordinal: 0,
    text: "Board > Power\n3.3 V supply",
    chars: 26,
    locator_json: JSON.stringify({
      type: "heading",
      path: ["Board", "Power"],
      slug: "power",
      start: 2,
      end: 3,
    }),
  });
  await rm(join(h.folder, "docs/board.md"));
  await h.service.reindexDocuments();
  expect(h.db.prepare("SELECT * FROM chunks").all()).toEqual([]);
});

it("synchronizes real watcher add/change/unlink with document rows and events", async () => {
  const h = await harness();
  await writeFile(join(h.folder, "docs/board.md"), "board one");
  await expect.poll(h.row, { timeout: 7000 }).toMatchObject({ status: "pending" });
  const hash = h.row()?.sha256;
  expect(hash).toMatch(/^[a-f0-9]{64}$/);
  await writeFile(join(h.folder, "docs/board.md"), "board two");
  await expect.poll(() => h.row()?.sha256, { timeout: 7000 }).not.toBe(hash);
  await rm(join(h.folder, "docs/board.md"));
  await expect.poll(h.row, { timeout: 7000 }).toBeUndefined();
  expect(h.events.filter((e) => e.topic === "workbench" && e.event.type === "index.document")).toHaveLength(
    3,
  );
  expect(h.events.some((e) => e.topic === "workbench" && e.event.type === "index.progress")).toBe(true);
}, 25000);

it("debounces bursts for one second and skips identical hashes without processing/events", async () => {
  let calls = 0;
  const h = await harness(async () => {
    calls++;
    return { status: "indexed" };
  });
  await writeFile(join(h.folder, "docs/board.md"), "one");
  await expect.poll(h.row, { timeout: 7000 }).toMatchObject({ status: "indexed" });
  const saved = h.row();
  const marker = h.events.length;
  await writeFile(join(h.folder, "docs/board.md"), "one");
  await expect
    .poll(
      () =>
        h.events
          .slice(marker)
          .some((e) => e.topic === "workbench" && e.event.type === "index.progress" && e.event.pending === 0),
      { timeout: 7000 },
    )
    .toBe(true);
  expect(h.row()).toEqual(saved);
  expect(calls).toBe(1);
  expect(
    h.events.slice(marker).filter((e) => e.topic === "workbench" && e.event.type === "index.document"),
  ).toEqual([]);
  await writeFile(join(h.folder, "docs/board.md"), "two");
  await new Promise((resolve) => setTimeout(resolve, 200));
  await writeFile(join(h.folder, "docs/board.md"), "three");
  await new Promise((resolve) => setTimeout(resolve, 500));
  expect(calls).toBe(1);
  await expect.poll(() => calls, { timeout: 7000 }).toBe(2);
}, 25000);

it("enforces inclusive PDF/text limits and records unsupported type/binary reasons", async () => {
  const h = await harness();
  // PDF bytes are opaque to ingest; sparse files exercise actual sizes cheaply.
  for (const [name, bytes] of [
    ["exact.pdf", PDF_LIMIT],
    ["large.pdf", PDF_LIMIT + 1],
    ["large.txt", TEXT_LIMIT + 1],
  ] as const) {
    const file = await open(join(h.folder, "docs", name), "w");
    await file.truncate(bytes);
    await file.close();
  }
  await writeFile(join(h.folder, "docs/exact.txt"), Buffer.alloc(TEXT_LIMIT, 65));
  await writeFile(join(h.folder, "docs/blob.txt"), Buffer.from([0, 1, 2]));
  await writeFile(join(h.folder, "docs/blob.bin"), "opaque");
  await h.service.reindexDocuments();
  const rows = new DocumentsRepository(h.db);
  expect(rows.get("docs/exact.pdf")).toMatchObject({ status: "pending", bytes: PDF_LIMIT });
  expect(rows.get("docs/exact.txt")).toMatchObject({ status: "pending", bytes: TEXT_LIMIT });
  for (const path of ["docs/large.pdf", "docs/large.txt"])
    expect(rows.get(path)).toMatchObject({ status: "unsupported", error: "SIZE_LIMIT", sha256: null });
  expect(rows.get("docs/blob.bin")).toMatchObject({ status: "unsupported", error: "TYPE_UNSUPPORTED" });
  expect(rows.get("docs/blob.txt")).toMatchObject({ status: "unsupported", error: "BINARY" });
}, 15000);

function derived(h: Awaited<ReturnType<typeof harness>>) {
  h.db.exec("CREATE TABLE embeddings(chunk_id INTEGER PRIMARY KEY,model_id TEXT,dim INTEGER,vector BLOB);");
  const doc = new DocumentsRepository(h.db).get("docs/board.md");
  const id = h.db
    .prepare("INSERT INTO chunks(doc_id,ordinal,text,chars) VALUES(?,0,'uniquetoken',11)")
    .run(doc?.id).lastInsertRowid;
  h.db.prepare("INSERT INTO embeddings VALUES(?,'test',1,?)").run(id, Buffer.alloc(4));
}
it("searches real extracted watcher chunks through change, hash skip, reindex and deletion", async () => {
  const h = await harness(
    createDocumentProcessor(async () => {
      throw Error("PDF unused");
    }),
  );
  const search = new KeywordSearch(h.db);
  const path = join(h.folder, "docs/board.md");
  await writeFile(path, "# Registers\n## Control\nI2C1_CR1 defines enable bits.");
  await expect.poll(() => search.search("C1_CR"), { timeout: 7000 }).toHaveLength(1);
  expect(search.search("I2C1_CR1")[0]).toMatchObject({
    path: "docs/board.md",
    locator: { type: "heading", slug: "control", start: 2, end: 3 },
  });
  const original = search.search("I2C1_CR1");
  const marker = h.events.length;
  await writeFile(path, "# Registers\n## Control\nI2C1_CR1 defines enable bits.");
  await expect
    .poll(
      () =>
        h.events
          .slice(marker)
          .some((e) => e.topic === "workbench" && e.event.type === "index.progress" && e.event.pending === 0),
      { timeout: 7000 },
    )
    .toBe(true);
  expect(search.search("I2C1_CR1")).toEqual(original);
  await writeFile(path, "# Registers\n## Status\nSPI2_SR defines status flags.");
  await expect.poll(() => search.search("PI2_SR"), { timeout: 7000 }).toHaveLength(1);
  expect(search.search("I2C1_CR1")).toEqual([]);
  await h.service.reindexDocuments();
  expect(search.search("SPI2_SR")).toHaveLength(1);
  await rm(path);
  await expect.poll(() => search.search("SPI2_SR"), { timeout: 7000 }).toEqual([]);
  for (const table of ["chunks_fts", "chunks_tri"])
    h.db.prepare(`INSERT INTO ${table}(${table},rank) VALUES('integrity-check',1)`).run();
}, 25000);
function expectDerivedEmpty(h: Awaited<ReturnType<typeof harness>>) {
  for (const table of ["chunks", "embeddings"])
    expect(h.db.prepare(`SELECT * FROM ${table}`).all()).toEqual([]);
  for (const table of ["chunks_fts", "chunks_tri"])
    expect(h.db.prepare(`SELECT rowid FROM ${table} WHERE ${table} MATCH 'uniquetoken'`).all()).toEqual([]);
}
it.each(["delete", "change", "reindex"] as const)(
  "atomically clears derived FTS/embeddings/chunks on %s",
  async (action) => {
    const h = await harness();
    await writeFile(join(h.folder, "docs/board.md"), "one");
    await h.service.reindexDocuments();
    derived(h);
    if (action === "reindex") await h.service.reindexDocuments();
    else if (action === "delete") {
      await rm(join(h.folder, "docs/board.md"));
      await expect.poll(h.row, { timeout: 7000 }).toBeUndefined();
    } else {
      const hash = h.row()?.sha256;
      await writeFile(join(h.folder, "docs/board.md"), "two");
      await expect.poll(() => h.row()?.sha256, { timeout: 7000 }).not.toBe(hash);
    }
    expectDerivedEmpty(h);
    if (action !== "delete") expect(h.row()).toMatchObject({ status: "pending" });
  },
  12000,
);

it("respects includes/excludes/ignore negation, permanent roots and live policy changes", async () => {
  const h = await harness();
  for (const dir of ["docs/.git", "docs/.VERA", "docs/node_modules", "firmware"])
    await mkdir(join(h.folder, dir), { recursive: true });
  for (const path of [
    "docs/board.md",
    "docs/no.md",
    "docs/keep.md",
    "docs/excluded.md",
    "docs/.git/g.txt",
    "docs/.VERA/v.txt",
    "docs/node_modules/n.txt",
    "firmware/readme.md",
  ])
    await writeFile(join(h.folder, path), "text");
  await writeFile(join(h.folder, ".veraignore"), "docs/*.md\n!docs/board.md\n!docs/keep.md\n");
  await h.service.updateConfig({
    docs: { include: ["**/*.md", "**/*.txt"], exclude: ["docs/keep.md", "docs/excluded.md"] },
  });
  await h.service.reindexDocuments();
  const rows = new DocumentsRepository(h.db);
  expect(rows.list().map((r) => r.path)).toEqual(["WORKBENCH.md", "docs/board.md", "firmware/readme.md"]);
  await writeFile(join(h.folder, ".veraignore"), "docs/\n");
  await expect.poll(() => rows.get("docs/board.md"), { timeout: 7000 }).toBeUndefined();
  await h.service.updateConfig({ docs: { include: [] } });
  await expect.poll(() => rows.list(), { timeout: 7000 }).toEqual([]);
}, 18000);

it("rejects escaped globs and directory redirection without reading outside documents", async () => {
  const h = await harness();
  const external = join(h.root, "outside");
  await mkdir(external);
  await writeFile(join(external, "secret.md"), "outside data");
  await symlink(external, join(h.folder, "docs/linked"), process.platform === "win32" ? "junction" : "dir");
  await h.service.reindexDocuments();
  expect(new DocumentsRepository(h.db).list()).toEqual([]);
  await h.service.updateConfig({ docs: { include: ["../outside/**"] } });
  await expect(h.service.reindexDocuments()).rejects.toThrow("Glob must stay inside the workbench");
}, 12000);

it.skipIf(process.platform === "win32")("skips both internal and external file symlinks", async () => {
  const h = await harness();
  await writeFile(join(h.folder, "docs/board.md"), "inside");
  await writeFile(join(h.root, "outside.md"), "outside");
  await symlink(join(h.root, "outside.md"), join(h.folder, "docs/out.md"));
  await symlink(join(h.folder, "docs/board.md"), join(h.folder, "docs/in.md"));
  await h.service.reindexDocuments();
  expect(new DocumentsRepository(h.db).list().map((r) => r.path)).toEqual(["docs/board.md"]);
});

it("reports processor results/failure and continues the queue without leaking raw errors", async () => {
  const h = await harness(async ({ path }) => {
    if (path.endsWith("a.md")) throw Error("secret raw absolute path");
    if (path.endsWith("b.pdf")) return { status: "needs_ocr", pages: 2 };
    return { status: "indexed" };
  });
  for (const path of ["docs/a.md", "docs/b.pdf", "docs/c.html"])
    await writeFile(join(h.folder, path), "data");
  await h.service.reindexDocuments();
  const rows = new DocumentsRepository(h.db);
  expect(rows.get("docs/a.md")).toMatchObject({ status: "failed", error: "PROCESSING", indexedAt: null });
  expect(rows.get("docs/b.pdf")).toMatchObject({
    status: "needs_ocr",
    error: "NEEDS_OCR",
    pages: 2,
    indexedAt: null,
  });
  expect(rows.get("docs/c.html")).toMatchObject({ status: "indexed", error: null });
  expect(JSON.stringify(h.events)).not.toContain("secret raw");
  expect(
    h.events.some(
      (e) =>
        e.topic === "workbench" &&
        e.event.type === "index.progress" &&
        e.event.failed === 1 &&
        e.event.pending === 0,
    ),
  ).toBe(true);
});

it("serializes processors and aborts/drains them before closing or switching storage", async () => {
  let active = 0,
    maximum = 0,
    entered = false,
    aborted = false;
  const h = await harness(async ({ signal }) => {
    active++;
    maximum = Math.max(maximum, active);
    entered = true;
    await new Promise<void>((resolve) =>
      signal.addEventListener(
        "abort",
        () => {
          aborted = true;
          resolve();
        },
        { once: true },
      ),
    );
    active--;
    return { status: "indexed" };
  });
  await writeFile(join(h.folder, "docs/board.md"), "one");
  await writeFile(join(h.folder, "docs/two.md"), "two");
  await expect.poll(() => entered, { timeout: 7000 }).toBe(true);
  const other = join(h.root, "other");
  await mkdir(other);
  await h.service.create(other, "other");
  expect(aborted).toBe(true);
  expect(active).toBe(0);
  expect(maximum).toBe(1);
  expect(h.db.open).toBe(false);
  expect(
    h.events.filter(
      (e) =>
        e.topic === "workbench" &&
        e.event.type === "index.document" &&
        e.event.document?.status === "indexed",
    ),
  ).toEqual([]);
}, 12000);

it("close aborts explicit reindex processing without waiting behind it", async () => {
  let entered = false,
    release: () => void = () => {};
  const h = await harness(async ({ signal }) => {
    entered = true;
    await new Promise<void>((resolve) => {
      release = resolve;
      signal.addEventListener("abort", () => resolve(), { once: true });
    });
    return { status: "indexed" };
  });
  await writeFile(join(h.folder, "docs/board.md"), "one");
  const indexing = h.service.reindexDocuments();
  await expect.poll(() => entered).toBe(true);
  const closing = h.service.close();
  try {
    const closed = await Promise.race([
      closing.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1500)),
    ]);
    expect(closed).toBe(true);
  } finally {
    release();
    await indexing;
    await closing;
  }
});

it("unselected continuous writes cannot starve selected documents", async () => {
  const h = await harness();
  await mkdir(join(h.folder, "firmware"));
  await h.service.reindexDocuments();
  let count = 0;
  const timer = setInterval(() => {
    void writeFile(join(h.folder, "firmware/live.log"), String(count++));
  }, 150);
  try {
    await writeFile(join(h.folder, "docs/board.md"), "one");
    await expect.poll(h.row, { timeout: 2500 }).toMatchObject({ status: "pending" });
  } finally {
    clearInterval(timer);
  }
}, 7000);

it.each(["docs", "docs/"])(
  "directory selector %s keeps real file events synchronized",
  async (include) => {
    const h = await harness();
    await h.service.updateConfig({ docs: { include: [include] } });
    await writeFile(join(h.folder, "docs/board.md"), "one");
    await h.service.reindexDocuments();
    // Let startup/config batches settle before proving file-event admission.
    await new Promise((resolve) => setTimeout(resolve, 1300));
    const hash = h.row()?.sha256;
    await writeFile(join(h.folder, "docs/board.md"), "two");
    await expect.poll(() => h.row()?.sha256, { timeout: 3000 }).not.toBe(hash);
    await rm(join(h.folder, "docs/board.md"));
    await expect.poll(h.row, { timeout: 3000 }).toBeUndefined();
  },
  12000,
);

it("directory excludes and negative includes cannot starve selected document events", async () => {
  const h = await harness();
  await mkdir(join(h.folder, "docs/generated"));
  await mkdir(join(h.folder, "docs/excluded"));
  await h.service.updateConfig({
    docs: { include: ["docs", "!docs/generated"], exclude: ["docs/excluded/"] },
  });
  await h.service.reindexDocuments();
  let count = 0;
  const jobs: Promise<unknown>[] = [];
  const timer = setInterval(() => {
    for (const dir of ["generated", "excluded"])
      jobs.push(writeFile(join(h.folder, `docs/${dir}/live.log`), String(count++)));
  }, 150);
  try {
    await writeFile(join(h.folder, "docs/board.md"), "one");
    await expect.poll(h.row, { timeout: 2500 }).toMatchObject({ status: "pending" });
    expect(new DocumentsRepository(h.db).list().map((r) => r.path)).toEqual(["docs/board.md"]);
  } finally {
    clearInterval(timer);
    await Promise.all(jobs);
  }
}, 7000);

it("keeps read-only snapshots and lost-token source storage untouched", async () => {
  const h = await harness();
  await writeFile(join(h.folder, "docs/board.md"), "one");
  await h.service.reindexDocuments();
  const rows = new DocumentsRepository(h.db),
    before = rows.list();
  const lockPath = join(h.folder, ".vera/lock");
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  await writeFile(lockPath, JSON.stringify({ ...lock, token: "foreign" }));
  await writeFile(join(h.folder, "docs/board.md"), "two");
  const marker = h.events.length;
  await expect
    .poll(
      () =>
        h.events
          .slice(marker)
          .some((e) => e.topic === "workbench" && e.event.type === "index.progress" && e.event.failed === 1),
      { timeout: 7000 },
    )
    .toBe(true);
  expect(rows.list()).toEqual(before);
  await expect(h.service.reindexDocuments()).rejects.toMatchObject({ code: "DENIED" });
  await h.service.open(h.folder);
  expect(h.service.getSnapshot().readOnly).toBe(true);
  await expect(h.service.reindexDocuments()).rejects.toMatchObject({ code: "DENIED" });
  expect(new DocumentsRepository(h.service.getDatabase()).list()).toEqual(before);
}, 12000);
