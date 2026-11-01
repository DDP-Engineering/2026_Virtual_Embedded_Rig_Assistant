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
import i18n from "../../i18n.js";
import { WorkbenchNavigation } from "../workbench-navigation.js";
import { Composer } from "./composer.js";
import { Markdown } from "./markdown.js";
import { ActivityLog } from "./session-inspector.js";
import { SessionList } from "./session-list.js";
import { Transcript } from "./transcript.js";
import { SessionWorkspace } from "./workspace.js";

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
test("sidebar action menus are exclusive across session and workbench triggers, with outside and Escape dismissal", async () => {
  await api.invoke("workbench.create", { folder: "/mock/exclusive-menus", name: "Menus" });
  await api.invoke("session.create", {});
  await api.invoke("session.create", {});
  await mount();
  const user = userEvent.setup();
  const menus = [...container.querySelectorAll<HTMLDetailsElement>(".session-options")];
  const bench = container.querySelector<HTMLDetailsElement>(".workbench-menu") as HTMLDetailsElement;
  const trigger = (menu: HTMLDetailsElement) => menu.querySelector("summary") as HTMLElement;
  await act(async () => user.click(trigger(menus[0] as HTMLDetailsElement)));
  await act(async () => user.click(trigger(menus[1] as HTMLDetailsElement)));
  expect(menus[0]?.open).toBe(false);
  expect(menus[1]?.open).toBe(true);
  await act(async () => user.click(trigger(bench)));
  expect(menus[1]?.open).toBe(false);
  expect(bench.open).toBe(true);
  await act(async () => user.keyboard("{Escape}"));
  expect(bench.open).toBe(false);
  expect(document.activeElement).toBe(trigger(bench));
  // Native summary Enter/Space activation is verified in Electron, not emulated by jsdom.
  await act(async () => user.click(trigger(bench)));
  expect(bench.open).toBe(true);
  await act(async () => user.click(container.querySelector("main") as HTMLElement));
  expect(bench.open).toBe(false);
});
// REQ-UX-ab0d5e61 REQ-FUNC-df70c1c8 REQ-FUNC-7871b582
test("Move up and Move down reorder workbenches within their pinned group and sessions, by menu and Alt+Shift+Arrow", async () => {
  for (const name of ["A", "B", "C"])
    await api.invoke("workbench.create", { folder: `/mock/order-${name}`, name: `Order ${name}` });
  // Order C is active; pinning Order A puts it in the pinned group above C and B.
  await api.invoke("workbench.recent", { pin: { folder: "/mock/order-A", value: true } });
  const created: string[] = [];
  for (const title of ["First", "Second", "Third", "Stored"]) {
    const session = await api.invoke("session.create", {});
    await api.invoke("session.rename", { sessionId: session.id, title });
    created.push(session.id);
  }
  await api.invoke("session.archive.set", { sessionId: created[3] as string, archived: true });
  await mount();
  const user = userEvent.setup();
  const keys = (key: string) => user.keyboard(`{Alt>}{Shift>}{${key}}{/Shift}{/Alt}`);
  const benches = () =>
    [...container.querySelectorAll(".workbench-group-name")]
      .map((b) => (b.textContent ?? "").replace(/^📌\s*/, ""))
      .filter((n) => n.startsWith("Order "));
  const heading = (name: string) =>
    [...container.querySelectorAll<HTMLElement>(".workbench-group-heading")].find((h) =>
      h.querySelector(".workbench-group-name")?.textContent?.endsWith(name),
    ) as HTMLElement;
  const item = (scope: Element, text: string) =>
    [...scope.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === text);
  const sessions = () =>
    [...container.querySelectorAll(".session-list > .session-entry [data-session] strong")].map(
      (s) => s.textContent,
    );
  const entry = (title: string) =>
    [...container.querySelectorAll<HTMLElement>(".session-entry")].find(
      (e) => e.querySelector("[data-session] strong")?.textContent === title,
    ) as HTMLElement;
  expect(benches().slice(0, 3)).toEqual(["Order A", "Order C", "Order B"]);
  // The only pinned entry and the first unpinned one cannot move up; C can move down past B.
  expect(item(heading("Order A"), "Move up")?.disabled).toBe(true);
  expect(item(heading("Order A"), "Move down")?.disabled).toBe(true);
  expect(item(heading("Order C"), "Move up")?.disabled).toBe(true);
  const benchMenu = heading("Order C").querySelector(".workbench-menu") as HTMLDetailsElement;
  await act(async () => user.click(benchMenu.querySelector("summary") as HTMLElement));
  await act(async () => user.click(item(benchMenu, "Move down") as HTMLButtonElement));
  await settle();
  expect(benches().slice(0, 3)).toEqual(["Order A", "Order B", "Order C"]);
  expect(heading("Order C").contains(document.activeElement)).toBe(true);
  // The keyboard moves the focused workbench row back and keeps focus on it.
  const name = heading("Order C").querySelector<HTMLButtonElement>(
    ".workbench-group-name",
  ) as HTMLButtonElement;
  name.focus();
  await act(async () => keys("ArrowUp"));
  await settle();
  expect(benches().slice(0, 3)).toEqual(["Order A", "Order C", "Order B"]);
  expect(document.activeElement?.textContent).toBe("Order C");
  expect((await api.invoke("workbench.recent", {})).map((e) => e.name).slice(0, 3)).toEqual([
    "Order C",
    "Order B",
    "Order A",
  ]);

  expect(sessions()).toEqual(["First", "Second", "Third"]);
  expect(item(entry("First"), "Move up")?.disabled).toBe(true);
  expect(item(entry("Third"), "Move down")?.disabled).toBe(true);
  // Archived sessions have no move items.
  expect(item(entry("Stored"), "Move up")).toBeUndefined();
  const sessionMenu = entry("Third").querySelector(".session-options") as HTMLDetailsElement;
  await act(async () => user.click(sessionMenu.querySelector("summary") as HTMLElement));
  await act(async () => user.click(item(sessionMenu, "Move up") as HTMLButtonElement));
  await settle();
  expect(sessions()).toEqual(["First", "Third", "Second"]);
  expect(entry("Third").contains(document.activeElement)).toBe(true);
  const row = entry("Third").querySelector<HTMLButtonElement>("[data-session]") as HTMLButtonElement;
  row.focus();
  await act(async () => keys("ArrowUp"));
  await settle();
  expect(sessions()).toEqual(["Third", "First", "Second"]);
  expect(document.activeElement?.getAttribute("data-session")).toBe(created[2]);
  // At the top edge the shortcut changes nothing.
  await act(async () => keys("ArrowUp"));
  await settle();
  expect(sessions()).toEqual(["Third", "First", "Second"]);
  expect((await api.invoke("session.list", {})).map((s) => s.title)).toEqual([
    "Third",
    "First",
    "Second",
    "Stored",
  ]);
});
// REQ-UX-ab0d5e61
test("search results get no move items or shortcut, and row menu triggers take Alt+Shift+Arrow, even for a missing workbench", async () => {
  const bench = await api.invoke("workbench.create", { folder: "/mock/order-search", name: "Order search" });
  const first = await api.invoke("session.create", { workbenchId: bench.config.id });
  const second = await api.invoke("session.create", { workbenchId: bench.config.id });
  const user = userEvent.setup();
  const keys = (key: string) => user.keyboard(`{Alt>}{Shift>}{${key}}{/Shift}{/Alt}`);
  const move = vi.fn(async () => true);
  const list = (search: string) =>
    createElement(SessionList, {
      sessions: [first, second],
      select: vi.fn(),
      create: vi.fn(),
      rename: vi.fn(),
      remove: vi.fn(),
      archive: vi.fn(),
      move,
      disabled: false,
      search,
      searchChanged: vi.fn(),
    });
  await mount(list("x"));
  expect(container.querySelector('[data-action^="move-session"]')).toBeNull();
  (container.querySelector(`[data-session="${second.id}"]`) as HTMLButtonElement).focus();
  await act(async () => keys("ArrowUp"));
  const summary = () =>
    container
      .querySelector(`[data-session="${second.id}"]`)
      ?.closest(".session-entry")
      ?.querySelector<HTMLElement>(".session-options > summary") as HTMLElement;
  summary().focus();
  await act(async () => keys("ArrowUp"));
  expect(move).not.toHaveBeenCalled();
  await act(async () => root.unmount());
  container.remove();
  // Without a search, the row's menu trigger moves it too.
  await mount(list(""));
  summary().focus();
  await act(async () => keys("ArrowUp"));
  expect(move).toHaveBeenCalledWith(second.id, -1);
  await act(async () => root.unmount());
  container.remove();
  // A missing workbench's toggle and name are disabled; its menu trigger still takes the keys.
  const moveBench = vi.fn(async () => true);
  const entries = [
    {
      folder: "/mock/kept",
      id: "wb_01ARZ3NDEKTSV4RRFFQ69G5FA1",
      name: "Kept",
      lastOpened: new Date(0).toISOString(),
      missing: false,
    },
    {
      folder: "/mock/gone",
      id: "wb_01ARZ3NDEKTSV4RRFFQ69G5FA2",
      name: "Gone",
      lastOpened: new Date(0).toISOString(),
      missing: true,
    },
  ];
  const navigation = {
    entries,
    activeId: undefined,
    disabled: false,
    settingsReadOnly: false,
    open: vi.fn(async () => true),
    pin: vi.fn(),
    move: moveBench,
    edit: vi.fn(),
    reveal: vi.fn(),
    remove: vi.fn(),
    children: null,
  };
  await mount(createElement(WorkbenchNavigation, navigation));
  const gone = container.querySelector(
    '[data-workbench-entry="wb_01ARZ3NDEKTSV4RRFFQ69G5FA2"]',
  ) as HTMLElement;
  expect(gone.querySelector<HTMLButtonElement>(".workbench-group-name")?.disabled).toBe(true);
  (gone.querySelector(".workbench-menu > summary") as HTMLElement).focus();
  await act(async () => keys("ArrowUp"));
  expect(moveBench).toHaveBeenCalledWith("/mock/gone", -1);
});
test("New session reuses a renamed empty session, preserves its draft and focuses the composer", async () => {
  await api.invoke("workbench.create", { folder: "/mock/reuse-empty", name: "Reuse" });
  const empty = await api.invoke("session.create", {});
  await api.invoke("session.rename", { sessionId: empty.id, title: "Named unused" });
  await mount();
  await act(async () => button("New session").click());
  await settle();
  expect(container.querySelector('[data-session][aria-current="page"]')?.getAttribute("data-session")).toBe(
    empty.id,
  );
  const editor = container.querySelector<HTMLTextAreaElement>("#chat-message") as HTMLTextAreaElement;
  expect(document.activeElement).toBe(editor);
  const user = userEvent.setup();
  await act(async () => user.type(editor, "Unsent draft"));
  await act(async () => {
    for (let i = 0; i < 15; i++) button("New session").click();
  });
  await settle();
  expect(await api.invoke("session.list", {})).toHaveLength(1);
  expect(editor.value).toBe("Unsent draft");
  expect(document.activeElement).toBe(editor);
});
test("New session guards an in-flight failure against rapid clicks and allows a successful retry", async () => {
  await api.invoke("workbench.create", { folder: "/mock/slow-new-session", name: "Slow create" });
  const archived = await api.invoke("session.create", {});
  await api.invoke("session.archive.set", { sessionId: archived.id, archived: true });
  await mount();
  const original = api.invoke.bind(api);
  let attempts = 0;
  let fail = true;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const invoke: typeof api.invoke = async (channel, request) => {
    if (channel === "session.create") {
      attempts++;
      await gate;
      if (fail) throw { code: "BUSY", messageKey: "errors.BUSY" };
    }
    return original(channel, request);
  };
  vi.spyOn(api, "invoke").mockImplementation(invoke);
  await act(async () => {
    for (let i = 0; i < 15; i++) button("New session").click();
  });
  expect(attempts).toBe(1);
  await act(async () => release?.());
  await settle();
  expect(container.querySelector('[role="alert"]')).toBeTruthy();
  expect(button("New session").disabled).toBe(false);
  fail = false;
  await act(async () => {
    for (let i = 0; i < 15; i++) button("New session").click();
  });
  await settle();
  expect(attempts).toBe(2);
  const sessions = await original("session.list", {});
  expect(sessions).toHaveLength(2);
  expect(sessions.filter((session) => !session.archived)).toHaveLength(1);
  expect(document.activeElement?.id).toBe("chat-message");
});
test("removing the only selected session leaves New session usable without a stale composer focus request", async () => {
  await api.invoke("workbench.create", { folder: "/mock/delete-only-session", name: "Delete only" });
  const session = await api.invoke("session.create", {});
  await mount();
  await act(async () =>
    container.querySelector<HTMLButtonElement>(`[data-session="${session.id}"]`)?.click(),
  );
  await settle();
  const row = container.querySelector(`[data-session="${session.id}"]`)?.parentElement as HTMLElement;
  await act(async () => row.querySelector<HTMLElement>("summary")?.click());
  await act(async () => row.querySelector<HTMLButtonElement>('button[aria-label^="Delete"]')?.click());
  await settle();
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[data-action="confirm-delete"]')?.click(),
  );
  await settle();
  // The chat mock seeds demonstration rows again after its last row is deleted.
  expect((await api.invoke("session.list", {})).some((row) => row.id === session.id)).toBe(false);
  expect(container.querySelector('[data-action="new-session"]')).toBeTruthy();
  await act(async () => button("New session").click());
  await settle();
  expect(
    container.querySelector('[data-session][aria-current="page"]')?.getAttribute("data-session"),
  ).not.toBe(session.id);
  expect(document.activeElement?.id).toBe("chat-message");
});
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
// REQ-UX-2c674629 REQ-UX-56c8cefc REQ-UX-7f289a2c
test("New Workbench creates only and submits the configured draft with prefilled name", async () => {
  await mount();
  await act(async () => button("New Workbench").click());
  const page = container.querySelector<HTMLElement>("[data-workbench-create]");
  if (!page) throw Error("Missing creation page");
  expect(container.querySelector('[data-action="open-workbench"], [data-action="open-recent"]')).toBeNull();
  expect(page.querySelector("[data-project-section]")).toBeNull();
  await act(async () => page.querySelector<HTMLButtonElement>('[data-action="choose-create"]')?.click());
  await settle();
  expect(page.querySelector<HTMLInputElement>("#workbench-name")?.value).toBe("new-board");
  expect(
    [...page.querySelectorAll("[data-project-section]")].map((b) => b.getAttribute("data-project-section")),
  ).toEqual(["general", "documents", "instructions", "agent", "tools", "skills", "embeddings", "plugins"]);
  await act(async () => page.querySelector<HTMLButtonElement>('[data-project-section="tools"]')?.click());
  await act(async () => page.querySelector<HTMLInputElement>('[data-tool-toggle="web_search"]')?.click());
  await act(async () =>
    page.querySelector<HTMLButtonElement>('[data-project-section="instructions"]')?.click(),
  );
  const instructions = page.querySelector<HTMLTextAreaElement>("#pinned-content");
  expect(instructions?.value).toContain("# new-board");
  const user = userEvent.setup();
  if (instructions) await act(async () => user.type(instructions, "STM32G474 bench"));
  await act(async () => page.querySelector<HTMLButtonElement>('[data-action="create-workbench"]')?.click());
  await settle();
  const created = await api.invoke("workbench.config.get", {});
  expect(created.config.name).toBe("new-board");
  expect(created.config.tools.disabled).toEqual(["web_search"]);
  expect((await api.invoke("workbench.pinned.get", {})).content).toContain("STM32G474 bench");
  expect(container.querySelector('[data-workbench="active"] h3')?.textContent).toBe("new-board");
});
/** Makes the mock folder picker return a test-owned folder, optionally listing extra skills for it. */
function pickFolder(folder: string, skills: { name: string; description: string }[] = []) {
  const invoke = api.invoke.bind(api);
  vi.spyOn(api, "invoke").mockImplementation((async (channel: string, request: unknown) => {
    if (channel === "app.chooseFolder") return { folder };
    const value = await invoke(channel as "app.info", request as never);
    if (channel !== "workbench.inspect") return value;
    const found = value as unknown as { skills: object[] };
    return {
      ...found,
      skills: [...found.skills, ...skills.map((s) => ({ ...s, source: "user", enabled: true }))],
    };
  }) as typeof api.invoke);
}
async function keyDown(target: Element, key: string) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}
// REQ-UX-56c8cefc REQ-UX-68353a4e
test("New Workbench keeps a typed name and offers Open for an existing workbench folder", async () => {
  await api.invoke("workbench.create", { folder: "/mock/existing-board", name: "Existing board" });
  await api.invoke("workbench.close", {});
  pickFolder("/mock/existing-board");
  await mount();
  await act(async () => button("New Workbench").click());
  const user = userEvent.setup();
  const name = container.querySelector<HTMLInputElement>("#workbench-name");
  if (!name) throw Error("Missing name field");
  await act(async () => user.type(name, "Typed"));
  await act(async () => container.querySelector<HTMLButtonElement>('[data-action="choose-create"]')?.click());
  await settle();
  expect(name.value).toBe("Typed");
  expect(container.querySelector("[data-existing-workbench]")).toBeTruthy();
  expect(container.querySelector("[data-workbench-create] [data-project-section]")).toBeNull();
  expect(container.querySelector<HTMLButtonElement>('[data-action="create-workbench"]')?.disabled).toBe(true);
  await act(async () => container.querySelector<HTMLButtonElement>('[data-action="open-existing"]')?.click());
  await settle();
  expect(container.querySelector('[data-workbench="active"] h3')?.textContent).toBe("Existing board");
});
// REQ-UX-7f289a2c REQ-FUNC-3815bacc
test("New Workbench drafts skills, keeps existing instructions, ignores Enter and resets after Create", async () => {
  pickFolder("/mock/with-notes", [{ name: "flash-esp32", description: "Flash ESP32 boards" }]);
  await mount();
  await act(async () => button("New Workbench").click());
  const page = container.querySelector<HTMLElement>("[data-workbench-create]");
  if (!page) throw Error("Missing creation page");
  await act(async () => page.querySelector<HTMLButtonElement>('[data-action="choose-create"]')?.click());
  await settle();
  await act(async () => page.querySelector<HTMLButtonElement>('[data-project-section="skills"]')?.click());
  const skill = page.querySelector<HTMLInputElement>('[data-create-skill="flash-esp32"] input');
  expect(skill?.checked).toBe(true);
  await act(async () => skill?.click());
  expect(skill?.checked).toBe(false);
  await act(async () =>
    page.querySelector<HTMLButtonElement>('[data-project-section="instructions"]')?.click(),
  );
  const instructions = page.querySelector<HTMLTextAreaElement>("#pinned-content");
  expect(instructions?.value).toBe("Existing bench notes\n");
  expect(instructions?.readOnly).toBe(true);
  await act(async () => page.querySelector<HTMLButtonElement>('[data-project-section="agent"]')?.click());
  const model = page.querySelector<HTMLInputElement>("[data-project-model]");
  if (!model) throw Error("Missing model field");
  const user = userEvent.setup();
  await act(async () => user.type(model, "openai/gpt-5{Enter}"));
  await settle();
  expect(container.querySelector('[data-workbench="active"]')).toBeNull();
  await act(async () => page.querySelector<HTMLButtonElement>('[data-action="create-workbench"]')?.click());
  await settle();
  const created = await api.invoke("workbench.config.get", {});
  expect(created.config.skills.disabled).toEqual(["flash-esp32"]);
  expect(created.config.agent.model).toBe("openai/gpt-5");
  expect((await api.invoke("workbench.pinned.get", {})).content).toBe("Existing bench notes\n");
  await act(async () => button("New Workbench").click());
  const fresh = container.querySelector<HTMLElement>("[data-workbench-create]");
  expect(fresh?.querySelector<HTMLInputElement>("#workbench-name")?.value).toBe("");
  expect(fresh?.querySelector("[data-project-section], [data-selected-folder]")).toBeNull();
});
/** Makes the mock folder picker return the given folders in order; returns the requests it got. */
function pickFolders(...folders: string[]) {
  const invoke = api.invoke.bind(api);
  const requests: unknown[] = [];
  vi.spyOn(api, "invoke").mockImplementation((async (channel: string, request: unknown) => {
    if (channel !== "app.chooseFolder") return invoke(channel as "app.info", request as never);
    requests.push(request);
    return { folder: folders.shift() ?? null };
  }) as typeof api.invoke);
  return requests;
}
async function openDocuments(page: HTMLElement) {
  await act(async () => page.querySelector<HTMLButtonElement>('[data-project-section="documents"]')?.click());
  await settle();
}
const docsFolder = (page: HTMLElement, path: string) =>
  page.querySelector<HTMLInputElement>(`[data-docs-folder="${path}"] input[type="checkbox"]`);
