// @vitest-environment jsdom
// REQ-UX-4bea0001 REQ-UX-4bea0002 REQ-UX-4bea0003 REQ-REL-4bea0004 REQ-UX-4bea0005 REQ-REL-4bea0006 REQ-UX-4bea0007 REQ-TEST-4bea0008
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { applySessionEvent, emptySessionState } from "@vera/shared";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "../../App.js";
import { api } from "../../api/index.js";
import { useSessionEvents } from "../../hooks/use-session-events.js";
import { Composer } from "./composer.js";
import { Markdown } from "./markdown.js";
import { Transcript } from "./transcript.js";
import "../../i18n.js";

vi.mock("../../api/index.js", async () => {
  const { createMockApi } = await import("../../mocks/mockApi.js");
  return { api: createMockApi(undefined, "chat").api, usingMocks: true };
});
let root: Root;
let container: HTMLDivElement;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
  this.querySelector<HTMLElement>("[autofocus]")?.focus();
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open");
  this.dispatchEvent(new Event("close"));
};
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}
function button(text: string) {
  const node = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent === text,
  );
  expect(node, text).toBeTruthy();
  return node as HTMLButtonElement;
}
async function mount(child: ReactElement = createElement(App)) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        child,
      ),
    ),
  );
  await settle();
}
afterEach(async () => {
  vi.restoreAllMocks();
  if (root) await act(async () => root.unmount());
  container?.remove();
  await api.invoke("workbench.close", {});
  localStorage.clear();
});

// Users choose their own workbench and explicitly compose requests.
test("Welcome offers user workbenches without a bundled demo or guided sessions", async () => {
  const observed = vi.spyOn(api, "invoke");
  await mount();
  expect(container.querySelector(".metadata")).toBeNull();
  expect(container.querySelector('[data-action="choose-create"]')).toBeTruthy();
  expect(container.querySelector('[data-action="create-workbench"]')).toBeTruthy();
  expect(container.querySelector("[data-demo-offer], [data-demo-guide], [data-demo-prompt]")).toBeNull();
  expect(container.querySelector('[data-action="open-demo"]')).toBeNull();
  expect(
    observed.mock.calls.some(([channel]) => channel === "session.create" || channel === "session.send"),
  ).toBe(false);
});

test("an ordinary composer starts empty and accepts user text without sending automatically", async () => {
  const send = vi.fn(async () => true);
  await mount(
    createElement(Composer, {
      state: emptySessionState(),
      disabled: false,
      send,
      stop: vi.fn(),
      setModel: vi.fn(),
      setMode: vi.fn(),
    }),
  );
  const input = container.querySelector<HTMLTextAreaElement>("textarea") as HTMLTextAreaElement;
  expect(input.value).toBe("");
  await typeText(input, "My project question");
  expect(input.value).toBe("My project question");
  expect(send).not.toHaveBeenCalled();
});

test("an existing workbench with the former example name opens as an ordinary user project", async () => {
  await api.invoke("workbench.create", { folder: "/mock/former-example", name: "VERA-DEMO-01" });
  const observed = vi.spyOn(api, "invoke");
  await mount();
  expect(container.querySelector('[data-workbench="active"]')?.textContent).toContain("VERA-DEMO-01");
  expect(container.querySelector("[data-demo-guide], [data-demo-prompt]")).toBeNull();
  expect(
    observed.mock.calls.some(([channel]) => channel === "session.create" || channel === "session.send"),
  ).toBe(false);
});

