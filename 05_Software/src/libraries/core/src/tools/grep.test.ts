import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import * as api from "../index.js";
import { workerFixture } from "../workers/worker.test-support.js";

let root = "";
let pool: api.NodeWorkerPool | undefined;
let bundle: ReturnType<typeof workerFixture> | undefined;
afterEach(async () => {
  await pool?.dispose();
  bundle?.close();
  if (root) await rm(root, { recursive: true, force: true });
});
it("runs all grep options inside a worker with ignored/binary/oversized skips and line refs", async () => {
  expect(api.grepTool).toBeDefined();
  root = await mkdtemp(join(tmpdir(), "vera-grep-"));
  await mkdir(join(root, "docs"));
  await mkdir(join(root, ".vera"));
  await writeFile(join(root, "docs/notes.txt"), "before\nHello\nafter\nHELLO\nend\n");
  await writeFile(join(root, "docs/hidden.txt"), "hello");
  await writeFile(join(root, ".vera/cache.txt"), "hello");
  await writeFile(join(root, "docs/binary.txt"), Buffer.from([0, ...Buffer.from("hello")]));
  await writeFile(join(root, "docs/big.txt"), "hello".repeat(1048577));
  await writeFile(join(root, ".vera/.veraignore"), "docs/hidden.txt\n");
  bundle = workerFixture();
  pool = new api.NodeWorkerPool(bundle.url);
  const ctx = api.createToolContext(root, pool);
  const call = (args: unknown) => api.grepTool.execute(ctx, args, new AbortController().signal);
  expect(
    await call({ pattern: "hello", glob: "*.txt", path: "docs", ignoreCase: true, context: 1 }),
  ).toMatchObject({
    matches: [
      {
        path: "docs/notes.txt",
        line: 2,
        text: "Hello",
        ref: "docs/notes.txt#L2-L2",
        context: [
          { line: 1, text: "before" },
          { line: 3, text: "after" },
        ],
      },
      { path: "docs/notes.txt", line: 4 },
    ],
    truncated: false,
  });
  expect(await call({ pattern: "Hello", glob: "docs/*.txt", output: "files" })).toMatchObject({
    paths: ["docs/notes.txt"],
  });
  expect(await call({ pattern: "hello", path: "docs", ignoreCase: true, output: "count" })).toMatchObject({
    counts: [{ path: "docs/notes.txt", count: 2 }],
  });
  expect(await call({ pattern: "hello", ignoreCase: true, maxResults: 1 })).toMatchObject({
    matches: [{ line: 2 }],
    truncated: true,
  });
  await expect(call({ pattern: "[" })).rejects.toThrow(/regex|regular expression/i);
  // One file as the path is searched itself, and unsearched files are counted, not silently dropped.
  expect(await call({ pattern: "Hello", path: "docs/notes.txt" })).toMatchObject({
    matches: [{ path: "docs/notes.txt", line: 2 }],
  });
  expect(await call({ pattern: "Hello", path: "docs/notes.txt", glob: "*.log" })).toMatchObject({
    matches: [],
    truncated: false,
  });
  await expect(call({ pattern: "Hello", path: "docs/missing" })).rejects.toThrow(
    /search path does not exist/i,
  );
  expect(await call({ pattern: "hello", path: "docs", ignoreCase: true })).toMatchObject({ skippedFiles: 2 });
  // A bare name pattern reaches files below the top level.
  expect(await call({ pattern: "Hello", glob: "*.txt", output: "files" })).toMatchObject({
    paths: ["docs/notes.txt"],
  });
  await mkdir(join(root, ".vera/runs"));
  await writeFile(join(root, ".vera/runs/run_01ABC.log"), "build failure\n");
  expect(await call({ pattern: "failure", path: ".vera/runs/run_01ABC.log" })).toMatchObject({
    matches: [{ path: ".vera/runs/run_01ABC.log", line: 1 }],
  });
  await writeFile(
    join(root, "docs/console.txt"),
    Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("startup ready\n", "utf16le")]),
  );
  expect(await call({ pattern: "ready", path: "docs/console.txt" })).toMatchObject({
    matches: [{ path: "docs/console.txt", line: 1, text: "startup ready" }],
  });
}, 15_000);

