// @vitest-environment jsdom
// REQ-UX-73dd7a9b
import type { SessionState } from "@vera/shared";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../../api/index.js";
import i18n from "../../i18n.js";
import { ApprovalCard } from "./approval-card.js";

vi.mock("../../api/index.js", () => ({ api: { invoke: vi.fn() } }));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
});

it.each(["en", "ro", "de", "fr"])("sends only an explicit chosen user prefix in %s", async (language) => {
  await i18n.changeLanguage(language);
  const approval = {
    approvalId: "apv",
    callId: "call",
    requestSha256: "a".repeat(64),
    tool: "run_command",
    path: "shell",
    diff: "",
    bytes: 0,
    decision: null,
    program: {
      pluginId: "vera",
      trial: false,
      program: "shell",
      programVersion: null,
      executable: "/bin/bash",
      args: ["npm test"],
      cwd: "/repo",
      risk: "device-write",
      confirm: null,
      files: [],
      notes: [],
    },
  } as SessionState["approvals"][number];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root?.render(createElement(ApprovalCard, { approval, sessionId: "s", disabled: false })),
  );
  expect(container.querySelector("[data-command-always-allow]")).toBeNull();
  await act(async () =>
    root?.render(
      createElement(ApprovalCard, { approval, sessionId: "s", disabled: false, canSavePrefix: true }),
    ),
  );
  const button = container.querySelector<HTMLButtonElement>("[data-command-always-allow]");
  expect(button?.textContent).toBe(i18n.t("approval.alwaysAllow"));
  expect(container.querySelector<HTMLSelectElement>("[data-command-prefix]")?.value).toBe("npm test");
  await act(async () => button?.click());
  expect(api.invoke).toHaveBeenLastCalledWith("session.approval.decide", {
    sessionId: "s",
    approvalId: "apv",
    requestSha256: "a".repeat(64),
    decision: "approved",
    commandPrefix: "npm test",
  });
});

it("decides with A and D on the card, never while the prefix list has the key", async () => {
  const approval = {
    approvalId: "apv",
    callId: "call",
    requestSha256: "a".repeat(64),
    tool: "run_command",
    path: "shell",
    diff: "",
    bytes: 0,
    decision: null,
    program: {
      pluginId: "vera",
      trial: false,
      program: "shell",
      programVersion: null,
      executable: "/bin/bash",
      args: ["apt list"],
      cwd: "/repo",
      risk: "device-write",
      confirm: null,
      files: [],
      notes: [],
    },
  } as SessionState["approvals"][number];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root?.render(
      createElement(ApprovalCard, { approval, sessionId: "s", disabled: false, canSavePrefix: true }),
    ),
  );
  vi.mocked(api.invoke).mockClear();
  const press = (target: Element | null | undefined, key: string) =>
    act(async () => {
      target?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    });
  const prefixes = container.querySelector("[data-command-prefix]");
  expect(prefixes).not.toBeNull();
  await press(prefixes, "a");
  await press(prefixes, "d");
  expect(api.invoke).not.toHaveBeenCalled();
  await press(container.querySelector("[data-approval-card]"), "a");
  expect(api.invoke).toHaveBeenCalledTimes(1);
  expect(api.invoke).toHaveBeenLastCalledWith(
    "session.approval.decide",
    expect.objectContaining({ approvalId: "apv", decision: "approved" }),
  );
});

it.each(["en", "ro", "de", "fr"])(
  "shows a literal shell command, cwd and shell with approve/deny in %s",
  async (language) => {
    await i18n.changeLanguage(language);
    const approval: SessionState["approvals"][number] = {
      approvalId: "command",
      callId: "call",
      requestSha256: "a".repeat(64),
      tool: "run_command",
      path: "shell",
      bytes: 0,
      diff: "",
      decision: null,
      program: {
        pluginId: "vera",
        trial: false,
        program: "shell",
        programVersion: null,
        executable: "/bin/bash",
        args: ["node -e \"console.log('hello')\""],
        cwd: "/repo with spaces",
        risk: "device-write",
        confirm: null,
        files: [],
        notes: [],
      },
    };
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
      root?.render(createElement(ApprovalCard, { approval, sessionId: "s", disabled: false })),
    );
    expect(container.querySelector("[data-approval-command]")?.textContent).toBe(approval.program?.args[0]);
    expect(container.textContent).toContain("/repo with spaces");
    expect(container.textContent).toContain("/bin/bash");
    expect(container.textContent).toContain(i18n.t("settings.commandShell"));
    expect([...container.querySelectorAll("button")].map((button) => button.textContent)).toEqual([
      i18n.t("approval.approve"),
      i18n.t("approval.deny"),
    ]);
  },
);

