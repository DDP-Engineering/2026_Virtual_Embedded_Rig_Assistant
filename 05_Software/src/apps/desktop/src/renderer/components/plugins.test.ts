// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import {
  type PluginProgramStatus,
  type PluginReview,
  type PluginSummary,
  veraError,
  workbenchSchema,
} from "@vera/shared";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../api/index.js";
import i18n from "../i18n.js";
import { Plugins } from "./plugins.js";
import { WorkbenchConfigForm } from "./workbench-config-form.js";

vi.mock("../api/index.js", () => ({ api: { invoke: vi.fn(), subscribe: vi.fn(() => () => {}) } }));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  client?.clear();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

const workbench = { id: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C", name: "Board", readOnly: false };
const echo: PluginSummary = {
  id: "echo-tools",
  issues: [],
  version: "1.0.0",
  name: "Echo tools",
  description: "Echo arguments and print test output.",
  ecosystem: "general",
  platforms: ["windows-x64", "linux-x64"],
  tier: "local",
  source: "folder",
  sha256: "a".repeat(64),
  installedAt: "2026-11-03T10:00:00.000Z",
  irreversible: [],
  enabled: false,
};
const broken: PluginSummary = {
  id: "broken-tools",
  issues: [{ code: "field", path: "rules.0.risk", issue: "invalid_value" }],
  enabled: false,
};
const review: PluginReview = {
  path: "C:/plugins/echo-tools",
  kind: "folder",
  sha256: "b".repeat(64),
  issues: [],
  manifest: {
    format: 1,
    id: "echo-tools",
    version: "1.0.0",
    name: "Echo tools",
    description: "Echo arguments and print test output.",
    ecosystem: "general",
    platforms: ["windows-x64", "linux-x64"],
    requires: [],
    programs: {
      echo: {
        install: {
          find: { windows: ["%VERA_TEST_NODE%"], linux: ["$VERA_TEST_NODE"] },
          hint: "Install Node.js.",
        },
        version: { args: ["--version"], match: "v(\\d+\\.\\d+\\.\\d+)", range: ">=18" },
      },
    },
    rules: [
      { match: "echo version", risk: "safe" },
      { match: "echo serve *", risk: "safe" },
      { match: "echo write *", risk: "device-write", note: "Writes the device." },
      { match: "echo burn *", risk: "irreversible", note: "Burns a fuse." },
      { match: "echo monitor *", risk: "blocked" },
    ],
    docs: [],
  },
};

/** An in-memory main process for the plugin channels. */
function stub(options: {
  installed?: PluginSummary[];
  programs?: PluginProgramStatus[];
  review?: PluginReview;
}) {
  const state = {
    installed: [...(options.installed ?? [])],
    programs: options.programs ?? [
      { name: "echo", kind: "find", state: "missing", hint: "Install Node.js." },
    ],
    provisioned: false,
  };
  vi.mocked(api.invoke).mockImplementation((async (channel: string, request: Record<string, unknown>) => {
    switch (channel) {
      case "plugins.list":
        return state.installed;
      case "plugins.programs":
        return state.provisioned
          ? [{ name: "echo", kind: "find", state: "ready", version: "22.11.0" }]
          : state.programs;
      case "plugins.provision":
        state.provisioned = true;
        return [{ name: "echo", kind: "find", state: "ready", version: "22.11.0" }];
      case "plugins.toggle":
        state.installed = state.installed.map((plugin) =>
          plugin.id === request.id ? { ...plugin, enabled: request.enabled as boolean } : plugin,
        );
        return {};
      case "plugins.uninstall":
        state.installed = state.installed.filter((plugin) => plugin.id !== request.id);
        return {};
      case "plugins.choose":
        return { path: options.review?.path ?? null };
      case "plugins.review":
        return options.review;
      case "plugins.install":
        state.installed.push(echo);
        return echo;
      // The catalog section is covered by plugin-catalog.test.ts; here it has nothing to offer.
      case "plugins.catalog":
        return { source: "none", plugins: [], packs: [] };
      case "app.settings.get":
        return { settings: { plugins: {} } };
      default:
        throw new Error(`Unexpected ${channel}`);
    }
  }) as never);
  return state;
}
async function render(props: Parameters<typeof Plugins>[0] = { workbench }) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client }, createElement(Plugins, props)));
  });
}
const $ = (selector: string) => container.querySelector(selector) as HTMLElement;
const click = async (selector: string) => {
  await act(async () => {
    await userEvent.setup().click($(selector));
  });
};
const calls = (channel: string) => vi.mocked(api.invoke).mock.calls.filter(([name]) => name === channel);

