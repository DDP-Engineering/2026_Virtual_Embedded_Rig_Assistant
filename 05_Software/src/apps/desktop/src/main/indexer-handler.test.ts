// REQ-FUNC-f9d5ae8d REQ-FUNC-362ebed9 REQ-FUNC-276a5da8 REQ-REL-4761ac1e
import { expect, it, vi } from "vitest";
import { createIndexerHandler } from "./indexer-handler.js";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function services() {
  let release: (() => void) | undefined;
  const self = {
    process: vi.fn(
      async (input: { signal: AbortSignal; assertWritable: () => void }) =>
        new Promise((resolve, reject) => {
          input.assertWritable();
          release = () => resolve({ status: "indexed", chunks: [] });
          input.signal.addEventListener("abort", () => reject(Error("aborted")), { once: true });
        }),
    ),
    select: vi.fn(async () => ({ paths: [{ path: "docs/a.md", size: 1 }], skipped: [], retry: false })),
    inspect: vi.fn(async () => ({ status: "ok", sha256: "b".repeat(64), binary: false })),
    cached: false,
    worker: {
      embed: vi.fn(async () => [new Float32Array([1])]),
      // Like EmbeddingHost: rows are read only when the worker's epoch cache misses.
      rank: vi.fn(async function (this: unknown, _root: string, _epoch: string, rows: unknown) {
        if (!self.cached) typeof rows === "function" ? rows() : rows;
        return [{ id: 1, score: 0.5 }];
      }),
    },
    embeddings: vi.fn(() => self.worker),
    release: vi.fn(async () => {}),
    finish: () => release?.(),
  };
  return self;
}

it("answers process, select and inspect requests with each service's result and a signal of its own", async () => {
  const s = services();
  const sent: unknown[] = [];
  const handle = createIndexerHandler(s as never, (message) => sent.push(message));
  handle({
    id: 1,
    type: "process",
    input: { root: "/b", path: "docs/a.md", kind: "markdown", sha256: "a".repeat(64) },
  });
  await flush();
  expect(s.process).toHaveBeenCalledWith(
    expect.objectContaining({ root: "/b", path: "docs/a.md", signal: expect.any(AbortSignal) }),
  );
  s.finish();
  await flush();
  expect(sent).toContainEqual({ id: 1, ok: true, value: { status: "indexed", chunks: [] } });
  handle({ id: 2, type: "select", input: { root: "/b", docs: { include: ["docs/**"], exclude: [] } } });
  handle({
    id: 3,
    type: "inspect",
    input: { root: "/b", path: "docs/a.md", kind: "markdown", identity: { ino: 1, dev: 2 } },
  });
  await flush();
  expect(sent).toContainEqual({
    id: 2,
    ok: true,
    value: { paths: [{ path: "docs/a.md", size: 1 }], skipped: [], retry: false },
  });
  expect(sent).toContainEqual(expect.objectContaining({ id: 3, ok: true }));
  // An unknown request type or a failing service answers with an error, never a crash.
  s.select.mockRejectedValueOnce(Error("glob failed"));
  handle({ id: 4, type: "select", input: { root: "/b", docs: { include: ["docs/**"], exclude: [] } } });
  handle({ id: 5, type: "unknown" });
  await flush();
  expect(sent).toContainEqual({ id: 4, ok: false, error: { message: "glob failed" } });
  expect(sent).toContainEqual(expect.objectContaining({ id: 5, ok: false }));
});

it("aborts a cancelled request and answers it as aborted", async () => {
  const s = services();
  const sent: { id?: number; ok?: boolean; error?: { aborted?: boolean } }[] = [];
  const handle = createIndexerHandler(s as never, (message) => sent.push(message as never));
  handle({
    id: 7,
    type: "process",
    input: { root: "/b", path: "docs/a.md", kind: "markdown", sha256: "a".repeat(64) },
  });
  await flush();
  handle({ type: "cancel", id: 7 });
  await flush();
  expect(sent.find((m) => m.id === 7)).toMatchObject({ ok: false, error: { aborted: true } });
  // After a cancel the request may not write anything more (its extraction cache included).
  const call = s.process.mock.calls[0]?.[0] as { assertWritable: () => void };
  expect(() => call.assertWritable()).toThrow();
});

it("asks for vectors only when the epoch is not cached, embeds queries and releases a root", async () => {
  const s = services();
  const sent: unknown[] = [];
  const handle = createIndexerHandler(s as never, (message) => sent.push(message));
  const model = "Xenova/multilingual-e5-small";
  handle({ id: 1, type: "rank", model, root: "/b", epoch: "3", query: "supply" });
  await flush();
  expect(sent).toContainEqual({ id: 1, ok: true, value: { needRows: true } });
  expect(s.embeddings).toHaveBeenCalledWith(model);
  const rows = [{ id: 1, vector: new Float32Array(384) }];
  handle({ id: 2, type: "rank", model, root: "/b", epoch: "3", query: "supply", rows });
  await flush();
  expect(s.worker.rank).toHaveBeenLastCalledWith("/b", "3", rows, "supply", expect.any(AbortSignal));
  expect(sent).toContainEqual({ id: 2, ok: true, value: { hits: [{ id: 1, score: 0.5 }] } });
  // A cached epoch never asks for vectors: the lazy rows are not read.
  s.cached = true;
  handle({ id: 3, type: "rank", model, root: "/b", epoch: "3", query: "supply" });
  await flush();
  expect(sent).toContainEqual({ id: 3, ok: true, value: { hits: [{ id: 1, score: 0.5 }] } });
  handle({ id: 4, type: "embed", model, root: "/b", texts: ["a"] });
  handle({ id: 5, type: "release", root: "/b" });
  await flush();
  expect(sent).toContainEqual({ id: 4, ok: true, value: [new Float32Array([1])] });
  expect(s.release).toHaveBeenCalledWith("/b");
  expect(sent).toContainEqual({ id: 5, ok: true, value: null });
  handle({ id: 6, type: "embed", model: "../unknown", root: "/b", texts: ["a"] });
  await flush();
  expect(sent).toContainEqual(expect.objectContaining({ id: 6, ok: false }));
  expect(s.worker.embed).toHaveBeenCalledTimes(1);
});

it("passes a failure's error code, such as ENOENT, back to main", async () => {
  const s = services();
  const sent: unknown[] = [];
  const handle = createIndexerHandler(s as never, (message) => sent.push(message));
  s.select.mockRejectedValueOnce(Object.assign(Error("gone"), { code: "ENOENT" }));
  handle({ id: 9, type: "select", input: { root: "/b", docs: { include: ["docs/**"], exclude: [] } } });
  await flush();
  expect(sent).toContainEqual({ id: 9, ok: false, error: { message: "gone", code: "ENOENT" } });
  const failure = { message: "Embedding queue deadline exceeded.", code: "EMBEDDING_DEADLINE" };
  s.worker.rank.mockRejectedValueOnce(Object.assign(Error(failure.message), { code: failure.code }));
  handle({
    id: 10,
    type: "rank",
    model: "Xenova/bge-small-en-v1.5",
    root: "/b",
    epoch: "e",
    query: "q",
    rows: [],
  });
  await flush();
  expect(sent).toContainEqual({ id: 10, ok: false, error: failure });
});
