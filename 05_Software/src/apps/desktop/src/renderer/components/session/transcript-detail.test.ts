// @vitest-environment jsdom
// REQ-UX-0165dafe REQ-UX-84087df1 REQ-UX-91b1b112

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { emptySessionState, foldSessionEvents, type SessionState } from "@vera/shared";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../../api/index.js";
import i18n from "../../i18n.js";
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
  await act(async () => i18n.changeLanguage("en"));
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
it("groups consecutive completed external calls without hiding pending approvals or errors", async () => {
  const state = emptySessionState();
  state.items = [
    { ...tool("first"), name: "run_command", args: { command: "echo unique", cwd: "/repo" } },
    { ...tool("second"), name: "run_program" },
    { ...tool("pending", "turn1", "running"), name: "run_command" },
    { ...tool("failed", "turn1", "error"), name: "run_command" },
  ];
  for (const [callId, decision] of [
    ["first", "approved"],
    ["second", "approved"],
    ["pending", null],
    ["failed", "denied"],
  ] as const)
    state.approvals.push({
      approvalId: `approval-${callId}`,
      callId,
      requestSha256: "a".repeat(64),
      tool: "run_command",
      path: callId,
      diff: "",
      bytes: 0,
      decision,
      ...(callId === "first"
        ? {
            program: {
              pluginId: "vera",
              trial: false,
              program: "shell",
              programVersion: null,
              executable: "/bin/bash",
              args: ["echo unique"],
              cwd: "/repo",
              risk: "safe" as const,
              confirm: null,
              files: [],
              notes: [],
            },
          }
        : {}),
    });
  await render(state, "normal");
  const toggle = container.querySelector<HTMLButtonElement>("[data-external-tool-group] .disclosure-toggle");
  expect(toggle?.textContent).toContain("Operations: 2");
  expect(toggle?.getAttribute("aria-expanded")).toBe("false");
  expect(container.querySelector('[data-approval-card="approval-pending"]')).not.toBeNull();
  expect(container.querySelector('[data-tool-row="run_command"]')).not.toBeNull();
  await act(async () => toggle?.click());
  expect(container.querySelectorAll("[data-external-tool-group] [data-tool-row]")).toHaveLength(2);
  expect(container.querySelector("[data-completed-approval-details]")).toBeNull();
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[data-external-tool-group] [data-tool-row="run_command"] button')
      ?.click(),
  );
  const detail = container.querySelector("[data-completed-approval-details]");
  expect(detail?.textContent).toContain("/bin/bash");
  expect(detail?.textContent).toContain("/repo");
  expect(
    container.querySelectorAll("[data-completed-approval-details] [data-approval-command]"),
  ).toHaveLength(1);
  expect(container.querySelector("[data-external-tool-group] .tool-command")).toBeNull();
  await render(state, "verbose");
  expect(container.querySelector("[data-external-tool-group]")).toBeNull();
});

