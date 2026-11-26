// REQ-FUNC-c1a1c758 REQ-NFR-89d6114f REQ-DATA-d727f6e1 REQ-FUNC-a187563c
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { type EventEnvelope, eventEnvelopeSchema } from "@vera/shared";
import type { FSWatcher } from "chokidar";
import { afterEach, expect, it, vi } from "vitest";

const record = vi.hoisted(() => ({ listed: [] as string[], opened: [] as string[] }));
const watched = vi.hoisted(() => [] as FSWatcher[]);
vi.mock("node:fs", async (original) => {
  const actual = await original<typeof import("node:fs")>();
  const readdir = ((path: string, ...rest: unknown[]) => {
    record.listed.push(String(path));
    return (actual.readdir as (...args: unknown[]) => void)(path, ...rest);
  }) as typeof actual.readdir;
  return { ...actual, readdir };
});
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  const open = ((path: string, ...rest: unknown[]) => {
    record.opened.push(String(path));
    return (actual.open as (...args: unknown[]) => unknown)(path, ...rest);
  }) as typeof actual.open;
  return { ...actual, open };
});
vi.mock("chokidar", async (original) => {
  const actual = await original<typeof import("chokidar")>();
  return {
    ...actual,
    watch: (...args: Parameters<typeof actual.watch>) => {
      const watcher = actual.watch(...args);
      watched.push(watcher);
      return watcher;
    },
  };
});

