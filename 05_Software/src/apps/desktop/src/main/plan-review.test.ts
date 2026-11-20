import { SessionHub } from "@vera/core";
import { channels, veraError } from "@vera/shared";
import { expect, it, vi } from "vitest";
import { type ChannelHandlers, createInvokeRouter } from "./ipc-router.js";
import { fixture } from "./plan-review.test-support.js";
import * as mainSessions from "./sessions.js";

const frame = { url: "vera://app/index.html" };
const sender = { mainFrame: frame, isDestroyed: () => false };
const event = { sender, senderFrame: frame };
function router(host: mainSessions.SessionsHost, containsSecret: (value: unknown) => boolean) {
  return createInvokeRouter({
    target: () => ({ webContents: sender, url: frame.url }),
    handlers: mainSessions.planReviewHandlers(host, containsSecret) as ChannelHandlers,
    log: () => {},
  });
}

it("validates four strict, scoped user-only contracts without accepting plan/prose/permission fields", async () => {
  const env = await fixture();
  const requests = [
    [
      "session.plan.comment.save",
      { ...env.scope, action: "create", expectedFeedbackRevision: 0, target: env.target, text: "Feedback" },
    ],
    ["session.plan.comment.delete", { ...env.scope, expectedFeedbackRevision: 1, commentId: "pc_test" }],
    ["session.plan.review", { ...env.scope, expectedPlanRevision: 1, expectedFeedbackRevision: 1 }],
    ["session.plan.review.restore", { ...env.scope, expectedFeedbackRevision: 2, reviewId: "pr_test" }],
  ] as const;
  for (const [channel, request] of requests) {
    expect(channels[channel].request.safeParse(request).success).toBe(true);
    for (const extra of [{ plan: [] }, { permissions: "bypass" }, { command: "execute" }, { foreign: "x" }])
      expect(channels[channel].request.safeParse({ ...request, ...extra }).success).toBe(false);
    expect(channels[channel].request.safeParse({ ...request, workbenchId: undefined }).success).toBe(false);
    expect(channels[channel].request.safeParse({ ...request, sessionId: "invalid" }).success).toBe(false);
    expect(channels[channel].response.safeParse({ extra: true }).success).toBe(false);
  }
  expect(
    channels["session.plan.comment.save"].request.safeParse({
      ...env.scope,
      action: "edit",
      commentId: "pc",
      expectedFeedbackRevision: 1,
      text: "Edit",
      target: env.target,
    }).success,
  ).toBe(false);
});

it("routes metadata and review with no skill/plugin/program preparation and uses the canonical review prompt", async () => {
  const env = await fixture();
  const invoke = router(env.host, env.containsSecret);
  const save = {
    ...env.scope,
    action: "create",
    expectedFeedbackRevision: 0,
    target: env.target,
    text: "Vérifier 😀\nGPIO",
  };
  expect(await invoke(event, "session.plan.comment.save", save)).toEqual({ ok: true, value: {} });
  const core = await env.host.run((service) => service, { purpose: "metadata" });
  const commentId = core.get(env.id).snapshot.planComments[0]?.id ?? "missing";
  expect(
    await invoke(event, "session.plan.comment.save", {
      ...env.scope,
      action: "edit",
      commentId,
      expectedFeedbackRevision: 1,
      text: "Updated 😀",
    }),
  ).toEqual({ ok: true, value: {} });
  expect(
    await invoke(event, "session.plan.comment.save", {
      ...env.scope,
      action: "reanchor",
      commentId,
      expectedFeedbackRevision: 2,
      target: { ...env.target, range: null },
    }),
  ).toEqual({ ok: true, value: {} });
  await invoke(event, "session.plan.comment.save", {
    ...env.scope,
    action: "create",
    expectedFeedbackRevision: 3,
    target: env.target,
    text: "Remove this draft",
  });
  const removed = core.get(env.id).snapshot.planComments[1]?.id ?? "missing";
  expect(
    await invoke(event, "session.plan.comment.delete", {
      ...env.scope,
      expectedFeedbackRevision: 4,
      commentId: removed,
    }),
  ).toEqual({ ok: true, value: {} });
  const stream = vi.spyOn(env.gateway, "stream");
  const reviewed = await invoke(event, "session.plan.review", {
    ...env.scope,
    expectedPlanRevision: 1,
    expectedFeedbackRevision: 5,
  });
  expect(reviewed).toMatchObject({
    ok: true,
    value: { reviewId: expect.any(String), turnId: expect.any(String), messageId: expect.any(String) },
  });
  expect(await core.waitIdle(env.id)).toEqual({ stopReason: "end" });
  expect(stream.mock.calls[0]?.[0].system).toContain("Pinned board context");
  expect(stream.mock.calls[0]?.[0].system).toContain("Board 0");
  expect(stream.mock.calls[0]?.[0].tools.map((tool) => tool.name)).toEqual(["todo"]);
  expect(env.skills).not.toHaveBeenCalled();
  expect(env.loadPlugins).not.toHaveBeenCalled();
  expect(env.resolve).not.toHaveBeenCalled();
  expect(env.getConfig).not.toHaveBeenCalled();
  expect(env.readConfig).toHaveBeenCalledOnce();
  expect(env.getPinned).toHaveBeenCalledOnce();
});