// REQ-UX-28503c97
it.each(["en", "ro", "de"])(
  "lists installed plugins with tier, version and program states (%s)",
  async (language) => {
    await i18n.changeLanguage(language);
    stub({ installed: [echo] });
    await render();
    await vi.waitFor(() => expect($('[data-plugin="echo-tools"] [data-program="echo"]')).not.toBeNull());
    const card = $('[data-plugin="echo-tools"]');
    for (const text of [
      "Echo tools",
      "1.0.0",
      i18n.t("plugins.tier.local"),
      "echo-tools",
      echo.description ?? "",
    ])
      expect(card.textContent).toContain(text);
    const program = $('[data-program="echo"]');
    expect(program.textContent).toContain(i18n.t("plugins.state.missing"));
    expect(program.textContent).toContain("Install Node.js.");
  },
);

it("says when no plugin is installed", async () => {
  await i18n.changeLanguage("en");
  stub({});
  await render();
  await vi.waitFor(() => expect(container.textContent).toContain(i18n.t("plugins.none")));
});

// REQ-UX-d51c6e3c
it("installs a plugin's programs and shows their new states", async () => {
  await i18n.changeLanguage("en");
  stub({ installed: [echo] });
  await render();
  await vi.waitFor(() => expect($('[data-action="plugin-provision"]')).not.toBeNull());
  await click('[data-action="plugin-provision"]');
  expect(calls("plugins.provision")).toEqual([["plugins.provision", { id: "echo-tools" }]]);
  await vi.waitFor(() =>
    expect($('[data-program="echo"]').textContent).toContain(i18n.t("plugins.state.ready")),
  );
  expect($('[data-program="echo"]').textContent).toContain("22.11.0");
  expect($('[data-action="plugin-provision"]')).toBeNull();
});

// REQ-UX-41c19e62
it("shows a broken plugin's issues and offers no switch or program install", async () => {
  await i18n.changeLanguage("en");
  stub({ installed: [broken] });
  await render();
  await vi.waitFor(() => expect($('[data-plugin="broken-tools"] [data-issue="field"]')).not.toBeNull());
  const card = $('[data-plugin="broken-tools"]');
  expect(card.textContent).toContain("rules.0.risk");
  expect(card.textContent).toContain(i18n.t("plugins.issue.field", { issue: "invalid_value" }));
  expect(card.querySelector('input[type="checkbox"]')).toBeNull();
  expect(card.querySelector('[data-action="plugin-provision"]')).toBeNull();
  expect(calls("plugins.programs")).toEqual([]);
});

// REQ-UX-fd6bc95d
it("enables a plugin for the open workbench, and asks for a workbench without one", async () => {
  await i18n.changeLanguage("en");
  stub({ installed: [echo] });
  await render();
  await vi.waitFor(() => expect($('[data-plugin="echo-tools"] input[type="checkbox"]')).not.toBeNull());
  await click('[data-plugin="echo-tools"] input[type="checkbox"]');
  expect(calls("plugins.toggle")).toEqual([
    ["plugins.toggle", { workbenchId: workbench.id, id: "echo-tools", enabled: true }],
  ]);
  await vi.waitFor(() =>
    expect(($('[data-plugin="echo-tools"] input[type="checkbox"]') as HTMLInputElement).checked).toBe(true),
  );
  await act(async () => root.unmount());
  container.remove();
  await render({});
  await vi.waitFor(() => expect($('[data-plugin="echo-tools"]')).not.toBeNull());
  expect(container.textContent).toContain(i18n.t("plugins.noWorkbench"));
  expect(container.querySelector('input[type="checkbox"]')).toBeNull();
  expect(calls("plugins.list").at(-1)).toEqual(["plugins.list", {}]);
});

// REQ-UX-c1de1651
it("uninstalls only after confirmation", async () => {
  await i18n.changeLanguage("en");
  stub({ installed: [echo] });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  await render();
  await vi.waitFor(() => expect($('[data-action="plugin-uninstall"]')).not.toBeNull());
  await click('[data-action="plugin-uninstall"]');
  expect(confirm).toHaveBeenCalledOnce();
  expect(calls("plugins.uninstall")).toEqual([]);
  confirm.mockReturnValue(true);
  await click('[data-action="plugin-uninstall"]');
  expect(calls("plugins.uninstall")).toEqual([["plugins.uninstall", { id: "echo-tools" }]]);
  await vi.waitFor(() => expect($('[data-plugin="echo-tools"]')).toBeNull());
});

