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
