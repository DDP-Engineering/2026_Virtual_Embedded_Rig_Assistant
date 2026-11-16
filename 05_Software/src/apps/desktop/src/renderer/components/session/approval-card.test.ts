// @vitest-environment jsdom
// REQ-UX-73dd7a9b
import type { SessionState } from "@vera/shared";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
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