// REQ-UX-e6056763, REQ-UX-acc04fbc
it("reviews a picked folder, then installs exactly the reviewed package", async () => {
  await i18n.changeLanguage("en");
  stub({ review });
  await render();
  await click('[data-action="plugin-install-folder"]');
  expect(calls("plugins.choose")).toEqual([["plugins.choose", { kind: "folder" }]]);
  await vi.waitFor(() => expect($("[data-plugin-review]")).not.toBeNull());
  const screen = $("[data-plugin-review]");
  for (const text of [
    "Echo tools",
    "echo-tools",
    "1.0.0",
    review.path,
    "%VERA_TEST_NODE%",
    "Install Node.js.",
    ">=18",
  ])
    expect(screen.textContent).toContain(text);
  expect(screen.querySelectorAll("[data-rule]")).toHaveLength(5);
  expect([...screen.querySelectorAll("[data-rule] .risk-badge")].map((badge) => badge.textContent)).toEqual([
    i18n.t("approval.risk.safe"),
    i18n.t("approval.risk.safe"),
    i18n.t("approval.risk.deviceWrite"),
    i18n.t("approval.risk.irreversible"),
    i18n.t("approval.risk.blocked"),
  ]);
  expect(screen.textContent).toContain("Writes the device.");
  expect(screen.textContent).toContain("Burns a fuse.");
  await click('[data-action="plugin-install"]');
  expect(calls("plugins.install")).toEqual([
    ["plugins.install", { path: review.path, sha256: review.sha256 }],
  ]);
  await vi.waitFor(() => expect($("[data-plugin-review]")).toBeNull());
  await vi.waitFor(() => expect($('[data-plugin="echo-tools"]')).not.toBeNull());
});

// REQ-UX-e6056763
it("cancels a review without installing", async () => {
  await i18n.changeLanguage("en");
  stub({ review });
  await render();
  await click('[data-action="plugin-install-zip"]');
  expect(calls("plugins.choose")).toEqual([["plugins.choose", { kind: "zip" }]]);
  await vi.waitFor(() => expect($("[data-plugin-review]")).not.toBeNull());
  await click('[data-action="plugin-review-cancel"]');
  expect($("[data-plugin-review]")).toBeNull();
  expect(calls("plugins.install")).toEqual([]);
});

// REQ-UX-acc04fbc
it("keeps the review open with the error when the install fails", async () => {
  await i18n.changeLanguage("en");
  stub({ review });
  const invoke = vi.mocked(api.invoke).getMockImplementation();
  vi.mocked(api.invoke).mockImplementation((async (channel: string, request: unknown) => {
    if (channel === "plugins.install") throw veraError("CONFLICT");
    return invoke?.(channel as never, request as never);
  }) as never);
  await render();
  await click('[data-action="plugin-install-folder"]');
  await vi.waitFor(() => expect($("[data-plugin-review]")).not.toBeNull());
  await click('[data-action="plugin-install"]');
  await vi.waitFor(() => expect($("[data-plugin-review] [role=alert]")).not.toBeNull());
  expect($("[data-plugin-review]").textContent).toContain(
    i18n.t("errors.CONFLICT", { operation: "", endpoint: "", message: "", retryAfter: "" }),
  );
});

// REQ-UX-8904f319
it("lists the issues of a broken package and disables Install", async () => {
  await i18n.changeLanguage("en");
  stub({
    review: {
      path: "C:/plugins/broken-tools",
      kind: "folder",
      sha256: "c".repeat(64),
      issues: [{ code: "field", path: "rules.0.risk", issue: "invalid_value" }],
    },
  });
  await render();
  await click('[data-action="plugin-install-folder"]');
  await vi.waitFor(() => expect($('[data-plugin-review] [data-issue="field"]')).not.toBeNull());
  expect($("[data-plugin-review]").textContent).toContain("rules.0.risk");
  expect(($('[data-action="plugin-install"]') as HTMLButtonElement).disabled).toBe(true);
});

it("does nothing when the picker is cancelled", async () => {
  await i18n.changeLanguage("en");
  stub({});
  await render();
  await click('[data-action="plugin-install-folder"]');
  expect(calls("plugins.review")).toEqual([]);
  expect($("[data-plugin-review]")).toBeNull();
});

// REQ-UX-e07790cb
it("points the workbench form's Plugins section to the Plugins page", async () => {
  await i18n.changeLanguage("en");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(WorkbenchConfigForm, {
        label: "Workbench",
        config: workbenchSchema.parse({ format: 1, id: workbench.id, name: "Board" }),
        setConfig: () => {},
        instructions: "",
        setInstructions: () => {},
        folder: "C:/board",
        skills: null,
      }),
    );
  });
  await click('[data-project-section="plugins"]');
  expect(container.textContent).toContain(i18n.t("plugins.configPointer"));
  expect(container.textContent).not.toContain("not available yet");
});
