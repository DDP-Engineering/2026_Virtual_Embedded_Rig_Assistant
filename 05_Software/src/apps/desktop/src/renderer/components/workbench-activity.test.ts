// @vitest-environment jsdom
// REQ-UX-18f96271 REQ-UX-9a0489f1 REQ-FUNC-1388cbcf REQ-FUNC-e117c80b REQ-UX-58fdc5c6 REQ-UX-ec37f55b
// REQ-UX-c2a9fe24 REQ-UX-4bb04608
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import type { AppEvent, Response, SessionActivity, SessionSummary, WorkbenchSnapshot } from "@vera/shared";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "../App.js";
import { api } from "../api/index.js";
import "../i18n.js";
import { SessionList } from "./session/session-list.js";

vi.mock("../api/index.js", async () => {
  const { createMockApi } = await import("../mocks/mockApi.js");
  return { api: createMockApi().api, usingMocks: true };
});
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open");
  this.dispatchEvent(new Event("close"));
};
let root: Root | undefined;
let container: HTMLDivElement;
afterEach(async () => {
  vi.restoreAllMocks();
  if (root) await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
  await api.invoke("workbench.close", {});
  await api.updateSettings({ advanced: { concurrentTurns: 3 } });
  localStorage.clear();
});
async function settle(ms = 30) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}
async function mount() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root?.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        createElement(App),
      ),
    ),
  );
  await settle();
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const heading = (bench: WorkbenchSnapshot) =>
  container.querySelector<HTMLElement>(
    `[data-workbench-entry="${bench.config.id}"] > .workbench-group-heading`,
  ) as HTMLElement;
const control = (bench: WorkbenchSnapshot) =>
  heading(bench)?.querySelector<HTMLDetailsElement>(".workbench-activity") ?? null;
const summary = (bench: WorkbenchSnapshot) =>
  control(bench)?.querySelector<HTMLElement>("summary") as HTMLElement;
const toggle = (bench: WorkbenchSnapshot) =>
  heading(bench).querySelector<HTMLButtonElement>(".workbench-sessions-toggle") as HTMLButtonElement;
const item = (bench: WorkbenchSnapshot, action: string, sessionId: string) =>
  control(bench)?.querySelector<HTMLButtonElement>(
    `[data-activity-session="${sessionId}"] [data-action="${action}"]`,
  ) as HTMLButtonElement;
const shown = (bench: WorkbenchSnapshot) =>
  heading(bench).querySelector(".workbench-group-name")?.getAttribute("aria-current") === "page";

/**
 * Alpha holds a session awaiting approval in the background (the browser mock keeps one workbench open,
 * so its activity row is added to what the mock reports); Beta is shown and runs a slow turn; Gamma is a
 * recent workbench that is not open.
 */
async function twoWorkbenches(tag: string) {
  const gamma = await api.invoke("workbench.create", { folder: `/mock/pwb04-gamma-${tag}`, name: "Gamma" });
  const alpha = await api.invoke("workbench.create", { folder: `/mock/pwb04-alpha-${tag}`, name: "Alpha" });
  const waiting = await api.invoke("session.create", { workbenchId: alpha.config.id });
  await api.invoke("session.rename", { sessionId: waiting.id, title: "Board edit" });
  const beta = await api.invoke("workbench.create", { folder: `/mock/pwb04-beta-${tag}`, name: "Beta" });
  const quiet = await api.invoke("session.create", { workbenchId: beta.config.id });
  await api.invoke("session.rename", { sessionId: quiet.id, title: "Quiet" });
  const running = await api.invoke("session.create", { workbenchId: beta.config.id });
  await api.invoke("session.send", { sessionId: running.id, text: "stream slowly please" });
  const background: SessionActivity = {
    workbenchId: alpha.config.id,
    name: "Alpha",
    folder: alpha.folder,
    foreground: false,
    sessions: [{ id: waiting.id, title: "Board edit", status: "awaiting_approval" }],
  };
  const invoke = api.invoke.bind(api);
  const calls: [string, unknown][] = [];
  const failures: Partial<Record<string, unknown>> = {};
  const state = { background: true };
  vi.spyOn(api, "invoke").mockImplementation((async (channel: string, payload: never) => {
    calls.push([channel, payload]);
    const failure = failures[channel];
    if (failure) {
      delete failures[channel];
      throw failure;
    }
    if (channel === "session.activity") {
      const reported = (await invoke("session.activity", {})) as SessionActivity[];
      return state.background && !shownIn(reported, alpha) ? [...reported, background] : reported;
    }
    // The mock cannot reach a background workbench's session; main routes the request to its owner.
    if (channel === "session.stop" && (payload as { sessionId: string }).sessionId === waiting.id) {
      state.background = false;
      return { stopped: true };
    }
    return invoke(channel as never, payload);
  }) as typeof api.invoke);
  return { alpha, beta, gamma, waiting, quiet, running, calls, failures, state };
}
const shownIn = (rows: SessionActivity[], bench: WorkbenchSnapshot) =>
  rows.some((row) => row.workbenchId === bench.config.id);

