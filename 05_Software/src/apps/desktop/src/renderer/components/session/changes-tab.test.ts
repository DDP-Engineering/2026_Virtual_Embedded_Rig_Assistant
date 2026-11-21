// @vitest-environment jsdom
// REQ-UX-18000003 REQ-REL-18000004 REQ-REL-18000006 REQ-SEC-18000005
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import type { ChangeDetail, Channel, Request, SessionEvent } from "@vera/shared";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "../../App.js";
import { api } from "../../api/index.js";
import { ChangesTab } from "./changes-tab.js";
import "../../i18n.js";

vi.mock("../../api/index.js", async () => {
  const { createMockApi } = await import("../../mocks/mockApi.js");
  return { api: createMockApi(undefined, "chat").api, usingMocks: true };
});
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
let root: Root, container: HTMLDivElement;
async function settle() {
  await act(async () => {
    await new Promise((done) => setTimeout(done, 30));
  });
}
function button(text: string) {
  const node = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.includes(text) || b.getAttribute("aria-label")?.includes(text),
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
test("shows the Changes empty state for an empty selected session", async () => {
  await api.invoke("workbench.open", { folder: "/mock/demo-board" });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        createElement(App),
      ),
    ),
  );
  const emptySession = await vi.waitFor(() => button("Empty session"));
  await act(async () => emptySession.click());
  await act(async () => container.querySelector<HTMLButtonElement>("[data-toggle=right]")?.click());
  const changes = await vi.waitFor(() => button("Changes"));
  await act(async () => changes.click());
  await vi.waitFor(() =>
    expect(container.querySelector("#panel-changes")?.textContent).toContain("No changes in this session."),
  );
});
// REQ-REL-4bea0006 (PERF-05: one session view per window)
test("opening side tabs reuses the chat's session view instead of reading the session again", async () => {
  await api.invoke("workbench.open", { folder: "/mock/demo-board" });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        createElement(App),
      ),
    ),
  );
  await settle();
  await act(async () => button("Empty session").click());
  await settle();
  const invoke = vi.spyOn(api, "invoke");
  const subscribe = vi.spyOn(api, "subscribe");
  await act(async () => container.querySelector<HTMLButtonElement>("[data-toggle=right]")?.click());
  for (const tab of ["Changes", "Artifacts", "Plan"]) {
    await act(async () => button(tab).click());
    await settle();
  }
  expect(container.querySelector("#panel-plan")).toBeTruthy();
  expect(invoke.mock.calls.filter(([channel]) => channel === "session.get")).toEqual([]);
  expect(subscribe).not.toHaveBeenCalled();
});

