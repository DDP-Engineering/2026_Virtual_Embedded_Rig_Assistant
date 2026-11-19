import { veraError } from "@vera/shared";
import { expect, it, vi } from "vitest";
import { fixture, input, plan, target } from "./review-turn.test-support.js";

it("stages failed review feedback explicitly, preserves later drafts, and reconciles restore acknowledgements without overwriting edits", async () => {
  const env = await fixture();
  env.host.gateway.stream = async function* () {
    yield { type: "error", error: veraError("OFFLINE"), aborted: false };
  };
  const receipt = env.service.reviewPlan(env.id, input);
  expect(await env.service.waitIdle(env.id)).toEqual({ stopReason: "error" });
  const submitted = env.service.get(env.id).snapshot.planReviews[0];
  env.service.savePlanComment(env.id, {
    action: "create",
    expectedFeedbackRevision: 2,
    target,
    text: "Later unsent feedback",
  });
  const restore = { reviewId: receipt.reviewId, expectedFeedbackRevision: 3 };
  const seen: unknown[] = [];
  env.service.subscribe(env.id, env.service.revision(env.id).seq, (_seq, event) => {
    if (event.type === "plan.review.restored") seen.push(env.service.get(env.id).snapshot.planComments);
  });
  env.service.restorePlanReview(env.id, restore);
  const state = env.service.get(env.id).snapshot;
  expect(state.planComments).toHaveLength(2);
  const retry = state.planComments.find((comment) => comment.restoredFrom);
  expect(retry).toMatchObject({
    text: submitted?.comments[0]?.text,
    target,
    stale: false,
    restoredFrom: { reviewId: receipt.reviewId, commentId: submitted?.comments[0]?.id },
  });
  expect(retry?.id).not.toBe(submitted?.comments[0]?.id);
  expect(seen).toEqual([state.planComments]);
  env.service.savePlanComment(env.id, {
    action: "edit",
    expectedFeedbackRevision: 4,
    commentId: retry?.id ?? "missing",
    text: "Edited retry",
  });
  await env.reopen();
  const before = env.service.get(env.id);
  env.service.restorePlanReview(env.id, restore); // Lost first acknowledgement, not another restore.
  env.service.restorePlanReview(env.id, { ...restore, expectedFeedbackRevision: 5 }); // Existing linked draft is never overwritten.
  expect(env.service.get(env.id)).toEqual(before);
  expect(env.service.get(env.id).snapshot.planReviews[0]).toEqual(submitted);
  expect(env.service.get(env.id).snapshot.planComments.map((comment) => comment.text)).toEqual([
    "Later unsent feedback",
    "Edited retry",
  ]);
});

it("requires explicit reanchoring after a partial failed revision, then submits a new logical review without changing old history", async () => {
  const env = await fixture();
  await env.script([
    { toolCalls: [{ name: "todo", args: { items: [{ text: "Revised GPIO check", status: "pending" }] } }] },
  ]);
  const original = env.host.gateway.stream.bind(env.host.gateway);
  let calls = 0;
  env.host.gateway.stream = async function* (request) {
    if (++calls === 1) yield* original(request);
    else yield { type: "error", error: veraError("OFFLINE"), aborted: false };
  };
  const receipt = env.service.reviewPlan(env.id, input);
  expect(await env.service.waitIdle(env.id)).toEqual({ stopReason: "error" });
  const submitted = env.service.get(env.id).snapshot.planReviews[0];
  env.service.restorePlanReview(env.id, { reviewId: receipt.reviewId, expectedFeedbackRevision: 2 });
  const retry = env.service.get(env.id).snapshot.planComments[0];
  expect(retry).toMatchObject({ target, stale: true });
  expect(() =>
    env.service.reviewPlan(env.id, { expectedPlanRevision: 2, expectedFeedbackRevision: 3 }),
  ).toThrow(expect.objectContaining({ code: "CONFLICT" }));
  env.service.savePlanComment(env.id, {
    action: "reanchor",
    commentId: retry?.id ?? "missing",
    expectedFeedbackRevision: 3,
    target: { revision: 2, stepIndex: 0, stepText: "Revised GPIO check", range: null },
  });
  env.host.gateway.stream = original;
  await env.script([{ text: "Brief explanation of revised GPIO checks." }]);
  const next = env.service.reviewPlan(env.id, { expectedPlanRevision: 2, expectedFeedbackRevision: 4 });
  expect(next.reviewId).not.toBe(receipt.reviewId);
  expect(await env.service.waitIdle(env.id)).toEqual({ stopReason: "end" });
  const state = env.service.get(env.id).snapshot;
  expect(state.planReviews).toHaveLength(2);
  expect(state.planReviews[0]).toEqual(submitted);
  expect(state.planReviews[1]?.comments[0]?.target.revision).toBe(2);
  expect(state.planComments).toEqual([]);
  env.service.restorePlanReview(env.id, { reviewId: receipt.reviewId, expectedFeedbackRevision: 2 });
  expect(env.service.get(env.id).snapshot.planComments).toEqual([]);
});

