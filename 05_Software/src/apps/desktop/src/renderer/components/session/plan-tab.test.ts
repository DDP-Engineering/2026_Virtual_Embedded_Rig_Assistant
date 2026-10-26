// @vitest-environment jsdom
// REQ-UX-8d3039aa
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { emptySessionState, type SessionEvent, type TodoItem, veraError } from "@vera/shared";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "../../App.js";
import { api } from "../../api/index.js";
import { PlanTab } from "./plan-tab.js";
import "../../i18n.js";

vi.mock("../../api/index.js", async () => {
  const { createMockApi } = await import("../../mocks/mockApi.js");
  return { api: createMockApi(undefined, "chat").api };
});
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
let root: Root, container: HTMLDivElement;
async function settle() {
  await act(async () => {
    await new Promise((done) => setTimeout(done, 30));
  });
}
function button(text: string) {
  const node = [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
    b.textContent?.includes(text),
  );
  expect(node, text).toBeTruthy();
  return node as HTMLButtonElement;
}
afterEach(async () => {
  vi.restoreAllMocks();
  if (root) await act(async () => root.unmount());
  container?.remove();
  await api.invoke("workbench.close", {});
  localStorage.clear();
});
async function mount() {
  await api.invoke("workbench.open", { folder: "/mock/demo-board" });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(App))));
  await settle();
  await act(async () => button("Empty session").click());
  await act(async () => container.querySelector<HTMLButtonElement>("[data-toggle=right]")?.click());
  await act(async () => button("Plan").click());
  await settle();
}
it("connects Plan to the selected session empty list", async () => {
  await mount();
  expect(container.querySelector("#panel-plan")?.textContent).toContain("No tasks in this session.");
});

async function renderPlan(sessionId: string, workbenchId = "wb_test") {
  if (!container) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  await act(async () => root.render(createElement(PlanTab, { workbenchId, sessionId })));
  await settle();
}
it("uses snapshot sequence, follows each replacement and clear, and treats text as data", async () => {
  container = undefined as unknown as HTMLDivElement;
  const snapshot = { ...emptySessionState(), todos: [{ text: "Initial", status: "pending" as const }] };
  vi.spyOn(api, "invoke").mockResolvedValue({ snapshot, seq: 12 });
  let notify: ((event: SessionEvent) => void) | undefined;
  const off = vi.fn();
  const subscribe = vi.spyOn(api, "subscribe").mockImplementation(((...args: unknown[]) => {
    notify = args[3] as (event: SessionEvent) => void;
    return off;
  }) as typeof api.subscribe);
  await renderPlan("ses_00000000000000000000000001");
  expect(subscribe).toHaveBeenCalledWith(
    "session",
    "ses_00000000000000000000000001",
    12,
    expect.any(Function),
  );
  expect(container.textContent).toContain("Initial");
  for (const items of [
    [
      { text: "First", status: "in_progress" as const },
      { text: "Second", status: "pending" as const },
    ],
    [
      { text: "Second", status: "in_progress" as const },
      { text: "First", status: "done" as const },
    ],
    [{ text: "<script>literal</script>", status: "done" as const }],
  ]) {
    await act(async () => notify?.({ type: "todo.updated", items }));
    expect([...container.querySelectorAll(".plan-text")].map((e) => e.textContent)).toEqual(
      items.map((i) => i.text),
    );
    expect([...container.querySelectorAll('[role="img"]')].map((e) => e.getAttribute("aria-label"))).toEqual(
      items.map((i) => (i.status === "done" ? "Done" : i.status === "pending" ? "Pending" : "In progress")),
    );
  }
  expect(container.querySelector("script")).toBeNull();
  await act(async () => notify?.({ type: "todo.updated", items: [] }));
  expect(container.textContent).toContain("No tasks in this session.");
  await renderPlan("ses_00000000000000000000000002");
  expect(off).toHaveBeenCalledOnce();
});
it("isolates late snapshots/events across session and workbench changes", async () => {
  container = undefined as unknown as HTMLDivElement;
  type Snapshot = { snapshot: ReturnType<typeof emptySessionState>; seq: number };
  const resolve: ((value: Snapshot) => void)[] = [];
  vi.spyOn(api, "invoke").mockImplementation(
    () => new Promise((done) => resolve.push(done)) as ReturnType<typeof api.invoke>,
  );
  const callbacks: ((e: SessionEvent) => void)[] = [];
  vi.spyOn(api, "subscribe").mockImplementation(((...args: unknown[]) => {
    callbacks.push(args[3] as (e: SessionEvent) => void);
    return () => {};
  }) as typeof api.subscribe);
  await renderPlan("ses_00000000000000000000000001");
  expect(container.querySelector('[role="status"]')).toBeTruthy();
  await renderPlan("ses_00000000000000000000000002");
  const items: TodoItem[] = [{ text: "Current", status: "done" }];
  await act(async () => resolve[1]?.({ snapshot: { ...emptySessionState(), todos: items }, seq: 5 }));
  await act(async () =>
    resolve[0]?.({
      snapshot: { ...emptySessionState(), todos: [{ text: "Obsolete", status: "pending" }] },
      seq: 1,
    }),
  );
  expect(container.textContent).toContain("Current");
  expect(container.textContent).not.toContain("Obsolete");
  await renderPlan("ses_00000000000000000000000002", "wb_other");
  await act(async () =>
    callbacks[0]?.({ type: "todo.updated", items: [{ text: "Old event", status: "pending" }] }),
  );
  expect(container.textContent).not.toContain("Old event");
  await act(async () => resolve[2]?.({ snapshot: emptySessionState(), seq: 2 }));
  expect(container.textContent).toContain("No tasks in this session.");
});
it("offers retry after a failed snapshot and presents restored todos", async () => {
  container = undefined as unknown as HTMLDivElement;
  vi.spyOn(api, "invoke")
    .mockRejectedValueOnce(veraError("INTERNAL"))
    .mockResolvedValue({
      snapshot: { ...emptySessionState(), todos: [{ text: "Restored", status: "done" }] },
      seq: 4,
    });
  vi.spyOn(api, "subscribe").mockImplementation(() => () => {});
  await renderPlan("ses_00000000000000000000000001");
  expect(container.querySelector('[role="alert"]')).toBeTruthy();
  await act(async () => button("Retry").click());
  await settle();
  expect(container.textContent).toContain("Restored");
});
