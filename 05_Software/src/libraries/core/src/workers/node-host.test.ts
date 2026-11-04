import { getEventListeners } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import * as api from "../index.js";
import { workerFixture } from "./worker.test-support.js";

let root: string;
let pool: api.NodeWorkerPool | undefined;
let bundle: ReturnType<typeof workerFixture> | undefined;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "vera-worker-test-"));
  await writeFile(join(root, "00-good.txt"), "ok");
  await writeFile(join(root, "99-bad.txt"), `${"a".repeat(30000)}!`);
});
afterEach(async () => {
  await pool?.dispose();
  bundle?.close();
  await rm(root, { recursive: true, force: true });
});
function host(deadlineMs = 1000, capacity = 1) {
  expect(api.NodeWorkerPool).toBeTypeOf("function");
  bundle = workerFixture();
  pool = new api.NodeWorkerPool(bundle.url, { deadlineMs, capacity });
  return pool;
}
const task = (pattern = "ok|(a+)+$") => ({ kind: "grep" as const, root, args: { pattern } });
it("owns an absolute deadline, terminates pathological matching with partial results and replaces capacity", async () => {
  const hostPool = host();
  expect(hostPool.deadlineMs).toBe(1000);
  const result = await hostPool.run(task(), new AbortController().signal);
  expect(result).toMatchObject({
    truncated: true,
    reason: "timeout",
    matches: [{ path: "00-good.txt", line: 1, text: "ok", ref: "00-good.txt#L1-L1" }],
  });
  expect(hostPool.activeCount).toBe(0);
  const next = await hostPool.run(
    { kind: "grep" as const, root, args: { pattern: "ok", glob: "00*" } },
    new AbortController().signal,
  );
  expect(next).toMatchObject({ truncated: false, matches: [{ path: "00-good.txt" }] });
});
it("aborts during matching and queued work, waits for termination and permits replacement", async () => {
  const hostPool = host(3000);
  const controller = new AbortController();
  let partial!: () => void;
  const received = new Promise<void>((resolve) => {
    partial = resolve;
  });
  const running = hostPool.run(task(), controller.signal, () => partial());
  await received;
  const queuedController = new AbortController();
  const queued = hostPool.run(task("ok"), queuedController.signal);
  queuedController.abort();
  expect(await queued).toMatchObject({ reason: "aborted", matches: [] });
  controller.abort();
  expect(await running).toMatchObject({ reason: "aborted", matches: [{ path: "00-good.txt" }] });
  expect(hostPool.activeCount).toBe(0);
  expect(
    (
      await hostPool.run(
        { kind: "grep" as const, root, args: { pattern: "ok", glob: "00*" } },
        new AbortController().signal,
      )
    ).matches,
  ).toHaveLength(1);
});
it("isolates one task per worker and a busy worker does not prevent another task", async () => {
  const hostPool = host(1500, 2);
  const controller = new AbortController();
  const busy = hostPool.run(task(), controller.signal);
  const ordinary = await hostPool.run(
    { kind: "grep" as const, root, args: { pattern: "ok", glob: "00*" } },
    new AbortController().signal,
  );
  expect(ordinary.matches).toHaveLength(1);
  controller.abort();
  expect(await busy).toMatchObject({ reason: "aborted" });
});
it("reports invalid regex errors and defaults to the production10 second deadline", async () => {
  const hostPool = host();
  expect(await hostPool.run(task("["), new AbortController().signal)).toMatchObject({
    error: expect.stringMatching(/regular expression|regex/i),
  });
  if (!bundle) throw Error("Worker fixture must exist.");
  const defaults = new api.NodeWorkerPool(bundle.url);
  expect(defaults.deadlineMs).toBe(10000);
  await defaults.dispose();
});
it("stops at the result ceiling before a later pathological match", async () => {
  const hostPool = host();
  const result = await hostPool.run(
    { kind: "grep" as const, root, args: { pattern: "ok|(a+)+$", maxResults: 1 } },
    new AbortController().signal,
  );
  expect(result.truncated).toBe(true);
  expect(result.matches).toHaveLength(1);
  expect(result.reason).toBeUndefined();
});

it("contains synchronous worker startup failure and restores capacity for real matching", async () => {
  bundle = workerFixture();
  const entry = new URL("https://invalid.example/grep-worker.js");
  pool = new api.NodeWorkerPool(entry, { capacity: 1, deadlineMs: 2000 });
  const controller = new AbortController();
  expect(await pool.run(task("ok"), controller.signal)).toEqual({
    matches: [],
    truncated: true,
    error: "Grep worker could not start. Retry the call.",
  });
  expect(pool.activeCount).toBe(0);
  expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  // The host owns this URL; correcting it keeps the same pool rather than constructing another.
  entry.href = bundle.url.href;
  expect(
    await pool.run(
      { kind: "grep" as const, root, args: { pattern: "ok", glob: "00*" } },
      new AbortController().signal,
    ),
  ).toEqual({
    truncated: false,
    matches: [{ path: "00-good.txt", line: 1, text: "ok", ref: "00-good.txt#L1-L1" }],
  });
  expect(pool.activeCount).toBe(0);
});
