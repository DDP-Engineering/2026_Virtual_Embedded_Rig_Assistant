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
let on: (event: SessionEvent) => void;
const changed = vi.fn();
const off = vi.fn();
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
  expect(api.subscribe).toHaveBeenCalledTimes(1);
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
  expect(api.subscribe).toHaveBeenCalledTimes(1);
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
  expect(api.subscribe).toHaveBeenCalledTimes(2);
});
