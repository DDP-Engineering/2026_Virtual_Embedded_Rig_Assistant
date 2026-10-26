import { expect, it } from "vitest";
import { documentSchema } from "./documents.js";
import { eventEnvelopeSchema } from "./events.js";
import { channels } from "./ipc.js";

const document = {
  id: 1,
  path: "docs/a.md",
  kind: "markdown",
  sha256: "a".repeat(64),
  bytes: 3,
  mtime: "2026-10-12T00:00:00.000Z",
  pages: null,
  status: "pending",
  error: null,
  indexedAt: null,
};
const envelope = (event: unknown) => ({ topic: "workbench", id: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C", event });
// REQ-FUNC-28ad0001
it("requires exact workbench identity and typed viewer requests without client snippets", () => {
  const workbenchId = "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C";
  expect(channels["docs.list"].request.parse({ workbenchId })).toEqual({ workbenchId });
  expect(channels["docs.open"].request.safeParse({ workbenchId, path: "docs/a.pdf" }).success).toBe(true);
  for (const value of [
    { path: "docs/a.pdf" },
    { workbenchId, path: "../secret" },
    { workbenchId, path: "docs/a.pdf", snippet: "invented" },
    { workbenchId, ref: "artifact:a.md" },
  ])
    expect(channels["docs.open"].request.safeParse(value).success).toBe(false);
  expect(channels["docs.search"].request.safeParse({ workbenchId, query: " " }).success).toBe(false);
});
it("validates strict reindex requests/responses and truthful document/progress/removal events", () => {
  expect(channels["docs.reindex"].request.parse({})).toEqual({});
  expect(channels["docs.reindex"].response.parse({})).toEqual({});
  expect(channels["docs.reindex"].request.safeParse({ path: "../outside" }).success).toBe(false);
  expect(channels["docs.reindex"].response.safeParse({ indexed: 99 }).success).toBe(false);
  for (const status of ["pending", "indexed", "failed", "unsupported", "needs_ocr"]) {
    expect(
      eventEnvelopeSchema.safeParse(
        envelope({ type: "index.document", path: document.path, document: { ...document, status } }),
      ).success,
    ).toBe(true);
  }
  expect(
    eventEnvelopeSchema.safeParse(envelope({ type: "index.document", path: document.path, document: null }))
      .success,
  ).toBe(true);
  expect(
    eventEnvelopeSchema.safeParse(envelope({ type: "index.progress", pending: 2, done: 1, failed: 0 }))
      .success,
  ).toBe(true);
  expect(
    eventEnvelopeSchema.safeParse(envelope({ type: "index.progress", pending: -1, done: 0, failed: 0 }))
      .success,
  ).toBe(false);
  expect(
    eventEnvelopeSchema.safeParse(envelope({ type: "index.progress", pending: 0, done: 1.2, failed: 0 }))
      .success,
  ).toBe(false);
  for (const patch of [
    { sha256: "bogus" },
    { bytes: -1 },
    { status: "complete" },
    { error: "raw error" },
    { absolutePath: "/secrets" },
  ])
    expect(documentSchema.safeParse({ ...document, ...patch }).success).toBe(false);
});