test("each workbench heading shows its running and awaiting sessions, background and collapsed included", async () => {
  const { alpha, beta, gamma, running, quiet } = await twoWorkbenches("show");
  await mount();
  const user = userEvent.setup();
  await vi.waitFor(() => expect(control(alpha)).toBeTruthy());
  // Alpha is in the background, so its row is collapsed; its approval wait still shows.
  expect(shown(alpha)).toBe(false);
  expect(toggle(alpha).getAttribute("aria-expanded")).toBe("false");
  expect(control(alpha)?.dataset.activity).toBe("awaiting_approval");
  expect(summary(alpha).textContent).toBe("1");
  expect(summary(alpha).getAttribute("aria-label")).toBe(
    "Active sessions in Alpha: running 0, awaiting approval 1",
  );
  // A workbench that is not open lists nothing.
  expect(heading(gamma)).toBeTruthy();
  expect(control(gamma)).toBeNull();
  expect(shown(beta)).toBe(true);
  expect(control(beta)?.dataset.activity).toBe("running");
  expect(summary(beta).getAttribute("aria-label")).toBe(
    "Active sessions in Beta: running 1, awaiting approval 0",
  );
  // The shown workbench keeps its activity when its row is collapsed.
  await act(async () => user.click(toggle(beta)));
  expect(toggle(beta).getAttribute("aria-expanded")).toBe("false");
  expect(control(beta)?.dataset.activity).toBe("running");
  await act(async () => user.click(toggle(beta)));
  // Rows of the shown workbench: an icon for running, none for idle; the status stays in the row's name.
  const row = container.querySelector(`[data-session="${running.id}"]`) as HTMLElement;
  expect(row.querySelector('[data-session-activity="running"]')).toBeTruthy();
  expect(row.textContent).toContain("Running");
  expect(container.querySelector(`[data-session="${quiet.id}"] [data-session-activity]`)).toBeNull();
  // One turn of the default three runs.
  const capacity = container.querySelector<HTMLElement>("[data-turn-capacity]");
  expect(capacity?.textContent).toContain("1/3");
  expect(capacity?.textContent).toContain("Concurrent turns: 1 of 3 running");
  expect(capacity?.dataset.limitReached).toBe("false");
  // The menu lists the session with its status, and works by keyboard.
  await act(async () => user.click(summary(alpha)));
  expect(control(alpha)?.open).toBe(true);
  const listed = control(alpha)?.querySelector('[data-activity-session] [data-action="open-active-session"]');
  expect(listed?.textContent).toContain("Board edit");
  expect(listed?.textContent).toContain("Awaiting approval");
  // Open and Stop follow the summary in Tab order (user-event leaves summaries out of its Tab order, so
  // the order is read from the document and native Enter/Tab is driven in Electron).
  const order = [...container.querySelectorAll<HTMLElement>("summary, button")].filter(
    (element) => !(element instanceof HTMLButtonElement && element.disabled),
  );
  const at = order.indexOf(summary(alpha));
  expect(order[at + 1]?.dataset.action).toBe("open-active-session");
  expect(order[at + 2]?.dataset.action).toBe("stop-active-session");
  order[at + 1]?.focus();
  await act(async () => user.keyboard("{Tab}"));
  expect(document.activeElement?.getAttribute("data-action")).toBe("stop-active-session");
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Stop: Board edit");
  await act(async () => user.keyboard("{Escape}"));
  expect(control(alpha)?.open).toBe(false);
  expect(document.activeElement).toBe(summary(alpha));
});