// REQ-UX-8b320385 REQ-UX-3001bd00: authored; execution deferred.
test("running composer accepts Enter and Send while retaining Stop and locking the model", async () => {
  const state = emptySessionState();
  state.activeTurnId = "turn";
  state.status = "running";
  const send = vi.fn(async () => true);
  await mount(
    createElement(Composer, {
      state,
      disabled: false,
      send,
      stop: vi.fn(),
      setModel: vi.fn(),
      setMode: vi.fn(),
    }),
  );
  const input = container.querySelector<HTMLTextAreaElement>("textarea") as HTMLTextAreaElement;
  expect(input.disabled).toBe(false);
  expect(container.querySelector<HTMLSelectElement>('select[aria-label="Model"]')?.disabled).toBe(true);
  expect(button("Stop").disabled).toBe(false);
  await typeText(input, "Steer with Enter");
  await act(async () => key(input, "Enter"));
  await settle();
  await typeText(input, "Steer with Send");
  await act(async () => button("Send").click());
  await settle();
  expect(send.mock.calls).toEqual([["Steer with Enter"], ["Steer with Send"]]);
  expect(input.value).toBe("");
});

test("approval waits lock the running composer and delivery removes only the pending marker", async () => {
  const state = emptySessionState();
  state.activeTurnId = "turn";
  state.status = "awaiting_approval";
  await mount(
    createElement(Composer, {
      state,
      disabled: false,
      send: vi.fn(),
      stop: vi.fn(),
      setModel: vi.fn(),
      setMode: vi.fn(),
    }),
  );
  expect(container.querySelector<HTMLTextAreaElement>("textarea")?.disabled).toBe(true);
  expect(button("Send").disabled).toBe(true);
  expect(button("Stop").disabled).toBe(false);
  const queued = applySessionEvent(state, {
    type: "message.queued",
    messageId: "q",
    text: "Use 3.3V",
    timestamp: 1,
  });
  const render = (state: typeof queued) =>
    createElement(Transcript, { state, reasoning: {}, updates: {}, retry: vi.fn(), search: "" });
  await act(async () => root.render(render(queued)));
  expect(container.querySelectorAll("[data-message-pending]")).toHaveLength(1);
  expect(container.textContent).toContain("Pending delivery");
  await act(async () =>
    root.render(render(applySessionEvent(queued, { type: "message.delivered", messageIds: ["q"] }))),
  );
  expect(container.querySelectorAll("[data-message-pending]")).toHaveLength(0);
  expect(container.querySelectorAll('[data-message-kind="user"]')).toHaveLength(1);
  expect(container.textContent).toContain("Use 3.3V");
});
test("renderer reload of a read-only workbench disables session mutations", async () => {
  await api.invoke("workbench.open", { folder: "/mock/demo-board" });
  const config = await api.invoke("workbench.config.get", {});
  const invoke = api.invoke.bind(api);
  const observed = vi
    .spyOn(api, "invoke")
    .mockImplementation((channel, request) =>
      channel === "workbench.config.get"
        ? Promise.resolve({ ...config, readOnly: true })
        : invoke(channel, request),
    );
  await mount();
  expect(observed).toHaveBeenCalledWith("workbench.config.get", {});
  expect(button("New session").disabled).toBe(true);
});
test("Welcome creation draft survives Settings navigation while viewer scope changes", async () => {
  await mount();
  const user = userEvent.setup();
  const name = container.querySelector<HTMLInputElement>("#workbench-name");
  if (!name) throw Error("Missing workbench form");
  await act(async () => user.type(name, "Unsaved board draft"));
  await act(async () => container.querySelector<HTMLButtonElement>('[data-action="choose-create"]')?.click());
  await act(async () => button("Settings").click());
  await act(async () => button("New Workbench").click());
  expect(container.querySelector<HTMLInputElement>("#workbench-name")?.value).toBe("Unsaved board draft");
  expect(container.querySelector<HTMLButtonElement>('[data-action="create-workbench"]')?.disabled).toBe(
    false,
  );
});
test("Welcome restores the active workbench and follows sidebar switches through editor and close", async () => {
  await api.invoke("workbench.create", { folder: "/mock/switch-a", name: "Switch A" });
  await api.invoke("workbench.create", { folder: "/mock/switch-b", name: "Switch B" });
  await api.invoke("workbench.pinned.update", { content: "Context B" });
  await api.invoke("workbench.open", { folder: "/mock/switch-a" });
  await mount();
  await act(async () => button("Switch A").click());
  expect(container.querySelector('[data-workbench="active"] h3')?.textContent).toBe("Switch A");
  expect(container.querySelector('[data-action="close-workbench"]')).toBeTruthy();
  await act(async () => button("Switch B").click());
  await settle();
  expect(container.querySelector('[data-workbench="active"] h3')?.textContent).toBe("Switch B");
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[data-action="edit-workbench-overview"]')?.click(),
  );
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[data-project-section="instructions"]')?.click(),
  );
  await settle();
  expect(container.querySelector<HTMLTextAreaElement>("#pinned-content")?.value).toBe("Context B");
  await act(async () => container.querySelector<HTMLButtonElement>("dialog button")?.click());
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[data-action="close-workbench"]')?.click(),
  );
  await settle();
  expect(container.querySelector('[data-workbench="active"]')).toBeNull();
  expect(container.querySelector('[data-action="new-session"]')).toBeNull();
});
test("obsolete snapshots and detached session callbacks cannot replace the selected session", async () => {
  await api.invoke("workbench.open", { folder: "/mock/demo-board" });
  const [a, b] = await api.invoke("session.list", {});
  if (!a || !b) throw new Error("Two fixtures required");
  const first = await api.invoke("session.get", { sessionId: a.id });
  const second = await api.invoke("session.get", { sessionId: b.id });
  let release: (value: typeof first) => void = () => {};
  const delayed = new Promise<typeof first>((resolve) => {
    release = resolve;
  });
  const invoke = api.invoke.bind(api);
  vi.spyOn(api, "invoke").mockImplementation((channel, request) =>
    channel === "session.get" && "sessionId" in request && request.sessionId === a.id
      ? (delayed as ReturnType<typeof api.invoke>)
      : invoke(channel, request),
  );
  const off = vi.fn();
  const subscription = vi.spyOn(api, "subscribe").mockReturnValue(off);
  const changed = () => {};
  function Projection({ id }: { id: string }) {
    const { view } = useSessionEvents(id, changed);
    return createElement("output", {}, view?.id);
  }
  await mount(createElement(Projection, { id: a.id }));
  await act(async () => root.render(createElement(Projection, { id: b.id })));
  await settle();
  expect(container.textContent).toBe(b.id);
  expect(subscription).toHaveBeenCalledWith("session", b.id, second.seq, expect.any(Function));
  await act(async () => release(first));
  expect(container.textContent).toBe(b.id);
  expect(subscription).toHaveBeenCalledTimes(1);
  const detached = subscription.mock.calls[0]?.[3];
  if (typeof detached !== "function") throw new Error("Session callback required");
  await act(async () => root.render(createElement(Projection, { id: a.id })));
  await settle();
  expect(off).toHaveBeenCalledTimes(1);
  expect(container.textContent).toBe(a.id);
  await act(async () => detached({ type: "message.delta", messageId: "obsolete", text: "stale" }));
  expect(container.textContent).toBe(a.id);
});
async function typeText(node: HTMLTextAreaElement | HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function key(node: HTMLElement, value: string, shiftKey = false) {
  const event = new KeyboardEvent("keydown", { key: value, shiftKey, bubbles: true, cancelable: true });
  node.dispatchEvent(event);
  return event;
}
test("an open workbench offers keyboard New session and a usable composer", async () => {
  await api.invoke("workbench.create", { folder: "/mock/chat-board", name: "Chat Board" });
  await mount();
  await act(async () => button("New session").click());
  await settle();
  expect(container.querySelector('textarea[aria-label="Message"]')).toBeTruthy();
  expect(container.querySelector('textarea[aria-label="Message"]')?.hasAttribute("disabled")).toBe(false);
});
test("chat fixtures render tool arguments, invalid citations, provider Retry and estimated usage", async () => {
  await api.invoke("workbench.open", { folder: "/mock/demo-board" });
  await mount();
  const list = await api.invoke("session.list", {});
  expect(list.map((s) => s.title)).toEqual(
    expect.arrayContaining([
      "Empty session",
      "Streaming answer",
      "Tool rows",
      "Invalid citation",
      "Provider error",
      "Context limit",
    ]),
  );
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(`[data-session="${list.find((s) => s.title === "Tool rows")?.id}"]`)
      ?.click(),
  );
  await settle();
  expect(container.querySelectorAll("[data-tool-row]")).toHaveLength(2);
  expect(container.querySelectorAll("[data-citation]")).toHaveLength(1);
  await act(async () => container.querySelector<HTMLElement>("[data-tool-row] button")?.click());
  expect(container.textContent).toContain('"path": "board.txt"');
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(
        `[data-session="${list.find((s) => s.title === "Invalid citation")?.id}"]`,
      )
      ?.click(),
  );
  await settle();
  expect(container.querySelector('[data-citation="invalid"]')).toBeTruthy();
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(
        `[data-session="${list.find((s) => s.title === "Provider error")?.id}"]`,
      )
      ?.click(),
  );
  await settle();
  expect(button("Retry").disabled).toBe(false);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Providers");
  await act(async () => button("Retry").click());
  await settle();
  expect(container.querySelectorAll('[data-message-kind="user"]')).toHaveLength(2);
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(
        `[data-session="${list.find((s) => s.title === "Context limit")?.id}"]`,
      )
      ?.click(),
  );
  await settle();
  expect(container.textContent).toContain("Estimated");
  expect(container.textContent).toContain("27033");
  expect(container.textContent).toContain("4096");
  expect(container.textContent).toContain("FULL HISTORY");
  expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')?.disabled).toBe(
    false,
  );
});
test("composer completes paths with keyboard, preserves Shift+Enter and Stop restores usability", async () => {
  await api.invoke("workbench.open", { folder: "/mock/demo-board" });
  await mount();
  const sessions = await api.invoke("session.list", {});
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(
        `[data-session="${sessions.find((s) => s.title === "Empty session")?.id}"]`,
      )
      ?.click(),
  );
  await settle();
  const input = container.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="Message"]',
  ) as HTMLTextAreaElement;
  input.focus();
  await typeText(input, "Read @WORK");
  await settle();
  expect(container.querySelector('[role="listbox"]')).toBeTruthy();
  await act(async () => {
    key(input, "ArrowDown");
    key(input, "Enter");
  });
  expect(input.value).toContain(".vera/WORKBENCH.md");
  expect(key(input, "Enter", true).defaultPrevented).toBe(false);
  await act(async () => userEvent.setup().keyboard("{Shift>}{Enter}{/Shift}"));
  expect(input.value).toContain("\n");
  await act(async () => key(input, "Enter"));
  await settle();
  expect(container.querySelectorAll('[data-message-kind="user"]')).toHaveLength(1);
  expect(container.querySelector('select[aria-label="Model"]')).toBeTruthy();
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(
        `[data-session="${sessions.find((s) => s.title === "Streaming answer")?.id}"]`,
      )
      ?.click(),
  );
  await settle();
  expect(container.textContent).toContain("Streaming mock answer");
  expect(container.querySelector(".reasoning button")).toBeTruthy();
  expect(button("Stop").disabled).toBe(false);
  const user = userEvent.setup();
  const reasoning = container.querySelector<HTMLButtonElement>(".reasoning button") as HTMLButtonElement;
  reasoning.focus();
  await act(async () => user.keyboard(" "));
  expect(reasoning.getAttribute("aria-expanded")).toBe("true");
  button("Stop").focus();
  await act(async () => user.keyboard("{Escape}"));
  expect(container.querySelector("dialog[open]")).toBeTruthy();
  await act(async () => user.keyboard("{Enter}")); // Cancel
  expect(button("Stop")).toBe(document.activeElement);
  await act(async () => user.keyboard("{Escape}"));
  await act(async () => user.tab());
  await act(async () => user.keyboard("{Enter}")); // confirmed Stop
  await settle();
  expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')?.disabled).toBe(
    false,
  );
});
test("session list creation, rename, confirmed delete and tool details work by keyboard alone", async () => {
  await api.invoke("workbench.open", { folder: "/mock/demo-board" });
  await mount();
  const user = userEvent.setup();
  button("New session").focus();
  await act(async () => user.keyboard("{Enter}"));
  await settle();
  expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')?.disabled).toBe(
    false,
  );
  const id = container.querySelector('[data-session][aria-current="page"]')?.getAttribute("data-session");
  const row = container.querySelector(`[data-session="${id}"]`)?.parentElement as HTMLElement;
  row.querySelector<HTMLButtonElement>('[aria-label^="Rename"]')?.focus();
  await act(async () => user.keyboard("{Enter}"));
  expect(document.activeElement?.tagName).toBe("INPUT");
  await act(async () => user.keyboard("Keyboard Session{Enter}"));
  await settle();
  expect((await api.invoke("session.list", {})).find((s) => s.id === id)?.title).toBe("Keyboard Session");
  const deletion = row.querySelector<HTMLButtonElement>('[aria-label^="Delete"]') as HTMLButtonElement;
  deletion.focus();
  await act(async () => user.keyboard("{Enter}"));
  expect(container.querySelector("dialog[open]")).toBeTruthy();
  await act(async () => user.keyboard("{Enter}")); // initially focused Cancel
  expect((await api.invoke("session.list", {})).some((s) => s.id === id)).toBe(true);
  expect(document.activeElement).toBe(deletion);
  await act(async () => user.keyboard("{Enter}"));
  await act(async () => user.tab());
  expect(document.activeElement?.getAttribute("data-action")).toBe("confirm-delete");
  await act(async () => user.keyboard("{Enter}"));
  await settle();
  expect((await api.invoke("session.list", {})).some((s) => s.id === id)).toBe(false);
  const toolsId = (await api.invoke("session.list", {})).find((s) => s.title === "Tool rows")?.id;
  container.querySelector<HTMLButtonElement>(`[data-session="${toolsId}"]`)?.focus();
  await act(async () => user.keyboard("{Enter}"));
  await settle();
  const summary = container.querySelector<HTMLElement>("[data-tool-row] button") as HTMLElement;
  summary.focus();
  await act(async () => user.keyboard(" "));
  expect(summary.getAttribute("aria-expanded") === "true").toBe(true);
  expect(summary.parentElement?.textContent).toContain("Source line");
});
test("context-limit retains full history and accepts another instruction; Context and Markdown are safe", async () => {
  await api.invoke("workbench.open", { folder: "/mock/demo-board" });
  await mount();
  const list = await api.invoke("session.list", {}),
    id = list.find((s) => s.title === "Context limit")?.id as string;
  container.querySelector<HTMLButtonElement>(`[data-session="${id}"]`)?.focus();
  const user = userEvent.setup();
  await act(async () => user.keyboard("{Enter}"));
  await settle();
  const full = (await api.invoke("session.get", { sessionId: id })).snapshot.items.find(
    (i) => i.kind === "user",
  ) as { text: string };
  expect(container.querySelector('[data-message-kind="user"] .markdown')?.textContent).toBe(
    full.text.trimEnd(),
  );
  const input = container.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="Message"]',
  ) as HTMLTextAreaElement;
  input.focus();
  await act(async () => user.keyboard("Short instruction{Enter}"));
  await settle();
  expect(
    (await api.invoke("session.get", { sessionId: id })).snapshot.items
      .filter((i) => i.kind === "user")
      .at(-1),
  ).toMatchObject({ text: "Short instruction" });
  expect(container.querySelector('[data-message-kind="user"] .markdown')?.textContent).toBe(
    full.text.trimEnd(),
  );
  if (!container.querySelector(".context-tab")) {
    await act(async () => container.querySelector<HTMLButtonElement>('[data-toggle="right"]')?.click());
    await settle();
  }
  expect(container.querySelector(".context-tab")?.textContent).toContain(".vera/WORKBENCH.md");
  expect(container.querySelector(".context-tab")?.textContent).toContain("No skills are available");
  const code = container.querySelector("code.language-c .hljs-type");
  expect(code?.textContent).toBe("int");
});
test("model picker uses configured catalogs and confirms the session model", async () => {
  await api.invoke("workbench.open", { folder: "/mock/demo-board" });
  await api.invoke("providers.save", {
    provider: "custom",
    config: {
      name: "Bench model",
      baseUrl: "http://127.0.0.1:8000/v1",
      model: "bench-chat",
      contextWindow: 32768,
      maxOutputTokens: 4096,
    },
  });
  await mount();
  await act(async () => button("New session").click());
  await settle();
  const picker = container.querySelector<HTMLSelectElement>(
    'select[aria-label="Model"]',
  ) as HTMLSelectElement;
  expect([...picker.options].map((o) => o.value)).toContain("custom:bench-model/bench-chat");
  const user = userEvent.setup();
  await act(async () => user.selectOptions(picker, "custom:bench-model/bench-chat"));
  await settle();
  const id = container
    .querySelector('[data-session][aria-current="page"]')
    ?.getAttribute("data-session") as string;
  expect((await api.invoke("session.get", { sessionId: id })).snapshot.modelRef).toBe(
    "custom:bench-model/bench-chat",
  );
  expect(picker.value).toBe("custom:bench-model/bench-chat");
  const invoke = api.invoke.bind(api);
  vi.spyOn(api, "invoke").mockImplementation((channel, request) =>
    channel === "session.model.set" || channel === "session.send"
      ? Promise.reject({ code: "BUSY" })
      : invoke(channel, request),
  );
  await act(async () => user.selectOptions(picker, ""));
  await settle();
  expect(picker.value).toBe("custom:bench-model/bench-chat");
  const input = container.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="Message"]',
  ) as HTMLTextAreaElement;
  input.focus();
  await act(async () => user.keyboard("Preserved draft{Enter}"));
  await settle();
  expect(input.value).toBe("Preserved draft");
  expect(container.querySelectorAll('[data-message-kind="user"]')).toHaveLength(0);
});
test("Markdown keeps remote content inert and citation syntax in code unmodified", async () => {
  await mount(
    createElement(Markdown, {
      text: "**Grounded** [[board.txt#L1-L2]]\n\n```text\n[[inside-code]]\n```\n\n[Remote](https://example.com/) ![External image](https://example.com/image.png) <script>attack()</script>",
      citations: [{ ref: "board.txt#L1-L2", valid: true }],
    }),
  );
  expect(container.querySelectorAll("[data-citation]")).toHaveLength(1);
  expect(container.querySelector("code")?.textContent).toContain("[[inside-code]]");
  expect(container.querySelector("strong")?.textContent).toBe("Grounded");
  expect(container.querySelector("script,img,a[href]")).toBeNull();
});
test("permission picker confirms mode and new sessions inherit the workbench default", async () => {
  await api.invoke("workbench.open", { folder: "/mock/demo-board" });
  await api.invoke("workbench.config.update", { patch: { agent: { permission_mode: "auto-edit" } } });
  await mount();
  await act(async () => button("New session").click());
  await settle();
  const picker = container.querySelector<HTMLSelectElement>('select[aria-label="Permission mode"]');
  expect(picker, container.innerHTML).toBeTruthy();
  if (!picker) throw Error("Permission picker is missing.");
  expect(picker?.value).toBe("auto-edit");
  await act(async () => userEvent.setup().selectOptions(picker, "read-only"));
  await settle();
  expect(picker?.value).toBe("read-only");
});
test("approval card renders exact inline diff, byte count and keyboard controls", async () => {
  const state = emptySessionState();
  state.activeTurnId = "turn";
  state.status = "awaiting_approval";
  state.items.push({ kind: "tool", id: "call", turnId: "turn", name: "edit", args: {}, status: "running" });
  state.approvals.push({
    approvalId: `apv_${"0".repeat(26)}`,
    callId: "call",
    requestSha256: "a".repeat(64),
    tool: "edit",
    path: "f.txt",
    diff: "--- f.txt\n+++ f.txt\n@@ -1 +1 @@\n-old\n+new",
    bytes: 4,
    decision: null,
  });
  await mount(createElement(Transcript, { state, reasoning: {}, updates: {}, retry: () => {}, search: "" }));
  expect(container.querySelector("[data-approval-card]")).toBeTruthy();
  expect(container.querySelector(".diff-added")?.textContent).toBe("+new\n");
  expect(button("Approve")).toBeTruthy();
  expect(button("Deny")).toBeTruthy();
  expect(container.textContent).toContain("4 bytes");
});
test.each(["a", "d"])(
  "focused approval %s locks composer, records digest and updates sidebar",
  async (key) => {
    await api.invoke("workbench.open", { folder: "/mock/demo-board" });
    await api.invoke("workbench.config.update", { patch: { agent: { permission_mode: "ask" } } });
    await mount();
    await act(async () => button("New session").click());
    await settle();
    const input = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]');
    expect(input).toBeTruthy();
    if (!input) throw Error("Message input is missing.");
    const user = userEvent.setup();
    input.focus();
    await act(async () => user.keyboard("Edit notes{Enter}"));
    await settle();
    const card = container.querySelector<HTMLElement>("[data-approval-card]");
    expect(card).toBeTruthy();
    if (!card) throw Error("Approval card is missing.");
    expect(input.disabled).toBe(true);
    expect(
      container.querySelector('[aria-current="page"] [data-session-status="awaiting_approval"]'),
    ).toBeTruthy();
    const id = container.querySelector('[data-session][aria-current="page"]')?.getAttribute("data-session");
    if (!id) throw Error("Session identity is missing.");
    const expected = (await api.invoke("session.get", { sessionId: id })).snapshot.approvals.at(-1);
    expect(expected).toBeDefined();
    if (!expected) throw Error("Approval identity is missing.");
    const invoke = api.invoke.bind(api),
      spy = vi.spyOn(api, "invoke").mockImplementation(invoke);
    card.focus();
    await act(async () => user.keyboard(key));
    await settle();
    expect(spy).toHaveBeenCalledWith("session.approval.decide", {
      sessionId: id,
      approvalId: expected.approvalId,
      requestSha256: expected.requestSha256,
      decision: key === "a" ? "approved" : "denied",
    });
    expect((await api.invoke("session.get", { sessionId: id })).snapshot.approvals.at(-1)?.decision).toBe(
      key === "a" ? "approved" : "denied",
    );
    expect(input.disabled).toBe(false);
  },
);