it("treats calls the mode approved automatically as routine, but keeps user decisions visible", async () => {
  const state = fixture();
  const approval = (callId: string, by: "mode" | "user") => ({
    approvalId: `grant-${callId}`,
    callId,
    requestSha256: "a".repeat(64),
    tool: "run_program" as const,
    path: "",
    diff: "",
    bytes: 0,
    decision: "approved" as const,
    by,
  });
  state.approvals.push(approval("one", "mode"), approval("two", "user"));
  await render(state, "minimal");
  // "one" was approved by auto mode: routine, hidden; "two" was approved by the user: still shown.
  expect(container.querySelectorAll('[data-message-kind="tool"]')).toHaveLength(1);
  expect(container.querySelectorAll(".completed-approval .disclosure-toggle")).toHaveLength(1);
  await render(state, "normal");
  // The auto-approved call joins the routine group; the user-approved one stays on its own.
  expect(container.querySelectorAll("[data-tool-group]").length).toBeGreaterThan(0);
  expect(container.querySelectorAll('[data-message-kind="tool"]')).toHaveLength(1);
  await render(state, "verbose");
  expect(container.querySelectorAll('[data-message-kind="tool"]')).toHaveLength(3);
});
it("keeps an irreversible program approved by the mode visible at every detail level", async () => {
  const state = fixture();
  // A completed run_program call would otherwise join a collapsed external group.
  state.items = state.items.map((item) => (item.id === "one" ? { ...item, name: "run_program" } : item));
  state.approvals.push({
    approvalId: "grant-one",
    callId: "one",
    requestSha256: "a".repeat(64),
    tool: "run_program",
    path: "scpi",
    diff: "",
    bytes: 0,
    decision: "approved",
    by: "mode",
    program: {
      pluginId: "scpi-instruments",
      trial: false,
      program: "scpi",
      programVersion: "0.2.0",
      executable: "/opt/uv",
      args: ["output", "--hold", "60"],
      cwd: ".",
      risk: "irreversible",
      confirm: "output",
      notes: ["Turns on a physical output."],
      files: [],
    },
  } as unknown as SessionState["approvals"][number]);
  for (const detail of ["minimal", "normal"] as const) {
    await render(state, detail);
    const toggle = container.querySelector<HTMLButtonElement>(".completed-approval .disclosure-toggle");
    expect(toggle).not.toBeNull();
    if (toggle?.getAttribute("aria-expanded") === "false") await act(async () => toggle.click());
    expect(container.querySelectorAll('[data-approval-card][data-risk="irreversible"]')).toHaveLength(1);
  }
});
it("shows per-question usage only at the verbose detail level", async () => {
  const state = fixture();
  state.items[0] = {
    kind: "user",
    id: "u",
    text: "Question",
    usage: { inputTokens: 7077, outputTokens: 435, contextTokens: 20, contextWindow: 1000, estimated: true },
  };
  for (const detail of ["minimal", "normal"] as const) {
    await render(state, detail);
    expect(container.querySelector("[data-prompt-usage]")).toBeNull();
  }
  await render(state, "verbose");
  expect(container.querySelectorAll("[data-prompt-usage]")).toHaveLength(1);
  expect(container.querySelector("[data-prompt-usage]")?.textContent).toContain("7,077");
});
// REQ-UX-8ec4dc82
it.each(["en", "ro"])("shows the send date and time to the minute at verbose in %s", async (language) => {
  // 2026-11-20 17:54:37 local time; the seconds must not show.
  const sent = new Date(2026, 10, 20, 17, 54, 37).getTime();
  const state = fixture();
  state.items = [
    { kind: "user", id: "u1", text: "Timed", timestamp: sent, usage: { inputTokens: 10, outputTokens: 2 } },
    { kind: "user", id: "u2", text: "Just sent", timestamp: sent + 60_000 },
    { kind: "user", id: "u3", text: "Recorded before send times", usage: { inputTokens: 5 } },
  ];
  for (const detail of ["minimal", "normal"] as const) {
    await render(state, detail);
    expect(container.querySelector("[data-prompt-usage]")).toBeNull();
    expect(container.querySelector("[data-prompt-time]")).toBeNull();
  }
  await render(state, "verbose");
  // The render helper starts in English; the line follows a language switch.
  await act(async () => {
    await i18n.changeLanguage(language);
  });
  const format = new Intl.DateTimeFormat(language, { dateStyle: "short", timeStyle: "short" });
  const users = [...container.querySelectorAll('[data-message-kind="user"]')];
  const time = (id: string) => users[Number(id.slice(1)) - 1]?.querySelector("[data-prompt-time]");
  expect(users).toHaveLength(3);
  expect(time("u1")?.textContent).toBe(format.format(sent));
  expect(time("u1")?.getAttribute("datetime")).toBe(new Date(sent).toISOString());
  expect(time("u1")?.textContent).not.toContain("37");
  expect(time("u2")?.textContent).toBe(format.format(sent + 60_000));
  expect(time("u3")).toBeNull();
  expect(container.querySelectorAll("[data-prompt-usage]")).toHaveLength(3);
  await act(async () => i18n.changeLanguage("en"));
});
it("switches levels reversibly without mutating history", async () => {
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
    // Collapsed details are not mounted (PERF-03): the failed row is found by its title.
    const failed = [...container.querySelectorAll('[data-tool-row="read"]')].find((n) =>
      n.textContent?.includes("failed.txt"),
    );
    expect(failed).toBeDefined();
    expect(failed?.closest("[data-tool-group]")).toBeNull();
    await act(async () => userEvent.setup().click(failed?.querySelector("button") as HTMLButtonElement));
    expect(failed?.textContent).toContain("output-failed");
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
// REQ-UX-4f1c85d5
it("shows a cut tool output as an excerpt and loads the full text on request", async () => {
  const full = "y".repeat(65536);
  vi.mocked(api.invoke).mockResolvedValue({ text: full });
  const state = fixture();
  state.items[1] = { ...tool("one"), preview: full.slice(0, 8192), truncated: { preview: 65536 } };
  await render(state, "verbose");
  for (const toggle of container.querySelectorAll<HTMLButtonElement>(".disclosure-toggle"))
    await act(async () => toggle.click());
  const buttons = () => [...container.querySelectorAll<HTMLButtonElement>("button[data-show-full]")];
  // Only the cut field gets a button; small previews and arguments do not.
  expect(buttons().map((b) => b.textContent)).toEqual(["Show full output (64 KB)"]);
  expect(container.textContent).toContain(full.slice(0, 8192));
  expect(container.textContent).not.toContain(full);
  await act(async () => buttons()[0]?.click());
  expect(api.invoke).toHaveBeenCalledExactlyOnceWith("session.item.detail", {
    sessionId: "session",
    itemId: "one",
    field: "preview",
  });
  expect(container.textContent).toContain(full);
  expect(buttons()).toHaveLength(0);
});

it("renders rate-limit errors with and without a Retry-After hint", async () => {
  const error = {
    type: "error",
    code: "PROVIDER",
    messageKey: "provider.rateLimit",
    retryable: false,
  } as const;
  const state = foldSessionEvents([error, { ...error, retryAfter: "12" }]);
  await render(state, "normal");
  expect([...container.querySelectorAll('[role="alert"]')].map((node) => node.textContent)).toEqual([
    "Provider rate limit.",
    "Provider rate limit. Retry after: 12.",
  ]);
});

it.each(["minimal", "normal", "verbose"] as const)(
  "keeps a single saved document search notice on the affected turn in %s detail",
  async (detail) => {
    const state = fixture();
    state.items.splice(
      2,
      0,
      {
        ...tool("partial"),
        name: "search_docs",
        documentSearch: {
          coverage: "partial",
          usage: { mode: "keyword", fallbackReason: "embedding-rebuild" },
        },
      },
      {
        ...tool("no-matches"),
        name: "search_docs",
        documentSearch: {
          coverage: "partial",
          usage: { mode: null, reason: "no-candidates" },
        },
      },
      {
        ...tool("later-complete", "turn2"),
        name: "search_docs",
        documentSearch: {
          coverage: "complete",
          usage: { mode: null, reason: "no-candidates" },
        },
      },
    );
    state.items.push({
      ...tool("unavailable", "turn3"),
      name: "search_docs",
      documentSearch: {
        coverage: "unknown",
        usage: { mode: null, reason: "revision-conflict" },
      },
    });
    await render(state, detail);
    const notices = Array.from(container.querySelectorAll("[data-retrieval-notice]"));
    expect(notices.map((notice) => notice.getAttribute("data-retrieval-notice"))).toEqual(["turn1", "turn3"]);
    expect(notices[0]?.textContent).toMatch(/pending or excluded sources/i);
    expect(notices[0]?.textContent).toMatch(/keyword/i);
    expect(notices[1]?.textContent).toMatch(/unavailable/i);
  },
);
