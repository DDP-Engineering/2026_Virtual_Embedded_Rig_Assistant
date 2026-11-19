import { SessionHub, zeroUsage } from "@vera/core";
import { expect, it, vi } from "vitest";
import { fixture } from "./plan-review.test-support.js";
import * as mainSessions from "./sessions.js";

it("revalidates plan and feedback counters changed during awaited review preparation", async () => {
  for (const change of ["plan", "feedback"] as const) {
    const env = await fixture(),
      handlers = mainSessions.planReviewHandlers(env.host, env.containsSecret);
    await handlers["session.plan.comment.save"]({
      ...env.scope,
      action: "create",
      expectedFeedbackRevision: 0,
      text: "Original feedback",
      target: env.target,
    });
    const core = await env.host.run((service) => service);
    env.holdPinned(async () => {
      if (change === "plan")
        env.record(env.a, { type: "todo.updated", items: [{ text: "A😀B\nμC", status: "pending" }] });
      else
        core.savePlanComment(env.id, {
          action: "edit",
          expectedFeedbackRevision: 1,
          commentId: core.get(env.id).snapshot.planComments[0]?.id ?? "missing",
          text: "Edited while preparing",
        });
    });
    const stream = vi.spyOn(env.gateway, "stream");
    await expect(
      handlers["session.plan.review"]({ ...env.scope, expectedPlanRevision: 1, expectedFeedbackRevision: 1 }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(core.get(env.id).snapshot.planComments[0]?.text).toBe(
      change === "plan" ? "Original feedback" : "Edited while preparing",
    );
    expect(core.get(env.id).snapshot.planReviews).toEqual([]);
    expect(stream).not.toHaveBeenCalled();
  }
});

it("keeps late review callbacks bound to the captured database and refuses effects after replacement", async () => {
  const env = await fixture(true),
    handlers = mainSessions.planReviewHandlers(env.host, env.containsSecret);
  await handlers["session.plan.comment.save"]({
    ...env.scope,
    action: "create",
    expectedFeedbackRevision: 0,
    target: env.target,
    text: "Review",
  });
  let release = () => {},
    entered = () => {};
  const held = new Promise<void>((resolve) => {
      release = resolve;
    }),
    started = new Promise<void>((resolve) => {
      entered = resolve;
    });
  env.gateway.stream = async function* () {
    entered();
    await held;
    yield {
      type: "done",
      message: {
        role: "assistant",
        api: "replay",
        provider: "replay",
        model: "chat",
        timestamp: 1,
        usage: zeroUsage(),
        stopReason: "toolUse",
        content: [{ type: "toolCall", id: "late", name: "todo", arguments: { items: [] } }],
      },
    };
  };
  await handlers["session.plan.review"]({
    ...env.scope,
    expectedPlanRevision: 1,
    expectedFeedbackRevision: 1,
  });
  const captured = await env.host.run((service) => service);
  await started;
  try {
    env.switchToB();
    release();
    expect(await captured.waitIdle(env.id)).toEqual({ stopReason: "error" });
    for (const store of [env.a, env.b])
      expect(new SessionHub(store.db, () => "").get(env.id).snapshot.todos).toEqual([
        { text: "A😀B\nμC", status: "pending" },
      ]);
    expect(new SessionHub(env.b.db, () => "").get(env.id).snapshot.planReviews).toEqual([]);
  } finally {
    release();
  }
});