it.each([
  ["run_program", "approved"],
  ["run_program", "denied"],
  ["run_program", "aborted"],
  ["run_command", "approved"],
  ["run_command", "denied"],
  ["run_command", "aborted"],
])("collapses completed %s approvals with decision %s only", async (tool, decision) => {
  const approval = {
    approvalId: "completed",
    callId: "call",
    requestSha256: "a".repeat(64),
    tool,
    path: "shell",
    diff: "",
    bytes: 0,
    decision,
    by: "user",
    program: {
      pluginId: "example",
      trial: false,
      program: "shell",
      programVersion: null,
      executable: "/bin/bash",
      args: ["echo hello"],
      cwd: "/repo",
      risk: "safe",
      confirm: null,
      files: [],
      notes: [],
    },
  } as SessionState["approvals"][number];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root?.render(
      createElement(ApprovalCard, { approval, sessionId: "s", disabled: false, completed: false }),
    ),
  );
  expect(container.querySelector(".completed-approval")).toBeNull();
  await act(async () =>
    root?.render(createElement(ApprovalCard, { approval, sessionId: "s", disabled: false, completed: true })),
  );
  const disclosure = container.querySelector<HTMLButtonElement>(".completed-approval button");
  expect(disclosure?.getAttribute("aria-expanded")).toBe("false");
  expect(disclosure?.textContent).toContain(tool === "run_command" ? "echo hello" : "shell");
  await act(async () => disclosure?.click());
  expect(disclosure?.getAttribute("aria-expanded")).toBe("true");
  expect(container.textContent).toContain("/repo");
  await act(async () =>
    root?.render(
      createElement(ApprovalCard, {
        approval: { ...approval, decision: null },
        sessionId: "s",
        disabled: false,
        completed: true,
      }),
    ),
  );
  expect(container.querySelector(".completed-approval")).toBeNull();
  expect(container.querySelector("[data-approval-command]")).not.toBeNull();
});

it("lists the reserved bench resources with the registry and its SHA-256", async () => {
  await i18n.changeLanguage("en");
  const approval = {
    approvalId: "apv",
    callId: "call",
    requestSha256: "a".repeat(64),
    tool: "run_program",
    path: "scpi",
    diff: "",
    bytes: 0,
    program: {
      pluginId: "scpi-instruments",
      trial: false,
      program: "scpi",
      programVersion: "1.0.0",
      executable: "/opt/uv",
      args: ["output", "--instrument", "psu", "--channel", "CH1", "--hold", "60"],
      cwd: ".",
      risk: "irreversible",
      confirm: "output",
      notes: ["Turns on a physical output."],
      files: [],
      directories: [{ arg: 1, path: "/outside/repository" }],
      resources: [{ alias: "psu", kind: "visa", resource: "USB0::0x1AB1::0x0E11::DP8C1::INSTR" }],
      registry: { path: "lab/resources.json", sha256: "c".repeat(64) },
    },
  } as unknown as SessionState["approvals"][number];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root?.render(createElement(ApprovalCard, { approval, sessionId: "s", disabled: false })),
  );
  const fields = [...container.querySelectorAll(".approval-program dt")];
  expect(fields.map((field) => [field.textContent, field.nextElementSibling?.textContent])).toEqual([
    [i18n.t("approval.pluginLabel"), "scpi-instruments"],
    [i18n.t("approval.cwd"), "."],
    [i18n.t("approval.executable"), "/opt/uv"],
  ]);
  const list = container.querySelector("[data-approval-resources]");
  expect(list?.getAttribute("aria-label")).toBe("Reserved bench resources");
  expect(list?.textContent).toContain("psu");
  expect(list?.textContent).toContain("USB0::0x1AB1::0x0E11::DP8C1::INSTR");
  expect(list?.textContent).toContain(`lab/resources.json`);
  expect(list?.textContent).toContain("c".repeat(64));
  const directories = container.querySelector("[data-approval-directories]");
  expect(directories?.textContent).toContain("/outside/repository");
  expect(directories?.textContent).not.toContain("SHA-256");
});
