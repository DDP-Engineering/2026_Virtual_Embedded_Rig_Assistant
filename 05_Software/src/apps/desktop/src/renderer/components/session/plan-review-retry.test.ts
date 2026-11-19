// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { emptySessionState, type SessionState, veraError } from "@vera/shared";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../../api/index.js";
import { SessionWorkspace } from "./workspace.js";
import "../../i18n.js";

const shared = vi.hoisted(() => ({ state: undefined as SessionState | undefined, reconcile: vi.fn() }));
vi.mock("../../hooks/session-view.js", () => ({
  useSessionView: (id: string) => ({
    view: shared.state ? { id, state: shared.state, reasoning: {}, updates: {} } : undefined,
    retry: shared.reconcile,
  }),
}));
vi.mock("../../api/index.js", async () => {
  const { createMockApi } = await import("../../mocks/mockApi.js");
  return { api: createMockApi(undefined, "chat").api };
});
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
let root: Root, container: HTMLDivElement, id: string, workbenchId: string;
const changed = vi.fn();
let client: QueryClient;
let serial = 0;
function fixtureState(review = true): SessionState {
  const state = emptySessionState();
  state.status = "error";
  state.planRevision = 1;
  state.planFeedbackRevision = 2;
  state.items = [
    {
      kind: "user",
      id: "user",
      text: "Review-only request; never execute",
      ...(review ? { reviewId: "review" } : {}),
    },
    { kind: "error", id: "error", code: "OFFLINE", messageKey: "errors.OFFLINE", retryable: true },
  ];
  if (review)
    state.planReviews = [
      {
        id: "review",
        expectedPlanRevision: 1,
        expectedFeedbackRevision: 1,
        plan: [{ text: "Plan", status: "pending" }],
        comments: [
          {
            id: "comment",
            text: "Feedback",
            target: { revision: 1, stepIndex: 0, stepText: "Plan", range: null },
          },
        ],
        turnId: "turn",
        messageId: "user",
        submittedAt: new Date(0).toISOString(),
        stopReason: "error",
      },
    ];
  return state;
}
async function render(options: { readOnly?: boolean; archived?: boolean; workbenchId?: string } = {}) {
  await act(async () =>
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(SessionWorkspace, {
          id,
          workbenchId: options.workbenchId ?? workbenchId,
          changed,
          readOnly: options.readOnly ?? false,
          archived: options.archived ?? false,
        }),
      ),
    ),
  );
}
async function mount(review = true) {
  const bench = await api.invoke("workbench.create", {
    folder: `/mock/plan-retry-${++serial}`,
    name: "Plan retry",
  });
  workbenchId = bench.config.id;
  id = (await api.invoke("session.create", {})).id;
  shared.state = fixtureState(review);
  shared.reconcile.mockClear();
  changed.mockClear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await render();
}
function retryButton() {
  const button = [...container.querySelectorAll("button")].find((node) => node.textContent === "Retry");
  expect(button).toBeTruthy();
  return button as HTMLButtonElement;
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  client?.clear();
  vi.restoreAllMocks();
  await api.invoke("workbench.close", {});
});

it("restores review feedback once on generic Retry without ordinary send, then announces Plan and reconciles", async () => {
  await mount();
  const original = api.invoke.bind(api);
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const invoke = vi.spyOn(api, "invoke").mockImplementation(async (channel, request) => {
    if (channel === "session.plan.review.restore") {
      await held;
      return {} as never;
    }
    return original(channel, request);
  });
  await act(async () => {
    retryButton().click();
    retryButton().click();
  });
  expect(invoke.mock.calls.filter(([channel]) => channel === "session.plan.review.restore")).toEqual([
    [
      "session.plan.review.restore",
      { workbenchId, sessionId: id, expectedFeedbackRevision: 2, reviewId: "review" },
    ],
  ]);
  expect(invoke.mock.calls.some(([channel]) => channel === "session.send")).toBe(false);
  await act(async () => {
    release();
    await held;
  });
  expect(shared.reconcile).toHaveBeenCalledOnce();
  expect(container.textContent).toContain("Feedback is ready in Plan.");
});

