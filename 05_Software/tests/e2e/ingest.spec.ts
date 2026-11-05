import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron, expect, test } from "@playwright/test";
import type { VeraBridge, WorkbenchEvent } from "@vera/shared";
import Database from "better-sqlite3";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

const desktop = join(dirname(fileURLToPath(import.meta.url)), "../../src/apps/desktop");
type IngestWindow = Window & {
  vera: VeraBridge;
  indexEvents: WorkbenchEvent[];
  indexTimings: {
    elapsed: number;
    type: string;
    status?: string;
    path?: string;
    pending?: number;
    done?: number;
    failed?: number;
  }[];
};
test("native hosts ingest and reindex through confined IPC/events, then close and reopen", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-ingest-native-"));
  const folder = join(root, "bench");
  await mkdir(folder);
  const env = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === "string"),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  const executable = join(
    desktop,
    "../../../node_modules/electron/dist",
    process.platform === "win32" ? "electron.exe" : "electron",
  );
  const app = await _electron.launch({
    executablePath: executable,
    chromiumSandbox: true,
    args: [desktop, `--user-data-dir=${join(root, "data")}`],
    env,
  });
  const stdout: Buffer[] = [],
    stderr: Buffer[] = [];
  const processHandle = app.process();
  processHandle.stdout?.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
  processHandle.stderr?.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
  const started = new Date().toISOString();
  const loaded = await app.evaluate(() => ({
    execPath: process.execPath,
    electron: process.versions.electron,
    node: process.versions.node,
  }));
  try {
    expect(await realpath(loaded.execPath)).toBe(await realpath(executable));
    expect(loaded.electron).toBe("44.7.0");
    await installNetworkGuard(app);
    const page = await app.firstWindow();
    await page.waitForFunction(() => !!(window as unknown as Window & { vera?: VeraBridge }).vera);
    await page.evaluate(async (folder) => {
      const host = window as unknown as IngestWindow;
      const bench = await host.vera.invoke("workbench.create", { folder, name: "Native ingest" });
      host.indexEvents = [];
      host.indexTimings = [];
      const start = performance.now();
      host.vera.subscribe("workbench", bench.config.id, (event) => {
        host.indexEvents.push(event);
        if (event.type.startsWith("index."))
          host.indexTimings.push({
            elapsed: performance.now() - start,
            type: event.type,
            ...(event.type === "index.document"
              ? { path: event.path, ...(event.document ? { status: event.document.status } : {}) }
              : {}),
            ...(event.type === "index.progress"
              ? { pending: event.pending, done: event.done, failed: event.failed }
              : {}),
          });
      });
    }, folder);
    await mkdir(join(folder, "docs"));
    await writeFile(join(folder, "docs/board.md"), "board one");
    const records = () =>
      page.evaluate(() =>
        (window as unknown as Window & { indexEvents: WorkbenchEvent[] }).indexEvents.filter(
          (e) =>
            e.type === "index.document" && e.path === "docs/board.md" && e.document?.status === "indexed",
        ),
      );
    try {
      await expect.poll(records).toHaveLength(1);
    } catch (error) {
      // Preserve phase evidence on failure without changing the assertion or its deadline.
      const evidence: Record<string, unknown> = {};
      let diagnosticTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        evidence.renderer = await Promise.race([
          page.evaluate(async () => {
            const host = window as unknown as IngestWindow;
            const start = performance.now();
            const info = await host.vera.invoke("app.info", {});
            const { config } = await host.vera.invoke("workbench.config.get", {});
            const volume = await host.vera.invoke("docs.volume", { workbenchId: config.id });
            return { phases: host.indexTimings, info, volume, responsivenessMs: performance.now() - start };
          }),
          new Promise((resolve) => {
            diagnosticTimer = setTimeout(() => resolve({ unresponsive: true }), 1000);
          }),
        ]);
        const db = new Database(join(folder, ".vera/vera.db"), { readonly: true, timeout: 0 });
        try {
          evidence.documents = db.prepare("SELECT path,status,error FROM documents").all();
        } finally {
          db.close();
        }
        const json = JSON.stringify(evidence, null, 2);
        if (process.env.VERA_E2E_EVIDENCE_DIR) {
          await mkdir(process.env.VERA_E2E_EVIDENCE_DIR, { recursive: true });
          await writeFile(
            join(
              process.env.VERA_E2E_EVIDENCE_DIR,
              `ingest-first-index-failure-${process.pid}-${Date.now()}.json`,
            ),
            json,
            { flag: "wx" },
          );
        } else console.error("Native ingest first-index failure evidence:", json);
      } catch (diagnosticError) {
        console.error(
          "Native ingest diagnostic unavailable:",
          diagnosticError instanceof Error ? diagnosticError.name : "unknown",
        );
      } finally {
        clearTimeout(diagnosticTimer);
      }
      throw error;
    }
    const first = (await records())[0];
    expect(first).toMatchObject({ path: "docs/board.md", document: { status: "indexed", kind: "markdown" } });
    const firstHash = first?.type === "index.document" ? first.document?.sha256 : null;
    await writeFile(join(folder, "docs/board.md"), "board two");
    await expect.poll(records).toHaveLength(2);
    const second = (await records())[1];
    expect(second?.type === "index.document" ? second.document?.sha256 : null).not.toBe(firstHash);
    const fixtures = join(desktop, "../../../tests/fixtures/documents");
    await writeFile(join(folder, "docs/pages.pdf"), await readFile(join(fixtures, "pages.pdf")));
    await writeFile(join(folder, "docs/scanned.pdf"), await readFile(join(fixtures, "scanned.pdf")));
    // Code and logs beside the documents are not indexed (TASK-e5310cdb).
    await writeFile(join(folder, "docs/firmware.c"), "int main(void) { return 0; }");
    await writeFile(join(folder, "docs/build.log"), "build ok");
    await page.evaluate(async () => {
      await (window as unknown as Window & { vera: VeraBridge }).vera.invoke("docs.reindex", {});
    });
    await expect.poll(records).toHaveLength(3);
    const pdfEvents = await page.evaluate(
      () => (window as unknown as Window & { indexEvents: WorkbenchEvent[] }).indexEvents,
    );
    expect(
      pdfEvents.some(
        (e) =>
          e.type === "index.document" &&
          e.path === "docs/pages.pdf" &&
          e.document?.status === "indexed" &&
          e.document.pages === 2,
      ),
    ).toBe(true);
    expect(
      pdfEvents.some(
        (e) =>
          e.type === "index.document" && e.path === "docs/scanned.pdf" && e.document?.status === "needs_ocr",
      ),
    ).toBe(true);
    expect(
      pdfEvents.some(
        (e) => e.type === "index.document" && (e.path === "docs/firmware.c" || e.path === "docs/build.log"),
      ),
    ).toBe(false);
    const volume = await page.evaluate(async () => {
      const api = (window as unknown as Window & { vera: VeraBridge }).vera;
      const { config } = await api.invoke("workbench.config.get", {});
      return (await api.invoke("docs.volume", { workbenchId: config.id })).volume;
    });
    expect(volume?.files).toBe(3);
    await page.evaluate(async () => {
      await (window as unknown as Window & { vera: VeraBridge }).vera.invoke("workbench.close", {});
    });
    const db = new Database(join(folder, ".vera/vera.db"), { readonly: true });
    try {
      const chunks = db
        .prepare(
          "SELECT locator_json,text,chars FROM chunks JOIN documents ON chunks.doc_id=documents.id WHERE documents.path='docs/pages.pdf' ORDER BY ordinal",
        )
        .all() as { locator_json: string; text: string; chars: number }[];
      expect(chunks.some((c) => JSON.parse(c.locator_json).page === 1 && c.text.includes("I2C1_CR1"))).toBe(
        true,
      );
      expect(chunks.some((c) => JSON.parse(c.locator_json).page === 2 && c.text.includes("WDG_KR"))).toBe(
        true,
      );
      expect(chunks.every((c) => c.chars === c.text.length && c.chars <= 1400)).toBe(true);
      const embeddings = db
        .prepare(`SELECT e.dim,e.vector,e.model_id FROM embeddings e
        JOIN chunks c ON c.id=e.chunk_id JOIN documents d ON d.id=c.doc_id WHERE d.path='docs/pages.pdf'`)
        .all() as { dim: number; vector: Buffer; model_id: string }[];
      expect(embeddings).toHaveLength(chunks.length);
      for (const embedding of embeddings) {
        expect(embedding.dim).toBe(384);
        expect(embedding.model_id).toContain("ea104dacec62c0de699686887e3f920caeb4f3e3");
        expect(
          Math.abs(Math.hypot(...new Float32Array(new Uint8Array(embedding.vector).buffer)) - 1),
        ).toBeLessThan(0.0001);
      }
      expect(db.prepare("SELECT count(*) FROM document_extractions").pluck().get()).toBe(2);
      const documents = db.prepare("SELECT sha256 FROM documents").all() as { sha256: string }[];
      for (const document of documents) {
        const cache = JSON.parse(
          await readFile(join(folder, `.vera/cache/extract/${document.sha256}.json`), "utf8"),
        );
        expect(cache.version).toBe(1);
        expect(cache.sha256).toBe(document.sha256);
      }
    } finally {
      db.close();
    }
    await rm(join(folder, "docs/board.md"));
    await page.evaluate(async (folder) => {
      await (window as unknown as Window & { vera: VeraBridge }).vera.invoke("workbench.open", { folder });
    }, folder);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as Window & { indexEvents: WorkbenchEvent[] }).indexEvents.filter(
              (e) => e.type === "index.document" && e.document === null,
            ).length,
        ),
      )
      .toBe(2);
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app.close();
    if (process.env.VERA_E2E_EVIDENCE_DIR) {
      const evidence = join(process.env.VERA_E2E_EVIDENCE_DIR, "ingest-native");
      await mkdir(evidence, { recursive: true });
      const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
      const main = await readFile(join(desktop, "out/main/index.js"));
      await writeFile(join(evidence, "main.js"), main);
      const workerHashes: Record<string, string> = {};
      for (const name of ["pdf-worker.js", "document-embedding-worker.js"]) {
        const bytes = await readFile(join(desktop, "out/main", name));
        await writeFile(join(evidence, name), bytes);
        workerHashes[name] = hash(bytes);
      }
      await writeFile(join(evidence, "stdout.log"), Buffer.concat(stdout));
      await writeFile(join(evidence, "stderr.log"), Buffer.concat(stderr));
      await writeFile(
        join(evidence, "execution.json"),
        JSON.stringify(
          {
            started,
            ended: new Date().toISOString(),
            ...loaded,
            argv: processHandle.spawnargs,
            exitCode: processHandle.exitCode,
            signalCode: processHandle.signalCode,
            mainSha256: hash(main),
            workerHashes,
            executableSha256: hash(await readFile(executable)),
          },
          null,
          2,
        ),
      );
    }
    await rm(root, { recursive: true, force: true });
  }
});
