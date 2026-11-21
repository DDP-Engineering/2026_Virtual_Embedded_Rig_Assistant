// @vitest-environment jsdom
import { applySessionEvent, emptySessionState, type SessionEvent } from "@vera/shared";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../api/index.js";
import { useSessionEvents } from "./use-session-events.js";

vi.mock("../api/index.js", () => ({ api: { invoke: vi.fn(), subscribe: vi.fn() } }));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
let root: Root;
let container: HTMLDivElement;
let latest: ReturnType<typeof useSessionEvents>;
let renders = 0;
let on: (event: SessionEvent) => void;
const changed = vi.fn();
const off = vi.fn();
const sessionSubscriptions = () =>
  vi.mocked(api.subscribe).mock.calls.filter(([topic]) => topic === "session");
const initial = [
  { type: "turn.started", turnId: "turn" },
  { type: "tool.started", callId: "download", name: "web_download", args: {} },
] satisfies SessionEvent[];
let events: SessionEvent[];
const snapshot = () => ({
  snapshot: events.reduce(applySessionEvent, emptySessionState()),
  seq: events.length,
});
function Probe({ id }: { id?: string }) {
  latest = useSessionEvents(id, changed);
  renders++;
  return null;
}
async function mount() {
  await act(async () => root.render(createElement(Probe, { id: "session" })));
}
async function tick() {
  await act(async () => vi.advanceTimersByTimeAsync(2000));
}
beforeEach(() => {
  vi.useFakeTimers();
  events = [...initial];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.mocked(api.invoke).mockImplementation(async (channel) => {
    if (channel === "session.revision") return { seq: events.length } as never;
    return snapshot() as never;
  });
  vi.mocked(api.subscribe).mockImplementation((...args: unknown[]) => {
    if (args[0] !== "session") return () => {};
    on = args[3] as typeof on;
    return off;
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.resetAllMocks();
});
it.each(["end", "error", "aborted"] as const)(
  "recovers missed tool and turn completion (%s) without navigation",
  async (stopReason) => {
    await mount();
    expect(latest.view?.state.status).toBe("running");
    const oldOn = on;
    events.push(
      {
        type: "tool.done",
        callId: "download",
        ok: stopReason === "end",
        summary: stopReason,
        durationMs: 42,
      },
      { type: "turn.done", turnId: "turn", stopReason },
    ); // Persisted in the backend, but the subscription has disconnected.
    await tick();
    expect(latest.view?.state.status).toBe(stopReason === "error" ? "error" : "idle");
    expect(latest.view?.state.activeTurnId).toBeNull();
    expect(latest.view?.state.items[0]).toMatchObject({
      status: stopReason === "end" ? "ok" : "error",
      summary: stopReason,
    });
    expect(off).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.subscribe).mock.calls.at(-1)?.slice(0, 3)).toEqual(["session", "session", 4]);
    await act(async () => oldOn({ type: "turn.started", turnId: "stale" }));
    expect(latest.view?.state.activeTurnId).toBeNull();
  },
);
it("keeps live text when the cursor has not changed and avoids full snapshot polling", async () => {
  await mount();
  await act(async () => on({ type: "message.delta", messageId: "answer", text: "Live text" }));
  await tick();
  expect(latest.view?.state.items.at(-1)).toMatchObject({ text: "Live text", streaming: true });
  expect(sessionSubscriptions()).toHaveLength(1);
  expect(vi.mocked(api.invoke).mock.calls.filter(([channel]) => channel === "session.get")).toHaveLength(1);
});
it("does not apply a stale snapshot over newer live events", async () => {
  await mount();
  events.push({ type: "tool.done", callId: "download", ok: true, summary: "Done", durationMs: 1 });
  const stale = snapshot();
  let resolve: (value: typeof stale) => void = () => {};
  vi.mocked(api.invoke).mockImplementation(async (channel) => {
    if (channel === "session.revision") return { seq: events.length } as never;
    return new Promise<typeof stale>((done) => {
      resolve = done;
    }) as never;
  });
  await tick();
  await act(async () => {
    on(events[2] as SessionEvent);
    on({ type: "turn.done", turnId: "turn", stopReason: "end" });
    resolve(stale);
  });
  expect(latest.view?.state.status).toBe("idle");
  expect(sessionSubscriptions()).toHaveLength(1);
});
it("retries transient failures, restores approvals and releases subscriptions on session change", async () => {
  await mount();
  vi.mocked(api.invoke).mockRejectedValueOnce(new Error("IPC unavailable"));
  await tick();
  expect(latest.error).toBeUndefined();
  events.push({
    type: "approval.requested",
    approvalId: "approval",
    callId: "download",
    requestSha256: "a".repeat(64),
    tool: "write",
    path: "notes.txt",
    diff: "",
    bytes: 1,
  });
  await tick();
  expect(latest.view?.state.status).toBe("awaiting_approval");
  await act(async () => root.render(createElement(Probe, {})));
  const calls = vi.mocked(api.invoke).mock.calls.length;
  await tick();
  expect(api.invoke).toHaveBeenCalledTimes(calls);
  expect(latest.view).toBeUndefined();
  expect(off).toHaveBeenCalledTimes(2);
});
it("retries an initial snapshot failure automatically", async () => {
  vi.mocked(api.invoke).mockRejectedValueOnce(new Error("Temporarily unavailable"));
  await mount();
  expect(latest.error).toBeDefined();
  await tick();
  expect(latest.error).toBeUndefined();
  expect(latest.view?.state.status).toBe("running");
});
it("reconnects after a transport error even when its synthetic event balances a missing completion", async () => {
  await mount();
  events.push({ type: "turn.done", turnId: "turn", stopReason: "aborted" });
  await act(async () =>
    on({ type: "error", code: "INTERNAL", messageKey: "errors.INTERNAL", retryable: false }),
  );
  await tick();
  expect(latest.view?.state.activeTurnId).toBeNull();
  expect(latest.view?.state.status).toBe("idle");
  expect(sessionSubscriptions()).toHaveLength(2);
});
it("applies the live events of one frame in a single update, in arrival order", async () => {
  await mount();
  const before = renders;
  for (let index = 0; index < 100; index++)
    await act(async () => on({ type: "message.delta", messageId: "answer", text: `${index},` }));
  await act(async () => on({ type: "reasoning.delta", messageId: "answer", text: "why" }));
  await act(async () => on({ type: "tool.update", callId: "download", text: "50%" }));
  expect(renders).toBe(before);
  await act(async () => vi.advanceTimersByTimeAsync(20));
  expect(renders).toBe(before + 1);
  const text = Array.from({ length: 100 }, (_, index) => `${index},`).join("");
  expect(latest.view?.state.items.at(-1)).toMatchObject({ text, streaming: true });
  expect(latest.view?.reasoning).toEqual({ answer: "why" });
  expect(latest.view?.updates).toEqual({ download: "50%" });
});
it("flushes queued live text at once on turn.done, error and session.updated", async () => {
  await mount();
  await act(async () => on({ type: "message.delta", messageId: "answer", text: "Final" }));
  await act(async () =>
    on({ type: "session.updated", title: "Renamed", status: "running", mode: "ask", modelRef: null }),
  );
  expect(latest.view?.state.items.at(-1)).toMatchObject({ text: "Final" });
  expect(latest.view?.state.title).toBe("Renamed");
  await act(async () => on({ type: "message.delta", messageId: "answer", text: " text" }));
  await act(async () => on({ type: "turn.done", turnId: "turn", stopReason: "end" }));
  // turn.done drops unfinalized live text, so the delta must have been applied before it.
  expect(latest.view?.state.status).toBe("idle");
  expect(latest.view?.state.items.some((item) => item.kind === "assistant")).toBe(false);
  await act(async () => on({ type: "reasoning.delta", messageId: "next", text: "thinking" }));
  await act(async () =>
    on({ type: "error", code: "INTERNAL", messageKey: "errors.INTERNAL", retryable: false }),
  );
  expect(latest.view?.reasoning).toEqual({ next: "thinking" });
});
it("keeps only the tail of live reasoning and tool output, and all of the message text", async () => {
  await mount();
  const long = "x".repeat(600_000);
  await act(async () => {
    on({ type: "message.delta", messageId: "answer", text: long });
    on({ type: "reasoning.delta", messageId: "answer", text: `${long}end` });
    on({ type: "tool.update", callId: "download", text: `${long}end` });
  });
  await act(async () => vi.advanceTimersByTimeAsync(20));
  expect(latest.view?.reasoning.answer).toHaveLength(500_000);
  expect(latest.view?.reasoning.answer?.endsWith("end")).toBe(true);
  expect(latest.view?.updates.download).toHaveLength(500_000);
  expect(latest.view?.state.items.at(-1)).toMatchObject({ text: long });
});
it("checks again after a reconcile call that never settles", async () => {
  await mount();
  events.push({ type: "turn.done", turnId: "turn", stopReason: "end" });
  vi.mocked(api.invoke).mockImplementationOnce(() => new Promise<never>(() => {}));
  await tick();
  await tick();
  expect(latest.view?.state.status).toBe("running");
  await act(async () => vi.advanceTimersByTimeAsync(30_000));
  await tick();
  expect(latest.view?.state.status).toBe("idle");
});
it("cancels a pending frame on unmount and on session switch", async () => {
  await mount();
  await act(async () => on({ type: "message.delta", messageId: "answer", text: "Dropped" }));
  await act(async () => root.render(createElement(Probe, { id: "other" })));
  await act(async () => vi.advanceTimersByTimeAsync(20));
  expect(latest.view?.state.items.some((item) => item.kind === "assistant")).toBe(false);
  await act(async () => on({ type: "message.delta", messageId: "answer", text: "Late" }));
  await act(async () => root.unmount());
  expect(vi.getTimerCount()).toBe(0);
  root = createRoot(container);
});
