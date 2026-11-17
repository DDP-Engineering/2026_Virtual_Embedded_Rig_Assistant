// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { api } from "../../api/index.js";
import "../../i18n.js";
import { DocumentTabs } from "./document-tabs.js";
import { readTextFile } from "./read-text-file.js";
import { DocumentViewerProvider, useDocumentViewer } from "./viewer-context.js";

vi.mock("../../api/index.js", async () => {
  const { createMockApi } = await import("../../mocks/mockApi.js");
  return { api: createMockApi(undefined, "chat").api };
});
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
const id = "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C";

// REQ-FUNC-c5def0c3 REQ-REL-3bb0b405
it("assembles bounded masked text windows and refuses inconsistent byte replies", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const bytes = new Uint8Array(1024 * 1024 + 6).fill(0x20);
  bytes.set([0xff, 0xfe, 0xe9, 0]);
  let failure = "";
  let statReads = 0;
  const original = api.invoke.bind(api);
  const invoke = vi.spyOn(api, "invoke").mockImplementation((async (channel: string, input: unknown) => {
    const request = input as { offset: number; length: number };
    if (channel === "docs.stat") {
      statReads++;
      return {
        workbenchId: id,
        properties: {
          path: "sample.txt",
          extension: ".txt",
          rendered: false,
          type: "file",
          size: failure === "large" ? 5 * 1024 * 1024 + 1 : bytes.length,
          modified:
            failure === "modified" && statReads > 2 ? "2026-11-17T00:00:01.000Z" : "2026-11-17T00:00:00.000Z",
        },
      };
    }
    if (channel === "docs.read") throw { code: "INVALID", messageKey: "documents.textBinary" };
    if (channel === "docs.readBytes") {
      const part = bytes.slice(request.offset, request.offset + request.length);
      return {
        workbenchId: failure === "owner" ? "other" : id,
        path: failure === "path" ? "other.txt" : "sample.txt",
        offset: request.offset + (failure === "offset" ? 1 : 0),
        size: bytes.length + (failure === "size" ? 2 : 0),
        data: btoa(
          Array.from(failure === "short" ? part.subarray(0, 1) : part, (byte) =>
            String.fromCharCode(byte),
          ).join(""),
        ),
      };
    }
    return original(channel as never, input as never);
  }) as typeof api.invoke);
  function Open() {
    const open = useDocumentViewer();
    return createElement(
      "button",
      { type: "button", onClick: () => open?.({ textPath: "sample.txt" }) },
      "Open",
    );
  }
  const open = () => act(async () => container.querySelector<HTMLButtonElement>("button")?.click());
  try {
    await act(async () =>
      root.render(
        createElement(
          QueryClientProvider,
          { client },
          createElement(
            DocumentViewerProvider,
            { workbenchId: id },
            createElement(Open),
            createElement(DocumentTabs, { chat: null }),
          ),
        ),
      ),
    );
    await open();
    expect(container.querySelector('[data-line="1"]')?.textContent).toContain("é");
    const reads = invoke.mock.calls.filter(([name]) => name === "docs.readBytes");
    expect(reads.map(([, request]) => request)).toEqual([
      { workbenchId: id, path: "sample.txt", offset: 0, length: 4096 },
      { workbenchId: id, path: "sample.txt", offset: 0, length: 1024 * 1024 },
      { workbenchId: id, path: "sample.txt", offset: 1024 * 1024, length: 6 },
    ]);
    for (failure of ["owner", "path", "offset", "size", "short", "modified"]) {
      statReads = 0;
      await open();
      expect(container.querySelector('[data-line="1"]'), failure).toBeNull();
      expect(container.querySelector('[role="alert"]'), failure).not.toBeNull();
    }
  } finally {
    invoke.mockRestore();
    await act(async () => root.unmount());
    client.clear();
    container.remove();
  }
});

it("reads empty files and opens large ordinary text as a bounded source descriptor", async () => {
  let size = 0;
  const spy = vi.spyOn(api, "invoke").mockImplementation((async (channel: string) => {
    if (channel === "docs.stat")
      return {
        workbenchId: id,
        properties: { path: "sample.txt", type: "file", size, modified: "2026-11-17T00:00:00.000Z" },
      };
    if (channel === "docs.readBytes")
      return { workbenchId: id, path: "sample.txt", size, offset: 0, data: size ? "77u/eA==" : "" };
    throw Error(channel);
  }) as typeof api.invoke);
  try {
    expect((await readTextFile(id, "sample.txt")).textBytes?.length).toBe(0);
    expect(spy).toHaveBeenCalledWith("docs.readBytes", {
      workbenchId: id,
      path: "sample.txt",
      offset: 0,
      length: 1,
    });
    size = 6 * 1024 * 1024;
    spy.mockClear();
    const existing = {
      kind: "text" as const,
      path: "sample.txt",
      ref: null,
      snippet: "",
      lines: ["verified extraction"],
      start: 1,
      end: 1,
    };
    const result = await readTextFile(id, "sample.txt", existing);
    expect(result.content.lines).toEqual([]);
    expect(result).toHaveProperty("largeText", {
      workbenchId: id,
      path: "sample.txt",
      size,
      modified: "2026-11-17T00:00:00.000Z",
      encoding: "utf-8",
    });
    expect(spy.mock.calls.filter(([channel]) => channel === "docs.readBytes")).toHaveLength(1);
  } finally {
    spy.mockRestore();
  }
});
