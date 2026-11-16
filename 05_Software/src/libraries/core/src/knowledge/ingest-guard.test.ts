// REQ-FUNC-9a05625c REQ-FUNC-37067755 REQ-DATA-b12d0ef7 REQ-FUNC-09c7b5d0 REQ-FUNC-817bbf83
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type DocumentGuard, type EventEnvelope, eventEnvelopeSchema } from "@vera/shared";
import { afterEach, expect, it } from "vitest";
import { SettingsService } from "../settings/service.js";
import { DocumentsRepository } from "../storage/repos/documents.js";
import { WorkbenchService } from "../workbench/service.js";
import type { DocumentProcessor, Ingester } from "./ingest.js";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.reverse().splice(0)) await close();
});

/** `count` small Markdown files in `folder`, written in parallel batches. */
async function generate(folder: string, count: number, from = 0) {
  await mkdir(folder, { recursive: true });
  const names = Array.from({ length: count }, (_, n) =>
    join(folder, `${String(from + n).padStart(5, "0")}.md`),
  );
  for (let at = 0; at < names.length; at += 500)
    await Promise.all(names.slice(at, at + 500).map((name) => writeFile(name, "# Note\n")));
}

async function harness(prepare: (folder: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "vera-guard-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const folder = join(root, "bench");
  await prepare(folder);
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
  /** Every document handed to the processor, i.e. indexed. */
  const processed: string[] = [];
  const processDocument: DocumentProcessor = async ({ path }) => {
    processed.push(path);
    return { status: "indexed", chunks: [] };
  };
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
  const snapshot = await service.create(folder, "Guard");
  const rows = () => new DocumentsRepository(service.getDatabase()).list();
  const guards = () =>
    events.flatMap((envelope) => (envelope.event.type === "index.guard" ? [envelope.event.guard] : []));
  const approved = () =>
    service.getDatabase().prepare("SELECT value FROM meta WHERE key='index_approved_files'").pluck().get();
  return { folder, service, id: snapshot.config.id, events, processed, rows, guards, approved };
}

/**
 * IDX-03-A..C over a generated workbench: docs/big/a 2,000, docs/big/b 1,000 and docs/n00..n08 with
 * 1,000 Markdown files each, 12,000 in all, under the default docs.maxFiles of 10,000. Files added
 * later are written outside the workbench and moved in with one rename, so no reconciliation sees a
 * half-written step.
 */
it("stops an oversized selection before indexing anything and indexes after Index anyway", async () => {
  const h = await harness(async (folder) => {
    await generate(join(folder, "docs/big/a"), 2000);
    await generate(join(folder, "docs/big/b"), 1000);
    for (let n = 0; n < 9; n++) await generate(join(folder, `docs/n0${n}`), 1000);
  });
  // Test seam: the active Ingester, to wait until a reconciliation of the current disk state ends.
  const ingester = () => (h.service as unknown as { ingest: Ingester }).ingest;
  const settle = async () => {
    h.service.refreshDocuments();
    await ingester().waitIdle();
  };
  const stage = join(h.folder, "../stage");
  const add = async (name: string, folders: number[], count = (_n: number) => 1000) => {
    for (const n of folders) await generate(join(stage, name, `n${String(n).padStart(2, "0")}`), count(n));
    await rename(join(stage, name), join(h.folder, "docs", name));
  };
  await settle();
  const stopped: DocumentGuard = {
    files: 12000,
    limit: 10000,
    folders: [
      { path: "docs", files: 12000 },
      { path: "docs/big", files: 3000 },
      { path: "docs/big/a", files: 2000 },
      { path: "docs/big/b", files: 1000 },
      ...[0, 1, 2, 3, 4, 5].map((n) => ({ path: `docs/n0${n}`, files: 1000 })),
    ],
  };
  // IDX-03-A and C: the guard reports the count and top folders; nothing is recorded or indexed.
  expect(h.guards().at(-1)).toEqual(stopped);
  expect(h.service.documentGuard()).toEqual(stopped);
  expect(h.rows()).toEqual([]);
  expect(h.processed).toEqual([]);
  expect(h.service.documentVolume()).toMatchObject({ files: 12000 });
  // IDX-04-A and B: the preview of the same folder counts and guards the selection as indexing does.
  const preview = () =>
    h.service.previewDocuments(h.folder, {
      include: ["docs/**"],
      exclude: [],
      gitignore: true,
      maxFiles: 10000,
    });
  expect(await preview()).toMatchObject({ files: 12000, truncated: false, guard: stopped });

  // 10,000 files index without a stop.
  for (const n of [7, 8]) await rm(join(h.folder, `docs/n0${n}`), { recursive: true });
  await settle();
  expect(h.guards().at(-1)).toBeNull();
  expect(h.service.documentGuard()).toBeNull();
  expect(h.rows()).toHaveLength(10000);
  expect(new Set(h.processed).size).toBe(10000);
  expect(await preview()).toMatchObject({ files: 10000, guard: null });

  // Growing past the limit stops again; a guarded Reindex keeps the existing index as it is.
  await add("more", [7, 8]);
  await settle();
  const indexed = h.rows();
  let processed = h.processed.length;
  await h.service.reindexDocuments();
  expect(h.guards().at(-1)).toMatchObject({ files: 12000, limit: 10000 });
  expect(h.rows()).toEqual(indexed);
  expect(h.processed).toHaveLength(processed);

  // IDX-03-B: Index anyway approves 12,000 and all of them index.
  await expect(h.service.approveDocuments("wb_00000000000000000000000000", 12000)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  expect(h.approved()).toBeUndefined();
  await h.service.approveDocuments(h.id, 12000);
  expect(h.approved()).toBe("12000");
  await ingester().waitIdle();
  expect(h.guards().at(-1)).toBeNull();
  expect(h.rows()).toHaveLength(12000);

  // 500 more keep indexing.
  await add("extra", [9], () => 500);
  await settle();
  expect(h.guards().at(-1)).toBeNull();
  expect(h.rows()).toHaveLength(12500);

  // Doubling the selection stops again, at 120 % of the approved count, also after a Reindex.
  await add("double", [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21], (n) => (n < 21 ? 1000 : 500));
  await settle();
  processed = h.processed.length;
  await h.service.reindexDocuments();
  expect(h.guards().at(-1)).toMatchObject({ files: 24000, limit: 14400 });
  expect(h.rows()).toHaveLength(12500);
  expect(h.processed).toHaveLength(processed);
  expect(h.approved()).toBe("12000");
}, 600000);

// REQ-FUNC-817bbf83
it("applies the active workbench's approval to its own preview only", async () => {
  const h = await harness(async (folder) => generate(join(folder, "docs"), 3));
  const other = join(h.folder, "../other");
  await generate(join(other, "docs"), 3);
  await h.service.updateConfig({ docs: { maxFiles: 2 } });
  const preview = (folder: string) =>
    h.service.previewDocuments(folder, { include: ["docs/**"], exclude: [], gitignore: true, maxFiles: 2 });
  await h.service.reindexDocuments();
  expect(h.guards().at(-1)).toMatchObject({ files: 3, limit: 2 });
  expect((await preview(h.folder)).guard).toEqual(h.guards().at(-1));
  await h.service.approveDocuments(h.id, 3);
  expect((await preview(h.folder)).guard).toBeNull();
  expect((await preview(other)).guard).toMatchObject({ files: 3, limit: 2 });
});