// REQ-UX-64605f7e REQ-UX-5b390823 REQ-UX-b7002720 REQ-UX-ff645484
test("New Workbench preselects detected documentation folders and previews what they index", async () => {
  pickFolders("/mock/docs-board");
  await mount();
  await act(async () => button("New Workbench").click());
  const page = container.querySelector<HTMLElement>("[data-workbench-create]");
  if (!page) throw Error("Missing creation page");
  await act(async () => page.querySelector<HTMLButtonElement>('[data-action="choose-create"]')?.click());
  await settle();
  await openDocuments(page);
  expect(docsFolder(page, "datasheets")?.checked).toBe(true);
  expect(docsFolder(page, "notes")?.checked).toBe(true);
  expect(page.querySelector('[data-docs-folder="src"]')).toBeNull();
  expect(page.querySelector('[data-docs-folder="datasheets"]')?.textContent).toContain("2 PDF");
  expect(page.querySelector('[data-docs-folder="datasheets"]')?.textContent).toContain("MB");
  expect(docsFolder(page, "Manuals (RM0440)")?.checked).toBe(true);
  expect(page.querySelector("[data-docs-preview]")?.textContent).toContain("Documents to index: 5 (");
  expect(page.querySelector("[data-docs-preview]")?.textContent).toContain(
    "Legacy Office and RTF files are not indexed: 1",
  );
  const advanced = page.querySelector<HTMLDetailsElement>("[data-docs-advanced]");
  expect(advanced?.open).toBe(false);
  const includeField = advanced?.querySelector<HTMLTextAreaElement>("[data-project-include]");
  expect(includeField?.value).toBe("Manuals [(]RM0440[)]/**\ndatasheets/**\nnotes/**");
  await act(async () => docsFolder(page, "datasheets")?.click());
  expect(docsFolder(page, "datasheets")?.checked).toBe(false);
  // The preview recomputes once the selection has been still for its debounce interval.
  await act(async () => new Promise((resolve) => setTimeout(resolve, 400)));
  await settle();
  expect(page.querySelector("[data-docs-preview]")?.textContent).toContain("Documents to index: 3 (");
  await act(async () => docsFolder(page, "datasheets")?.click());
  expect(docsFolder(page, "datasheets")?.checked).toBe(true);
  await act(async () => {
    if (advanced) advanced.open = true;
  });
  if (!includeField) throw Error("Missing include field");
  await act(async () => {
    await userEvent.setup().clear(includeField);
    await userEvent.setup().type(includeField, "datasheets/**");
  });
  await settle();
  expect(docsFolder(page, "notes")?.checked).toBe(false);
  expect(docsFolder(page, "Manuals (RM0440)")?.checked).toBe(false);
  expect(docsFolder(page, "datasheets")?.checked).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 400));
  await settle();
  expect(page.querySelector("[data-docs-preview]")?.textContent).toContain("Documents to index: 2 (");
  const excludeField = advanced?.querySelectorAll<HTMLTextAreaElement>("textarea")[1];
  if (!excludeField) throw Error("Missing exclude field");
  await act(async () => userEvent.setup().type(excludeField, "datasheets/old/**"));
  await act(async () => page.querySelector<HTMLButtonElement>('[data-action="create-workbench"]')?.click());
  await settle();
  const saved = (await api.invoke("workbench.config.get", {})).config.docs;
  expect(saved.include).toEqual(["datasheets/**"]);
  expect(saved.exclude).toEqual(["datasheets/old/**"]);
});
// REQ-UX-64605f7e REQ-UX-b96730c7
test("Documents keeps defaults without detections and adds picked folders inside the workbench only", async () => {
  const picks = pickFolders("/mock/empty-board", "/mock/empty-board/manuals/st", "/mock/elsewhere");
  await mount();
  await act(async () => button("New Workbench").click());
  const page = container.querySelector<HTMLElement>("[data-workbench-create]");
  if (!page) throw Error("Missing creation page");
  await act(async () => page.querySelector<HTMLButtonElement>('[data-action="choose-create"]')?.click());
  await settle();
  await openDocuments(page);
  const include = () => page.querySelector<HTMLTextAreaElement>("[data-project-include]")?.value;
  expect(include()).toBe("docs/**");
  expect(page.querySelector("[data-docs-none]")).toBeTruthy();
  // An undetected listed folder stays listed after unchecking, so it can be checked again.
  await act(async () => docsFolder(page, "docs")?.click());
  expect(include()).toBe("");
  expect(docsFolder(page, "docs")?.checked).toBe(false);
  await act(async () => docsFolder(page, "docs")?.click());
  expect(include()).toBe("docs/**");
  await act(async () => page.querySelector<HTMLButtonElement>('[data-action="add-docs-folder"]')?.click());
  await settle();
  expect(docsFolder(page, "manuals/st")?.checked).toBe(true);
  expect(include()).toBe("docs/**\nmanuals/st/**");
  // Choosing the workbench folder starts anywhere; Add folder starts in the workbench root.
  expect(picks.slice(0, 2)).toEqual([{}, { start: "/mock/empty-board" }]);
  await act(async () => page.querySelector<HTMLButtonElement>('[data-action="add-docs-folder"]')?.click());
  await settle();
  expect(page.querySelector('[data-docs] [data-i18n="errors.DENIED"]')).toBeTruthy();
  expect(include()).toBe("docs/**\nmanuals/st/**");
});
// REQ-UX-64605f7e
test("a failing documentation scan keeps the defaults and still allows creation", async () => {
  pickFolders("/mock/locked-board");
  await mount();
  await act(async () => button("New Workbench").click());
  const page = container.querySelector<HTMLElement>("[data-workbench-create]");
  if (!page) throw Error("Missing creation page");
  await act(async () => page.querySelector<HTMLButtonElement>('[data-action="choose-create"]')?.click());
  await settle();
  expect(page.querySelector('[data-workbench-create] > [role="alert"]')).toBeNull();
  await openDocuments(page);
  expect(page.querySelector<HTMLTextAreaElement>("[data-project-include]")?.value).toBe("docs/**");
  expect(page.querySelector('[data-docs] [data-i18n="errors.DENIED"]')).toBeTruthy();
  expect(page.querySelector<HTMLButtonElement>('[data-action="create-workbench"]')?.disabled).toBe(false);
});
// REQ-UX-d048dbdd
test("Indexing offers retrieval defaults that New Workbench creates and the editor saves", async () => {
  pickFolders("/mock/retrieval-board");
  await mount();
  await act(async () => button("New Workbench").click());
  const page = container.querySelector<HTMLElement>("[data-workbench-create]");
  if (!page) throw Error("Missing creation page");
  await act(async () => page.querySelector<HTMLButtonElement>('[data-action="choose-create"]')?.click());
  await settle();
  await act(async () =>
    page.querySelector<HTMLButtonElement>('[data-project-section="embeddings"]')?.click(),
  );
  const results = page.querySelector<HTMLInputElement>("[data-retrieval-results]");
  const mode = page.querySelector<HTMLSelectElement>("[data-retrieval-mode]");
  if (!results || !mode) throw Error("Missing retrieval controls");
  expect(results.value).toBe("8");
  expect(results.min).toBe("1");
  expect(results.max).toBe("20");
  expect(mode.value).toBe("hybrid");
  expect([...mode.options].map((o) => o.value)).toEqual(["hybrid", "keyword", "semantic"]);
  const user = userEvent.setup();
  await act(async () => {
    await user.clear(results);
    await user.type(results, "12");
    await user.selectOptions(mode, "keyword");
  });
  await act(async () => page.querySelector<HTMLButtonElement>('[data-action="create-workbench"]')?.click());
  await settle();
  expect((await api.invoke("workbench.config.get", {})).config.retrieval).toEqual({
    results: 12,
    mode: "keyword",
  });
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[data-action="edit-workbench-overview"]')?.click(),
  );
  await settle();
  const editor = container.querySelector<HTMLElement>(".workbench-editor");
  if (!editor) throw Error("Missing editor");
  await act(async () =>
    editor.querySelector<HTMLButtonElement>('[data-project-section="embeddings"]')?.click(),
  );
  const editMode = editor.querySelector<HTMLSelectElement>("[data-retrieval-mode]");
  expect(editMode?.value).toBe("keyword");
  if (editMode) await act(async () => user.selectOptions(editMode, "semantic"));
  await act(async () => editor.querySelector<HTMLButtonElement>("[data-project-save]")?.click());
  await settle();
  expect((await api.invoke("workbench.config.get", {})).config.retrieval).toEqual({
    results: 12,
    mode: "semantic",
  });
});
// REQ-UX-5b390823 REQ-UX-3d0691bc
test("workbench editor shows the creation page's sections and the open workbench's documentation folders", async () => {
  await api.invoke("workbench.create", { folder: "/mock/docs-editor", name: "Docs board" });
  await api.invoke("workbench.config.update", { patch: { docs: { include: ["datasheets/**"] } } });
  await mount();
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[data-action="edit-workbench-overview"]')?.click(),
  );
  await settle();
  const editor = container.querySelector<HTMLElement>(".workbench-editor");
  if (!editor) throw Error("Missing editor");
  expect(
    [...editor.querySelectorAll("[data-project-section]")].map((b) => b.getAttribute("data-project-section")),
  ).toEqual(["general", "documents", "instructions", "agent", "tools", "skills", "embeddings", "plugins"]);
  await openDocuments(editor);
  expect(docsFolder(editor, "datasheets")?.checked).toBe(true);
  expect(docsFolder(editor, "notes")?.checked).toBe(false);
  expect(editor.querySelector("[data-docs-preview]")?.textContent).toContain("Documents to index: 2 (");
});
// REQ-UX-1d6c940b REQ-UX-efb3e4fb
test("sidebar Edit of another workbench loads its own values and Close asks before dropping edits", async () => {
  await api.invoke("workbench.create", { folder: "/mock/edit-a", name: "Edit A" });
  await api.invoke("workbench.pinned.update", { content: "Context A" });
  const b = await api.invoke("workbench.create", { folder: "/mock/edit-b", name: "Edit B" });
  await api.invoke("workbench.pinned.update", { content: "Context B" });
  await api.invoke("workbench.open", { folder: "/mock/edit-a" });
  await mount();
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[data-action="edit-workbench-overview"]')?.click(),
  );
  await settle();
  expect(container.querySelector<HTMLInputElement>("[data-project-name]")?.value).toBe("Edit A");
  const entry = () => container.querySelector<HTMLElement>(`[data-workbench-entry="${b.config.id}"]`);
  const menuButton = (text: string) =>
    [...(entry()?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((n) => n.textContent === text);
  await act(async () => menuButton("Edit workbench")?.click());
  await settle();
  expect(container.querySelector<HTMLInputElement>("[data-project-name]")?.value).toBe("Edit B");
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[data-project-section="instructions"]')?.click(),
  );
  await settle();
  expect(container.querySelector<HTMLTextAreaElement>("#pinned-content")?.value).toBe("Context B");
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[data-project-section="general"]')?.click(),
  );
  const name = container.querySelector<HTMLInputElement>("[data-project-name]");
  if (!name) throw Error("Missing name field");
  await act(async () => userEvent.setup().type(name, " changed"));
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  await act(async () => menuButton("Close workbench")?.click());
  await settle();
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(container.querySelector<HTMLInputElement>("[data-project-name]")?.value).toBe("Edit B changed");
  confirm.mockReturnValue(true);
  await act(async () => menuButton("Close workbench")?.click());
  await settle();
  expect(container.querySelector(".workbench-editor")).toBeNull();
  expect(container.querySelector('[data-workbench="active"]')).toBeNull();
});
// REQ-UX-1d6c940b REQ-UX-efb3e4fb
test("workbench editor page closes on Escape with focus restored and guards unsaved edits", async () => {
  await api.invoke("workbench.create", { folder: "/mock/editor-page", name: "Editor page" });
  await mount();
  const edit = () => container.querySelector<HTMLButtonElement>('[data-action="edit-workbench-overview"]');
  await act(async () => edit()?.focus());
  await act(async () => edit()?.click());
  await settle();
  const editor = container.querySelector<HTMLElement>(".workbench-editor");
  if (!editor) throw Error("Missing editor page");
  expect(editor.closest("dialog")).toBeNull();
  await keyDown(editor, "Escape");
  await settle();
  expect(container.querySelector(".workbench-editor")).toBeNull();
  expect(document.activeElement).toBe(edit());
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  await act(async () => edit()?.click());
  await settle();
  await act(async () => button("Settings").click());
  expect(confirm).not.toHaveBeenCalled();
  expect(container.querySelector(".workbench-editor")).toBeNull();
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[data-action="leave-settings"]')?.click(),
  );
  await settle();
  await act(async () => edit()?.click());
  await settle();
  const user = userEvent.setup();
  const name = container.querySelector<HTMLInputElement>("[data-project-name]");
  if (!name) throw Error("Missing name field");
  await act(async () => user.type(name, " revised"));
  await act(async () => button("Settings").click());
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(container.querySelector<HTMLInputElement>("[data-project-name]")?.value).toBe("Editor page revised");
  confirm.mockReturnValue(true);
  await act(async () => button("Settings").click());
  expect(confirm).toHaveBeenCalledTimes(2);
  expect(container.querySelector(".workbench-editor")).toBeNull();
  expect(container.querySelector(".page-title")?.textContent).toBe("App settings");
});
// REQ-UX-efb3e4fb
test("New session with unsaved editor edits confirms once and creates nothing when declined", async () => {
  await api.invoke("workbench.create", { folder: "/mock/editor-session", name: "Editor session" });
  await mount();
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[data-action="edit-workbench-overview"]')?.click(),
  );
  await settle();
  const name = container.querySelector<HTMLInputElement>("[data-project-name]");
  if (!name) throw Error("Missing name field");
  await act(async () => userEvent.setup().type(name, " draft"));
  const before = (await api.invoke("session.list", {})).length;
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  await act(async () => container.querySelector<HTMLButtonElement>('[data-action="new-session"]')?.click());
  await settle();
  expect(confirm).toHaveBeenCalledTimes(1);
  expect((await api.invoke("session.list", {})).length).toBe(before);
  expect(container.querySelector<HTMLInputElement>("[data-project-name]")?.value).toBe(
    "Editor session draft",
  );
  confirm.mockReturnValue(true);
  await act(async () => container.querySelector<HTMLButtonElement>('[data-action="new-session"]')?.click());
  await settle();
  expect(confirm).toHaveBeenCalledTimes(2);
  expect(container.querySelector(".workbench-editor")).toBeNull();
  expect(container.querySelector('[data-session][aria-current="page"]')).toBeTruthy();
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
  await act(async () =>
    container.querySelector<HTMLButtonElement>(".workbench-editor footer button")?.click(),
  );
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
  await act(async () => container.querySelector<HTMLButtonElement>('[data-action="show-context"]')?.click());
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
  const actions = row.querySelector("summary") as HTMLElement;
  actions.focus();
  await act(async () => user.keyboard("{Enter}"));
  row.querySelector<HTMLButtonElement>('[aria-label^="Rename"]')?.focus();
  await act(async () => user.keyboard("{Enter}"));
  expect(document.activeElement?.tagName).toBe("INPUT");
  await act(async () => user.keyboard("Keyboard Session{Enter}"));
  await settle();
  expect((await api.invoke("session.list", {})).find((s) => s.id === id)?.title).toBe("Keyboard Session");
  actions.focus();
  await act(async () => user.keyboard("{Enter}"));
  const deletion = row.querySelector<HTMLButtonElement>('[aria-label^="Delete"]') as HTMLButtonElement;
  deletion.focus();
  await act(async () => user.keyboard("{Enter}"));
  expect(container.querySelector("dialog[open]")).toBeTruthy();
  await act(async () => user.keyboard("{Enter}")); // initially focused Cancel
  expect((await api.invoke("session.list", {})).some((s) => s.id === id)).toBe(true);
  expect(document.activeElement).toBe(actions);
  await act(async () => user.keyboard("{Enter}"));
  deletion.focus();
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
  await api.invoke("workbench.create", {
    folder: "/mock/new-default-permissions",
    name: "Default permissions",
  });
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

test("a page opened while a workbench closes stays open when the close completes", async () => {
  await api.invoke("workbench.open", { folder: "/mock/demo-board" });
  const original = api.invoke.bind(api);
  let finish: () => void = () => {};
  const closing = new Promise<void>((done) => {
    finish = done;
  });
  vi.spyOn(api, "invoke").mockImplementation((async (channel: string, request: unknown) => {
    if (channel === "workbench.close") await closing;
    return original(channel as never, request as never);
  }) as typeof api.invoke);
  await mount();
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[data-action="close-workbench"]')?.click(),
  );
  // The close is still pending when the user opens New Workbench.
  // The creation page stays mounted while hidden, so only a shown page counts.
  const shown = () => {
    const page = container.querySelector("[data-workbench-create]");
    return !!page && !page.closest("[hidden]");
  };
  await act(async () => button("New Workbench").click());
  expect(shown()).toBe(true);
  await act(async () => finish());
  await settle();
  expect(shown()).toBe(true);
  // The workbench did close.
  await expect(api.invoke("workbench.config.get", {})).rejects.toMatchObject({ code: "NOT_FOUND" });
});