test("Stop ends only the chosen session and keeps the shown workbench; a failed Stop shows its error", async () => {
  const { alpha, beta, waiting, running, calls, failures } = await twoWorkbenches("stop");
  await mount();
  const user = userEvent.setup();
  await vi.waitFor(() => expect(control(alpha)).toBeTruthy());
  failures["session.stop"] = { code: "NOT_FOUND", messageKey: "errors.NOT_FOUND" };
  await act(async () => user.click(summary(alpha)));
  await act(async () => user.click(item(alpha, "stop-active-session", waiting.id)));
  await settle();
  const alert = container.querySelector('.workbench-navigation ~ [role="alert"]');
  expect(alert?.getAttribute("data-i18n")).toBe("errors.NOT_FOUND");
  expect(alert?.textContent).toContain("was not found.");
  expect(shown(beta)).toBe(true);
  expect(control(alpha)).toBeTruthy();

  calls.length = 0;
  await act(async () => user.click(summary(alpha)));
  await act(async () => user.click(item(alpha, "stop-active-session", waiting.id)));
  await settle(100);
  expect(calls.filter(([channel]) => channel === "session.stop")).toEqual([
    ["session.stop", { sessionId: waiting.id }],
  ]);
  expect(calls.some(([channel]) => channel === "workbench.open")).toBe(false);
  expect(container.querySelector('.workbench-navigation ~ [role="alert"]')).toBeNull();
  // Alpha has nothing left to show; Beta is still shown and still streaming.
  await vi.waitFor(() => expect(control(alpha)).toBeNull());
  expect(shown(beta)).toBe(true);
  expect((await api.invoke("session.get", { sessionId: running.id })).snapshot.activeTurnId).not.toBeNull();
  expect(document.activeElement).toBe(heading(alpha).querySelector(".workbench-group-name"));
});

test("Open shows a background session in its own workbench; a failed open keeps the view", async () => {
  const { alpha, beta, waiting, quiet, calls, failures } = await twoWorkbenches("open");
  await mount();
  const user = userEvent.setup();
  await vi.waitFor(() => expect(control(alpha)).toBeTruthy());
  await act(async () => (container.querySelector(`[data-session="${quiet.id}"]`) as HTMLElement).click());
  await settle();
  failures["session.activity.open"] = { code: "NOT_FOUND", messageKey: "errors.NOT_FOUND" };
  await act(async () => user.click(summary(alpha)));
  await act(async () => user.click(item(alpha, "open-active-session", waiting.id)));
  await settle();
  const alert = container.querySelector('.workbench-navigation ~ [role="alert"]');
  expect(alert?.getAttribute("data-i18n")).toBe("errors.NOT_FOUND");
  expect(alert?.textContent).toContain("was not found.");
  expect(shown(beta)).toBe(true);
  expect(container.querySelector(`[data-session="${quiet.id}"]`)?.getAttribute("aria-current")).toBe("page");

  await act(async () => user.click(summary(alpha)));
  await act(async () => user.click(item(alpha, "open-active-session", waiting.id)));
  await settle(100);
  expect(calls).toContainEqual([
    "session.activity.open",
    { folder: alpha.folder, workbenchId: alpha.config.id, sessionId: waiting.id },
  ]);
  await vi.waitFor(() => expect(shown(alpha)).toBe(true));
  await vi.waitFor(() =>
    expect(container.querySelector(`[data-session="${waiting.id}"]`)?.getAttribute("aria-current")).toBe(
      "page",
    ),
  );
  await vi.waitFor(() => expect(document.activeElement?.textContent).toBe("Board edit"));
  expect(document.activeElement?.tagName).toBe("H2");
});

