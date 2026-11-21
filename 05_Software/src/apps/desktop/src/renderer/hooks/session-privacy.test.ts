// @vitest-environment jsdom
import {
  type AppEvent,
  emptySessionState,
  type SessionEvent,
  type SessionState,
  type WorkbenchEvent,
  workbenchSchema,
} from "@vera/shared";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../api/index.js";
import { SessionViewProvider, useSessionView } from "./session-view.js";

vi.mock("../api/index.js", () => ({ api: { invoke: vi.fn(), subscribe: vi.fn() } }));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
const id = "ses_00000000000000000000000001",
  wb = "wb_00000000000000000000000001";
const changed = vi.fn();
let root: Root, container: HTMLDivElement, latest: ReturnType<typeof useSessionView>;
let onApp: (event: AppEvent) => void,
  onBench: (event: WorkbenchEvent) => void,
  onSession: (event: SessionEvent) => void;
let active: number, peak: number, state: SessionState, seq: number;
type Snapshot = { snapshot: SessionState; seq: number };
let load: () => Promise<Snapshot>;
function snapshot(masked = false): SessionState {
  const text = masked ? "A[REDACTED]B" : "AsecretB";
  return {
    ...emptySessionState(),
    planRevision: 1,
    planFeedbackRevision: 1,
    todos: [{ text, status: "pending" }],
    planComments: [
      {
        id: "pc",
        text: masked ? "[REDACTED]" : "secret",
        target: {
          revision: 1,
          stepIndex: 0,
          stepText: text,
          range: { start: 1, end: 7, quote: masked ? "[REDACTED]" : "secret" },
        },
        stale: masked,
      },
    ],
  };
}
function Probe() {
  latest = useSessionView(id, changed);
  return createElement("output", null, latest.view ? JSON.stringify(latest.view.state) : "Loading");
}
async function mount(workbenchId = wb) {
  await act(async () =>
    root.render(
      createElement(
        SessionViewProvider,
        { key: workbenchId, id, workbenchId, changed },
        createElement(Probe, { key: "chat" }),
        createElement(Probe, { key: "plan" }),
      ),
    ),
  );
}
const gets = () => vi.mocked(api.invoke).mock.calls.filter(([channel]) => channel === "session.get").length;
beforeEach(() => {
  vi.useFakeTimers();
  active = 0;
  peak = 0;
  seq = 7;
  state = snapshot();
  load = async () => ({ snapshot: state, seq });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.mocked(api.invoke).mockImplementation(async (channel) =>
    channel === "session.revision" ? ({ seq } as never) : ((await load()) as never),
  );
  vi.mocked(api.subscribe).mockImplementation((...args: unknown[]) => {
    if (args[0] === "app") {
      onApp = args[1] as typeof onApp;
      return () => {};
    }
    if (args[0] === "workbench") {
      onBench = args[2] as typeof onBench;
      return () => {};
    }
    onSession = args[3] as typeof onSession;
    active++;
    peak = Math.max(peak, active);
    return () => {
      active--;
    };
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  expect(active).toBe(0);
  container.remove();
  vi.useRealTimers();
  vi.resetAllMocks();
});

it("remasks at unchanged seq for both shared consumers, hiding old content and ignoring old frames/events", async () => {
  await mount();
  expect(gets()).toBe(1);
  expect(active).toBe(1);
  const old = onSession;
  await act(async () => onSession({ type: "message.delta", messageId: "live", text: "secret" }));
  await act(async () => onApp?.({ type: "settings.changed", masking: false }));
  expect(gets()).toBe(1);
  let resolve = (_value: Snapshot) => {};
  load = () =>
    new Promise((done) => {
      resolve = done;
    });
  await act(async () => onApp?.({ type: "settings.changed" }));
  expect(latest.view).toBeUndefined();
  expect(container.textContent).not.toContain("secret");
  expect(latest.projection).toBe(1);
  expect(gets()).toBe(2);
  state = snapshot(true);
  await act(async () => {
    old({ type: "message.delta", messageId: "old", text: "secret" });
    resolve({ snapshot: state, seq });
  });
  expect(container.textContent).not.toContain("secret");
  expect(latest.view?.state.planComments[0]?.stale).toBe(true);
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(gets()).toBe(2);
  expect(active).toBe(1);
  expect(peak).toBe(1);
});

it("forces the same shared projection through workbench policy and effective session model changes", async () => {
  await mount();
  state = snapshot(true);
  await act(async () =>
    onBench?.({
      type: "config.changed",
      config: workbenchSchema.parse({ format: 1, id: wb, name: "Board" }),
      warnings: [],
    }),
  );
  expect(gets()).toBe(2);
  expect(latest.projection).toBe(1);
  state = { ...state, modelRef: "replay/new" };
  seq++;
  await act(async () => onSession({ type: "session.updated", modelRef: "replay/new" }));
  expect(gets()).toBe(3);
  expect(latest.view?.state.modelRef).toBe("replay/new");
  seq++;
  await act(async () => onSession({ type: "session.updated", modelRef: "replay/new" }));
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(gets()).toBe(3);
  expect(active).toBe(1);
  expect(peak).toBe(1);
});

it("invalidates an older in-flight projection again and never installs its late answer", async () => {
  await mount();
  const pending: Array<(value: Snapshot) => void> = [];
  load = () => new Promise((resolve) => pending.push(resolve));
  await act(async () => onApp?.({ type: "settings.changed" }));
  await act(async () => onApp?.({ type: "settings.changed" }));
  expect(gets()).toBe(3);
  await act(async () => pending[0]?.({ snapshot: snapshot(), seq }));
  expect(latest.view).toBeUndefined();
  await act(async () => pending[1]?.({ snapshot: snapshot(true), seq }));
  expect(container.textContent).not.toContain("secret");
  expect(active).toBe(1);
  expect(peak).toBe(1);
});

it("keys shared transport by workbench even for coincident session IDs and drops obsolete privacy callbacks", async () => {
  await mount();
  const old = onApp;
  let resolve = (_value: Snapshot) => {};
  load = () =>
    new Promise((done) => {
      resolve = done;
    });
  await mount("wb_00000000000000000000000002");
  expect(latest.view).toBeUndefined();
  await act(async () => old?.({ type: "settings.changed" }));
  expect(gets()).toBe(2);
  await act(async () => resolve({ snapshot: snapshot(true), seq }));
  expect(container.textContent).not.toContain("secret");
  expect(active).toBe(1);
  expect(peak).toBe(1);
});