test("Settings selects one page with vertical tabs, including placeholders and keyboard navigation", async () => {
  await mount();
  await act(async () => container.querySelector<HTMLButtonElement>('[data-toggle="sidebar"]')?.click());
  await act(async () => container.querySelector<HTMLButtonElement>('[data-i18n="nav.settings"]')?.click());
  await settle();
  expect(container.querySelector("#sidebar")?.getAttribute("data-collapsed")).toBe("false");
  const tabs = [...container.querySelectorAll<HTMLButtonElement>('[role="tablist"] [role="tab"]')];
  // Web access joined the pages with the web providers.
  expect(tabs.map((tab) => tab.dataset.section)).toEqual([
    "providers",
    "web",
    "appearance",
    "language",
    "notifications",
    "shortcuts",
    "storage",
    "configuration",
    "updates",
    "data",
    "about",
  ]);
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

test("session context details stay closed until requested and editor grows and shrinks", async () => {
  const bench = await api.invoke("workbench.create", { folder: "/mock/compact-session", name: "Compact" });
  const session = await api.invoke("session.create", { workbenchId: bench.config.id });
  await mount(
    createElement(SessionWorkspace, {
      id: session.id,
      workbenchId: bench.config.id,
      changed: () => {},
      readOnly: false,
    }),
  );
  expect(container.querySelector("[data-usage]")).toBeNull();
  expect(container.querySelector('[data-action="show-context"]')).toBeTruthy();
  expect(container.querySelector('[data-action="show-activity"]')).toBeTruthy();
  expect(container.textContent).not.toContain("Export Markdown");
  const input = container.querySelector<HTMLTextAreaElement>("textarea") as HTMLTextAreaElement;
  Object.defineProperty(input, "scrollHeight", { configurable: true, get: () => (input.value ? 160 : 40) });
  await typeText(input, "Line one\nLine two");
  expect(input.style.height).toBe("160px");
  await typeText(input, "");
  expect(input.style.height).toBe("40px");
  await act(async () => container.querySelector<HTMLButtonElement>('[data-action="show-context"]')?.click());
  expect(container.querySelector("dialog[open] [data-usage]")).toBeTruthy();
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[data-action="close-inspector"]')?.click(),
  );
  expect(container.querySelector("[data-usage]")).toBeNull();
});

test("agent activity projects real prompt/reply and tool arguments, updates and results", async () => {
  let state = emptySessionState();
  for (const event of [
    { type: "message.user", messageId: "u", text: "Inspect board" },
    { type: "tool.started", callId: "call", name: "read", args: { path: "board.txt" } },
    { type: "message.done", messageId: "a", text: "Reply from VERA", citations: [] },
  ] as import("@vera/shared").SessionEvent[])
    state = applySessionEvent(state, event);
  await mount(
    createElement(ActivityLog, {
      state,
      reasoning: { a: "Visible provider reasoning" },
      updates: { call: "Live result" },
    }),
  );
  expect(container.querySelectorAll("[data-activity-kind]")).toHaveLength(3);
  expect(container.textContent).toContain("Inspect board");
  expect(container.textContent).toContain('"path": "board.txt"');
  expect(container.textContent).toContain("Live result");
  expect(container.textContent).toContain("Reply from VERA");
  expect(container.textContent).toContain("Visible provider reasoning");
  state = applySessionEvent(state, {
    type: "tool.done",
    callId: "call",
    ok: true,
    preview: "Completed result",
    summary: "Read completed",
    durationMs: 5,
  });
  await act(async () => root.render(createElement(ActivityLog, { state, reasoning: {}, updates: {} })));
  expect(container.textContent).toContain("Completed result");
  expect(container.textContent).not.toContain("Visible provider reasoning");
});

test("session ellipsis exports its own row and archives/restores without duplicate workspace actions", async () => {
  await api.invoke("workbench.create", { folder: "/mock/menu-board", name: "Menu board" });
  const first = await api.invoke("session.create", {});
  const target = await api.invoke("session.create", {});
  await mount();
  await act(async () => container.querySelector<HTMLButtonElement>(`[data-session="${first.id}"]`)?.click());
  await settle();
  const observed = vi.spyOn(api, "invoke");
  const row = () => container.querySelector(`[data-session="${target.id}"]`)?.parentElement as HTMLElement;
  const menu = row().querySelector("details") as HTMLDetailsElement;
  await act(async () => {
    menu.open = true;
  });
  const exportButton = [...row().querySelectorAll("button")].find((b) => b.textContent === "Export Markdown");
  await act(async () => exportButton?.click());
  await settle();
  expect(observed.mock.calls).toContainEqual(["session.export", { sessionId: target.id, format: "md" }]);
  expect(container.querySelector(".session-workspace")?.textContent).not.toContain("Export Markdown");
  await act(async () => row().querySelector<HTMLButtonElement>('[data-action="archive-session"]')?.click());
  await settle();
  expect((await api.invoke("session.list", {})).find((s) => s.id === target.id)?.archived).toBe(true);
  expect(container.querySelector(`.archived-sessions [data-session="${target.id}"]`)).toBeTruthy();
  await act(async () => row().querySelector<HTMLButtonElement>('[data-action="restore-session"]')?.click());
  await settle();
  expect((await api.invoke("session.list", {})).find((s) => s.id === target.id)?.archived).toBe(false);
});

test.each(["en", "ro", "de"])(
  "session row shows localized last activity date and time in %s",
  async (language) => {
    const bench = await api.invoke("workbench.create", {
      folder: `/mock/session-dates-${language}`,
      name: "Dates",
    });
    const created = await api.invoke("session.create", { workbenchId: bench.config.id });
    const session = {
      ...created,
      title: "Dated session",
      createdAt: "2026-09-01T01:02:00.000Z",
      updatedAt: "2026-10-28T10:15:00.000Z",
    };
    const select = vi.fn();
    await act(async () => {
      await i18n.changeLanguage(language);
    });
    try {
      await mount(
        createElement(SessionList, {
          sessions: [session],
          active: session.id,
          select,
          create: vi.fn(),
          rename: vi.fn(),
          remove: vi.fn(),
          archive: vi.fn(),
          disabled: false,
        }),
      );
      const row = container.querySelector(`[data-session="${session.id}"]`) as HTMLButtonElement;
      const time = row.querySelector("time");
      expect(time).toBeTruthy();
      expect(time?.dateTime).toBe(session.updatedAt);
      const formatted = new Intl.DateTimeFormat(language, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(session.updatedAt));
      expect(time?.textContent).toBe(formatted);
      expect(time?.title).toBe(i18n.t("chat.lastActivity", { date: formatted }));
      expect(row.querySelector('[data-session-status="idle"]')?.classList.contains("sr-only")).toBe(true);
      await act(async () => row.click());
      expect(select).toHaveBeenCalledWith(session.id);
      expect(time?.dateTime).toBe(session.updatedAt);
    } finally {
      await act(async () => {
        await i18n.changeLanguage("en");
      });
    }
  },
);

test("workbench session disclosure is a visible icon button with translated state tooltip", async () => {
  const bench = await api.invoke("workbench.create", {
    folder: "/mock/disclosure-bench",
    name: "Disclosure bench",
  });
  await mount();
  const group = container.querySelector(`[data-workbench-entry="${bench.config.id}"]`) as HTMLElement;
  const toggle = group.querySelector<HTMLButtonElement>(".workbench-sessions-toggle");
  expect(toggle).toBeTruthy();
  expect(toggle?.querySelector("svg")).toBeTruthy();
  expect(toggle?.getAttribute("aria-expanded")).toBe("true");
  expect(toggle?.title).toBe("Hide sessions: Disclosure bench");
  await act(async () => toggle?.click());
  expect(toggle?.getAttribute("aria-expanded")).toBe("false");
  expect(toggle?.title).toBe("Show sessions: Disclosure bench");
  expect(document.getElementById(toggle?.getAttribute("aria-controls") ?? "")?.hidden).toBe(true);
  await act(async () => toggle?.click());
  expect(toggle?.getAttribute("aria-expanded")).toBe("true");
  expect(group.querySelector<HTMLButtonElement>(".workbench-group-name")?.textContent).toContain(
    "Disclosure bench",
  );
});

test.each([false, true])(
  "composer shows model-declared reasoning during a turn (read-only=%s)",
  async (disabled) => {
    await api.invoke("workbench.create", { folder: `/mock/reasoning-${disabled}`, name: "Reasoning" });
    const original = api.invoke;
    let selected: string | null = null;
    const invoke: typeof api.invoke = async (channel, request) => {
      if (channel === "session.reasoning.get" || channel === "session.reasoning.set") {
        if (channel === "session.reasoning.set")
          selected = (request as { reasoning: string | null }).reasoning;
        return { modelRef: "chatgpt/future", options: ["low", "high", "ultra"], selected } as never;
      }
      return original(channel, request);
    };
    vi.spyOn(api, "invoke").mockImplementation(invoke);
    const state = {
      ...emptySessionState(),
      modelRef: "chatgpt/future",
      activeTurnId: "turn-live",
      status: "running" as const,
    };
    await mount(
      createElement(Composer, {
        sessionId: "session_reasoning",
        state,
        disabled,
        send: async () => true,
        stop: () => {},
        setModel: async () => {},
        setMode: async () => {},
      }),
    );
    const picker = container.querySelector<HTMLSelectElement>("[data-reasoning-picker]");
    expect(picker).toBeTruthy();
    if (!picker) throw Error("Missing reasoning picker");
    expect([...picker.options].map((o) => o.value)).toEqual(["", "low", "high", "ultra"]);
    expect(picker?.disabled).toBe(disabled);
    if (disabled) return;
    await act(async () => userEvent.selectOptions(picker, "high"));
    await settle();
    expect(selected).toBe("high");
    expect(picker?.value).toBe("high");
    await act(async () => userEvent.selectOptions(picker, ""));
    await settle();
    expect(selected).toBeNull();
  },
);

// REQ-UX-712804c9 REQ-UX-b3231a55
test("citations open in the right panel Source tab beside the conversation, which widens only there", async () => {
  await api.invoke("workbench.open", { folder: "/mock/demo-board" });
  await mount();
  const list = await api.invoke("session.list", {});
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(`[data-session="${list.find((s) => s.title === "Tool rows")?.id}"]`)
      ?.click(),
  );
  await settle();
  const panel = () => container.querySelector<HTMLElement>("#right-panel");
  const width = () =>
    container.querySelector<HTMLElement>(".app-shell")?.style.getPropertyValue("--right-width");
  const resizer = () => container.querySelector<HTMLElement>('[data-resize="right"]');
  expect(panel()).toBeNull();
  await act(async () => container.querySelector<HTMLButtonElement>('[data-citation="valid"]')?.click());
  await settle();
  // Other app dialogs exist closed; no dialog is shown for the source.
  expect(container.querySelector("dialog[open], .document-dialog")).toBeNull();
  expect(panel()?.dataset.tab).toBe("source");
  expect(container.querySelector("#tab-source")?.getAttribute("aria-selected")).toBe("true");
  expect(container.querySelector('[data-source-current] [data-line="1"]')?.getAttribute("aria-current")).toBe(
    "true",
  );
  expect(container.querySelector('textarea[aria-label="Message"]')?.hasAttribute("disabled")).toBe(false);
  expect(width()).toBe("36rem");
  expect(resizer()?.getAttribute("aria-valuemax")).toBe("90");
  for (let n = 0; n < 3; n++)
    await act(async () =>
      resizer()?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })),
    );
  expect(width()).toBe("39rem");
  await act(async () => container.querySelector<HTMLButtonElement>("#tab-docs")?.click());
  expect(panel()?.dataset.tab).toBe("docs");
  expect(width()).toBe("22rem");
  expect(resizer()?.getAttribute("aria-valuemax")).toBe("28");
  // REQ-UX-d64f086f: a source opened from Docs returns to Docs and its row on Escape.
  await settle();
  // Docs shows a folder tree (TASK-66b7d4aa): open docs, then the document's own row.
  const docsFolder = container.querySelector<HTMLElement>('[role="treeitem"][data-tree-path="docs"]');
  if (docsFolder?.getAttribute("aria-expanded") === "false") {
    await act(async () => docsFolder.click());
    await settle();
  }
  const row = container.querySelector<HTMLElement>('[data-document="docs/a.md"]');
  row?.focus();
  await act(async () => row?.click());
  await settle();
  expect(panel()?.dataset.tab).toBe("source");
  expect(container.querySelector("[data-source-panel]")?.contains(document.activeElement)).toBe(true);
  await act(async () =>
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  await settle();
  expect(panel()?.dataset.tab).toBe("docs");
  expect(document.activeElement).toBe(row);
});

