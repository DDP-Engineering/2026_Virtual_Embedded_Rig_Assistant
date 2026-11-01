// @vitest-environment jsdom
// REQ-UX-b93197aa
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Channel, Request, WebDownload } from "@vera/shared";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { api } from "../../api/index.js";
import { DownloadCard } from "./downloads.js";
import "../../i18n.js";

vi.mock("../../api/index.js", async () => {
  const { createMockApi } = await import("../../mocks/mockApi.js");
  return { api: createMockApi(undefined, "chat").api, usingMocks: true };
});
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined, container: HTMLDivElement | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

const downloadId = "f203834e-881c-40da-940d-432276c10d04";
const download: WebDownload = {
  downloadId,
  name: "firmware.zip",
  path: `.vera/downloads/${downloadId}/firmware.zip`,
  sessionId: `ses_${"0".repeat(26)}`,
  callId: "download-1",
  sourceUrl: "https://example.org/firmware.zip",
  finalUrl: "https://cdn.example.org/firmware.zip",
  mime: "application/zip",
  bytes: 6,
  sha256: "a".repeat(64),
  createdAt: "2026-10-30T12:00:00.000Z",
};
async function mount() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root?.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(DownloadCard, { result: JSON.stringify({ download }) }),
      ),
    ),
  );
}
function reveal() {
  const node = container?.querySelector<HTMLButtonElement>("[data-download] button");
  expect(node?.textContent).toBe("Show in Explorer");
  return node as HTMLButtonElement;
}

test("reveals a non-PDF download by id instead of sending its managed .vera path", async () => {
  const spy = vi.spyOn(api, "invoke").mockImplementation((async (channel: Channel, raw: Request<Channel>) => {
    if (channel === "downloads.reveal") return {};
    throw Error(`unexpected ${channel} ${JSON.stringify(raw)}`);
  }) as typeof api.invoke);
  await mount();
  await act(async () => reveal().click());
  expect(spy).toHaveBeenCalledExactlyOnceWith("downloads.reveal", { downloadId });
  expect(spy).not.toHaveBeenCalledWith("app.revealPath", expect.anything());
  expect(container?.querySelector("[role=alert]")).toBeNull();
});

test("shows the main-process refusal when the download cannot be located", async () => {
  await mount();
  await act(async () => reveal().click());
  await act(async () => {
    await new Promise((done) => setTimeout(done, 10));
  });
  expect(container?.querySelector("[data-download]")?.textContent).toContain("was not found");
});
