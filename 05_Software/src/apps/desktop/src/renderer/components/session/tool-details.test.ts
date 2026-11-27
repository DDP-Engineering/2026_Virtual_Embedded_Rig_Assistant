// @vitest-environment jsdom
import userEvent from "@testing-library/user-event";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../../api/index.js";
import i18n from "../../i18n.js";
import { ToolDetails } from "./tool-details.js";
import type { ToolItem } from "./transcript-projection.js";

vi.mock("../../api/index.js", () => ({ api: { invoke: vi.fn().mockResolvedValue({}) } }));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  await i18n.changeLanguage("en");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});
const tool = (overrides: Partial<ToolItem> = {}): ToolItem => ({
  kind: "tool",
  id: "call",
  turnId: "turn",
  name: "help",
  args: { page: "chat-and-sessions" },
  status: "ok",
  summary: JSON.stringify({
    title: "Chat and sessions",
    text: "Help content",
    ref: "help:chat-and-sessions",
  }),
  durationMs: 9,
  ...overrides,
});
const render = (item: ToolItem) =>
  act(async () => root.render(createElement(ToolDetails, { item, sessionId: "session", update: undefined })));
const expand = () =>
  act(async () => container.querySelector<HTMLButtonElement>(".tool-activity > button")?.click());
const technical = () =>
  act(async () => container.querySelector<HTMLButtonElement>(".tool-technical > button")?.click());

it.each(["en", "ro", "de", "fr"])(
  "renders actual plan steps and translated status in %s before technical data",
  async (lang) => {
    await i18n.changeLanguage(lang);
    const items = [
      { text: "Exemplu: stabilește obiectivul.", status: "done" },
      { text: "Exemplu: verifică pașii necesari.", status: "in_progress" },
      { text: "Exemplu: prezintă rezultatul.", status: "pending" },
    ];
    await render(tool({ name: "todo", args: { items }, summary: JSON.stringify({ items }) }));
    expect(container.querySelector(".tool-activity-title")?.textContent).toContain("3");
    await expand();
    expect([...container.querySelectorAll(".plan-text")].map((node) => node.textContent)).toEqual(
      items.map((item) => item.text),
    );
    expect([...container.querySelectorAll(".plan-status")].map((node) => node.textContent)).toEqual([
      i18n.t("plan.done"),
      i18n.t("plan.inProgress"),
      i18n.t("plan.pending"),
    ]);
    expect(container.querySelector(".tool-technical pre")).toBeNull();
    expect(container.textContent).not.toContain("toolActivity.");
  },
);

it.each(["en", "ro", "de", "fr"])("localizes the embedding rebuild notice in %s", async (language) => {
  await i18n.changeLanguage(language);
  await render(
    tool({
      name: "search_docs",
      args: { query: "coolant" },
      documentSearch: {
        coverage: "partial",
        usage: { mode: "keyword", fallbackReason: "embedding-rebuild" },
      },
      summary: JSON.stringify({
        message: "Embedding vectors are being rebuilt; these are keyword results.",
        results: [{ path: "docs/coolant.txt" }],
      }),
    }),
  );
  await expand();
  expect(container.querySelector(".tool-activity-body > pre")?.textContent).toBe(
    i18n.t("toolActivity.embeddingRebuild"),
  );
});

it("reports a cleared plan and leaves invalid or refused plan data in technical details", async () => {
  await render(tool({ name: "todo", args: { items: [] }, summary: '{"items":[]}' }));
  expect(container.querySelector(".tool-activity-title")?.textContent).toContain("Plan cleared");
  await expand();
  expect(container.querySelectorAll(".plan-text")).toHaveLength(0);
  for (const override of [
    { status: "error" as const, summary: "Permission denied" },
    { status: "ok" as const, summary: '{"items":[{"text":"Bad status","status":"wrong"}]}' },
  ]) {
    await render(
      tool({ name: "todo", args: { items: [{ text: "Not applied", status: "done" }] }, ...override }),
    );
    expect(container.querySelectorAll(".plan-text")).toHaveLength(0);
  }
});