it("rejects empty plans and absent, deleted-last or submitted-only feedback without consuming pending feedback", async () => {
  const env = await fixture(),
    invoke = router(env.host, env.containsSecret);
  const stream = vi.spyOn(env.gateway, "stream");
  const review = (planRevision: number, feedbackRevision: number, sessionId = env.id) =>
    invoke(event, "session.plan.review", {
      ...env.scope,
      sessionId,
      expectedPlanRevision: planRevision,
      expectedFeedbackRevision: feedbackRevision,
    });
  expect(await review(1, 0)).toMatchObject({ ok: false, error: { code: "INVALID" } });
  const core = await env.host.run((service) => service);
  const empty = core.create().id;
  expect(await review(0, 0, empty)).toMatchObject({ ok: false, error: { code: "INVALID" } });
  await invoke(event, "session.plan.comment.save", {
    ...env.scope,
    action: "create",
    expectedFeedbackRevision: 0,
    text: "First",
    target: env.target,
  });
  const commentId = core.get(env.id).snapshot.planComments[0]?.id ?? "missing";
  await invoke(event, "session.plan.comment.delete", {
    ...env.scope,
    expectedFeedbackRevision: 1,
    commentId,
  });
  expect(await review(1, 2)).toMatchObject({ ok: false, error: { code: "INVALID" } });
  await invoke(event, "session.plan.comment.save", {
    ...env.scope,
    action: "create",
    expectedFeedbackRevision: 2,
    text: "Submitted",
    target: env.target,
  });
  expect(await review(1, 3)).toMatchObject({ ok: true });
  await core.waitIdle(env.id);
  expect(await review(1, 4)).toMatchObject({ ok: false, error: { code: "INVALID" } });
  await invoke(event, "session.plan.comment.save", {
    ...env.scope,
    action: "create",
    expectedFeedbackRevision: 4,
    text: "Retained pending",
    target: env.target,
  });
  env.record(env.a, { type: "todo.updated", items: [] });
  expect(await review(2, 5)).toMatchObject({ ok: false, error: { code: "INVALID" } });
  expect(core.get(env.id).snapshot.planComments).toMatchObject([
    { text: "Retained pending", target: env.target },
  ]);
  expect(core.get(env.id).snapshot.items.filter((item) => item.kind === "user")).toHaveLength(1);
  expect(stream).toHaveBeenCalledOnce();
});