async function mountTab(sessionId: string) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  async function render(id: string) {
    await act(async () =>
      root.render(
        createElement(
          QueryClientProvider,
          { client },
          createElement(ChangesTab, { workbenchId: "wb-test", sessionId: id }),
        ),
      ),
    );
    await settle();
  }
  await render(sessionId);
  return render;
}
async function session() {
  await api.invoke("workbench.open", { folder: "/mock/demo-board" });
  return api.invoke("session.create", { mode: "auto-edit" });
}
const patch = (path: string, word: string) => `--- ${path}\n+++ ${path}\n@@ -1 +1 @@\n-old\n+${word}\n`;
function row(id: number, sessionId: string, path: string): ChangeDetail {
  return {
    changeId: id,
    sessionId,
    path,
    createdAt: "2026-10-12T00:00:00.000Z",
    added: id,
    removed: 1,
    diff: patch(path, `new${id}`),
  };
}
function reads(rows: ChangeDetail[]) {
  const original = api.invoke.bind(api);
  return vi.spyOn(api, "invoke").mockImplementation((async (channel: Channel, raw: Request<Channel>) => {
    if (channel === "changes.list")
      return rows
        .filter((c) => c.sessionId === (raw as Request<"changes.list">).sessionId)
        .map(({ diff: _, ...c }) => c);
    if (channel === "changes.get")
      return rows.find((c) => c.changeId === (raw as Request<"changes.get">).changeId);
    return original(channel, raw);
  }) as typeof api.invoke);
}
test("presents multiple ordered counts, selects diff and reveals the selected relative path", async () => {
  const s = await session();
  const rows = [row(1, s.id, "first ă.txt"), row(2, s.id, "second.txt")];
  const spy = reads(rows);
  await mountTab(s.id);
  await settle();
  expect([...container.querySelectorAll("[data-change]")].map((b) => b.getAttribute("data-change"))).toEqual([
    "1",
    "2",
  ]);
  expect(container.querySelector("[data-change='2']")?.textContent).toContain("+2 −1");
  // Counts and time share one line under the path.
  expect(container.querySelector("[data-change='2'] .changes-meta time")).not.toBeNull();
  expect(container.querySelector("[data-change='2'] .changes-meta .changes-counts")?.textContent).toBe(
    "+2 −1",
  );
  expect(container.querySelector("pre")?.textContent).toContain("+new1");
  await act(async () => container.querySelector<HTMLButtonElement>("[data-change='2']")?.click());
  await settle();
  expect(container.querySelector("pre")?.textContent).toContain("+new2");
  expect(container.querySelector(".approval-diff .diff-removed")?.textContent).toContain("-old");
  await act(async () => button("Reveal in folder").click());
  await settle();
  expect(spy).toHaveBeenCalledWith("app.revealPath", { path: "second.txt" });
});
test("updates live during pending initial list and preserves the selected diff on a later change", async () => {
  const s = await session();
  const original = api.invoke.bind(api);
  let first = true;
  let finish: ((value: unknown) => void) | undefined;
  vi.spyOn(api, "invoke").mockImplementation((async (channel: Channel, raw: Request<Channel>) => {
    if (channel === "changes.list" && first) {
      first = false;
      return new Promise<unknown>((done) => {
        finish = done;
      });
    }
    return original(channel, raw);
  }) as typeof api.invoke);
  await mountTab(s.id);
  expect(finish).toBeDefined();
  await act(async () => {
    await original("session.send", { sessionId: s.id, text: "Edit notes" });
  });
  await settle();
  await settle();
  await act(async () => finish?.([]));
  await settle();
  expect(container.querySelectorAll("[data-change]")).toHaveLength(1);
  expect(container.querySelector("pre")?.textContent).toContain("+new");
  const chosen = container.querySelector("[aria-pressed=true]")?.getAttribute("data-change");
  await act(async () => {
    await original("session.send", { sessionId: s.id, text: "Edit again" });
  });
  await settle();
  await settle();
  expect(container.querySelectorAll("[data-change]")).toHaveLength(2);
  expect(container.querySelector("[aria-pressed=true]")?.getAttribute("data-change")).toBe(chosen);
});
test("isolates late diff and reveal outcomes on session switches and detaches subscriptions", async () => {
  const a = await session(),
    b = await api.invoke("session.create", {});
  const rows = [row(1, a.id, "old.txt"), row(2, b.id, "current.txt")];
  const original = api.invoke.bind(api);
  let finish: ((value: ChangeDetail) => void) | undefined;
  let rejectReveal: ((value: unknown) => void) | undefined;
  const subscribe = api.subscribe.bind(api);
  let detached = 0;
  vi.spyOn(api, "subscribe").mockImplementation(((
    topic: "session",
    id: string,
    seq: number,
    on: (event: SessionEvent) => void,
  ) => {
    const off = subscribe(topic, id, seq, on);
    return () => {
      detached++;
      off();
    };
  }) as typeof api.subscribe);
  vi.spyOn(api, "invoke").mockImplementation((async (channel: Channel, raw: Request<Channel>) => {
    if (channel === "changes.list")
      return rows
        .filter((c) => c.sessionId === (raw as Request<"changes.list">).sessionId)
        .map(({ diff: _, ...c }) => c);
    if (channel === "changes.get") {
      if ((raw as Request<"changes.get">).changeId === 1)
        return new Promise<ChangeDetail>((done) => {
          finish = done;
        });
      return rows[1];
    }
    if (channel === "app.revealPath")
      return new Promise((_done, reject) => {
        rejectReveal = reject;
      });
    return original(channel, raw);
  }) as typeof api.invoke);
  const render = await mountTab(a.id);
  expect(finish).toBeDefined();
  await render(b.id);
  await act(async () => finish?.(rows[0] as ChangeDetail));
  await settle();
  expect(container.querySelector("pre")?.textContent).toContain("current.txt");
  expect(container.querySelector("pre")?.textContent).not.toContain("old.txt");
  await act(async () => button("Reveal in folder").click());
  expect(rejectReveal).toBeDefined();
  await render(a.id);
  await act(async () => rejectReveal?.({ code: "DENIED", messageKey: "errors.DENIED" }));
  await settle();
  expect(container.querySelector("[role=alert]")).toBeNull();
  expect(detached).toBe(2);
});
test("ignores an obsolete pending list after selecting another session", async () => {
  const a = await session(),
    b = await api.invoke("session.create", {});
  const original = api.invoke.bind(api);
  let finish: ((value: unknown) => void) | undefined;
  vi.spyOn(api, "invoke").mockImplementation((async (channel: Channel, raw: Request<Channel>) => {
    if (channel === "changes.list") {
      if ((raw as Request<"changes.list">).sessionId === a.id)
        return new Promise<unknown>((done) => {
          finish = done;
        });
      return [];
    }
    return original(channel, raw);
  }) as typeof api.invoke);
  const render = await mountTab(a.id);
  expect(finish).toBeDefined();
  await render(b.id);
  await act(async () => finish?.([row(1, a.id, "old-session.txt")]));
  await settle();
  expect(container.textContent).toContain("No changes in this session.");
  expect(container.textContent).not.toContain("old-session.txt");
});
test("shows list, detail and reveal failures with actionable retries", async () => {
  const s = await session();
  const rows = [row(1, s.id, "first.txt")];
  const original = api.invoke.bind(api);
  let listFail = true,
    detailFail = true;
  vi.spyOn(api, "invoke").mockImplementation((async (channel: Channel, raw: Request<Channel>) => {
    if (channel === "changes.list") {
      if (listFail) throw { code: "NOT_FOUND", messageKey: "errors.NOT_FOUND" };
      return rows.map(({ diff: _, ...c }) => c);
    }
    if (channel === "changes.get") {
      if (detailFail) throw { code: "NOT_FOUND", messageKey: "errors.NOT_FOUND" };
      return rows[0];
    }
    if (channel === "app.revealPath") throw { code: "DENIED", messageKey: "errors.DENIED" };
    return original(channel, raw);
  }) as typeof api.invoke);
  await mountTab(s.id);
  expect(container.querySelector("[role=alert]")).toBeTruthy();
  listFail = false;
  await act(async () => button("Retry").click());
  await settle();
  expect(container.querySelector("[role=alert]")).toBeTruthy();
  expect(container.querySelector("pre")).toBeNull();
  detailFail = false;
  await act(async () => button("Retry").click());
  await settle();
  expect(container.querySelector("pre")?.textContent).toContain("+new1");
  await act(async () => button("Reveal in folder").click());
  await settle();
  expect(container.querySelector("[role=alert]")).toBeTruthy();
});