it.each([
  ["en", "Read VERA help", "Technical details"],
  ["ro", "Consultare documentație VERA", "Detalii tehnice"],
  ["de", "VERA-Hilfe lesen", "Technische Details"],
  ["fr", "Consultation de l’aide VERA", "Détails techniques"],
])(
  "describes help in %s and opens its readable result before raw technical details",
  async (lang, action, label) => {
    await i18n.changeLanguage(lang);
    const item = tool();
    await render(item);
    const toggle = container.querySelector<HTMLButtonElement>(".tool-activity > button") as HTMLButtonElement;
    expect(toggle.textContent).toContain(action);
    expect(toggle.textContent).toContain("Chat and sessions");
    expect(container.querySelector(".tool-activity-body")).toBeNull();
    toggle.focus();
    await act(async () => userEvent.setup().keyboard("{Enter}"));
    expect(container.querySelector(".tool-activity-body > pre")?.textContent).toBe("Help content");
    expect(container.querySelector(".tool-technical > button")?.textContent).toBe(label);
    expect(container.querySelector(".tool-technical pre")).toBeNull();
    await technical();
    expect(container.querySelector(".tool-technical")?.textContent).toContain('"page": "chat-and-sessions"');
    expect(container.querySelector(".tool-technical")?.textContent).toContain(item.summary);
    expect(container.querySelector(".tool-technical")?.textContent).toContain("9 ms");
    expect(api.invoke).not.toHaveBeenCalled();
  },
);

it.each([
  [{ exitCode: 0, output: "README content" }, "ok", "Completed"],
  [{ exitCode: 2, output: "Syntax error" }, "error", "Error"],
  [{ timedOut: true, exitCode: null, output: "Partial output" }, "error", "Timed out"],
  [{ handle: "run-1" }, "ok", "Started in background"],
  [{ running: true, output: "Partial output" }, "ok", "Program still running"],
  [{ stopped: true, exitCode: -15 }, "ok", "Stopped"],
] as const)(
  "presents program outcome %j without confusing tool completion with command success",
  async (result, status, label) => {
    const command = 'Get-Content "folder with spaces/README.md" -TotalCount 10';
    await render(
      tool({
        name: "run_command",
        args: { command, cwd: "folder with spaces" },
        summary: JSON.stringify(result),
      }),
    );
    expect(container.querySelector("[data-tool-status]")?.getAttribute("data-tool-status")).toBe(status);
    expect(container.querySelector(".tool-activity-status")?.textContent).toBe(label);
    await expand();
    expect(container.querySelector(".tool-command")?.textContent).toBe(command);
    expect(container.querySelector(".tool-activity-body")?.textContent).toContain(
      "Folder: folder with spaces",
    );
    if ("output" in result)
      expect(container.querySelector(".tool-activity-body")?.textContent).toContain(result.output);
  },
);

it("shows the configured duration in the localized web download timeout", async () => {
  await i18n.changeLanguage("ro");
  await render(
    tool({
      name: "web_download",
      status: "error",
      summary: JSON.stringify({
        isError: true,
        timedOut: true,
        timeoutSeconds: 120,
        error: "Download timed out",
      }),
    }),
  );
  await expand();
  expect(container.querySelector(".tool-activity-body")?.textContent).toContain(
    "Descărcarea a depășit limita de 120 s.",
  );
});

it.each([undefined, "", " \n\t"])(
  "omits blank program output %j while retaining technical details",
  async (output) => {
    const summary = JSON.stringify({ running: true, output });
    await render(tool({ name: "program_output", args: { handle: "run-1" }, summary }));
    expect(container.querySelector(".tool-activity-status")?.textContent).toBe("Program still running");
    await expand();
    expect(container.querySelector(".tool-activity-body > pre")).toBeNull();
    expect(container.querySelector(".tool-technical > button")).not.toBeNull();
    await technical();
    expect(container.querySelector(".tool-technical")?.textContent).toContain(summary);
  },
);

