import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workbenchSchema } from "@vera/shared";
import Database from "better-sqlite3";
import { afterEach, expect, it, vi } from "vitest";
import { DocumentsRepository } from "../storage/repos/documents.js";
import { schemaSql } from "../storage/schema.js";
import { type DocumentProcessor, type DocumentResult, Ingester } from "./ingest.js";
import { inspectSource } from "./inspect.js";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.reverse().splice(0)) await close();
});
async function fixture(process: DocumentProcessor) {
  const root = await mkdtemp(join(tmpdir(), "vera-unchanged-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const db = new Database(":memory:");
  cleanup.push(async () => db.close());
  db.pragma("foreign_keys=ON");
  db.exec(schemaSql);
  await mkdir(join(root, "docs"));
  await mkdir(join(root, ".vera"));
  const config = workbenchSchema.parse({
    format: 1,
    id: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C",
    name: "Board",
    docs: { include: ["docs/**"], exclude: [] },
  });
  const open = () => {
    const ingest = new Ingester({
      root,
      db,
      config: () => config,
      assertWritable: () => {},
      now: () => new Date(),
      emit: () => {},
      process,
    });
    cleanup.push(() => ingest.close());
    return ingest;
  };
  const f = {
    path: join(root, "docs/a.md"),
    ingest: open(),
    rows: new DocumentsRepository(db),
    reconcile: async () => {
      f.ingest.request();
      await f.ingest.waitIdle();
    },
    /** Closes the workbench's ingest and opens it again over the same database. */
    reopen: async () => {
      await f.ingest.close();
      f.ingest = open();
    },
  };
  return f;
}
/** A file last written `secondsAgo`, as a document that already lay in the folder. */
async function writeDated(path: string, text: string, secondsAgo: number) {
  await writeFile(path, text);
  const at = new Date(Date.now() - secondsAgo * 1000);
  await utimes(path, at, at);
}
function processor(result: () => Promise<DocumentResult>) {
  const inspect = vi.fn(inspectSource);
  const process = vi.fn(result);
  return { inspect, process, port: Object.assign(process, { inspect }) as unknown as DocumentProcessor };
}
const indexed = async (): Promise<DocumentResult> => ({ status: "indexed", chunks: [] });

it("does not read an indexed file again until its size or time changes or the user reindexes", async () => {
  const { inspect, process, port } = processor(indexed);
  const f = await fixture(port);
  await writeDated(f.path, "# A", 60);
  await f.reconcile();
  expect(f.rows.get("docs/a.md")?.status).toBe("indexed");
  await f.reconcile();
  expect(inspect).toHaveBeenCalledTimes(1);
  // Same size, another time: read and processed again.
  await writeDated(f.path, "# B", 30);
  await f.reconcile();
  expect(inspect).toHaveBeenCalledTimes(2);
  expect(process).toHaveBeenCalledTimes(2);
  await f.reconcile();
  expect(inspect).toHaveBeenCalledTimes(2);
  await f.ingest.reindex();
  expect(inspect).toHaveBeenCalledTimes(3);
  expect(process).toHaveBeenCalledTimes(3);
});

it("reads a file again when it was indexed right after its last write", async () => {
  const { inspect, process, port } = processor(indexed);
  const f = await fixture(port);
  await writeFile(f.path, "# A");
  await f.reconcile();
  await f.reconcile();
  // Its time cannot prove it unchanged, its hash does: read twice, processed once.
  expect(inspect).toHaveBeenCalledTimes(2);
  expect(process).toHaveBeenCalledTimes(1);
});

it("tries a failed document once per open, then only after a content change or Reindex", async () => {
  const { process, port } = processor(async () => {
    throw Error("corrupt");
  });
  const f = await fixture(port);
  await writeFile(f.path, "# A");
  await f.reconcile();
  expect(f.rows.get("docs/a.md")).toMatchObject({ status: "failed", error: "PROCESSING" });
  await f.reconcile();
  expect(process).toHaveBeenCalledTimes(1);
  expect(f.rows.get("docs/a.md")?.status).toBe("failed");
  // The next open gives the stored failure one more try.
  await f.reopen();
  await f.reconcile();
  await f.reconcile();
  expect(process).toHaveBeenCalledTimes(2);
  expect(f.rows.get("docs/a.md")?.status).toBe("failed");
  await f.ingest.reindex();
  expect(process).toHaveBeenCalledTimes(3);
  await writeFile(f.path, "# A, repaired");
  await f.reconcile();
  expect(process).toHaveBeenCalledTimes(4);
});

it("tries a document again after a read failure", async () => {
  const { inspect, port } = processor(indexed);
  inspect.mockRejectedValueOnce(Object.assign(Error("locked"), { code: "EBUSY" }));
  const f = await fixture(port);
  await writeFile(f.path, "# A");
  await f.reconcile();
  expect(f.rows.get("docs/a.md")).toMatchObject({ status: "failed", error: "IO" });
  await f.reconcile();
  expect(f.rows.get("docs/a.md")?.status).toBe("indexed");
});
