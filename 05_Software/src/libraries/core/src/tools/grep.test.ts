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
});

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
