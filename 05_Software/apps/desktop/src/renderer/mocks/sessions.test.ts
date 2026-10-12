import type { ChangeDetail, ChangeSummary, SessionState } from "@vera/shared";
import { expect, it, vi } from "vitest";
import { MockSessions } from "./sessions.js";

it("records approved mock changes with strict list/get parity and workbench isolation", async () => {
  let workbench = "one";
  const sessions = new MockSessions(() => ({ id: workbench, readOnly: false, model: null, mode: "ask" }));
  const s = sessions.invoke("session.create", {}) as { id: string };
  expect(sessions.invoke("changes.list", { sessionId: s.id })).toEqual([]);
  const approve = async (decision: "approved" | "denied") => {
    sessions.invoke("session.send", { sessionId: s.id, text: "edit notes" });
    await expect
      .poll(
        () =>
          (sessions.invoke("session.get", { sessionId: s.id }) as { snapshot: SessionState }).snapshot.status,
      )
      .toBe("awaiting_approval");
    const approval = (
      sessions.invoke("session.get", { sessionId: s.id }) as { snapshot: SessionState }
    ).snapshot.approvals.at(-1);
    if (!approval) throw Error("approval missing");
    sessions.invoke("session.approval.decide", {
      sessionId: s.id,
      approvalId: approval.approvalId,
      requestSha256: approval.requestSha256,
      decision,
    });
    await expect
      .poll(
        () =>
          (sessions.invoke("session.get", { sessionId: s.id }) as { snapshot: SessionState }).snapshot.status,
      )
      .toBe("idle");
  };
  await approve("denied");
  expect(sessions.invoke("changes.list", { sessionId: s.id })).toEqual([]);
  await approve("approved");
  const list = sessions.invoke("changes.list", { sessionId: s.id }) as ChangeSummary[];
  expect(list).toHaveLength(1);
  expect(list[0]).toMatchObject({ sessionId: s.id, added: 1, removed: 1 });
  const detail = sessions.invoke("changes.get", { changeId: list[0]?.changeId }) as ChangeDetail;
  expect(detail.diff).toContain("-old\n+new");
  expect(
    (sessions.invoke("session.get", { sessionId: s.id }) as { snapshot: SessionState }).snapshot.changes[0],
  ).toMatchObject({ changeId: detail.changeId, added: 1, removed: 1 });
  workbench = "two";
  expect(() => sessions.invoke("changes.get", { changeId: detail.changeId })).toThrow();
  workbench = "one";
  expect(sessions.invoke("changes.get", { changeId: detail.changeId })).toEqual(detail);
});

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

it("retains the aborted approval when a waiting mock workbench is closed and reopened", async () => {
  const sessions = new MockSessions(() => ({ id: "one", readOnly: false, model: null, mode: "ask" }));
  const first = sessions.invoke("session.create", {}) as { id: string };
  sessions.invoke("session.send", { sessionId: first.id, text: "edit" });
  await expect
    .poll(() => sessions.invoke("session.get", { sessionId: first.id }))
    .toMatchObject({
      snapshot: { status: "awaiting_approval" },
    });
  await sessions.close();
  const value = sessions.invoke("session.get", { sessionId: first.id }) as {
    snapshot: { approvals: { decision?: string }[]; status: string };
  };
  expect(value.snapshot.status).toBe("idle");
  expect(value.snapshot.approvals).toHaveLength(1);
  expect(value.snapshot.approvals[0]?.decision).toBe("aborted");
});
