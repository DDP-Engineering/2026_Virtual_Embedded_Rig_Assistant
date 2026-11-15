// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type SessionSummary, workbenchSchema } from "@vera/shared";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../api/index.js";
import i18n from "../i18n.js";
import { formatBytes, Workbench } from "./workbench.js";

vi.mock("../api/index.js", () => ({ api: { invoke: vi.fn(), subscribe: vi.fn(() => () => {}) } }));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
let root: Root;
let container: HTMLDivElement;
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  vi.clearAllMocks();
});

it("formats sizes in the largest binary unit with localized names", () => {
  expect(formatBytes(undefined, "en")).toBe("—");
  expect(formatBytes(0, "en")).toBe("0 byte");
  expect(formatBytes(1536, "en")).toBe("1.5 kB");
  expect(formatBytes(512 * 1024, "en")).toBe("512 kB");
  expect(formatBytes(2.4 * 1024 * 1024, "de")).toBe("2,4 MB");
});

it("shows each session's stored size in the overview table", async () => {
  await i18n.changeLanguage("en");
  const config = workbenchSchema.parse({ format: 1, id: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C", name: "Bench" });
  const at = "2026-11-15T20:00:00.000Z";
  const sessions = ["ses_a", "ses_b"].map(
    (id) =>
      ({
        id,
        title: id,
        createdAt: at,
        updatedAt: at,
        modelRef: null,
        mode: "ask",
        status: "idle",
        archived: false,
      }) as SessionSummary,
  );
  vi.mocked(api.invoke).mockResolvedValue({ ses_a: 3 * 1024 * 1024 } as never);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        createElement(Workbench, {
          active: { folder: "/bench", config, readOnly: false, warnings: [] },
          changed: vi.fn(),
          closed: vi.fn(),
          sessions,
        }),
      ),
    );
  });
  expect(api.invoke).toHaveBeenCalledWith("session.sizes", { workbenchId: config.id });
  expect([...container.querySelectorAll("th")].map((th) => th.textContent)).toContain("Size");
  await vi.waitFor(() =>
    expect([...container.querySelectorAll("[data-session-size]")].map((td) => td.textContent)).toEqual([
      "3 MB",
      "—",
    ]),
  );
});
