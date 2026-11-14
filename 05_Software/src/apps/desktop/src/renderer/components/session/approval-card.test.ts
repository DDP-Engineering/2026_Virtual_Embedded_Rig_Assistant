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
});