// REQ-FUNC-0df8e905 REQ-FUNC-820e2701
it("returns up to the session's Grep results and skips files above its Grep file size", async () => {
  root = await mkdtemp(join(tmpdir(), "vera-grep-limits-"));
  await mkdir(join(root, "docs"));
  await writeFile(join(root, "docs/many.txt"), Array.from({ length: 80 }, () => "needle").join("\n"));
  await writeFile(join(root, "docs/two-mib.txt"), `marker\n${"z".repeat(2 * 1024 * 1024)}`);
  await writeFile(join(root, "docs/half-mib.txt"), `marker\n${"z".repeat(512 * 1024)}`);
  bundle = workerFixture();
  pool = new api.NodeWorkerPool(bundle.url);
  const limits: Record<string, number> = { grepResults: 50, grepFileMB: 1 };
  const ctx = { ...api.createToolContext(root, pool), advanced: ((key: string) => limits[key]) as never };
  const count = async (args: Record<string, unknown>) =>
    (
      (await api.grepTool.execute(ctx, { pattern: "needle", ...args }, new AbortController().signal))
        .matches as unknown[]
    ).length;
  expect(await count({})).toBe(50);
  expect(
    (await api.grepTool.execute(ctx, { pattern: "needle" }, new AbortController().signal)).truncated,
  ).toBe(true);
  expect(await count({ maxResults: 60 })).toBe(50);
  expect(await count({ maxResults: 10 })).toBe(10);
  const files = async () =>
    (await api.grepTool.execute(ctx, { pattern: "marker", output: "files" }, new AbortController().signal))
      .paths;
  expect(await files()).toEqual(["docs/half-mib.txt"]);
  limits.grepFileMB = 3;
  expect(await files()).toEqual(["docs/half-mib.txt", "docs/two-mib.txt"]);
  // The schema accepts up to the setting's largest value.
  expect(api.grepParams.safeParse({ pattern: "x", maxResults: 2000 }).success).toBe(true);
});

it("limits files and count by matching paths without cutting the totals within a file", async () => {
  root = await mkdtemp(join(tmpdir(), "vera-grep-modes-"));
  await writeFile(join(root, "a.txt"), "needle\n".repeat(20));
  await writeFile(join(root, "b.txt"), "needle\n".repeat(3));
  await writeFile(join(root, "c.txt"), "needle\n");
  bundle = workerFixture();
  pool = new api.NodeWorkerPool(bundle.url);
  const ctx = api.createToolContext(root, pool);
  const call = (output: string, maxResults: number, path?: string) =>
    api.grepTool.execute(ctx, { pattern: "needle", output, maxResults, path }, new AbortController().signal);
  expect(await call("files", 2)).toEqual({ paths: ["a.txt", "b.txt"], truncated: true });
  expect(await call("count", 2)).toEqual({
    counts: [
      { path: "a.txt", count: 20 },
      { path: "b.txt", count: 3 },
    ],
    truncated: true,
  });
  expect(await call("count", 1, "a.txt")).toEqual({
    counts: [{ path: "a.txt", count: 20 }],
    truncated: false,
  });
}, 15_000);

it.each(["content", "files", "count"] as const)(
  "continues searching after a long matching preview for %s output",
  async (output) => {
    root = await mkdtemp(join(tmpdir(), "vera-grep-long-match-"));
    await writeFile(join(root, "00-long.txt"), `hit${"x".repeat(20000)}`);
    await writeFile(join(root, "99-short.txt"), "hit");
    bundle = workerFixture();
    pool = new api.NodeWorkerPool(bundle.url);
    const result = await api.grepTool.execute(
      api.createToolContext(root, pool),
      { pattern: "hit", output },
      new AbortController().signal,
    );
    expect(result.truncated).toBe(output === "content");
    if (output === "files") expect(result.paths).toEqual(["00-long.txt", "99-short.txt"]);
    else if (output === "count")
      expect(result.counts).toEqual([
        { path: "00-long.txt", count: 1 },
        { path: "99-short.txt", count: 1 },
      ]);
    else
      expect(result.matches).toMatchObject([
        { path: "00-long.txt", text: `hit${"x".repeat(15997)}` },
        { path: "99-short.txt", text: "hit" },
      ]);
  },
);

it.each(["content", "files", "count"] as const)(
  "continues searching after long emitted context for %s output",
  async (output) => {
    root = await mkdtemp(join(tmpdir(), "vera-grep-long-context-"));
    await writeFile(join(root, "00-long.txt"), `${"x".repeat(3000)}\nhit`);
    await writeFile(join(root, "99-short.txt"), "hit");
    bundle = workerFixture();
    pool = new api.NodeWorkerPool(bundle.url);
    const result = await api.grepTool.execute(
      api.createToolContext(root, pool),
      { pattern: "hit", output, context: 1 },
      new AbortController().signal,
    );
    expect(result.truncated).toBe(output === "content");
    if (output === "files") expect(result.paths).toEqual(["00-long.txt", "99-short.txt"]);
    else if (output === "count")
      expect(result.counts).toEqual([
        { path: "00-long.txt", count: 1 },
        { path: "99-short.txt", count: 1 },
      ]);
    else
      expect(result.matches).toMatchObject([
        { path: "00-long.txt", context: [{ line: 1, text: "x".repeat(2000) }] },
        { path: "99-short.txt", text: "hit" },
      ]);
  },
);

it("does not mark an excluded matching line as clipped context", async () => {
  root = await mkdtemp(join(tmpdir(), "vera-grep-excluded-context-"));
  await writeFile(join(root, "00-long.txt"), `hit${"x".repeat(3000)}`);
  await writeFile(join(root, "99-short.txt"), "hit");
  bundle = workerFixture();
  pool = new api.NodeWorkerPool(bundle.url);
  const result = await api.grepTool.execute(
    api.createToolContext(root, pool),
    { pattern: "hit", context: 1 },
    new AbortController().signal,
  );
  expect(result).toMatchObject({ truncated: false, matches: [{ context: [] }, { context: [] }] });
});
