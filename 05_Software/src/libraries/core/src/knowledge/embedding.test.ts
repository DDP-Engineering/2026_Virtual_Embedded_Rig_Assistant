import { getEventListeners } from "node:events";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import { build } from "esbuild";
import { expect, it } from "vitest";
import { DocumentsRepository } from "../storage/repos/documents.js";
import { schemaSql } from "../storage/schema.js";
import { EmbeddingHost } from "./embedding.js";
import { DocumentKnowledge } from "./search.js";

const software = fileURLToPath(new URL("../../../../../", import.meta.url));
const manifest = JSON.parse(await readFile(join(software, "src/models/model-manifest.json"), "utf8"));
it("disables native telemetry in the parent before a worker initializes", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "vera-embedding-privacy-"));
  const entry = join(temporary, "worker.mjs");
  const prior = process.env.ORT_DISABLE_TELEMETRY;
  process.env.ORT_DISABLE_TELEMETRY = "0";
  const host = new EmbeddingHost(pathToFileURL(entry), "unused", manifest);
  try {
    expect(process.env.ORT_DISABLE_TELEMETRY).toBe("1");
    await writeFile(
      entry,
      `import {parentPort} from 'node:worker_threads';
      const disabledAtStartup = process.env.ORT_DISABLE_TELEMETRY === '1';
      parentPort.on('message', () => parentPort.postMessage({ok:disabledAtStartup,
        result:[Array.from({length:384},(_,i)=>Number(i===0))]}));`,
    );
    expect(await host.embed(temporary, ["local"], new AbortController().signal)).toHaveLength(1);
  } finally {
    await host.dispose();
    if (prior === undefined) delete process.env.ORT_DISABLE_TELEMETRY;
    else process.env.ORT_DISABLE_TELEMETRY = prior;
    await rm(temporary, { recursive: true, force: true });
  }
});
it("runs local CPU batches32, enforces full query budget and caches deterministic normalized cosine", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "vera-embedding-"));
  const entry = join(temporary, "worker.mjs");
  const host = new EmbeddingHost(pathToFileURL(entry), join(software, "src/models"), manifest);
  try {
    await symlink(
      join(software, "node_modules"),
      join(temporary, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await build({
      entryPoints: [join(software, "src/libraries/core/src/knowledge/embedding-worker.ts")],
      outfile: entry,
      bundle: true,
      platform: "node",
      format: "esm",
      packages: "external",
      target: "node24",
    });
    const signal = new AbortController().signal;
    const vectors = await host.embed(
      temporary,
      Array.from({ length: 33 }, (_, n) =>
        n % 2 ? "I2C1_CR1 control register enables I2C." : "The supply voltage is 3.3 V.",
      ),
      signal,
    );
    expect(vectors).toHaveLength(33);
    expect(vectors.every((v) => v.length === 384 && Math.abs(Math.hypot(...v) - 1) < 0.0001)).toBe(true);
    const rows = vectors.map((vector, n) => ({ id: n + 1, vector }));
    const first = await host.rank(temporary, "1", rows, "I2C control register", signal);
    expect(first[0]?.id).toBe(2);
    expect(host.cached(temporary, "1")).toBe(true);
    expect(await host.rank(temporary, "1", undefined, "I2C control register", signal)).toEqual(first);
    const db = new Database(":memory:");
    try {
      db.pragma("foreign_keys=ON");
      db.exec(schemaSql);
      await mkdir(join(temporary, "docs"));
      const repository = new DocumentsRepository(db);
      for (const [n, text] of [
        "The supply voltage is 3.3 V.",
        "I2C1_CR1 enables the I2C register.",
      ].entries()) {
        const path = `docs/${n}.txt`;
        await writeFile(join(temporary, path), text);
        const vector = vectors[n];
        if (!vector) throw Error("Fixture vector missing");
        const doc = repository.save({
          path,
          kind: "text",
          sha256: "a".repeat(64),
          bytes: 100,
          mtime: new Date().toISOString(),
          pages: null,
          status: "indexed",
          error: null,
          indexedAt: null,
        });
        repository.replaceChunks(doc.id, [{ text, locator: { type: "lines", start: 1, end: 1 } }], {
          modelId: host.modelId,
          vectors: [vector],
          extraction: { kind: "text", lines: [text] },
        });
      }
      const knowledge = new DocumentKnowledge(temporary, db, host);
      await knowledge.search({ query: "supply", mode: "semantic", pathGlob: "docs/0.txt" }, signal);
      const concurrent = await Promise.all([
        knowledge.search({ query: "register", mode: "semantic", pathGlob: "docs/1.txt" }, signal),
        knowledge.search({ query: "supply", mode: "semantic", pathGlob: "docs/0.txt" }, signal),
      ]);
      expect(concurrent.map((r) => r.results[0]?.path)).toEqual(["docs/1.txt", "docs/0.txt"]);
    } finally {
      db.close();
    }
    const only = await host.rank(temporary, "2", [{ id: 99, vector: vectors[0]! }], "supply", signal);
    expect(only.map((r) => r.id)).toEqual([99]);
    await expect(host.rank(temporary, "2", undefined, "token ".repeat(520), signal)).rejects.toThrow(
      /budget/,
    );
    expect(host.cached(temporary, "2")).toBe(false);
    expect(getEventListeners(signal, "abort")).toHaveLength(0);
    await host.release(temporary);
  } finally {
    await host.dispose();
    await rm(temporary, { recursive: true, force: true });
  }
}, 30000);
it("lets a busy worker finish its native call before terminating it after abort or release", async () => {
  // ONNX Runtime aborts the whole process (0xE06D7363) when its worker is terminated mid-call.
  const temporary = await mkdtemp(join(tmpdir(), "vera-embedding-retire-")),
    entry = join(temporary, "worker.mjs"),
    marker = join(temporary, "replied.txt");
  const host = new EmbeddingHost(pathToFileURL(entry), "unused", manifest, 5000);
  try {
    await mkdir(join(temporary, "bench"));
    await writeFile(
      entry,
      `import {parentPort} from 'node:worker_threads'; import {appendFileSync} from 'node:fs';
parentPort.on('message',()=>setTimeout(()=>{appendFileSync(${JSON.stringify(marker)},'x');parentPort.postMessage({ok:true,result:[Array.from({length:384},(_,n)=>Number(n===0))]});},400));`,
    );
    const controller = new AbortController();
    const pending = host.embed(temporary, ["a"], controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const aborted = performance.now();
    controller.abort();
    await expect(pending).rejects.toThrow(/abort/);
    // The caller is released at once; the worker keeps running until its reply.
    expect(performance.now() - aborted).toBeLessThan(250);
    await host.release(temporary);
    expect(await readFile(marker, "utf8")).toBe("x");
    // Release of a busy workbench also waits for the reply instead of terminating mid-call.
    const second = host.embed(temporary, ["a"], new AbortController().signal);
    await new Promise((resolve) => setTimeout(resolve, 150));
    await host.release(temporary);
    await second.catch(() => {});
    expect(await readFile(marker, "utf8")).toBe("xx");
  } finally {
    await host.dispose();
    await rm(temporary, { recursive: true, force: true });
  }
}, 20000);
it("terminates deadline, abort, crash and premature exit jobs and replaces workers", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "vera-embedding-failure-")),
    entry = join(temporary, "worker.mjs");
  // Allow Windows worker startup; the nonresponding worker still verifies the deadline.
  const host = new EmbeddingHost(pathToFileURL(entry), "unused", manifest, 1000);
  try {
    await mkdir(join(temporary, "bench"));
    await writeFile(
      entry,
      "import {parentPort} from 'node:worker_threads'; parentPort.on('message',()=>{});",
    );
    await expect(host.embed(temporary, ["a"], new AbortController().signal)).rejects.toThrow(/deadline/);
    const controller = new AbortController(),
      pending = host.embed(temporary, ["a"], controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow(/abort/);
    await host.release(temporary);
    await writeFile(entry, "throw Error('crash');");
    await expect(host.embed(temporary, ["a"], new AbortController().signal)).rejects.toThrow(/failed|exited/);
    await writeFile(entry, "process.exit(0);");
    await expect(host.embed(temporary, ["a"], new AbortController().signal)).rejects.toThrow(/exited/);
    await writeFile(
      entry,
      "import {parentPort} from 'node:worker_threads'; parentPort.on('message',()=>parentPort.postMessage({ok:true,result:[Array.from({length:384},(_,n)=>Number(n===0))]}));",
    );
    expect(await host.embed(temporary, ["a"], new AbortController().signal)).toHaveLength(1);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  } finally {
    await host.dispose();
    await rm(temporary, { recursive: true, force: true });
  }
});