it("retains complete oversized feedback on context limit and explicit retry, with zero rejected-request dispatch", async () => {
  const env = await fixture();
  const commentId = env.service.get(env.id).snapshot.planComments[0]?.id ?? "missing";
  const feedback = "Long 😀 feedback\n".repeat(10000);
  env.service.savePlanComment(env.id, {
    action: "edit",
    expectedFeedbackRevision: 1,
    commentId,
    text: feedback,
  });
  const stream = vi.spyOn(env.host.gateway, "stream");
  const receipt = env.service.reviewPlan(env.id, { ...input, expectedFeedbackRevision: 2 });
  expect(await env.service.waitIdle(env.id)).toEqual({ stopReason: "limit" });
  expect(stream).not.toHaveBeenCalled();
  expect(env.service.get(env.id).snapshot.planReviews[0]).toMatchObject({
    stopReason: "limit",
    comments: [{ text: feedback }],
  });
  env.service.restorePlanReview(env.id, { reviewId: receipt.reviewId, expectedFeedbackRevision: 3 });
  const retry = env.service.get(env.id).snapshot.planComments[0];
  expect(retry?.text).toBe(feedback);
  env.service.savePlanComment(env.id, {
    action: "edit",
    expectedFeedbackRevision: 4,
    commentId: retry?.id ?? "missing",
    text: "Shortened explicitly by the user",
  });
  env.service.reviewPlan(env.id, { ...input, expectedFeedbackRevision: 5 });
  // The earlier oversized, unanswered request is still protected transcript context.
  expect(await env.service.waitIdle(env.id)).toEqual({ stopReason: "limit" });
  expect(stream).not.toHaveBeenCalled();
  expect(env.service.get(env.id).snapshot.planReviews[1]?.comments[0]?.text).toBe(
    "Shortened explicitly by the user",
  );
  expect(env.service.get(env.id).snapshot.planReviews[0]?.comments[0]?.text).toBe(feedback);
});

it("closes an interrupted accepted review on recovery without automatic resubmission and preserves its receipt", async () => {
  const env = await fixture();
  const stream = vi.spyOn(env.host.gateway, "stream");
  const receipt = env.service.reviewPlan(env.id, input);
  await env.service.waitIdle(env.id);
  expect(() =>
    env.service.restorePlanReview(env.id, { reviewId: receipt.reviewId, expectedFeedbackRevision: 2 }),
  ).toThrow(expect.objectContaining({ code: "CONFLICT" }));
  // A crash after a response but before its terminal persistence leaves this committed prefix.
  env.host.db.prepare("DELETE FROM events WHERE session_id=? AND type='turn.done'").run(env.id);
  env.host.db.prepare("UPDATE sessions SET status='running' WHERE id=?").run(env.id);
  await env.reopen();
  expect(env.service.get(env.id).snapshot.planReviews[0]).toMatchObject({
    id: receipt.reviewId,
    plan,
    stopReason: "aborted",
  });
  const recovered = env.service.get(env.id);
  await env.reopen();
  expect(env.service.get(env.id)).toEqual(recovered);
  expect(stream).toHaveBeenCalledOnce();
  expect(env.service.reviewPlan(env.id, input)).toEqual(receipt);
  env.service.restorePlanReview(env.id, { reviewId: receipt.reviewId, expectedFeedbackRevision: 2 });
  expect(env.service.get(env.id).snapshot.planComments[0]).toMatchObject({
    target,
    restoredFrom: { reviewId: receipt.reviewId },
  });
  expect(stream).toHaveBeenCalledOnce();
});

