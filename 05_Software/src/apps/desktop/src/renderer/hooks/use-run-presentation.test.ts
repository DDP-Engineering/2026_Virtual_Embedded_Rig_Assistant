// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { api } from "../api/index.js";
import { observeProgramAction, useRunPresentation } from "./use-run-presentation.js";

vi.mock("../api/index.js", async () => {
  const { createMockApi } = await import("../mocks/mockApi.js");
  return { api: createMockApi(undefined, "chat").api };
});
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
const id = "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C";

it("clears finished/inactive owner caches and cancels a late live reply on app and workbench changes", async () => {
  let appChanged = () => {},
    workbenchChanged = () => {};
  const subscription = vi.spyOn(api, "subscribe").mockImplementation(((topic: string, ...args: unknown[]) => {
    const callback = args.at(-1) as (event: { type: string }) => void;
    if (topic === "app") appChanged = () => callback({ type: "settings.changed" });
    else workbenchChanged = () => callback({ type: "config.changed" });
    return () => {};
  }) as typeof api.subscribe);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const node = document.createElement("div"),
    root = createRoot(node);
  let resolveOld = (_text: string) => {};
  let calls = 0;
  function Probe() {
    useRunPresentation(id);
    const query = useQuery({
      queryKey: ["run-log", id, "live"],
      queryFn: () =>
        ++calls === 1
          ? new Promise<string>((done) => {
              resolveOld = done;
            })
          : Promise.resolve("[REDACTED]"),
    });
    return createElement("pre", null, query.data);
  }
  const keys = [
    ["runs", id],
    ["run-log", id, "finished"],
    ["plugin-programs", id, "tool"],
    ["plugin-programs", null, "global"],
    ["run-log", "other", "finished"],
  ];
  try {
    for (const key of keys) client.setQueryData(key, "secret");
    await act(async () => {
      root.render(createElement(QueryClientProvider, { client }, createElement(Probe)));
    });
    await act(async () => {
      workbenchChanged();
    });
    for (const key of keys.slice(0, 3)) expect(client.getQueryData(key)).toBeUndefined();
    for (const key of keys.slice(3)) expect(client.getQueryData(key)).toBe("secret");
    await act(async () => {
      resolveOld("late-secret");
      await new Promise((done) => setTimeout(done, 20));
    });
    expect(node.textContent).toBe("[REDACTED]");
    await act(async () => {
      appChanged();
    });
    for (const key of keys) expect(client.getQueryData(key)).toBeUndefined();
    expect(client.getQueryData(["run-log", id, "live"])).toBe("[REDACTED]");
  } finally {
    await act(async () => root.unmount());
    client.clear();
    subscription.mockRestore();
  }
});

it.each(["success", "failure"] as const)(
  "retires an earlier passive status read at action %s completion",
  async (outcome) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = ["plugin-programs", id, "tool"];
    const request = { id: "tool", workbenchId: id };
    const old = [{ name: "tool", kind: "find", state: "missing" }];
    const fresh = [{ name: "tool", kind: "find", state: "ready" }];
    let resolveOld = (_value: unknown) => {},
      complete = (_value: unknown) => {},
      fail = (_error: Error) => {},
      started = false;
    const action = new Promise((resolve, reject) => {
      complete = resolve;
      fail = reject;
    });
    let reads = 0;
    const invoke = vi.spyOn(api, "invoke").mockImplementation((async () =>
      ++reads === 1
        ? new Promise<unknown>((done) => {
            resolveOld = done;
          })
        : fresh) as typeof api.invoke);
    try {
      client.setQueryData(key, old);
      const observed = observeProgramAction(client, key, request, () => {
        started = true;
        return action;
      }).then(
        (value) => ({ value, error: undefined }),
        (error) => ({ value: undefined, error }),
      );
      await vi.waitFor(() => expect(started).toBe(true));
      const passive = client
        .fetchQuery({ queryKey: key, staleTime: 0, queryFn: () => api.invoke("plugins.programs", request) })
        .catch(() => undefined);
      await vi.waitFor(() => expect(reads).toBe(1));
      const failure = Error("Original action failure");
      if (outcome === "success") complete(fresh);
      else fail(failure);
      await new Promise((done) => setTimeout(done, 0));
      resolveOld(old);
      const result = await observed;
      await passive;
      if (outcome === "success") {
        expect(result.error).toBeUndefined();
        expect(client.getQueryData(key)).toEqual(fresh);
        expect(reads).toBe(2);
      } else {
        expect(result.error).toBe(failure);
        expect(client.getQueryState(key)?.status).toBe("error");
      }
    } finally {
      client.clear();
      invoke.mockRestore();
    }
  },
);
