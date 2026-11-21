// @vitest-environment jsdom
// REQ-UX-8663749f REQ-UX-91d7a481 REQ-UX-692b8471
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../../api/index.js";
import i18n from "../../i18n.js";
import { SessionAdvancedDialog } from "./session-advanced.js";

const view = vi.hoisted(() => ({
  state: {
    advanced: {} as Record<string, number | boolean>,
    activeTurnId: null as string | null,
    status: "idle",
    usage: { inputTokens: 0, outputTokens: 0 } as {
      inputTokens: number;
      outputTokens: number;
      compactionStatus?: string;
    },
  },
}));
vi.mock("../../api/index.js", () => ({ api: { invoke: vi.fn() } }));
vi.mock("../../hooks/session-view.js", () => ({ useSessionView: () => ({ view }) }));
vi.mock("../../hooks/use-preferences.js", () => ({
  useSettingsSnapshot: () => ({ data: { settings: { advanced: {} } } }),
}));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
  this.setAttribute("open", "");
};
let root: Root;
let container: HTMLDivElement;
const invoke = vi.mocked(api.invoke);
beforeEach(async () => {
  await i18n.changeLanguage("en");
  view.state.advanced = { toolCallsPerTurn: 120 };
  view.state.activeTurnId = null;
  view.state.status = "idle";
  view.state.usage = { inputTokens: 0, outputTokens: 0 };
  invoke.mockImplementation(async (channel) =>
    channel === "workbench.config.get" ? ({ config: {} } as never) : ({} as never),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});
const mount = async (onClose: () => void) =>
  act(async () =>
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        createElement(SessionAdvancedDialog, { sessionId: "s1", onClose }),
      ),
    ),
  );
const button = (action: string) =>
  container.querySelector<HTMLButtonElement>(`[data-action="${action}"]`) as HTMLButtonElement;
const setCalls = () => invoke.mock.calls.filter(([channel]) => channel === "session.advanced.set");

it("records nothing on Cancel or Escape, even with an edited draft", async () => {
  const onClose = vi.fn();
  await mount(onClose);
  const input = container.querySelector<HTMLInputElement>("[data-advanced-field] input") as HTMLInputElement;
  await act(async () => userEvent.setup().clear(input));
  await act(async () => userEvent.setup().type(input, "300"));
  await act(async () => userEvent.setup().click(button("close-session-advanced")));
  await act(async () => {
    container.querySelector("dialog")?.dispatchEvent(new Event("cancel", { cancelable: true }));
  });
  expect(onClose).toHaveBeenCalledTimes(2);
  expect(setCalls()).toEqual([]);
});

it("sends null for a value cleared with Reset, only on Save", async () => {
  const onClose = vi.fn();
  await mount(onClose);
  expect(button("save-session-advanced").disabled).toBe(true);
  await act(async () =>
    userEvent.setup().click(container.querySelector("[data-advanced-reset]") as HTMLButtonElement),
  );
  expect(setCalls()).toEqual([]);
  await act(async () => userEvent.setup().click(button("save-session-advanced")));
  expect(setCalls()).toEqual([
    ["session.advanced.set", { sessionId: "s1", key: "toolCallsPerTurn", value: null }],
  ]);
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("keeps the dialog and the draft open with the error when the save fails", async () => {
  invoke.mockImplementation(async (channel) => {
    if (channel === "session.advanced.set") throw { code: "DENIED", messageKey: "errors.DENIED" };
    return { config: {} } as never;
  });
  const onClose = vi.fn();
  await mount(onClose);
  const input = container.querySelector<HTMLInputElement>("[data-advanced-field] input") as HTMLInputElement;
  await act(async () => userEvent.setup().clear(input));
  await act(async () => userEvent.setup().type(input, "300"));
  await act(async () => userEvent.setup().click(button("save-session-advanced")));
  expect(onClose).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  expect(input.value).toBe("300");
  expect(button("save-session-advanced").disabled).toBe(false);
});

it("keeps the dialog open on Cancel and Escape while a save is in progress", async () => {
  let finish: () => void = () => {};
  invoke.mockImplementation(async (channel) => {
    if (channel === "session.advanced.set") await new Promise<void>((resolve) => (finish = resolve));
    return { config: {} } as never;
  });
  const onClose = vi.fn();
  await mount(onClose);
  await act(async () =>
    userEvent.setup().click(container.querySelector("[data-advanced-reset]") as HTMLButtonElement),
  );
  await act(async () => button("save-session-advanced").click());
  expect(button("close-session-advanced").disabled).toBe(true);
  await act(async () => {
    container.querySelector("dialog")?.dispatchEvent(new Event("cancel", { cancelable: true }));
  });
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => finish());
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("edits a switch as inherit, on or off and saves a boolean", async () => {
  const onClose = vi.fn();
  await mount(onClose);
  const select = container.querySelector<HTMLSelectElement>(
    '[data-advanced-field="autoCompaction"] select',
  ) as HTMLSelectElement;
  expect(select.value).toBe("");
  expect(select.options[0]?.textContent).toBe("Inherit: On (default)");
  await act(async () => userEvent.setup().selectOptions(select, "off"));
  await act(async () => userEvent.setup().click(button("save-session-advanced")));
  expect(setCalls()).toEqual([
    ["session.advanced.set", { sessionId: "s1", key: "autoCompaction", value: false }],
  ]);
});

it("compacts now and shows the outcome, and refuses while the session runs", async () => {
  invoke.mockImplementation(async (channel) => {
    if (channel === "session.compact") return { status: "completed" } as never;
    return { config: {} } as never;
  });
  await mount(vi.fn());
  await act(async () => userEvent.setup().click(button("compact-session")));
  expect(invoke).toHaveBeenCalledWith("session.compact", { sessionId: "s1" });
  expect(container.querySelector("[data-compact-status]")?.textContent).toBe("History summarized.");
  expect(setCalls()).toEqual([]);
  await act(async () => root.unmount());
  root = createRoot(container);
  view.state.activeTurnId = "turn";
  await mount(vi.fn());
  expect(button("compact-session").disabled).toBe(true);
});

it("shows a refused Compact now as an error", async () => {
  invoke.mockImplementation(async (channel) => {
    if (channel === "session.compact") throw { code: "DENIED", messageKey: "errors.DENIED" };
    return { config: {} } as never;
  });
  await mount(vi.fn());
  await act(async () => userEvent.setup().click(button("compact-session")));
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  expect(container.querySelector("[data-compact-status]")).toBeNull();
});
