import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, SessionHub, SessionService } from "@vera/core";
import { channels } from "@vera/shared";
import { expect, it } from "vitest";
import { rendererSessionSnapshot, sanitizeEvent } from "./events.js";
import { type ChannelHandlers, createInvokeRouter } from "./ipc-router.js";

it("validates bookmark IPC and rejects assistant, foreign, readonly and archived targets", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-bookmark-ipc-"));
  const storage = await openDb(join(root, "vera.db"), { workbenchId: "wb_test", appVersion: "0" });
  let readOnly = false;
  const service = new SessionService({
    root,
    db: storage.db,
    clock: { now: () => new Date(123), sleep: async () => {} },
    gateway: {} as never,
    model: () => "replay/read-then-answer",
    prompt: () => "test",
    assertWritable: () => {
      if (readOnly) throw { code: "DENIED", messageKey: "errors.DENIED" };
    },
  });
  const frame = { url: "vera://app/index.html" };
  const sender = { mainFrame: frame, isDestroyed: () => false };
  const event = { sender, senderFrame: frame };
  const router = createInvokeRouter({
    target: () => ({ webContents: sender, url: frame.url }),
    handlers: {
      "session.bookmark": ({ sessionId, messageId, bookmarked }) => {
        service.bookmark(sessionId, messageId, bookmarked);
        return {};
      },
    } as ChannelHandlers,
    log: () => {},
  });
  try {
    await service.waitReady();
    const id = service.create().id;
    const other = service.create().id;
    const hub = new SessionHub(storage.db, () => new Date(123).toISOString());
    hub.emit(id, { type: "message.user", messageId: "u", text: "Remember" });
    hub.emit(id, { type: "message.done", messageId: "a", text: "Answer", citations: [] });
    hub.emit(other, { type: "message.user", messageId: "foreign", text: "Other" });
    const request = { sessionId: id, messageId: "u", bookmarked: true };
    const invoke = (input: unknown) => router(event, "session.bookmark", input);
    expect(await invoke(request)).toEqual({ ok: true, value: {} });
    expect(rendererSessionSnapshot(service.get(id).snapshot, () => "redacted").bookmarkedMessageIds).toEqual([
      "u",
    ]);
    expect(
      sanitizeEvent(
        {
          topic: "session",
          id,
          event: {
            type: "message.bookmarked",
            messageId: "u",
            bookmarked: true,
          },
        },
        () => "redacted",
      ),
    ).toMatchObject({ event: { messageId: "u", bookmarked: true } });
    const before = service.revision(id);
    for (const input of [
      { ...request, messageId: "a" },
      { ...request, messageId: "foreign" },
      { ...request, messageId: "missing" },
      { ...request, messageId: "" },
      { ...request, messageId: "x".repeat(201) },
      { ...request, bookmarked: "true" },
      { ...request, sessionId: "bad" },
      { ...request, extra: true },
      { sessionId: id, messageId: "u" },
    ])
      expect(await invoke(input)).toMatchObject({ ok: false, error: { code: "INVALID" } });
    expect(service.revision(id)).toEqual(before);
    readOnly = true;
    expect(await invoke({ ...request, bookmarked: false })).toMatchObject({
      ok: false,
      error: { code: "DENIED" },
    });
    readOnly = false;
    service.setArchived(id, true);
    expect(await invoke({ ...request, bookmarked: false })).toMatchObject({
      ok: false,
      error: { code: "DENIED" },
    });
    expect(service.get(id).snapshot.bookmarkedMessageIds).toEqual(["u"]);
    expect(channels["session.bookmark"].response.safeParse({ extra: true }).success).toBe(false);
    expect(
      await router({ sender, senderFrame: { url: "https://invalid.test" } }, "session.bookmark", request),
    ).toMatchObject({ ok: false, error: { code: "DENIED" } });
  } finally {
    await service.close();
    storage.close();
    await rm(root, { recursive: true, force: true });
  }
});