test("Open of a session of the shown workbench selects it without opening the workbench again", async () => {
  const { beta, running, quiet, calls } = await twoWorkbenches("shown");
  await mount();
  const user = userEvent.setup();
  await vi.waitFor(() => expect(control(beta)).toBeTruthy());
  await act(async () => (container.querySelector(`[data-session="${quiet.id}"]`) as HTMLElement).click());
  await settle();
  calls.length = 0;
  await act(async () => user.click(summary(beta)));
  await act(async () => user.click(item(beta, "open-active-session", running.id)));
  await settle(100);
  expect(calls.some(([channel]) => channel === "workbench.open")).toBe(false);
  expect(shown(beta)).toBe(true);
  expect(container.querySelector(`[data-session="${running.id}"]`)?.getAttribute("aria-current")).toBe(
    "page",
  );
  await vi.waitFor(() => expect(document.activeElement?.textContent).toBe("stream slowly please"));
  expect(document.activeElement?.tagName).toBe("H2");
});

test("session rows mark running and awaiting-approval sessions only, with the status in the row name", async () => {
  const bench = await api.invoke("workbench.create", { folder: "/mock/pwb04-rows", name: "Rows" });
  const base = await api.invoke("session.create", { workbenchId: bench.config.id });
  const rows: SessionSummary[] = (["idle", "running", "awaiting_approval", "error"] as const).map(
    (status, index) => ({ ...base, id: `${base.id.slice(0, -1)}${index + 5}`, title: status, status }),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root?.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        createElement(SessionList, {
          sessions: rows,
          select: () => {},
          create: () => {},
          rename: async () => true,
          remove: async () => true,
          archive: async () => true,
          disabled: false,
        }),
      ),
    ),
  );
  await settle();
  const icon = (title: string) => {
    const row = [...container.querySelectorAll<HTMLElement>("[data-session]")].find(
      (element) => element.querySelector("strong")?.textContent === title,
    );
    expect(row, title).toBeTruthy();
    return row?.querySelector<HTMLElement>("[data-session-activity]") ?? null;
  };
  expect(icon("running")?.dataset.sessionActivity).toBe("running");
  expect(icon("awaiting_approval")?.dataset.sessionActivity).toBe("awaiting_approval");
  expect(icon("awaiting_approval")?.getAttribute("aria-hidden")).toBe("true");
  expect(icon("idle")).toBeNull();
  expect(icon("error")).toBeNull();
  const awaiting = container.querySelector<HTMLElement>(`[data-session="${rows[2]?.id}"]`);
  expect(awaiting?.querySelector(".sr-only")?.textContent).toBe("Awaiting approval");
});

test("an activity event supersedes both initial reads that are still in flight", async () => {
  const bench = await api.invoke("workbench.create", { folder: "/mock/activity-first-read", name: "Rig" });
  const session = await api.invoke("session.create", { workbenchId: bench.config.id });
  const pendingActivity = deferred<Response<"session.activity">>();
  const pendingUnread = deferred<Response<"session.activity.unread">>();
  const counts = { activity: 0, unread: 0 };
  const completion = {
    folder: bench.folder,
    workbenchId: bench.config.id,
    sessionId: session.id,
    completionId: "188cc057-0c82-4079-8775-05efced31572",
    workbenchName: "Rig",
    title: "A reply just finished",
  };
  const invoke = api.invoke.bind(api);
  vi.spyOn(api, "invoke").mockImplementation((async (channel: string, payload: never) => {
    if (channel === "session.activity" && ++counts.activity === 1) return pendingActivity.promise;
    if (channel === "session.activity.unread")
      return ++counts.unread === 1 ? pendingUnread.promise : [completion];
    return invoke(channel as never, payload);
  }) as typeof api.invoke);
  await mount();
  await act(async () => {
    container.querySelector<HTMLButtonElement>('[data-action="show-activity"]')?.click();
  });
  await vi.waitFor(() => expect(counts).toEqual({ activity: 1, unread: 1 }));
  await act(async () => {
    await api.invoke("session.send", { sessionId: session.id, text: "stream slowly please" });
  });
  await vi.waitFor(() => {
    expect(document.querySelector('dialog [data-activity-kind="running"]')).toBeTruthy();
    expect(document.querySelector('dialog [data-activity-kind="completion"]')?.textContent).toContain(
      completion.title,
    );
  });
  await act(async () => {
    pendingActivity.resolve([]);
    pendingUnread.resolve([]);
  });
  expect(document.querySelector('dialog [data-activity-kind="running"]')).toBeTruthy();
  expect(document.querySelector('dialog [data-activity-kind="completion"]')).toBeTruthy();
});