it("omits blank plain previews and preserves whitespace around meaningful output", async () => {
  await render(tool({ name: "unknown_extension", summary: " \n\t" }));
  await expand();
  expect(container.querySelector(".tool-activity-body > pre")).toBeNull();
  const output = " \n  Listening on port 3000.\n";
  await render(tool({ name: "program_output", summary: JSON.stringify({ running: true, output }) }));
  expect(container.querySelector(".tool-activity-body > pre")?.textContent).toBe(output);
});

it("shows returned search counts, change counts and readable errors without inventing unknown output", async () => {
  await render(
    tool({ name: "search_docs", args: { query: "pinout" }, summary: JSON.stringify({ results: [] }) }),
  );
  expect(container.querySelector(".tool-activity-title")?.textContent).toContain("Search documentation");
  expect(container.querySelector(".tool-activity-target")?.textContent).toBe("pinout");
  expect(container.querySelector(".tool-activity-caption")?.textContent).toBe("Results: 0");
  await render(
    tool({ name: "edit", args: { path: "main.cpp" }, summary: JSON.stringify({ added: 12, removed: 4 }) }),
  );
  expect(container.querySelector(".tool-activity-caption")?.textContent).toBe("Lines: +12 / −4");
  await render(
    tool({ name: "read", args: { path: "missing.txt" }, status: "error", summary: "File not found" }),
  );
  await expand();
  expect(container.querySelector(".tool-activity-body > pre")?.textContent).toBe("File not found");
});

it("shows that a file was saved even while change history is pending", async () => {
  await render(
    tool({
      name: "edit",
      args: { path: "main.cpp" },
      summary: JSON.stringify({ added: 1, removed: 1, historyPending: true }),
    }),
  );
  expect(container.querySelector(".tool-activity-caption")?.textContent).toBe(
    "File saved. Change history pending.",
  );
  expect(container.querySelector("[data-tool-status]")?.getAttribute("data-tool-status")).toBe("ok");
});

it("keeps unfamiliar, malformed and oversized results available in technical details", async () => {
  for (const summary of ['{"unfinished":', JSON.stringify({ opaque: [1, 2] }), "x".repeat(70000)]) {
    await render(tool({ name: "unknown_extension", args: null, summary }));
    const toggle = container.querySelector<HTMLButtonElement>(".tool-activity > button") as HTMLButtonElement;
    expect(toggle.textContent).toContain("Tool operation");
    if (toggle.getAttribute("aria-expanded") === "false") await expand();
    const details = container.querySelector<HTMLButtonElement>(
      ".tool-technical > button",
    ) as HTMLButtonElement;
    if (details.getAttribute("aria-expanded") === "false") await technical();
    expect(container.querySelector(".tool-technical")?.textContent).toContain(summary);
  }
});

it("loads exact cut arguments on demand and keeps result text inert", async () => {
  const full = '{"command":"echo exact command"}';
  vi.mocked(api.invoke).mockResolvedValue({ text: full });
  await render(
    tool({
      name: "run_command",
      args: '{"command":"echo',
      truncated: { args: 64000 },
      summary: JSON.stringify({ exitCode: 0, output: '<img src=x onerror="alert(1)">' }),
    }),
  );
  await expand();
  expect(container.querySelector(".tool-activity-body > pre")?.textContent).toContain("<img");
  expect(container.querySelector("img")).toBeNull();
  await technical();
  await act(async () => container.querySelector<HTMLButtonElement>('[data-show-full="args"]')?.click());
  expect(api.invoke).toHaveBeenCalledExactlyOnceWith("session.item.detail", {
    sessionId: "session",
    itemId: "call",
    field: "args",
  });
  expect(container.querySelector(".tool-technical")?.textContent).toContain(full);
});
