import { expect, it, vi } from "vitest";
import { MockSessions } from "./sessions.js";

it("binds scheduled responses to their original workbench even after a switch", async () => {
  let id = "one";
  const sessions = new MockSessions(() => ({ id, readOnly: false, model: null, mode: "ask" }));
  const first = sessions.invoke("session.create", {}) as { id: string };
  const on = vi.fn();
  sessions.subscribe(first.id, 0, on);
  sessions.invoke("session.send", { sessionId: first.id, text: "Read" });
  id = "two";
  sessions.invoke("session.create", {});
  await new Promise((resolve) => setTimeout(resolve, 0));
  id = "one";
  expect(sessions.invoke("session.get", { sessionId: first.id })).toMatchObject({
    snapshot: { status: "idle", turns: [{ stopReason: "end" }] },
  });
  expect(on.mock.calls.at(-1)?.[0]).toMatchObject({ type: "turn.done", stopReason: "end" });
});

it("aborts and drains a pending turn before closing, with subscriptions removed", async () => {
  const sessions = new MockSessions(() => ({ id: "one", readOnly: false, model: null, mode: "ask" }));
  const first = sessions.invoke("session.create", {}) as { id: string };
  const on = vi.fn();
  sessions.subscribe(first.id, 0, on);
  sessions.invoke("session.send", { sessionId: first.id, text: "Read" });
  const calls = on.mock.calls.length;
  await sessions.close();
  expect(on).toHaveBeenCalledTimes(calls);
  expect(sessions.invoke("session.get", { sessionId: first.id })).toMatchObject({
    snapshot: { status: "idle", turns: [{ stopReason: "aborted" }] },
  });
});
