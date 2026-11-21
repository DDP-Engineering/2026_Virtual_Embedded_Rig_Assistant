import { getEventListeners } from "node:events";
import { foldSessionEvents, type SessionEvent, veraError } from "@vera/shared";
import { expect, it, vi } from "vitest";
import { projectDelegatedTurn, waitForDelegatedTurn } from "./delegation-monitor.js";
import type { SessionListener } from "./hub.js";

const launch = { sessionId: "child", turnId: "initial", messageId: "initial-prompt" };
const initial: SessionEvent = { type: "turn.started", turnId: launch.turnId };
const tool: SessionEvent = { type: "tool.started", callId: "call", name: "write", args: { secret: "raw" } };
const approval: SessionEvent = {
  type: "approval.requested",
  approvalId: "approval",
  callId: "call",
  requestSha256: "digest",
  tool: "write",
  path: "private/path",
  diff: "private diff",
  bytes: 20,
};
const done: SessionEvent = { type: "turn.done", turnId: launch.turnId, stopReason: "end" };
const identity = (text: string) => text;

function view(...afterStart: SessionEvent[]) {
  return { launch, snapshot: foldSessionEvents([initial, ...afterStart]), seq: afterStart.length + 1 };
}

it("reports current user approval as status only and ignores approval from another turn", async () => {
  let current = view(tool);
  let notify: SessionListener | undefined;
  const dispose = vi.fn();
  const signal = new AbortController().signal;
  const waiting = waitForDelegatedTurn(
    () => current,
    (seq, listener) => {
      expect(seq).toBe(current.seq);
      notify = listener;
      return dispose;
    },
    identity,
    30000,
    signal,
  );
  expect(getEventListeners(signal, "abort")).toHaveLength(1);
  current = view(tool, approval);
  notify?.(current.seq, approval);
  expect(await waiting).toEqual({
    sessionId: launch.sessionId,
    turnId: launch.turnId,
    status: "awaiting_approval",
    toolSteps: 1,
  });
  expect(getEventListeners(signal, "abort")).toHaveLength(0);
  expect(dispose).toHaveBeenCalledOnce();

  const later = view(done, { type: "turn.started", turnId: "unrelated" }, tool, approval, {
    type: "message.done",
    messageId: "later",
    text: "unrelated reply",
    citations: [],
  });
  expect(projectDelegatedTurn(later, identity)).toEqual({
    sessionId: launch.sessionId,
    turnId: launch.turnId,
    status: "completed",
    toolSteps: 0,
  });
});

it("cleans abort and stream resources when a live recheck fails", async () => {
  let notify: SessionListener | undefined;
  const dispose = vi.fn();
  const controller = new AbortController();
  const missing = veraError("NOT_FOUND");
  const inspect = vi
    .fn((): ReturnType<typeof view> => {
      throw missing;
    })
    .mockReturnValueOnce(view());
  const waiting = waitForDelegatedTurn(
    inspect,
    (_seq, listener) => {
      notify = listener;
      return dispose;
    },
    identity,
    30000,
    controller.signal,
  );
  notify?.(2, done);
  await expect(waiting).rejects.toBe(missing);
  expect(dispose).toHaveBeenCalledOnce();
  expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
});

it("releases abort and deadline resources when subscription throws", async () => {
  vi.useFakeTimers();
  try {
    const { signal } = new AbortController();
    const error = Error("Replay could not be read.");
    await expect(
      waitForDelegatedTurn(
        () => view(),
        () => {
          throw error;
        },
        identity,
        30000,
        signal,
      ),
    ).rejects.toBe(error);
    expect(getEventListeners(signal, "abort")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it("waits through an approval recorded and resolved synchronously by mode", async () => {
  let current = view(tool);
  let notify: SessionListener | undefined;
  const decided = {
    type: "approval.decided",
    approvalId: approval.approvalId,
    decision: "approved",
    by: "mode",
  } as const;
  const waiting = waitForDelegatedTurn(
    () => current,
    (_seq, listener) => {
      notify = listener;
      return () => {};
    },
    identity,
    30000,
    new AbortController().signal,
  );
  current = view(tool, approval);
  notify?.(current.seq, approval);
  current = view(tool, approval, decided);
  notify?.(current.seq, decided);
  current = view(tool, approval, decided, done);
  notify?.(current.seq, done);
  expect(await waiting).toMatchObject({ status: "completed", turnId: launch.turnId });
});
