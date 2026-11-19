import { channels, type SessionState, type SessionSummary } from "@vera/shared";
import { expect, it } from "vitest";
import { MockSessions } from "./sessions.js";

const workbenchId = "wb_00000000000000000000000001";
async function fixture() {
  let current = workbenchId,
    readOnly = false;
  const sessions = new MockSessions(() => ({ id: current, readOnly, model: null, mode: "bypass" }));
  const session = sessions.invoke("session.create", {}) as SessionSummary;
  const scope = { workbenchId, sessionId: session.id };
  const snapshot = () => (sessions.invoke("session.get", scope) as { snapshot: SessionState }).snapshot;
  sessions.invoke("session.send", { sessionId: session.id, text: "Update the plan" });
  await expect.poll(() => snapshot().status).toBe("idle");
  return {
    sessions,
    scope,
    snapshot,
    select: (id: string) => {
      current = id;
    },
    readOnly: () => {
      readOnly = true;
    },
  };
}

it("mirrors strict event-backed comment CRUD and original-pair receipts without execution or review steering", async () => {
  const { sessions, scope, snapshot } = await fixture();
  const state = snapshot();
  const target = {
    revision: state.planRevision,
    stepIndex: 0,
    stepText: state.todos[0]?.text ?? "",
    range: null,
  };
  expect(
    sessions.invoke("session.plan.comment.save", {
      ...scope,
      action: "create",
      text: "Keep\n😀",
      target,
      expectedFeedbackRevision: 0,
    }),
  ).toEqual({});
  const saved = snapshot().planComments[0];
  expect(saved).toBeTruthy();
  sessions.invoke("session.plan.comment.save", {
    ...scope,
    action: "edit",
    commentId: saved?.id,
    text: "Updated\nμ",
    expectedFeedbackRevision: 1,
  });
  expect(snapshot().planComments[0]?.target).toEqual(target);
  const request = { ...scope, expectedPlanRevision: state.planRevision, expectedFeedbackRevision: 2 };
  const receipt = channels["session.plan.review"].response.parse(
    sessions.invoke("session.plan.review", request),
  );
  expect(snapshot().planComments).toEqual([]);
  expect(snapshot().planReviews[0]?.comments[0]?.text).toBe("Updated\nμ");
  expect(() => sessions.invoke("session.send", { sessionId: scope.sessionId, text: "burn key" })).toThrow(
    expect.objectContaining({ code: "BUSY" }),
  );
  expect(sessions.invoke("session.plan.review", request)).toEqual(receipt);
  await expect.poll(() => snapshot().planReviews[0]?.stopReason).toBe("end");
  expect(sessions.invoke("session.plan.review", request)).toEqual(receipt);
  expect(snapshot().planReviews).toHaveLength(1);
  const update = snapshot()
    .items.filter((item) => item.kind === "tool")
    .map((item) => item.name);
  expect(update).toEqual(["todo"]);
  expect(snapshot().changes).toEqual([]);
  expect(snapshot().approvals).toEqual([]);
  expect(snapshot().todos).toHaveLength(state.todos.length);
  await sessions.close();
});

it("restores stopped review feedback explicitly and enforces schema, scope, stale-CAS and authority", async () => {
  const { sessions, scope, snapshot, select, readOnly } = await fixture();
  const state = snapshot();
  const change = {
    ...scope,
    action: "create",
    text: "No execution",
    expectedFeedbackRevision: 0,
    target: { revision: state.planRevision, stepIndex: 0, stepText: state.todos[0]?.text ?? "", range: null },
  };
  sessions.invoke("session.plan.comment.save", change);
  expect(() => sessions.invoke("session.plan.comment.save", { ...change, permission: "bypass" })).toThrow(
    expect.objectContaining({ code: "INVALID" }),
  );
  expect(() => sessions.invoke("session.plan.comment.save", change)).toThrow(
    expect.objectContaining({ code: "CONFLICT" }),
  );
  const receipt = channels["session.plan.review"].response.parse(
    sessions.invoke("session.plan.review", {
      ...scope,
      expectedPlanRevision: state.planRevision,
      expectedFeedbackRevision: 1,
    }),
  );
  sessions.invoke("session.stop", scope);
  await sessions.close();
  expect(snapshot().planReviews[0]?.stopReason).toBe("aborted");
  const restore = { ...scope, reviewId: receipt.reviewId, expectedFeedbackRevision: 2 };
  sessions.invoke("session.plan.review.restore", restore);
  sessions.invoke("session.plan.review.restore", restore);
  expect(snapshot().planComments).toHaveLength(1);
  expect(snapshot().planReviews).toHaveLength(1);
  const id = snapshot().planComments[0]?.id;
  sessions.invoke("session.plan.comment.delete", { ...scope, commentId: id, expectedFeedbackRevision: 3 });
  expect(snapshot().planComments).toEqual([]);
  select("wb_00000000000000000000000002");
  expect(() => sessions.invoke("session.plan.review.restore", restore)).toThrow(
    expect.objectContaining({ code: "CONFLICT" }),
  );
  select(workbenchId);
  readOnly();
  expect(() => sessions.invoke("session.plan.review.restore", restore)).toThrow(
    expect.objectContaining({ code: "DENIED" }),
  );
});
