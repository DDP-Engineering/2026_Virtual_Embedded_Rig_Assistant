// @vitest-environment jsdom
// REQ-UX-0165dafe REQ-UX-84087df1 REQ-UX-91b1b112

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { emptySessionState, type SessionState } from "@vera/shared";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../../api/index.js";
import i18n from "../../i18n.js";
import { ActivityLog } from "./session-inspector.js";
import { Transcript } from "./transcript.js";

vi.mock("../../api/index.js", () => ({ api: { invoke: vi.fn().mockResolvedValue({}) } }));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
const tool = (id: string, turnId: string | null = "turn1", status: "ok" | "running" | "error" = "ok") =>
  ({
    kind: "tool",
    id,
    turnId,
    name: "read",
    args: { path: `${id}.txt` },
    status,
    preview: `output-${id}`,
  }) as const;
const fixture = (): SessionState => ({
  ...emptySessionState(),
  items: [
    { kind: "user", id: "u", text: "Question" },
    tool("one"),
    tool("two"),
    { kind: "assistant", id: "a", turnId: "turn1", text: "Answer", streaming: false, citations: [] },
    tool("three", "turn2"),
  ],
});
async function render(state: SessionState, detail: "verbose" | "normal" | "minimal", retry = vi.fn()) {
  await i18n.changeLanguage("en");
  if (!container) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    client = new QueryClient();
  }
  await act(async () =>
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(Transcript, {
          state,
          detail,
          reasoning: { turn1: "Live reasoning" },
          updates: { two: "Live update" },
          retry,
          search: "Answer",
          sessionId: "session",
        }),
      ),
    ),
  );
}
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  container = undefined as never;
  vi.clearAllMocks();
  client?.clear();
});
it("normal groups consecutive same-turn tools without moving conversation, keyboard expands details", async () => {
  const state = fixture();
  state.items.splice(2, 0, {
    kind: "assistant",
    id: "empty-tool-step",
    turnId: "turn1",
    text: "",
    streaming: false,
    citations: [],
  });
  state.items.splice(2, 0, tool("running", "turn1", "running"));
  await render(state, "normal");
  const groups = container.querySelectorAll("[data-tool-group]");
  expect(groups).toHaveLength(2);
  const toggle = groups[0]?.querySelector("button") as HTMLButtonElement;
  expect(toggle.textContent).toContain("Operations: 3");
  expect(toggle.textContent).toContain("Running");
  expect(toggle.textContent).not.toContain("one.txt");
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  toggle.focus();
  await act(async () => userEvent.setup().keyboard("{Enter}"));
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(groups[0]?.textContent).toContain("one.txt");
  expect(
    [
      ...container.querySelectorAll(
        "[data-message-kind=user] .markdown, [data-message-kind=assistant] .markdown",
      ),
    ].map((n) => n.textContent),
  ).toEqual(["Question", "Answer"]);
  expect(container.querySelector("[data-search-match=true]")).not.toBeNull();
  expect(container.querySelector(".reasoning")).toBeNull();
});
it("switches levels reversibly without mutating history and keeps complete Activity", async () => {
  const state = fixture(),
    before = JSON.stringify(state);
  await render(state, "minimal");
  expect(container.querySelector("[data-tool-row]")).toBeNull();
  expect(container.querySelector("[data-tool-group]")).toBeNull();
  expect(container.textContent).not.toContain("one.txt");
  await render(state, "verbose");
  expect(container.querySelectorAll("[data-tool-row]")).toHaveLength(3);
  expect(container.querySelector(".reasoning")).not.toBeNull();
  await render(state, "normal");
  expect(container.querySelectorAll("[data-tool-group]")).toHaveLength(2);
  await act(async () =>
    root.render(createElement(ActivityLog, { state, reasoning: { turn1: "Live reasoning" }, updates: {} })),
  );
  expect(container.querySelectorAll('[data-activity-kind="tool"]')).toHaveLength(3);
  expect(container.textContent).toContain("Live reasoning");
  expect(JSON.stringify(state)).toBe(before);
});
it.each(["minimal", "normal", "verbose"] as const)(
  "keeps approvals, failed tools, Retry and stopped status visible in %s",
  async (detail) => {
    const state = fixture(),
      retry = vi.fn();
    state.items.push(tool("failed", "turn2", "error"), {
      kind: "error",
      id: "e",
      code: "CONTEXT_LIMIT",
      messageKey: "errors.CONTEXT_LIMIT",
      retryable: true,
    });
    state.approvals.push({
      approvalId: "grant",
      callId: "one",
      requestSha256: "a".repeat(64),
      tool: "write",
      path: "one.txt",
      diff: "+exact change",
      bytes: 12,
      decision: null,
    });
    state.turns.push({ turnId: "turn2", steps: 2, stopReason: "aborted" });
    await render(state, detail, retry);
    expect(container.querySelector("[data-approval-card]")?.closest("[hidden]")).toBeNull();
    const failed = [...container.querySelectorAll('[data-tool-row="read"]')].find((n) =>
      n.textContent?.includes("output-failed"),
    );
    expect(failed).toBeDefined();
    expect(failed?.closest("[data-tool-group]")).toBeNull();
    expect(container.textContent).toContain("Stopped");
    const buttons = [...container.querySelectorAll<HTMLButtonElement>("button")];
    await act(async () =>
      userEvent.setup().click(buttons.find((b) => b.textContent === "Retry") as HTMLButtonElement),
    );
    expect(retry).toHaveBeenCalledOnce();
    await act(async () =>
      userEvent.setup().click(buttons.find((b) => b.textContent === "Approve") as HTMLButtonElement),
    );
    expect(vi.mocked(api.invoke).mock.calls[0]).toEqual([
      "session.approval.decide",
      expect.objectContaining({ requestSha256: "a".repeat(64), approvalId: "grant" }),
    ]);
  },
);
it("minimal shows one working status only while active, including before any tool starts", async () => {
  const state = emptySessionState();
  state.status = "running";
  state.activeTurnId = "turn";
  await render(state, "minimal");
  expect(container.querySelector("[data-chat-working]")?.textContent).toContain("VERA is working");
  state.status = "idle";
  state.activeTurnId = null;
  await render(state, "minimal");
  expect(container.querySelector("[data-chat-working]")).toBeNull();
});
it.each(["minimal", "normal"] as const)("keeps downloads directly actionable in %s", async (detail) => {
  const state = fixture();
  state.items.push({
    ...tool("download"),
    name: "web_download",
    preview: JSON.stringify({
      download: {
        downloadId: "abcdef01-1234-4321-8123-0123456789ab",
        sessionId: "ses_01JB8Z6Q4M7N2K5R9T3V8X1Y0C",
        callId: "download",
        name: "manual.txt",
        path: ".vera/downloads/abcdef01-1234-4321-8123-0123456789ab/manual.txt",
        sourceUrl: "https://example.com/manual.txt",
        finalUrl: "https://example.com/manual.txt",
        mime: "text/plain",
        bytes: 12,
        sha256: "a".repeat(64),
        createdAt: "2026-11-04T00:00:00Z",
      },
    }),
  });
  await render(state, detail);
  const download = container.querySelector("[data-download]");
  expect(download).not.toBeNull();
  expect(download?.closest("[hidden]")).toBeNull();
  await act(async () => userEvent.setup().click(download?.querySelector("button") as HTMLButtonElement));
  expect(vi.mocked(api.invoke)).toHaveBeenCalledWith("downloads.reveal", {
    downloadId: "abcdef01-1234-4321-8123-0123456789ab",
  });
});
it("normal never groups unknown or distinct turns and separates errors", async () => {
  const state = emptySessionState();
  state.items.push(tool("one", null), tool("two", null), tool("three", "t1"), tool("four", "t2"));
  await render(state, "normal");
  expect(container.querySelectorAll("[data-tool-group]")).toHaveLength(4);
});
