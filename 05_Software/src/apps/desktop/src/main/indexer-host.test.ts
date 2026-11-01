// REQ-FUNC-f9d5ae8d REQ-FUNC-362ebed9 REQ-FUNC-276a5da8 REQ-REL-6a962d80 REQ-REL-08946818 REQ-REL-4761ac1e
import { existsSync } from "node:fs";
import { beforeAll, expect, it, vi } from "vitest";

let IndexerHost: typeof import("./indexer-host.js").IndexerHost;
beforeAll(async () => {
  expect(existsSync(new URL("./indexer-host.ts", import.meta.url)), "indexer host exists").toBe(true);
  ({ IndexerHost } = await import("./indexer-host.js"));
});

type Message = { id?: number; type: string; [key: string]: unknown };
/** A scripted indexer endpoint: records requests and lets the test reply, crash or stay silent. */
function endpoint() {
  const listeners = { message: [] as ((m: unknown) => void)[], exit: [] as ((code: number) => void)[] };
  const sent: Message[] = [];
  const self = {
    pid: Math.floor(Math.random() * 10000) + 1,
    sent,
    killed: false,
    postMessage: (message: Message) => sent.push(message),
    on: (event: "message" | "exit", listener: (value: never) => void) => {
      listeners[event].push(listener as never);
      return self;
    },
    kill: () => {
      self.killed = true;
      for (const on of listeners.exit) on(0);
      return true;
    },
    reply: (id: number | undefined, value: unknown) => {
      for (const on of listeners.message) on({ id, ok: true, value });
    },
    fail: (id: number | undefined, error: unknown) => {
      for (const on of listeners.message) on({ id, ok: false, error });
    },
    crash: () => {
      for (const on of listeners.exit) on(1);
    },
  };
  return self;
}
function harness(start = 0) {
  const endpoints: ReturnType<typeof endpoint>[] = [];
  let now = start;
  const states: string[] = [];
  const host = new IndexerHost({
    spawn: () => {
      const next = endpoint();
      endpoints.push(next);
      return next;
    },
    modelId: "model@1",
    now: () => now,
    status: (state) => states.push(state),
  });
  return {
    host,
    endpoints,
    states,
    latest: () => endpoints.at(-1) as ReturnType<typeof endpoint>,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const input = (signal = new AbortController().signal) => ({
  root: "/bench",
  path: "docs/a.pdf",
  kind: "pdf" as const,
  sha256: "a".repeat(64),
  embeddings: { model: "Xenova/bge-small-en-v1.5" as const, chunkSize: 512, overlap: 64 },
  signal,
  assertWritable: () => {},
});

it("runs document processing, selection and inspection in the indexer and returns its results", async () => {
  const h = harness();
  expect(h.host.processor.modelId).toBe("model@1");
  const pending = h.host.processor(input());
  await flush();
  const request = h.latest().sent.at(-1) as Message;
  expect(request).toMatchObject({
    type: "process",
    input: { root: "/bench", path: "docs/a.pdf", kind: "pdf" },
  });
  // Functions and signals stay in main; only data crosses the boundary.
  expect(JSON.stringify(Object.keys(request.input as object).sort())).toBe(
    JSON.stringify(["embeddings", "kind", "path", "root", "sha256"]),
  );
  const result = {
    status: "indexed",
    chunks: [],
    derived: { vectors: [new Float32Array([1, 0])], modelId: "model@1" },
  };
  h.latest().reply(request.id, result);
  expect(await pending).toEqual(result);
  const selection = h.host.processor.select?.({
    root: "/bench",
    docs: { include: ["docs/**"], exclude: [] },
    signal: new AbortController().signal,
  });
  await flush();
  const select = h.latest().sent.at(-1) as Message;
  expect(select).toMatchObject({
    type: "select",
    input: { root: "/bench", docs: { include: ["docs/**"], exclude: [] } },
  });
  h.latest().reply(select.id, { paths: [{ path: "docs/a.pdf", size: 3 }], retry: false });
  expect(await selection).toEqual({ paths: [{ path: "docs/a.pdf", size: 3 }], retry: false });
  const inspection = h.host.processor.inspect?.({
    root: "/bench",
    path: "docs/a.pdf",
    kind: "pdf",
    identity: { ino: 7, dev: 9 },
    signal: new AbortController().signal,
  });
  await flush();
  const inspect = h.latest().sent.at(-1) as Message;
  expect(inspect).toMatchObject({ type: "inspect", input: { identity: { ino: 7, dev: 9 } } });
  h.latest().fail(inspect.id, { message: "Unreadable." });
  await expect(inspection).rejects.toThrow("Unreadable.");
});

it("ranks through the indexer and sends vectors only when its cache misses the epoch", async () => {
  const h = harness();
  const rows = vi.fn(() => [{ id: 1, vector: new Float32Array(384) }]);
  const signal = new AbortController().signal;
  let ranking = h.host.embeddings.rank("/bench", "3", rows, "supply", signal);
  await flush();
  let request = h.latest().sent.at(-1) as Message;
  expect(request).toMatchObject({ type: "rank", root: "/bench", epoch: "3", query: "supply" });
  expect(request.rows).toBeUndefined();
  h.latest().reply(request.id, { needRows: true });
  await flush();
  request = h.latest().sent.at(-1) as Message;
  expect(request).toMatchObject({ type: "rank", epoch: "3", rows: [{ id: 1 }] });
  h.latest().reply(request.id, { hits: [{ id: 1, score: 0.9 }] });
  expect(await ranking).toEqual([{ id: 1, score: 0.9 }]);
  expect(rows).toHaveBeenCalledTimes(1);
  ranking = h.host.embeddings.rank("/bench", "3", rows, "supply", signal);
  await flush();
  h.latest().reply((h.latest().sent.at(-1) as Message).id, { hits: [] });
  expect(await ranking).toEqual([]);
  expect(rows).toHaveBeenCalledTimes(1);
  const embedding = h.host.embeddings.embed("/bench", ["a"], signal);
  await flush();
  h.latest().reply((h.latest().sent.at(-1) as Message).id, [new Float32Array([1])]);
  expect(await embedding).toEqual([new Float32Array([1])]);
});

it("cancels an aborted call, ignores its late result and releases a workbench's embeddings", async () => {
  const h = harness();
  const controller = new AbortController();
  const pending = h.host.processor(input(controller.signal));
  await flush();
  const id = (h.latest().sent.at(-1) as Message).id;
  controller.abort();
  await expect(pending).rejects.toThrow();
  expect(h.latest().sent.at(-1)).toEqual({ type: "cancel", id });
  // A result that arrives after the cancel is dropped without error.
  h.latest().reply(id, { status: "indexed", chunks: [] });
  // Release is asked for but not awaited: closing a workbench never waits for the indexer.
  await h.host.processor.release?.("/bench");
  expect(h.latest().sent.at(-1)).toMatchObject({ type: "release", root: "/bench" });
});

it("does not start an indexer only to release a workbench", async () => {
  const h = harness();
  await h.host.processor.release?.("/bench");
  await h.host.embeddings.release("/bench");
  expect(h.endpoints).toHaveLength(0);
});

it("fails calls in flight with a retry error and restarts after a crash", async () => {
  const h = harness();
  const pending = h.host.processor(input());
  await flush();
  h.latest().crash();
  // Marked as lost to a crash, which ingest counts per document (RULING-006).
  await expect(pending).rejects.toMatchObject({ retry: true, crashed: true });
  expect(h.endpoints).toHaveLength(2);
  expect(h.host.state()).toBe("running");
  const next = h.host.processor(input());
  await flush();
  expect(h.endpoints[1]?.sent.at(-1)).toMatchObject({ type: "process" });
  h.latest().reply((h.latest().sent.at(-1) as Message).id, { status: "indexed", chunks: [] });
  await expect(next).resolves.toMatchObject({ status: "indexed" });
});

it("stops after three crashes within a minute until restarted, and keeps restarting slower crashes", async () => {
  const h = harness(1000);
  // The indexer starts on the first call (utilityProcess needs a ready app).
  expect(h.endpoints).toHaveLength(0);
  void h.host.processor(input()).catch(() => {});
  expect(h.endpoints).toHaveLength(1);
  for (let n = 0; n < 2; n++) {
    h.latest().crash();
    h.advance(10_000);
  }
  expect(h.host.state()).toBe("running");
  h.latest().crash();
  expect(h.host.state()).toBe("stopped");
  expect(h.states).toContain("stopped");
  const spawned = h.endpoints.length;
  await expect(h.host.processor(input())).rejects.toMatchObject({ retry: true });
  expect(h.endpoints).toHaveLength(spawned);
  h.host.restart();
  expect(h.host.state()).toBe("running");
  expect(h.states.at(-1)).toBe("running");
  expect(h.endpoints).toHaveLength(spawned + 1);
  // Crashes spread over more than a minute keep restarting.
  for (let n = 0; n < 4; n++) {
    h.advance(31_000);
    h.latest().crash();
    expect(h.host.state()).toBe("running");
  }
});

it("closes the indexer without restarting it", async () => {
  const h = harness();
  const pending = h.host.processor(input());
  await flush();
  const first = h.latest();
  await h.host.close();
  expect(first.killed).toBe(true);
  await expect(pending).rejects.toThrow();
  expect(h.endpoints).toHaveLength(1);
});

it("restores error codes and aborted errors from the indexer", async () => {
  const h = harness();
  const pending = h.host.processor(input());
  await flush();
  h.latest().fail((h.latest().sent.at(-1) as Message).id, { message: "gone", code: "ENOENT" });
  await expect(pending).rejects.toMatchObject({ message: "gone", code: "ENOENT" });
  const aborted = h.host.processor(input());
  await flush();
  h.latest().fail((h.latest().sent.at(-1) as Message).id, { aborted: true });
  await expect(aborted).rejects.toMatchObject({ name: "AbortError" });
});

it("ignores messages and exits of a replaced indexer and fails a call it cannot post", async () => {
  const h = harness();
  void h.host.processor(input()).catch(() => {});
  await flush();
  const old = h.latest();
  old.crash();
  const next = h.host.processor(input());
  await flush();
  // The dead endpoint's late reply and repeated exit change nothing.
  old.reply(1, { status: "indexed", chunks: [] });
  old.crash();
  expect(h.endpoints).toHaveLength(2);
  h.latest().reply((h.latest().sent.at(-1) as Message).id, { status: "indexed", chunks: [] });
  await expect(next).resolves.toMatchObject({ status: "indexed" });
  h.latest().postMessage = () => {
    throw Error("channel closed");
  };
  await expect(h.host.processor(input())).rejects.toMatchObject({ retry: true });
});

it("counts a failed indexer start as a crash and stops after three", async () => {
  const states: string[] = [];
  let attempts = 0;
  const host = new IndexerHost({
    spawn: () => {
      attempts++;
      throw Error("fork failed");
    },
    modelId: "model@1",
    now: () => 0,
    status: (state) => states.push(state),
  });
  await expect(host.processor(input())).rejects.toMatchObject({ retry: true });
  expect(attempts).toBe(3);
  expect(host.state()).toBe("stopped");
  expect(states).toContain("stopped");
});
