// REQ-FUNC-362ebed9 REQ-FUNC-f9d5ae8d REQ-REL-6a962d80
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EventEnvelope } from "@vera/shared";
import type { FSWatcher } from "chokidar";
import { afterEach, expect, it, vi } from "vitest";
import { SettingsService } from "../settings/service.js";
import { DocumentsRepository } from "../storage/repos/documents.js";
import { WorkbenchService } from "../workbench/service.js";
import type { DocumentProcessor, Ingester } from "./ingest.js";

let inspectSource: typeof import("./inspect.js").inspectSource;
let selectDocuments: typeof import("./selection.js").selectDocuments;
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.reverse().splice(0)) await close();
});
async function load() {
  ({ inspectSource } = await import("./inspect.js"));
  ({ selectDocuments } = await import("./selection.js"));
}
async function harness(processDocument: DocumentProcessor) {
  const root = await mkdtemp(join(tmpdir(), "vera-ports-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const folder = join(root, "bench");
  await mkdir(join(folder, "docs"), { recursive: true });
  const files = {
    read: async (path: string) => {
      try {
        return await readFile(path, "utf8");
      } catch {
        return undefined;
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
  const service = new WorkbenchService(
    {
      files,
      settings,
      pid: process.pid,
      appVersion: "0.0.0",
      now: () => new Date(),
      token: randomUUID,
      isProcessAlive: (pid) => pid === process.pid,
      changed: (event) => events.push(event),
    },
    processDocument,
  );
  cleanup.push(() => service.close());
  await service.create(folder, "Ports");
  const rows = () => new DocumentsRepository(service.getDatabase());
  return { folder, service, rows, events };
}
const indexed = { status: "indexed" as const, chunks: [] };

it("selects and inspects documents through the processor's ports when they are supplied", async () => {
  await load();
  const select = vi.fn((input: Parameters<typeof selectDocuments>[0]) => selectDocuments(input));
  const inspect = vi.fn((input: Parameters<typeof inspectSource>[0]) => inspectSource(input));
  const process = vi.fn(async () => indexed) as unknown as DocumentProcessor;
  Object.assign(process, { select, inspect });
  const h = await harness(process);
  await writeFile(join(h.folder, "docs/a.md"), "# A");
  await writeFile(join(h.folder, "docs/b.txt"), "b");
  await h.service.reindexDocuments();
  expect(select).toHaveBeenCalledWith(
    expect.objectContaining({ root: h.folder, docs: expect.objectContaining({ include: ["docs/**"] }) }),
  );
  expect(inspect.mock.calls.map(([input]) => input.path).sort()).toEqual(["docs/a.md", "docs/b.txt"]);
  expect(h.rows().get("docs/a.md")).toMatchObject({
    status: "indexed",
    sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  // The selection port decides what is selected: a scripted selection drops b.txt.
  select.mockImplementation(async () => ({
    paths: [{ path: "docs/a.md", size: 3 }],
    skipped: [],
    retry: false,
  }));
  await h.service.reindexDocuments();
  expect(h.rows().get("docs/b.txt")).toBeUndefined();
  expect(h.service.documentVolume()).toEqual({ files: 1, bytes: 3 });
});

it("keeps a document pending and retries it when the processor reports an interrupted indexer", async () => {
  await load();
  let interrupted = true;
  const process = vi.fn(async () => {
    if (interrupted) {
      interrupted = false;
      throw Object.assign(Error("Indexer interrupted."), { retry: true });
    }
    return indexed;
  }) as unknown as DocumentProcessor;
  const h = await harness(process);
  await writeFile(join(h.folder, "docs/a.md"), "# A");
  await h.service.reindexDocuments();
  // Not stored as failed: the reconciliation it requested indexes it.
  expect(h.rows().get("docs/a.md")?.status).not.toBe("failed");
  await vi.waitFor(() => expect(h.rows().get("docs/a.md")?.status).toBe("indexed"), {
    timeout: 6000,
    interval: 100,
  });
  expect(process).toHaveBeenCalledTimes(2);
}, 10000);

it("inspects a source in-process with identity, binary and change checks", async () => {
  await load();
  const root = await mkdtemp(join(tmpdir(), "vera-inspect-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "a.txt"), "hello");
  await writeFile(join(root, "b.txt"), Buffer.from([0, 1, 2]));
  const { lstat } = await import("node:fs/promises");
  const identity = async (name: string) => {
    const info = await lstat(join(root, name));
    return { ino: info.ino, dev: info.dev };
  };
  const signal = new AbortController().signal;
  expect(
    await inspectSource({ root, path: "a.txt", kind: "text", identity: await identity("a.txt"), signal }),
  ).toEqual({
    status: "ok",
    sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    binary: false,
  });
  expect(
    await inspectSource({ root, path: "b.txt", kind: "text", identity: await identity("b.txt"), signal }),
  ).toMatchObject({ status: "ok", binary: true });
  // A different file identity than the one main checked means the source changed.
  expect(
    await inspectSource({ root, path: "a.txt", kind: "text", identity: await identity("b.txt"), signal }),
  ).toEqual({ status: "changed" });
});

it("retries a document whose source vanished in the indexer instead of storing a failure", async () => {
  await load();
  let missing = true;
  const inspect = vi.fn(async (input: Parameters<typeof inspectSource>[0]) => {
    if (missing) {
      missing = false;
      throw Object.assign(Error("gone"), { code: "ENOENT" });
    }
    return inspectSource(input);
  });
  const process = Object.assign(
    vi.fn(async () => indexed),
    { inspect },
  ) as unknown as DocumentProcessor;
  const h = await harness(process);
  await writeFile(join(h.folder, "docs/a.md"), "# A");
  await h.service.reindexDocuments();
  expect(h.rows().get("docs/a.md")?.status).not.toBe("failed");
  await vi.waitFor(() => expect(h.rows().get("docs/a.md")?.status).toBe("indexed"), {
    timeout: 6000,
    interval: 100,
  });
}, 10000);

it("keeps the index when a reindex cannot obtain the selection", async () => {
  await load();
  let stopped = false;
  const select = vi.fn(async (input: Parameters<typeof selectDocuments>[0]) => {
    if (stopped) throw Object.assign(Error("Indexing stopped."), { retry: true });
    return selectDocuments(input);
  });
  const process = Object.assign(
    vi.fn(async () => indexed),
    { select },
  ) as unknown as DocumentProcessor;
  const h = await harness(process);
  await writeFile(join(h.folder, "docs/a.md"), "# A");
  await h.service.reindexDocuments();
  expect(h.rows().get("docs/a.md")?.status).toBe("indexed");
  stopped = true;
  await expect(h.service.reindexDocuments()).rejects.toThrow("Indexing stopped.");
  expect(h.rows().get("docs/a.md")?.status).toBe("indexed");
});

// RULING-006
it("stores a document as failed after two indexer crashes while it was processed, until it changes", async () => {
  await load();
  let crashes = 0;
  const process = vi.fn(async (input: { path: string }) => {
    if (input.path === "docs/poison.md") {
      crashes++;
      throw Object.assign(Error("The indexer process stopped."), { retry: true, crashed: true });
    }
    return indexed;
  }) as unknown as DocumentProcessor;
  const h = await harness(process);
  await writeFile(join(h.folder, "docs/poison.md"), "# Poison");
  await writeFile(join(h.folder, "docs/fine.md"), "# Fine");
  await h.service.reindexDocuments();
  await vi.waitFor(() => expect(h.rows().get("docs/poison.md")?.status).toBe("failed"), {
    timeout: 6000,
    interval: 100,
  });
  expect(h.rows().get("docs/poison.md")?.error).toBe("PROCESSING");
  expect(crashes).toBe(2);
  expect(h.rows().get("docs/fine.md")?.status).toBe("indexed");
  // Not retried while unchanged...
  h.service.refreshDocuments();
  await new Promise((resolve) => setTimeout(resolve, 1500));
  expect(crashes).toBe(2);
  // ...but a changed file is processed again.
  await writeFile(join(h.folder, "docs/poison.md"), "# Poison v2");
  await h.service.reindexDocuments();
  expect(crashes).toBeGreaterThan(2);
}, 15000);

it("persists the chunks and vectors a processor port returns", async () => {
  await load();
  const { createDocumentProcessor } = await import("./processor.js");
  const port = {
    modelId: "model@1",
    embed: async (_root: string, texts: string[]) =>
      texts.map(() => {
        const vector = new Float32Array(384);
        vector[0] = 1;
        return vector;
      }),
    rank: async () => [],
    release: async () => {},
  };
  // The indexer's real processor output, returned through the port as the desktop host does.
  const real = createDocumentProcessor(async () => ({ kind: "pdf", pages: [] }), port);
  const process = Object.assign((input: Parameters<DocumentProcessor>[0]) => real(input), {
    modelId: () => port.modelId,
  }) as DocumentProcessor;
  const h = await harness(process);
  await writeFile(join(h.folder, "docs/a.md"), "# A\n\nThe board uses a 3.3 V supply.\n");
  await h.service.reindexDocuments();
  const db = h.service.getDatabase();
  expect(h.rows().get("docs/a.md")?.status).toBe("indexed");
  const chunks = db.prepare("SELECT id, text FROM chunks").all() as { id: number; text: string }[];
  expect(chunks.length).toBeGreaterThan(0);
  expect(chunks[0]?.text).toContain("3.3 V supply");
  expect(db.prepare("SELECT model_id AS model, dim FROM embeddings").all()).toEqual(
    chunks.map(() => ({ model: "model@1", dim: 384 })),
  );
});

it("reports measured work, searchable passages and exceptions for the exact active lease", async () => {
  await load();
  let extracting = () => {};
  let resume = () => {};
  const entered = new Promise<void>((resolve) => {
    extracting = resolve;
  });
  const released = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const process: DocumentProcessor = async ({ path }) => {
    if (path.endsWith("b.txt")) {
      extracting();
      await released;
      return indexed;
    }
    if (path.endsWith("c.txt")) return { status: "needs_ocr" };
    if (path.endsWith("d.txt")) return { status: "failed" };
    return { status: "indexed", chunks: [{ text: "one", locator: { type: "lines", start: 1, end: 1 } }] };
  };
  const h = await harness(process);
  try {
    const { config, indexLease } = h.service.getSnapshot();
    const status = () => h.service.documentIndexStatus(config.id, indexLease);
    expect(status()).toMatchObject({ state: "scanning", progress: null });
    await Promise.all(
      ["a.txt", "b.txt", "c.txt", "d.txt"].map((name) => writeFile(join(h.folder, "docs", name), "text")),
    );
    await h.service.updateConfig({ docs: { maxFileMB: 1 } }, config.id);
    await writeFile(join(h.folder, "docs/e.txt"), Buffer.alloc(1024 * 1024 + 1, 65));
    const pass = h.service.reindexDocuments();
    await entered;
    expect(status()).toMatchObject({
      state: "indexing",
      searchable: 1,
      progress: { total: 5, processed: 1, exceptions: 0 },
    });
    h.service.refreshDocuments();
    resume();
    await pass;
    expect(status()).toMatchObject({ state: "scanning", progress: null, searchable: 1 });
    expect(
      h.events.some(({ event }) => event.type === "index.status" && event.status.state === "ready"),
    ).toBe(false);
    await vi.waitFor(
      () =>
        expect(status()).toMatchObject({
          state: "exceptions",
          searchable: 1,
          progress: { total: 5, processed: 5, exceptions: 3 },
        }),
      { timeout: 5000 },
    );
    h.service.setDocumentIndexerStopped(true);
    expect(status()).toMatchObject({ state: "stopped", progress: null, searchable: 1 });
    h.service.setDocumentIndexerStopped(false);
    expect(status()).toMatchObject({ state: "scanning", progress: null });
    await h.service.close();
    const reopened = await h.service.open(h.folder);
    expect(reopened.indexLease).not.toBe(indexLease);
    expect(status).toThrow(expect.objectContaining({ code: "CONFLICT" }));
    expect(h.service.documentIndexStatus(config.id, reopened.indexLease).state).toBe("scanning");
  } finally {
    resume();
  }
}, 10000);

it("keeps failed watcher generations blocked even after ready and recovers on Reindex", async () => {
  await load();
  const h = await harness(async () => ({
    status: "indexed",
    chunks: [{ text: "one", locator: { type: "lines", start: 1, end: 1 } }],
  }));
  const { config, indexLease } = h.service.getSnapshot();
  const status = () => h.service.documentIndexStatus(config.id, indexLease);
  const ingest = (h.service as unknown as { ingest: Ingester }).ingest;
  const watcher = () => (ingest as unknown as { watcher: FSWatcher }).watcher;
  await writeFile(join(h.folder, "docs/source.txt"), "one");
  await ingest.waitIdle();
  expect(status()).toMatchObject({ state: "ready", searchable: 1 });
  const old = watcher();
  old.emit("error", Error("Lost watcher"));
  expect(status()).toMatchObject({ state: "blocked", searchable: 1, progress: null });

  const binding = ingest as unknown as {
    createWatcher(targets: string[]): { watcher: FSWatcher };
  };
  const bind = binding.createWatcher.bind(ingest);
  const replace = vi.spyOn(binding, "createWatcher").mockImplementationOnce((targets) => {
    const created = bind(targets);
    queueMicrotask(() => {
      created.watcher.emit("error", Object.assign(Error("Registration denied"), { code: "EACCES" }));
      created.watcher.emit("ready");
      created.watcher.emit("all", "change", join(h.folder, "docs/source.txt"));
    });
    return created;
  });
  await h.service.reindexDocuments();
  await ingest.waitIdle();
  expect(replace).toHaveBeenCalledTimes(1);
  expect(watcher()).not.toBe(old);
  expect(status()).toMatchObject({ state: "blocked", searchable: 1, progress: null });

  await h.service.reindexDocuments();
  await ingest.waitIdle();
  expect(replace).toHaveBeenCalledTimes(2);
  expect(status()).toMatchObject({ state: "ready", searchable: 1 });
});