// REQ-UX-712804c9 REQ-UX-d64f086f
test("the Source tab returns to where it was opened from, follows keyboard tab changes and session changes, and never drops focus", async () => {
  await api.invoke("workbench.open", { folder: "/mock/demo-board" });
  await mount();
  const list = await api.invoke("session.list", {});
  const openSession = async (title: string) => {
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(`[data-session="${list.find((s) => s.title === title)?.id}"]`)
        ?.click(),
    );
    await settle();
  };
  const panel = () => container.querySelector<HTMLElement>("#right-panel");
  const chip = () => container.querySelector<HTMLButtonElement>('[data-citation="valid"]');
  const pressEscape = async () => {
    await act(async () =>
      document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    await settle();
  };
  await openSession("Tool rows");
  // A citation opened with the panel collapsed closes back to a collapsed panel and the chip.
  chip()?.focus();
  await act(async () => chip()?.click());
  await settle();
  expect(panel()?.dataset.tab).toBe("source");
  await pressEscape();
  expect(panel()).toBeNull();
  expect(document.activeElement).toBe(chip());
  // Arrow keys to another tab end the old return path: the next close returns to that tab.
  await act(async () => chip()?.click());
  await settle();
  await act(async () =>
    container
      .querySelector("#tab-source")
      ?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })),
  );
  expect(panel()?.dataset.tab).toBe("changes");
  chip()?.focus();
  await act(async () => chip()?.click());
  await settle();
  expect(panel()?.dataset.tab).toBe("source");
  await pressEscape();
  expect(panel()?.dataset.tab).toBe("changes");
  expect(document.activeElement).toBe(chip());
  // A session change closes an open source and restores the panel it came from.
  await act(async () => container.querySelector<HTMLButtonElement>("#tab-context")?.click());
  await act(async () => chip()?.click());
  await settle();
  expect(panel()?.dataset.tab).toBe("source");
  await openSession("Invalid citation");
  expect(panel()?.dataset.tab).toBe("context");
  expect(container.querySelector("[data-source-current]")).toBeNull();
  // An opener that is gone hands focus to the visible tab instead of the document.
  await act(async () => container.querySelector<HTMLButtonElement>("#tab-docs")?.click());
  await settle();
  // Docs shows a folder tree (TASK-66b7d4aa): open docs, then the document's own row.
  const docsFolder = container.querySelector<HTMLElement>('[role="treeitem"][data-tree-path="docs"]');
  if (docsFolder?.getAttribute("aria-expanded") === "false") {
    await act(async () => docsFolder.click());
    await settle();
  }
  const row = container.querySelector<HTMLElement>('[data-document="docs/a.md"]');
  row?.focus();
  await act(async () => row?.click());
  await settle();
  await act(async () => container.querySelector<HTMLButtonElement>("#tab-docs")?.click());
  await act(async () => container.querySelector<HTMLButtonElement>("#tab-source")?.click());
  container.querySelector<HTMLElement>("[data-source-current]")?.focus();
  await pressEscape();
  expect(document.activeElement).toBe(container.querySelector("#tab-source"));
});