it("guards restore scope, CAS and authority without disclosing or consuming another session's history", async () => {
  const env = await fixture();
  env.host.gateway.stream = async function* () {
    yield { type: "error", error: veraError("OFFLINE"), aborted: false };
  };
  const receipt = env.service.reviewPlan(env.id, input);
  await env.service.waitIdle(env.id);
  const other = env.service.create().id;
  for (const reviewId of [receipt.reviewId, "unknown"])
    expect(() => env.service.restorePlanReview(other, { reviewId, expectedFeedbackRevision: 0 })).toThrow(
      expect.objectContaining({ code: "NOT_FOUND" }),
    );
  expect(() =>
    env.service.restorePlanReview(env.id, { reviewId: receipt.reviewId, expectedFeedbackRevision: 1 }),
  ).toThrow(expect.objectContaining({ code: "CONFLICT" }));
  expect(() =>
    env.service.restorePlanReview(env.id, { reviewId: receipt.reviewId, expectedFeedbackRevision: -1 }),
  ).toThrow(expect.objectContaining({ code: "INVALID" }));
  env.service.setArchived(env.id, true);
  expect(() =>
    env.service.restorePlanReview(env.id, { reviewId: receipt.reviewId, expectedFeedbackRevision: 2 }),
  ).toThrow(expect.objectContaining({ code: "DENIED" }));
  env.service.setArchived(env.id, false);
  env.host.assertWritable = () => {
    throw veraError("DENIED");
  };
  expect(() =>
    env.service.restorePlanReview(env.id, { reviewId: receipt.reviewId, expectedFeedbackRevision: 2 }),
  ).toThrow(expect.objectContaining({ code: "DENIED" }));
  delete env.host.assertWritable;
  await env.reopen(true);
  const before = env.service.get(env.id);
  expect(() =>
    env.service.restorePlanReview(env.id, { reviewId: receipt.reviewId, expectedFeedbackRevision: 2 }),
  ).toThrow(expect.objectContaining({ code: "DENIED" }));
  expect(env.service.get(env.id)).toEqual(before);
});

it("rolls back failed restore persistence and leaves submitted history available for an explicit retry", async () => {
  const env = await fixture();
  env.host.gateway.stream = async function* () {
    yield { type: "error", error: veraError("OFFLINE"), aborted: false };
  };
  const receipt = env.service.reviewPlan(env.id, input);
  await env.service.waitIdle(env.id);
  const before = env.service.get(env.id);
  env.host.db.exec(
    "CREATE TEMP TRIGGER reject_restore BEFORE INSERT ON events WHEN NEW.type='plan.review.restored' BEGIN SELECT RAISE(ABORT,'restore failed'); END",
  );
  expect(() =>
    env.service.restorePlanReview(env.id, { reviewId: receipt.reviewId, expectedFeedbackRevision: 2 }),
  ).toThrow("restore failed");
  expect(env.service.get(env.id)).toEqual(before);
  env.host.db.exec("DROP TRIGGER reject_restore");
  env.service.restorePlanReview(env.id, { reviewId: receipt.reviewId, expectedFeedbackRevision: 2 });
  expect(env.service.get(env.id).snapshot.planComments).toHaveLength(1);
});

it("contains a failing host logger when closing a postcommit startup failure", async () => {
  const env = await fixture();
  const { ReferenceRuntime } = await import("../agent/runtime.js");
  env.host.runtime = (host) => {
    const runtime = new ReferenceRuntime(host);
    runtime.send = () => {
      throw Error("Startup failed");
    };
    return runtime;
  };
  env.host.log = () => {
    throw Error("Logger failed");
  };
  const receipt = env.service.reviewPlan(env.id, input);
  expect(await env.service.waitIdle(env.id)).toEqual({ stopReason: "error" });
  expect(env.service.get(env.id).snapshot.planReviews[0]).toMatchObject({
    id: receipt.reviewId,
    stopReason: "error",
  });
});