it("keeps failed restore errors and retries the same feedback snapshot without sending chat", async () => {
  await mount();
  const original = api.invoke.bind(api);
  let attempts = 0;
  const invoke = vi.spyOn(api, "invoke").mockImplementation(async (channel, request) => {
    if (channel === "session.plan.review.restore") {
      if (++attempts === 1) throw veraError("CONFLICT");
      return {} as never;
    }
    return original(channel, request);
  });
  await act(async () => retryButton().click());
  expect(container.querySelectorAll('[role="alert"]').length).toBeGreaterThan(1);
  expect(container.textContent).not.toContain("Feedback is ready in Plan.");
  await act(async () => retryButton().click());
  expect(attempts).toBe(2);
  expect(invoke.mock.calls.some(([channel]) => channel === "session.send")).toBe(false);
});

it("does not restore in archived or read-only workbenches and drops an old-scope acknowledgement", async () => {
  await mount();
  const original = api.invoke.bind(api);
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const invoke = vi.spyOn(api, "invoke").mockImplementation(async (channel, request) => {
    if (channel === "session.plan.review.restore") {
      await held;
      return {} as never;
    }
    return original(channel, request);
  });
  for (const options of [{ archived: true }, { readOnly: true }]) {
    await render(options);
    await act(async () => retryButton().click());
  }
  expect(invoke).not.toHaveBeenCalled();
  await render();
  await act(async () => retryButton().click());
  await render({ workbenchId: "wb_00000000000000000000000002" });
  await act(async () => {
    release();
    await held;
  });
  expect(changed).not.toHaveBeenCalled();
  expect(shared.reconcile).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain("Feedback is ready in Plan.");
});

it("retains the unsent composer through a hidden privacy projection without retaining disclosed history", async () => {
  await mount(false);
  const input = container.querySelector<HTMLTextAreaElement>("#chat-message") as HTMLTextAreaElement;
  await act(async () => userEvent.setup().type(input, "Preserved unsent draft"));
  shared.state = undefined;
  await render();
  expect(input.isConnected).toBe(true);
  expect(input.disabled).toBe(true);
  expect(container.querySelector("[data-message-kind]")).toBeNull();
  shared.state = fixtureState(false);
  await render();
  expect(container.querySelector("#chat-message")).toBe(input);
  expect(input.value).toBe("Preserved unsent draft");
  expect(input.disabled).toBe(false);
});

it("locks review text and Send but retains Stop without changing ordinary Retry", async () => {
  await mount();
  if (!shared.state) throw Error("missing fixture");
  shared.state = { ...shared.state, status: "running", activeTurnId: "turn" };
  await render();
  expect(container.querySelector<HTMLTextAreaElement>("#chat-message")?.disabled).toBe(true);
  expect(container.querySelector<HTMLButtonElement>('[data-action="stop-session"]')?.disabled).toBe(false);
  shared.state = undefined;
  await render();
  expect(container.querySelector<HTMLTextAreaElement>("#chat-message")?.disabled).toBe(true);
  expect(container.querySelector<HTMLButtonElement>('[data-action="stop-session"]')?.disabled).toBe(false);
  shared.state = fixtureState(false);
  await render();
  const original = api.invoke.bind(api);
  const invoke = vi
    .spyOn(api, "invoke")
    .mockImplementation(async (channel, request) =>
      channel === "session.send" ? ({ messageId: "ordinary" } as never) : original(channel, request),
    );
  await act(async () => retryButton().click());
  expect(invoke).toHaveBeenCalledWith("session.send", {
    sessionId: id,
    text: "Review-only request; never execute",
  });
  expect(invoke.mock.calls.some(([channel]) => channel === "session.plan.review.restore")).toBe(false);
});