it("authorizes before dispatch and refuses secrets, malformed targets and foreign IDs without changing drafts", async () => {
  const env = await fixture();
  const invoke = router(env.host, env.containsSecret);
  const request = {
    ...env.scope,
    action: "create",
    expectedFeedbackRevision: 0,
    target: env.target,
    text: "Feedback",
  };
  const capture = vi.spyOn(env.host, "captureScope");
  expect(
    await invoke(
      { sender, senderFrame: { url: "https://foreign.invalid" } },
      "session.plan.comment.save",
      request,
    ),
  ).toMatchObject({ ok: false, error: { code: "DENIED" } });
  expect(capture).not.toHaveBeenCalled();
  for (const invalid of [
    { ...request, text: "credential-secret" },
    { ...request, target: { ...env.target, range: { start: 1, end: 2, quote: "\ud83d" } } },
    { ...request, target: { ...env.target, range: { start: 1, end: 3, quote: "forged" } } },
  ])
    expect(await invoke(event, "session.plan.comment.save", invalid)).toMatchObject({
      ok: false,
      error: { code: "INVALID" },
    });
  expect(
    await invoke(event, "session.plan.comment.delete", {
      ...env.scope,
      expectedFeedbackRevision: 0,
      commentId: "foreign",
    }),
  ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  expect(
    await invoke(event, "session.plan.review.restore", {
      ...env.scope,
      expectedFeedbackRevision: 0,
      reviewId: "foreign",
    }),
  ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  expect(new SessionHub(env.a.db, () => "").get(env.id).snapshot.planComments).toEqual([]);
});

it("does not blanket-refuse projected quoted plan context while refusing credential-bearing feedback", async () => {
  const env = await fixture();
  env.record(env.a, { type: "todo.updated", items: [{ text: "credential-secret", status: "pending" }] });
  const invoke = router(env.host, env.containsSecret);
  expect(
    await invoke(event, "session.plan.comment.save", {
      ...env.scope,
      action: "create",
      expectedFeedbackRevision: 0,
      text: "Review the masked target",
      target: { revision: 2, stepIndex: 0, stepText: "[REDACTED]", range: null },
    }),
  ).toEqual({ ok: true, value: {} });
});

for (const sameWorkbenchId of [false, true])
  it(`captures the originating DB before a queued lifecycle switch (same workbench identity: ${sameWorkbenchId})`, async () => {
    const env = await fixture(sameWorkbenchId);
    const handlers = mainSessions.planReviewHandlers(env.host, env.containsSecret);
    let release = () => {},
      entered = () => {};
    const held = new Promise<void>((resolve) => {
        release = resolve;
      }),
      started = new Promise<void>((resolve) => {
        entered = resolve;
      });
    const switching = env.host.lifecycle(async () => {
      entered();
      await held;
      env.switchToB();
    });
    await started;
    const pending = handlers["session.plan.comment.save"]({
      ...env.scope,
      action: "create",
      expectedFeedbackRevision: 0,
      text: "Must remain in A",
      target: env.target,
    });
    const rejected = expect(pending).rejects.toMatchObject({ code: "CONFLICT" });
    release();
    await switching;
    await rejected;
    expect(new SessionHub(env.b.db, () => "").get(env.id).snapshot.planComments).toEqual([]);
    expect(new SessionHub(env.a.db, () => "").get(env.id).snapshot.planComments).toEqual([]);
    expect(env.skills).not.toHaveBeenCalled();
    expect(env.loadPlugins).not.toHaveBeenCalled();
  });

it.each(["config", "pinned"] as const)(
  "rechecks captured DB after awaited review %s and leaves feedback pending in its owner",
  async (held) => {
    const env = await fixture(true),
      handlers = mainSessions.planReviewHandlers(env.host, env.containsSecret);
    await handlers["session.plan.comment.save"]({
      ...env.scope,
      action: "create",
      expectedFeedbackRevision: 0,
      text: "Retained",
      target: env.target,
    });
    const hold = held === "config" ? env.holdConfig : env.holdPinned;
    hold(async () => {
      env.switchToB();
    });
    await expect(
      handlers["session.plan.review"]({ ...env.scope, expectedPlanRevision: 1, expectedFeedbackRevision: 1 }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(new SessionHub(env.a.db, () => "").get(env.id).snapshot.planComments).toHaveLength(1);
    expect(new SessionHub(env.b.db, () => "").get(env.id).snapshot.planReviews).toEqual([]);
    expect(env.readConfig).toHaveBeenCalledOnce();
    expect(env.getConfig).not.toHaveBeenCalled();
    expect(env.getPinned).toHaveBeenCalledTimes(held === "config" ? 0 : 1);
  },
);

it("rejects ordinary preparation before it can probe programs while a review is active", async () => {
  const env = await fixture(),
    handlers = mainSessions.planReviewHandlers(env.host, env.containsSecret);
  await handlers["session.plan.comment.save"]({
    ...env.scope,
    action: "create",
    expectedFeedbackRevision: 0,
    text: "Review",
    target: env.target,
  });
  let release = () => {},
    entered = () => {};
  const held = new Promise<void>((resolve) => {
      release = resolve;
    }),
    started = new Promise<void>((resolve) => {
      entered = resolve;
    });
  const stream = env.gateway.stream.bind(env.gateway);
  env.gateway.stream = async function* (request) {
    entered();
    await held;
    yield* stream(request);
  };
  const receipt = await handlers["session.plan.review"]({
    ...env.scope,
    expectedPlanRevision: 1,
    expectedFeedbackRevision: 1,
  });
  await started;
  try {
    await expect(
      env.host.run((service) => service.send(env.id, "Execute the steps"), {
        purpose: "ordinary",
        ordinarySessionId: env.id,
      }),
    ).rejects.toMatchObject({ code: "BUSY" });
    expect(env.skills).not.toHaveBeenCalled();
    expect(env.loadPlugins).not.toHaveBeenCalled();
    expect(env.getConfig).not.toHaveBeenCalled();
    expect(env.readConfig).toHaveBeenCalledOnce();
    const core = await env.host.run((service) => service);
    core.stop(env.id);
    release();
    await core.waitIdle(env.id);
    env.gateway.stream = async function* () {
      yield { type: "error", error: veraError("OFFLINE"), aborted: false };
    };
    await handlers["session.plan.review.restore"]({
      ...env.scope,
      expectedFeedbackRevision: 2,
      reviewId: receipt.reviewId,
    });
    expect(core.get(env.id).snapshot.planComments).toHaveLength(1);
  } finally {
    release();
  }
});
