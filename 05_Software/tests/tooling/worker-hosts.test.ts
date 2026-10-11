import { getEventListeners } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { NodeWorkerPool, WorkerHostOptions, WorkerPool } from "@vera/core";
import { buildSync } from "esbuild";
import { expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
async function compileHost(host: string, temporary: string) {
  const source = host === "cli" ? "apps/cli/src" : "apps/desktop/src/main";
  buildSync({
    entryPoints: {
      "worker-pool": join(root, source, "worker-pool.ts"),
      "grep-worker": join(root, source, "grep-worker.ts"),
    },
    outdir: temporary,
    platform: "node",
    format: "esm",
    bundle: true,
    alias: {
      "@vera/core": join(root, "packages/core/src/workers/node-host.ts"),
      "@vera/core/grep-worker": join(root, "packages/core/src/tools/grep-worker.ts"),
      "@vera/shared": join(root, "packages/shared/src/index.ts"),
    },
    target: "node24",
  });
  const adapter = (await import(pathToFileURL(join(temporary, "worker-pool.js")).href)) as {
    createCliWorkerPool?: (options?: WorkerHostOptions) => NodeWorkerPool;
    createDesktopWorkerPool?: (options?: WorkerHostOptions) => NodeWorkerPool;
  };
  const factory = host === "cli" ? adapter.createCliWorkerPool : adapter.createDesktopWorkerPool;
  expect(factory).toBeTypeOf("function");
  if (!factory) throw Error("Host factory must exist.");
  return factory;
}
it.each(["cli", "desktop"])(
  "%s compiled host aborts pathological matching and replaces its worker",
  async (host) => {
    const temporary = await mkdtemp(join(tmpdir(), "vera-host-adapter-"));
    let pool: WorkerPool | undefined;
    try {
      const factory = await compileHost(host, temporary);
      pool = factory();
      await writeFile(join(temporary, "00-good.txt"), "ok");
      await writeFile(join(temporary, "99-bad.txt"), `${"a".repeat(30000)}!`);
      const controller = new AbortController();
      let ready!: () => void;
      const partial = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const pending = pool.run(
        { root: temporary, args: { pattern: "ok|(a+)+$", glob: "*.txt" } },
        controller.signal,
        () => ready(),
      );
      await partial;
      controller.abort();
      expect(await pending).toMatchObject({
        truncated: true,
        reason: "aborted",
        matches: [{ path: "00-good.txt" }],
      });
      expect(
        await pool.run(
          { root: temporary, args: { pattern: "ok", glob: "00*" } },
          new AbortController().signal,
        ),
      ).toMatchObject({ truncated: false, matches: [{ path: "00-good.txt" }] });
    } finally {
      await pool?.dispose();
      await rm(temporary, { recursive: true, force: true });
    }
  },
);

it.each(
  ["cli", "desktop"].flatMap((host) =>
    (["crash", "early-exit", "missing-entry"] as const).map((failure) => [host, failure] as const),
  ),
)("%s compiled host recovers from real worker %s without fallback", async (host, failure) => {
  const temporary = await mkdtemp(join(tmpdir(), "vera-host-failure-"));
  let pool: NodeWorkerPool | undefined;
  try {
    const factory = await compileHost(host, temporary);
    const entry = join(temporary, "grep-worker.js");
    const original = await readFile(entry);
    await writeFile(join(temporary, "00-good.txt"), "before\nok\n");
    pool = factory({ capacity: 1, deadlineMs: 2000 });
    if (failure === "missing-entry") await rm(entry);
    else
      await writeFile(
        entry,
        `import { writeFileSync } from "node:fs";
import { parentPort, isMainThread, threadId } from "node:worker_threads";
writeFileSync(new URL("./worker-started.json", import.meta.url), JSON.stringify({ isMainThread, threadId }));
parentPort.once("message", () => { ${failure === "crash" ? 'throw Error("deterministic fixture crash");' : "process.exit(0);"} });
`,
      );
    const controller = new AbortController();
    const failed = await pool.run(
      { root: temporary, args: { pattern: "ok", glob: "*.txt" } },
      controller.signal,
    );
    expect(failed).toEqual({
      matches: [],
      truncated: true,
      error:
        failure === "early-exit"
          ? "Grep worker exited before completion. Retry the call."
          : "Grep worker failed. Retry the call.",
    });
    // A valid matching file exists during failure: any fallback would produce a match.
    expect(pool.activeCount).toBe(0);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    if (failure !== "missing-entry") {
      const started = JSON.parse(await readFile(join(temporary, "worker-started.json"), "utf8"));
      expect(started).toMatchObject({ isMainThread: false });
      expect(started.threadId).toBeGreaterThan(0);
    }
    // Restore the actual compiled grep entry; retain the same capacity-one pool and adapter.
    await writeFile(entry, original);
    const nextController = new AbortController();
    const matches: string[] = [];
    expect(
      await pool.run(
        { root: temporary, args: { pattern: "ok", glob: "*.txt" } },
        nextController.signal,
        (match) => matches.push(match.ref),
      ),
    ).toEqual({
      truncated: false,
      matches: [{ path: "00-good.txt", line: 2, text: "ok", ref: "00-good.txt#L2-L2" }],
    });
    expect(matches).toEqual(["00-good.txt#L2-L2"]);
    expect(pool.activeCount).toBe(0);
    expect(getEventListeners(nextController.signal, "abort")).toHaveLength(0);
  } finally {
    await pool?.dispose();
    await rm(temporary, { recursive: true, force: true });
  }
});