test("Settings selects one page with vertical tabs, including placeholders and keyboard navigation", async () => {
  await mount();
  await act(async () => container.querySelector<HTMLButtonElement>('[data-toggle="sidebar"]')?.click());
  await act(async () => container.querySelector<HTMLButtonElement>('[data-i18n="nav.settings"]')?.click());
  await settle();
  expect(container.querySelector("#sidebar")?.getAttribute("data-collapsed")).toBe("false");
  const tabs = [...container.querySelectorAll<HTMLButtonElement>('[role="tablist"] [role="tab"]')];
  expect(tabs).toHaveLength(10);
  function visibleSections() {
    return [...container.querySelectorAll<HTMLElement>("[data-settings-section]")]
      .filter((node) => !node.closest("[hidden]"))
      .map((node) => node.dataset.settingsSection);
  }
  expect(visibleSections()).toEqual(["appearance"]);
  for (const tab of tabs) {
    const main = container.querySelector<HTMLElement>("#main-content");
    if (main) main.scrollTop = 120;
    await act(async () => tab.click());
    expect(main?.scrollTop).toBe(0);
    expect(tab.getAttribute("aria-selected")).toBe("true");
    expect(visibleSections()).toEqual([tab.dataset.section]);
    expect(container.querySelectorAll('[role="tab"][tabindex="0"]')).toHaveLength(1);
  }
  const last = tabs.at(-1);
  await act(async () => {
    last?.focus();
    last?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  });
  expect(document.activeElement).toBe(tabs[0]);
  expect(visibleSections()).toEqual(["providers"]);
  await act(async () => tabs[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
  expect(document.activeElement).toBe(last);
  expect(visibleSections()).toEqual(["about"]);
});