test("pages a long change list and keeps the selected diff below it", async () => {
  const s = await session();
  const rows = Array.from({ length: 12 }, (_, index) => row(index + 1, s.id, `file${index + 1}.txt`));
  reads(rows);
  await mountTab(s.id);
  await settle();
  const shown = () =>
    [...container.querySelectorAll("[data-change]")].map((b) => b.getAttribute("data-change"));
  expect(shown()).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
  expect(container.querySelector("[data-pager]")).not.toBeNull();
  await act(async () => container.querySelector<HTMLButtonElement>("[data-pager-next]")?.click());
  await settle();
  expect(shown()).toEqual(["11", "12"]);
  // The first change stays selected; its diff is shown under the list.
  expect(container.querySelector("pre")?.textContent).toContain("+new1");
  await act(async () => container.querySelector<HTMLButtonElement>("[data-change='12']")?.click());
  await settle();
  expect(container.querySelector("pre")?.textContent).toContain("+new12");
});

test("resizes the file list and the diff from the keyboard within a quarter on each side", async () => {
  const s = await session();
  reads([row(1, s.id, "first.txt"), row(2, s.id, "second.txt")]);
  await mountTab(s.id);
  await settle();
  const splitter = container.querySelector<HTMLElement>("[data-changes-splitter]") as HTMLElement;
  const files = () => container.querySelector<HTMLElement>(".changes-files")?.style.flexBasis;
  expect(splitter.getAttribute("aria-label")).toBe("Resize the file list and the diff");
  splitter.focus();
  await act(async () => userEvent.setup().keyboard("{Home}"));
  expect(splitter.getAttribute("aria-valuenow")).toBe("25");
  expect(files()).toBe("25%");
  await act(async () => userEvent.setup().keyboard("{ArrowUp}"));
  expect(splitter.getAttribute("aria-valuenow")).toBe("25");
  await act(async () => userEvent.setup().keyboard("{ArrowDown}"));
  expect(files()).toBe("30%");
  await act(async () => userEvent.setup().keyboard("{End}{ArrowDown}"));
  expect(splitter.getAttribute("aria-valuenow")).toBe("75");
  expect(files()).toBe("75%");
});