import { SettingsService } from "../settings/service.js";
import { DocumentsRepository } from "../storage/repos/documents.js";
import { WorkbenchService } from "../workbench/service.js";
import { selectDocuments } from "./selection.js";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.reverse().splice(0)) await close();
});
async function harness(
  layout: Record<string, string>,
  docs: { include: string[]; exclude?: string[]; gitignore?: boolean },
) {
  const root = await mkdtemp(join(tmpdir(), "vera-select-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const folder = join(root, "bench");
  for (const [path, text] of Object.entries(layout)) {
    await mkdir(join(folder, path, ".."), { recursive: true });
    await writeFile(join(folder, path), text);
  }
  await mkdir(folder, { recursive: true });
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
  const service = new WorkbenchService({
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
  });
  cleanup.push(() => service.close());
  await service.create(folder, "Select");
  await service.updateConfig({
    docs: { include: docs.include, exclude: docs.exclude ?? [], gitignore: docs.gitignore ?? true },
  });
  record.listed.length = 0;
  record.opened.length = 0;
  await service.reindexDocuments();
  const rel = (path: string) => relative(folder, path).split(/[\\/]/).filter(Boolean).join("/");
  const rows = () =>
    new DocumentsRepository(service.getDatabase())
      .list()
      .map((row) => row.path)
      .sort();
  return { folder, service, events, rows, rel };
}

it("selects, reads and records only document files, in any letter case", async () => {
  const documents = [
    "docs/board.pdf",
    "docs/notes.md",
    "docs/spec.docx",
    "docs/readme.txt",
    "docs/BOARD2.PDF",
    // Tables such as pinouts and register maps are documents too (RULING-005).
    "docs/pinout.csv",
    "docs/registers.tsv",
  ];
  const others = ["src/main.c", "logs/build.log", "data/data.json", "docs/old.doc", "bin/tool.exe"];
  const h = await harness(
    Object.fromEntries([...documents, ...others].map((path) => [path, `content of ${path}`])),
    { include: ["**/*"] },
  );
  expect(h.rows()).toEqual([...documents].sort());
  const opened = record.opened.map(h.rel);
  for (const path of documents) expect(opened).toContain(path);
  for (const path of others) expect(opened).not.toContain(path);
  const announced = h.events.flatMap((e) => (e.event.type === "index.document" ? [e.event.path] : []));
  for (const path of documents) expect(announced).toContain(path);
  for (const path of others) expect(announced).not.toContain(path);
});

// REQ-FUNC-eade110e REQ-FUNC-2336bfd2 REQ-FUNC-ad5868a2
it("leaves out what the root and nested .gitignore files exclude while docs.gitignore is on", async () => {
  const layout = {
    ".gitignore": ".venv/\nhtmlcov/\nbuild/html/\ndocs/gen.md\n!.git/\n!node_modules/\n",
    ".venv/lib/site/readme.md": "# venv",
    "htmlcov/index.html": "<p>coverage</p>",
    "build/html/index.html": "<p>generated</p>",
    "build/manual.pdf": "%PDF-1.4",
    "docs/guide.md": "# Guide",
    "docs/.gitignore": "draft.md\n",
    "docs/draft.md": "# below docs",
    "draft.md": "# at the root",
    "docs/gen.md": "# brought back by .veraignore",
    ".vera/.veraignore": "!docs/gen.md\n",
    ".git/notes.md": "# vcs",
    "node_modules/pkg/readme.md": "# dependency",
  };
  const real = ["build/manual.pdf", "docs/gen.md", "docs/guide.md", "draft.md"];
  const on = await harness(layout, { include: ["**/*"] });
  expect(on.rows()).toEqual(real);
  // IDX-04-A: the preview of the same folder counts exactly what was indexed.
  const preview = (h: typeof on, gitignore: boolean) =>
    h.service.previewDocuments(h.folder, { include: ["**/*"], exclude: [], gitignore, maxFiles: 10000 });
  expect(await preview(on, true)).toMatchObject({ files: real.length, truncated: false, guard: null });
  expect(record.opened.map(on.rel).filter((path) => path.startsWith(".venv"))).toEqual([]);
  const off = await harness(layout, { include: ["**/*"], gitignore: false });
  expect(off.rows()).toEqual(
    [
      ...real,
      ".venv/lib/site/readme.md",
      "build/html/index.html",
      "docs/draft.md",
      "htmlcov/index.html",
    ].sort(),
  );
  expect((await preview(off, false)).files).toBe(off.rows().length);
});

it("keeps folders that an allowlist .veraignore re-includes", async () => {
  const h = await harness(
    {
      ".vera/.veraignore": "*\n!*/\n!*.pdf\n",
      "docs/a.pdf": "%PDF-1.4",
      "docs/notes.md": "# ignored by the allowlist",
      "other/deep/b.pdf": "%PDF-1.4",
    },
    { include: ["**/*"] },
  );
  expect(h.rows()).toEqual(["docs/a.pdf", "other/deep/b.pdf"]);
});

it("lists and watches no folder excluded by docs.exclude, .veraignore or node_modules", async () => {
  const layout: Record<string, string> = {
    "docs/c.pdf": "%PDF-1.4",
    "extra/d.pdf": "%PDF-1.4",
    ".vera/.veraignore": "ignored/\n",
  };
  for (const top of ["skipped", "ignored", "node_modules"]) {
    layout[`${top}/a.pdf`] = "%PDF-1.4";
    layout[`${top}/deep/b.pdf`] = "%PDF-1.4";
  }
  const h = await harness(layout, { include: ["**/*"], exclude: ["skipped/**"] });
  expect(h.rows()).toEqual(["docs/c.pdf", "extra/d.pdf"]);
  const listed = record.listed.map(h.rel);
  expect(listed).toContain("docs");
  const outside = (path: string) =>
    ["skipped", "ignored", "node_modules"].some((top) => path === top || path.startsWith(`${top}/`));
  expect(listed.filter(outside)).toEqual([]);
  const registered = () => Object.keys((watched.at(-1) as FSWatcher).getWatched()).map(h.rel);
  // updateConfig replaces the docs/** watcher with a root watcher asynchronously.
  // Only the root watcher registers "extra"; the old docs/** watcher never does.
  await vi.waitFor(() => expect(registered()).toEqual(expect.arrayContaining(["", "docs", "extra"])), {
    timeout: 5000,
    interval: 50,
  });
  expect(registered().filter(outside)).toEqual([]);
  await writeFile(join(h.folder, ".vera/.veraignore"), "");
  await vi.waitFor(() => expect(registered()).toContain("ignored"), { timeout: 8000, interval: 100 });
  expect(registered().filter((path) => path === "skipped" || path === "node_modules")).toEqual([]);
});

// REQ-FUNC-eade110e
it("follows root and nested .gitignore edits while the workbench is open", async () => {
  const h = await harness(
    { ".gitignore": "", "docs/a.md": "# A", "docs/b.md": "# B", "docs/sub/c.md": "# C" },
    { include: ["docs/**"] },
  );
  expect(h.rows()).toEqual(["docs/a.md", "docs/b.md", "docs/sub/c.md"]);
  const until = (rows: string[]) =>
    vi.waitFor(() => expect(h.rows()).toEqual(rows), { timeout: 8000, interval: 100 });
  await writeFile(join(h.folder, ".gitignore"), "docs/a.md\n");
  await until(["docs/b.md", "docs/sub/c.md"]);
  await writeFile(join(h.folder, "docs/sub/.gitignore"), "*.md\n");
  await until(["docs/b.md"]);
  await writeFile(join(h.folder, ".gitignore"), "");
  await until(["docs/a.md", "docs/b.md"]);
}, 30000);

it("drops a stored row of a non-document file on the next reconciliation and keeps document rows", async () => {
  const h = await harness(
    { "docs/board.pdf": "%PDF-1.4", "src/main.c": "int main(void){}" },
    { include: ["**/*"] },
  );
  const repository = new DocumentsRepository(h.service.getDatabase());
  const board = repository.get("docs/board.pdf");
  // A row indexed under an earlier selection that still included source code.
  repository.save({
    path: "src/main.c",
    kind: "text",
    sha256: "a".repeat(64),
    bytes: 16,
    mtime: new Date().toISOString(),
    pages: null,
    status: "indexed",
    error: null,
    indexedAt: new Date().toISOString(),
  });
  const id = repository.get("src/main.c")?.id;
  const db = h.service.getDatabase();
  const chunk = db
    .prepare("INSERT INTO chunks(doc_id,ordinal,locator_json,text,chars) VALUES(?,0,'{}','int main',8)")
    .run(id).lastInsertRowid;
  db.prepare("INSERT INTO embeddings(chunk_id,model_id,dim,vector) VALUES(?,'m',384,?)").run(
    chunk,
    Buffer.alloc(384 * 4),
  );
  db.prepare("INSERT INTO document_extractions(doc_id,extraction_json) VALUES(?,'{}')").run(id);
  h.events.length = 0;
  // A watched change requests an ordinary reconciliation, not a rebuild.
  await writeFile(join(h.folder, "docs/trigger.md"), "# Trigger");
  await vi.waitFor(
    () =>
      expect(h.events.map((e) => e.event)).toContainEqual({
        type: "index.document",
        path: "src/main.c",
        document: null,
      }),
    { timeout: 8000, interval: 100 },
  );
  // The reconciliation has processed every selected document before the checks below.
  await vi.waitFor(
    () =>
      expect(h.events.map((e) => e.event)).toContainEqual(
        expect.objectContaining({ type: "index.progress", pending: 0 }),
      ),
    { timeout: 8000, interval: 100 },
  );
  expect(repository.get("src/main.c")).toBeUndefined();
  expect(h.service.getDatabase().prepare("SELECT COUNT(*) AS n FROM chunks WHERE doc_id=?").get(id)).toEqual({
    n: 0,
  });
  expect(db.prepare("SELECT COUNT(*) AS n FROM embeddings WHERE chunk_id=?").get(chunk)).toEqual({ n: 0 });
  expect(db.prepare("SELECT COUNT(*) AS n FROM document_extractions WHERE doc_id=?").get(id)).toEqual({
    n: 0,
  });
  expect(repository.get("docs/board.pdf")).toEqual(board);
  // The unchanged document is skipped by its hash: no event, no new processing.
  const touched = h.events.flatMap((e) => (e.event.type === "index.document" ? [e.event.path] : []));
  expect(touched).not.toContain("docs/board.pdf");
}, 15000);

it("reports the number and bytes of the selected documents after each selection", async () => {
  const h = await harness(
    {
      "docs/a.pdf": "a".repeat(100),
      "docs/b.md": "b".repeat(250),
      "docs/c.txt": "c".repeat(50),
      "src/x.c": "x",
    },
    { include: ["**/*"] },
  );
  expect(h.service.documentVolume()).toEqual({ files: 3, bytes: 400 });
  expect(h.events.map((e) => e.event)).toContainEqual({ type: "index.volume", files: 3, bytes: 400 });
  await rm(join(h.folder, "docs/b.md"));
  await h.service.reindexDocuments();
  expect(h.service.documentVolume()).toEqual({ files: 2, bytes: 150 });
});

it.skipIf(process.platform !== "win32")(
  "reports a document whose name the path guard refuses as skipped and records why",
  async () => {
    // A Windows device name is an ordinary file name on Linux, macOS and current Windows.
    const h = await harness({ "docs/aux.md": "# Aux", "docs/board.md": "# Board" }, { include: ["docs/**"] });
    expect(
      await selectDocuments({
        root: h.folder,
        docs: { include: ["docs/**"], exclude: [], gitignore: true, maxFiles: 10000 },
        signal: new AbortController().signal,
      }),
    ).toEqual({
      paths: [{ path: "docs/board.md", size: 7 }],
      skipped: [{ path: "docs/aux.md", size: 0, reason: "unsupported-name" }],
      retry: false,
    });
    const rows = new DocumentsRepository(h.service.getDatabase());
    expect(rows.get("docs/aux.md")).toMatchObject({
      status: "unsupported",
      error: "NAME_UNSUPPORTED",
      sha256: null,
    });
    expect(rows.get("docs/board.md")).toMatchObject({ error: null });
    expect(record.opened.map(h.rel)).not.toContain("docs/aux.md");
    expect(h.service.documentVolume()).toEqual({ files: 1, bytes: 7 });
  },
);

it.skipIf(process.platform === "win32")(
  "admits ordinary POSIX names with colons and Windows device spellings",
  async () => {
    const files = { "docs/aux.md": "# Aux", "docs/capture_12:30.txt": "Evidence" };
    const h = await harness(files, { include: ["docs/**"] });
    const rows = new DocumentsRepository(h.service.getDatabase());
    for (const path of Object.keys(files))
      expect(rows.get(path)).toMatchObject({ status: "pending", error: null });
  },
);

const MiB = 1024 * 1024;
/** A sparse file of `bytes` bytes: real sizes without writing them. */
async function sparse(path: string, bytes: number) {
  const file = await open(path, "w");
  await file.truncate(bytes);
  await file.close();
}

// REQ-FUNC-133f57ee REQ-DATA-9fd427f1 REQ-FUNC-ad5868a2
it("skips documents above docs.maxFileMB (PDF and Office) or the text size as too large", async () => {
  const h = await harness({ "docs/small.md": "small" }, { include: ["docs/**"] });
  await sparse(join(h.folder, "docs/scan.pdf"), 30 * MiB);
  await sparse(join(h.folder, "docs/exact.pdf"), 25 * MiB);
  await sparse(join(h.folder, "docs/huge.pdf"), 100 * MiB + 1);
  const select = (maxFileMB?: number, maxTextMB?: number) =>
    selectDocuments({
      root: h.folder,
      docs: {
        include: ["docs/**"],
        exclude: [],
        gitignore: true,
        maxFiles: 10000,
        ...(maxFileMB ? { maxFileMB } : {}),
        ...(maxTextMB ? { maxTextMB } : {}),
      },
      signal: new AbortController().signal,
    });
  expect(await select(25)).toEqual({
    paths: [
      { path: "docs/exact.pdf", size: 25 * MiB },
      { path: "docs/small.md", size: 5 },
    ],
    skipped: [
      { path: "docs/huge.pdf", size: 100 * MiB + 1, reason: "too-large" },
      { path: "docs/scan.pdf", size: 30 * MiB, reason: "too-large" },
    ],
    retry: false,
  });
  // Without the setting the 30 MB PDF is indexed and the 100 MB default stops the huge one; a larger
  // setting raises the limit.
  expect((await select()).skipped.map((entry) => entry.path)).toEqual(["docs/huge.pdf"]);
  expect((await select(150)).skipped).toEqual([]);
  // Text has its own limit, which docs.maxFileMB does not change.
  await sparse(join(h.folder, "docs/export.csv"), 2 * MiB);
  expect((await select(500, 1)).skipped.map((entry) => entry.path)).toEqual(["docs/export.csv"]);
  expect((await select(1)).skipped.map((entry) => entry.path)).not.toContain("docs/export.csv");
  await rm(join(h.folder, "docs/export.csv"));

  await h.service.updateConfig({ docs: { maxFileMB: 25 } });
  const yaml = await readFile(join(h.folder, ".vera/workbench.yaml"), "utf8");
  expect(yaml).toMatch(/^format: 1$/m);
  expect(yaml).toMatch(/^ {2}maxFileMB: 25$/m);
  expect(yaml).toMatch(/^ {2}maxFiles: 10000$/m);
  record.opened.length = 0;
  await h.service.reindexDocuments();
  const rows = new DocumentsRepository(h.service.getDatabase());
  for (const path of ["docs/scan.pdf", "docs/huge.pdf"])
    expect(rows.get(path)).toMatchObject({ status: "unsupported", error: "SIZE_LIMIT", sha256: null });
  expect(rows.get("docs/exact.pdf")).toMatchObject({ error: null, bytes: 25 * MiB });
  // A skipped document is recorded from its size alone, never opened; a selected one is read.
  expect(record.opened.map(h.rel)).toContain("docs/exact.pdf");
  expect(record.opened.map(h.rel)).not.toContain("docs/scan.pdf");
  expect(h.service.documentVolume()).toEqual({ files: 2, bytes: 25 * MiB + 5 });
  // IDX-04-A: the preview applies the same lowered limit and counts the indexed documents only.
  expect(
    await h.service.previewDocuments(h.folder, {
      include: ["docs/**"],
      exclude: [],
      gitignore: true,
      maxFileMB: 25,
      maxFiles: 10000,
    }),
  ).toMatchObject({ files: 2, bytes: 25 * MiB + 5, truncated: false });

  await h.service.updateConfig({ docs: { maxFileMB: null } });
  expect(await readFile(join(h.folder, ".vera/workbench.yaml"), "utf8")).not.toContain("maxFileMB");
  await h.service.reindexDocuments();
  expect(rows.get("docs/scan.pdf")).toMatchObject({ error: null, bytes: 30 * MiB });
  expect(rows.get("docs/huge.pdf")).toMatchObject({ status: "unsupported", error: "SIZE_LIMIT" });

  // REQ-FUNC-486d6a86: a raised limit indexes the document once; its later checks accept it, so the
  // ingest settles instead of reindexing it again and again.
  await h.service.updateConfig({ docs: { maxFileMB: 150 } });
  await h.service.reindexDocuments();
  expect(rows.get("docs/huge.pdf")).toMatchObject({ error: null, bytes: 100 * MiB + 1 });
  // The workbench text size reaches the ingest selection.
  await writeFile(join(h.folder, "docs/notes.txt"), "x".repeat(2 * MiB));
  await h.service.updateConfig({ advanced: { textFileMB: 1 } });
  await h.service.reindexDocuments();
  expect(rows.get("docs/notes.txt")).toMatchObject({ status: "unsupported", error: "SIZE_LIMIT" });
}, 30000);
