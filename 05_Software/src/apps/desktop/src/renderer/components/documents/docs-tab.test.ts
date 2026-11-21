// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { api } from "../../api/index.js";
import "../../i18n.js";
import { DocsTab } from "./docs-tab.js";
import { DocumentViewerProvider } from "./viewer-context.js";

vi.mock("../../api/index.js", async () => {
  const { createMockApi } = await import("../../mocks/mockApi.js");
  return { api: createMockApi(undefined, "chat").api };
});
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
const id = "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C";
const wait = () =>
  act(async () => {
    await new Promise((done) => setTimeout(done, 400));
  });

it("reloads the lists once after a burst of index.document events, and never after unmount", async () => {
  const { indexLease } = await api.invoke("workbench.open", { folder: "/mock/demo-board" });
  const handlers: ((event: unknown) => void)[] = [];
  const subscribe = api.subscribe.bind(api);
  vi.spyOn(api, "subscribe").mockImplementation(((topic: string, ...rest: unknown[]) => {
    if (topic === "workbench") handlers.push(rest.at(-1) as (event: unknown) => void);
    return (subscribe as (...args: unknown[]) => () => void)(topic, ...rest);
  }) as typeof api.subscribe);
  const invoke = vi.spyOn(api, "invoke");
  const listed = () => invoke.mock.calls.filter(([channel]) => channel === "docs.list").length;
  const indexed = (path: string) =>
    act(async () => {
      for (const on of handlers) on({ type: "index.document", path, document: null });
    });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let mounted = true;
  try {
    await act(async () =>
      root.render(
        createElement(
          QueryClientProvider,
          { client },
          createElement(
            DocumentViewerProvider,
            { workbenchId: id },
            createElement(DocsTab, { workbenchId: id, indexLease, readOnly: false }),
          ),
        ),
      ),
    );
    await wait();
    const before = listed();
    for (let n = 0; n < 5; n++) await indexed(`docs/${n}.md`);
    expect(listed()).toBe(before);
    await wait();
    expect(listed()).toBe(before + 1);
    await indexed("docs/late.md");
    await act(async () => root.unmount());
    mounted = false;
    await wait();
    expect(listed()).toBe(before + 1);
  } finally {
    if (mounted) await act(async () => root.unmount());
    container.remove();
    client.clear();
    vi.restoreAllMocks();
    await api.invoke("workbench.close", {});
  }
});