test("a pending sidebar open freezes editors and preserves a newer native activation", async () => {
  const bench = await api.invoke("workbench.create", { folder: "/mock/activity-navigation", name: "Rig" });
  const running = await api.invoke("session.create", { workbenchId: bench.config.id });
  await api.invoke("session.send", { sessionId: running.id, text: "stream slowly please" });
  const native = await api.invoke("session.create", { workbenchId: bench.config.id });
  const open = deferred<Response<"session.activity.open">>();
  const invoke = api.invoke.bind(api);
  const nativeOpen = vi.fn((_request: unknown) => ({ workbench: bench, sessionId: native.id }));
  vi.spyOn(api, "invoke").mockImplementation((async (channel: string, payload: never) => {
    if (channel === "session.activity.open") return open.promise;
    if (channel === "session.notification.open") return nativeOpen(payload);
    return invoke(channel as never, payload);
  }) as typeof api.invoke);
  const subscribe = api.subscribe.bind(api);
  const listeners = new Set<(event: AppEvent) => void>();
  vi.spyOn(api, "subscribe").mockImplementation(((...args: unknown[]) => {
    const unsubscribe = Reflect.apply(subscribe, api, args) as () => void;
    if (args[0] !== "app") return unsubscribe;
    const listener = args[1] as (event: AppEvent) => void;
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      unsubscribe();
    };
  }) as typeof api.subscribe);
  await mount();
  await vi.waitFor(() => expect(control(bench)).toBeTruthy());
  await act(async () => {
    container.querySelector<HTMLButtonElement>('[data-action="edit-workbench-overview"]')?.click();
  });
  const editor = container.querySelector(".workbench-editor");
  expect(editor).toBeTruthy();
  expect(editor?.closest("[inert]")).toBeNull();
  await act(async () => {
    item(bench, "open-active-session", running.id).click();
  });
  const token = "188cc057-0c82-4079-8775-05efced31572";
  await act(async () => {
    for (const listener of listeners) listener({ type: "session.notification.clicked", token });
  });
  expect(editor?.closest("[inert]")).toBeTruthy();
  expect(nativeOpen).not.toHaveBeenCalled();
  await act(async () => open.resolve({ workbench: bench, sessionId: running.id }));
  await vi.waitFor(() => expect(nativeOpen).toHaveBeenCalledExactlyOnceWith({ token }));
  await vi.waitFor(() =>
    expect(container.querySelector(`[data-session="${native.id}"]`)?.getAttribute("aria-current")).toBe(
      "page",
    ),
  );
});

test("activity events refresh the heading and the rows at once; the limit shows as reached", async () => {
  await api.updateSettings({ advanced: { concurrentTurns: 1 } });
  const bench = await api.invoke("workbench.create", { folder: "/mock/pwb04-live", name: "Live" });
  const session = await api.invoke("session.create", { workbenchId: bench.config.id });
  await mount();
  await vi.waitFor(() => expect(container.querySelector(`[data-session="${session.id}"]`)).toBeTruthy());
  expect(control(bench)).toBeNull();
  expect(container.querySelector("[data-turn-capacity]")).toBeNull();
  // Faster than the two-second list poll: the activity event brings the change.
  await act(async () => {
    await api.invoke("session.send", { sessionId: session.id, text: "stream slowly please" });
  });
  await vi.waitFor(
    () => {
      expect(control(bench)?.dataset.activity).toBe("running");
      expect(container.querySelector(`[data-session="${session.id}"] [data-session-activity]`)).toBeTruthy();
    },
    { timeout: 1000 },
  );
  const capacity = container.querySelector<HTMLElement>("[data-turn-capacity]");
  expect(capacity?.textContent).toContain("1/1");
  expect(capacity?.dataset.limitReached).toBe("true");
  expect(capacity?.textContent).toContain("Concurrent turns limit reached: 1 of 1 running");
  await act(async () => {
    await api.invoke("session.stop", { sessionId: session.id });
  });
  await vi.waitFor(
    () => {
      expect(control(bench)).toBeNull();
      expect(container.querySelector(`[data-session="${session.id}"] [data-session-activity]`)).toBeNull();
      expect(container.querySelector("[data-turn-capacity]")).toBeNull();
    },
    { timeout: 1000 },
  );
});
