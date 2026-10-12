// @vitest-environment jsdom
// REQ-UX-76d958ce REQ-REL-da260a86
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ArtifactContent, Channel, Request, SessionEvent } from "@vera/shared";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "../../App.js";
import { api } from "../../api/index.js";
import { ArtifactsTab } from "./artifacts-tab.js";
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
async function mount(element: ReturnType<typeof createElement>) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const render = async (node: ReturnType<typeof createElement>) => {
    await act(async () => root.render(createElement(QueryClientProvider, { client }, node)));
    await settle();
  };
  await render(element);
  return render;
}
async function session() {
  await api.invoke("workbench.open", { folder: "/mock/demo-board" });
  return api.invoke("session.create", {});
}
function artifact(sessionId: string, name = "summary.md", n = 1): ArtifactContent {
  return {
    artifactId: `art_${String(n).padStart(26, "0")}`,
    sessionId,
    name,
    mime: name.endsWith(".md") ? "text/markdown" : "text/plain",
    bytes: 7,
    sha256: "a".repeat(64),
    description: null,
    createdAt: "2026-10-12T00:00:00.000Z",
    content: "# Hello\n<script>bad()</script>",
  };
}
function reads(rows: ArtifactContent[]) {
  const original = api.invoke.bind(api);
  return vi.spyOn(api, "invoke").mockImplementation((async (channel: Channel, raw: Request<Channel>) => {
    if (channel === "artifacts.list")
      return rows
        .filter((a) => a.sessionId === (raw as Request<"artifacts.list">).sessionId)
        .map(({ content: _, ...a }) => a);
    if (channel === "artifacts.open")
      return rows.find((a) => a.artifactId === (raw as Request<"artifacts.open">).artifactId);
    if (channel === "artifacts.reveal") return {};
    if (channel === "artifacts.export") return { exported: true };
    return original(channel, raw);
  }) as typeof api.invoke);
}
it("connects Artifacts to the selected session empty state", async () => {
  await api.invoke("workbench.open", { folder: "/mock/demo-board" });
  await mount(createElement(App));
  await settle();
  await act(async () => button("Empty session").click());
  await act(async () => container.querySelector<HTMLButtonElement>("[data-toggle=right]")?.click());
  await act(async () => button("Artifacts").click());
  await settle();
  expect(container.querySelector("#panel-artifacts")?.textContent).toContain("No artifacts in this session.");
});
it("shows name/size/time and safe Markdown/plain viewer with export/reveal actions", async () => {
  const s = await session();
  const rows = [artifact(s.id), { ...artifact(s.id, "notes.txt", 2), content: "<script>literal</script>" }];
  const spy = reads(rows);
  await mount(createElement(ArtifactsTab, { workbenchId: "wb", sessionId: s.id }));
  await settle();
  expect(container.querySelectorAll("[data-artifact]")).toHaveLength(2);
  expect(container.textContent).toContain("7 B");
  expect(container.querySelector("time")?.dateTime).toBe(rows[0]?.createdAt);
  expect(container.querySelector("h1")?.textContent).toBe("Hello");
  expect(container.querySelector("script")).toBeNull();
  await act(async () => button("notes.txt").click());
  await settle();
  expect(container.querySelector("pre")?.textContent).toBe("<script>literal</script>");
  await act(async () => button("Export").click());
  await act(async () => button("Reveal in folder").click());
  expect(spy).toHaveBeenCalledWith("artifacts.export", { artifactId: rows[1]?.artifactId });
  expect(spy).toHaveBeenCalledWith("artifacts.reveal", { artifactId: rows[1]?.artifactId });
});
it("refreshes live saves/overwrite and isolates late opens after navigation", async () => {
  const a = await session(),
    b = await api.invoke("session.create", {});
  const rows = [artifact(a.id)];
  reads(rows);
  const listeners = new Map<string, (e: SessionEvent) => void>();
  vi.spyOn(api, "subscribe").mockImplementation(((
    topic: string,
    id: string,
    _seq: number,
    on: (e: SessionEvent) => void,
  ) => {
    if (topic === "session") listeners.set(id, on);
    return () => {
      listeners.delete(id);
    };
  }) as unknown as typeof api.subscribe);
  const render = await mount(createElement(ArtifactsTab, { workbenchId: "wb", sessionId: a.id }));
  await settle();
  const updated = { ...artifact(a.id), content: "# Updated" };
  rows[0] = updated;
  await act(async () =>
    listeners.get(a.id)?.({
      type: "artifact.saved",
      artifactId: updated.artifactId,
      name: "summary.md",
      bytes: 9,
    }),
  );
  await settle();
  expect(container.querySelector("h1")?.textContent).toBe("Updated");
  await render(createElement(ArtifactsTab, { workbenchId: "wb", sessionId: b.id }));
  expect(container.textContent).toContain("No artifacts in this session.");
  expect(listeners.has(a.id)).toBe(false);
});
it("keeps delayed old open and action failures out of the newly selected session", async () => {
  const a = await session(),
    b = await api.invoke("session.create", {});
  const old = artifact(a.id),
    fresh = { ...artifact(b.id, "fresh.md", 2), content: "# Fresh" };
  const spy = reads([old, fresh]);
  const ordinary = spy.getMockImplementation();
  if (!ordinary) throw Error("mock missing");
  let resolveOld!: (a: ArtifactContent) => void;
  spy.mockImplementation((async (channel: Channel, raw: Request<Channel>) =>
    channel === "artifacts.open" && (raw as Request<"artifacts.open">).artifactId === old.artifactId
      ? new Promise<ArtifactContent>((done) => {
          resolveOld = done;
        })
      : ordinary(channel, raw)) as typeof api.invoke);
  const render = await mount(createElement(ArtifactsTab, { workbenchId: "wb", sessionId: a.id }));
  expect(container.querySelector("h1")).toBeNull();
  await render(createElement(ArtifactsTab, { workbenchId: "wb", sessionId: b.id }));
  await settle();
  expect(container.querySelector("h1")?.textContent).toBe("Fresh");
  await act(async () => resolveOld(old));
  await settle();
  expect(container.querySelector("h1")?.textContent).toBe("Fresh");
  let rejectAction!: (error: unknown) => void;
  spy.mockImplementation((async (channel: Channel, raw: Request<Channel>) =>
    channel === "artifacts.export"
      ? new Promise((_, fail) => {
          rejectAction = fail;
        })
      : ordinary(channel, raw)) as typeof api.invoke);
  await act(async () => button("Export").click());
  await render(createElement(ArtifactsTab, { workbenchId: "another", sessionId: a.id }));
  await act(async () => rejectAction({ code: "OFFLINE", messageKey: "errors.OFFLINE" }));
  await settle();
  expect(container.querySelector('[role="alert"]')).toBeNull();
});
it("surfaces list/open/action failures and allows confirmed read retries", async () => {
  const s = await session(),
    a = artifact(s.id);
  const spy = reads([a]);
  const ordinary = spy.getMockImplementation();
  if (!ordinary) throw Error("mock missing");
  let listFails = true,
    openFails = true;
  spy.mockImplementation((async (channel: Channel, raw: Request<Channel>) => {
    if (
      (channel === "artifacts.list" && listFails) ||
      (channel === "artifacts.open" && openFails) ||
      channel === "artifacts.reveal"
    )
      throw { code: "OFFLINE", messageKey: "errors.OFFLINE" };
    return ordinary(channel, raw);
  }) as typeof api.invoke);
  await mount(createElement(ArtifactsTab, { workbenchId: "wb", sessionId: s.id }));
  expect(container.querySelector('[role="alert"]')).toBeTruthy();
  listFails = false;
  await act(async () => button("Retry").click());
  await settle();
  expect(container.querySelector('[role="alert"]')).toBeTruthy();
  openFails = false;
  await act(async () => button("Retry").click());
  await settle();
  expect(container.querySelector("h1")?.textContent).toBe("Hello");
  await act(async () => button("Reveal in folder").click());
  expect(container.querySelector('[role="alert"]')).toBeTruthy();
});
