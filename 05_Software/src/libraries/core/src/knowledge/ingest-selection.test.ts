// REQ-FUNC-c1a1c758 REQ-NFR-89d6114f REQ-DATA-d727f6e1 REQ-FUNC-a187563c
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.reverse().splice(0)) await close();
});
async function harness(layout: Record<string, string>, docs: { include: string[]; exclude?: string[] }) {
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
  await service.updateConfig({ docs: { include: docs.include, exclude: docs.exclude ?? [] } });
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
