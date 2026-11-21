// @vitest-environment jsdom
// REQ-UX-f20cb322
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { api } from "../../api/index.js";
import "../../i18n.js";
import { SessionWorkspace } from "./workspace.js";

vi.mock("../../api/index.js", async () => {
  const { createMockApi } = await import("../../mocks/mockApi.js");
  return { api: createMockApi().api, usingMocks: true };
});
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  await api.invoke("workbench.close", {});
});
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

test("a send at the turn limit stays in the composer and says when a turn can start", async () => {
  await api.updateSettings({ advanced: { concurrentTurns: 1 } });
  const bench = await api.invoke("workbench.create", { folder: "/mock/turn-limit", name: "Turn limit" });
  const running = await api.invoke("session.create", { workbenchId: bench.config.id });
  const waiting = await api.invoke("session.create", { workbenchId: bench.config.id });
  // The first turn asks for an approval and keeps its slot until it ends.
  await api.invoke("session.send", { sessionId: running.id, text: "edit the notes" });
  expect(await api.invoke("session.capacity", {})).toEqual({ active: 1, limit: 1 });

  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root?.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        createElement(SessionWorkspace, {
          id: waiting.id,
          workbenchId: bench.config.id,
          changed: () => {},
          readOnly: false,
        }),
      ),
    ),
  );
  await settle();
  const view = container;
  const input = view.querySelector<HTMLTextAreaElement>("#chat-message") as HTMLTextAreaElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
      input,
      "Second question",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const send = () =>
    view.querySelector<HTMLButtonElement>('[data-action="send-message"]') as HTMLButtonElement;
  await act(async () => send().click());
  await settle();

  const alert = view.querySelector('[role="alert"][data-i18n="errors.TURN_LIMIT"]');
  expect(alert?.textContent).toContain("(1)");
  expect(input.value).toBe("Second question");
  expect(view.querySelector('[data-i18n="chat.turnSlotFree"]')).toBeNull();
  expect((await api.invoke("session.get", { sessionId: waiting.id })).snapshot.items).toHaveLength(0);
  const unchanged = (await api.invoke("session.list", {})).find((row) => row.id === waiting.id);
  expect(unchanged?.updatedAt).toBe(waiting.updatedAt);

  // Ending the running turn frees the slot: the alert becomes a status and the draft is still there.
  await act(async () => {
    await api.invoke("session.stop", { sessionId: running.id });
  });
  await settle();
  expect(view.querySelector('[data-i18n="errors.TURN_LIMIT"]')).toBeNull();
  expect(view.querySelector('[role="status"][data-i18n="chat.turnSlotFree"]')?.textContent).toBe(
    "A turn can start now. Send your message again.",
  );
  expect(input.value).toBe("Second question");

  await act(async () => send().click());
  await settle();
  expect(view.querySelector('[data-i18n="chat.turnSlotFree"]')).toBeNull();
  expect(input.value).toBe("");
});
