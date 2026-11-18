// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getByRole, queryByRole } from "@testing-library/dom";
import userEvent from "@testing-library/user-event";
import { type SkillSummary, skillTemplate, veraError } from "@vera/shared";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../api/index.js";
import i18n from "../i18n.js";
import { SkillSettings, SkillsPanel } from "./skills.js";

vi.mock("../api/index.js", () => ({ api: { invoke: vi.fn() } }));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open");
};
let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
const workbenchId = "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C";
const hash = "a".repeat(64);
const user = userEvent.setup();
const invoke = vi.mocked(api.invoke);
const reader: SkillSummary = { name: "reader", source: "workbench", description: "Reads.", enabled: true };
function node(selector: string) {
  return container.querySelector(selector) as HTMLElement;
}
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}
async function click(element: HTMLElement) {
  await act(async () => {
    await user.click(element);
  });
  await settle();
}
async function type(selector: string, value: string) {
  await act(async () => {
    await user.type(node(selector), value);
  });
  await settle();
}
async function mount(readOnly = false, dialog = true, language = "en") {
  await i18n.changeLanguage(language);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(dialog ? SkillSettings : SkillsPanel, { workbenchId, readOnly }),
      ),
    );
  });
  if (dialog) await click(node('[data-action="skills-settings"]'));
  await settle();
}
function mockSkills(initial: SkillSummary[] = [reader]) {
  let skills = initial.map((skill) => ({ ...skill }));
  const contents = new Map(initial.map((skill) => [skill.name, skillTemplate(skill.name)]));
  invoke.mockImplementation(async (channel, request) => {
    const data = request as {
      name: string;
      source: SkillSummary["source"];
      enabled: boolean;
      content: string;
    };
    switch (channel) {
      case "skills.list":
        return skills.map((skill) => ({ ...skill })) as never;
      case "skills.open":
        return { content: contents.get(data.name), sha256: hash } as never;
      case "skills.create":
        skills = [
          ...skills,
          { name: data.name, source: data.source, description: "Template.", enabled: true },
        ];
        contents.set(data.name, skillTemplate(data.name));
        return { content: skillTemplate(data.name), sha256: hash } as never;
      case "skills.toggle":
        skills = skills.map((skill) =>
          skill.name === data.name ? { ...skill, enabled: data.enabled } : skill,
        );
        return {} as never;
      case "skills.save":
        contents.set(data.name, data.content);
        return { content: data.content, sha256: hash } as never;
      default:
        throw Error(channel);
    }
  });
}
afterEach(async () => {
  await act(async () => root?.unmount());
  client?.clear();
  container?.remove();
  vi.resetAllMocks();
});

it.each(["en", "ro", "de", "fr"])(
  "labels all sources, scopes, validation and read-only viewing (%s)",
  async (language) => {
    mockSkills([
      reader,
      { name: "personal", source: "user", description: "Personal.", enabled: false },
      { name: "create-plugin", source: "official", description: "Official.", enabled: true },
      { name: "echo-guide", source: "plugin", plugin: "echo-tools", description: "Guide.", enabled: true },
    ]);
    await mount(false, true, language);
    expect(container.querySelectorAll(".skills-list li")).toHaveLength(4);
    expect(container.textContent).toContain(i18n.t("skills.explanation"));
    expect(queryByRole(container, "button", { name: i18n.t("settings.retry") })).toBeNull();
    for (const name of ["create-plugin", "echo-guide"]) {
      const row = node(`[data-skill="${name}"]`);
      expect(row.textContent).toContain(i18n.t("skills.view"));
      await click(row.querySelector("button") as HTMLElement);
      expect((node("[data-skill-content]") as HTMLTextAreaElement).readOnly).toBe(true);
      expect(node('[data-action="save-skill"]')).toBeNull();
      expect(container.textContent).toContain(i18n.t("skills.readOnlySource"));
      await click(getByRole(node(".skill-editor"), "button", { name: i18n.t("skills.close") }));
      expect(document.activeElement).toBe(row.querySelector("button"));
    }
    await click(node('[data-action="new-skill"]'));
    expect(document.activeElement).toBe(node("[data-skill-name]"));
    expect(container.textContent).toContain(i18n.t("skills.nameHelp"));
    expect(container.textContent).toContain(i18n.t("skills.scopeWorkbench"));
    expect((node('[data-action="create-skill"]') as HTMLButtonElement).disabled).toBe(true);
    await type("[data-skill-name]", "Invalid name");
    expect(node("[data-skill-name]").getAttribute("aria-invalid")).toBe("true");
    expect((node('[data-action="create-skill"]') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      await user.selectOptions(node("[data-skill-source]"), "user");
    });
    expect(container.textContent).toContain(i18n.t("skills.scopeUser"));
    expect(getByRole(container, "option", { name: i18n.t("skills.locationUser") })).toBeTruthy();
    await click(getByRole(node(".skill-create"), "button", { name: i18n.t("workbench.cancel") }));
    expect(node("[data-skill-name]")).toBeNull();
    expect(document.activeElement).toBe(node('[data-action="new-skill"]'));
  },
);

it.each(["workbench", "user"])(
  "creates a %s skill once and immediately opens the template, saves and restores row focus",
  async (source) => {
    mockSkills();
    await mount(false, false);
    await click(node('[data-action="new-skill"]'));
    await type("[data-skill-name]", "new-skill");
    await act(async () => {
      await user.selectOptions(node("[data-skill-source]"), source);
    });
    await click(node('[data-action="create-skill"]'));
    expect(invoke).toHaveBeenCalledWith("skills.create", { workbenchId, name: "new-skill", source });
    expect(invoke.mock.calls.filter(([channel]) => channel === "skills.create")).toHaveLength(1);
    expect(container.textContent).toContain(i18n.t("skills.template"));
    expect(document.activeElement).toBe(node("[data-skill-content]"));
    expect((node("[data-skill-content]") as HTMLTextAreaElement).value).toContain("name: new-skill");
    await type("[data-skill-content]", "Extra instructions");
    await click(node('[data-action="save-skill"]'));
    expect(invoke).toHaveBeenCalledWith(
      "skills.save",
      expect.objectContaining({ workbenchId, name: "new-skill", source, sha256: hash }),
    );
    expect(node(".skill-editor")).toBeNull();
    expect(document.activeElement).toBe(node('[data-skill="new-skill"] button'));
    expect(container.textContent).toContain(i18n.t("skills.saved"));
  },
);

it("retries a failed list load, refreshes and reports completion without mutation", async () => {
  invoke.mockRejectedValueOnce(veraError("DENIED")).mockResolvedValue([reader] as never);
  await mount();
  expect(container.textContent).toContain(i18n.t("skills.listFailed"));
  await click(getByRole(container, "button", { name: i18n.t("settings.retry") }));
  expect(container.querySelectorAll(".skills-list li")).toHaveLength(1);
  expect(queryByRole(container, "button", { name: i18n.t("settings.retry") })).toBeNull();
  await click(node('[data-action="refresh-skills"]'));
  expect(container.textContent).toContain(i18n.t("skills.refreshed"));
  expect(invoke.mock.calls.map(([channel]) => channel)).toEqual([
    "skills.list",
    "skills.list",
    "skills.list",
  ]);
});

it("recovers failed creation and activation by retrying the relevant operation", async () => {
  mockSkills();
  const success = invoke.getMockImplementation();
  let failCreate = true,
    failToggle = true;
  invoke.mockImplementation(async (channel, request) => {
    if (channel === "skills.create" && failCreate) {
      failCreate = false;
      throw veraError("DENIED");
    }
    if (channel === "skills.toggle" && failToggle) {
      failToggle = false;
      throw veraError("DENIED");
    }
    return success?.(channel, request) as never;
  });
  await mount();
  await click(node('[data-action="new-skill"]'));
  await type("[data-skill-name]", "recover");
  await click(node('[data-action="create-skill"]'));
  expect((node("[data-skill-name]") as HTMLInputElement).value).toBe("recover");
  expect((node('[data-action="create-skill"]') as HTMLButtonElement).disabled).toBe(false);
  await click(getByRole(container, "button", { name: i18n.t("settings.retry") }));
  await click(getByRole(node(".skill-editor"), "button", { name: i18n.t("workbench.cancel") }));
  const toggle = node('[data-skill="reader"] input');
  await click(toggle);
  expect((toggle as HTMLInputElement).checked).toBe(true);
  await click(getByRole(container, "button", { name: i18n.t("settings.retry") }));
  expect((node('[data-skill="reader"] input') as HTMLInputElement).checked).toBe(false);
  expect(container.textContent).toContain(i18n.t("skills.activationSaved"));
  const close = getByRole(node(".skills-dialog > header"), "button", { name: i18n.t("skills.close") });
  await click(close);
  expect(document.activeElement).toBe(node('[data-action="skills-settings"]'));
  await click(node('[data-action="skills-settings"]'));
  expect((node('[data-skill="reader"] input') as HTMLInputElement).checked).toBe(false);
});

it("keeps drafts after open/save failures and retries without stuck controls", async () => {
  mockSkills();
  const success = invoke.getMockImplementation();
  let failOpen = true,
    failSave = true;
  invoke.mockImplementation(async (channel, request) => {
    if (channel === "skills.open" && failOpen) {
      failOpen = false;
      throw veraError("NOT_FOUND");
    }
    if (channel === "skills.save" && failSave) {
      failSave = false;
      throw veraError("CONFLICT");
    }
    return success?.(channel, request) as never;
  });
  await mount();
  await click(node('[data-action="open-skill"]'));
  expect(container.textContent).toContain(i18n.t("skills.openFailed"));
  await click(getByRole(node(".skill-editor"), "button", { name: i18n.t("settings.retry") }));
  expect(document.activeElement).toBe(node("[data-skill-content]"));
  await type("[data-skill-content]", "Draft text");
  await click(node('[data-action="save-skill"]'));
  expect(container.textContent).toContain(i18n.t("skills.saveFailed"));
  expect((node("[data-skill-content]") as HTMLTextAreaElement).value).toContain("Draft text");
  expect((node("[data-skill-content]") as HTMLTextAreaElement).disabled).toBe(false);
  await click(getByRole(node(".skill-editor"), "button", { name: i18n.t("settings.retry") }));
  expect(node(".skill-editor")).toBeNull();
});

it("prevents duplicate pending creation and saving and restores controls after failure", async () => {
  mockSkills();
  const success = invoke.getMockImplementation();
  let reject: (error: unknown) => void = () => {};
  invoke.mockImplementation((channel, request) =>
    channel === "skills.create" || channel === "skills.save"
      ? new Promise((_resolve, fail) => {
          reject = fail;
        })
      : (success?.(channel, request) as never),
  );
  await mount();
  await click(node('[data-action="new-skill"]'));
  await type("[data-skill-name]", "pending");
  const form = node(".skill-create");
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(invoke.mock.calls.filter(([channel]) => channel === "skills.create")).toHaveLength(1);
  expect(container.textContent).toContain(i18n.t("skills.saving"));
  expect((getByRole(node(".skills-dialog > header"), "button") as HTMLButtonElement).disabled).toBe(true);
  await act(async () => reject(veraError("DENIED")));
  await settle();
  expect((node('[data-action="create-skill"]') as HTMLButtonElement).disabled).toBe(false);
  await click(getByRole(form, "button", { name: i18n.t("workbench.cancel") }));
  await click(node('[data-action="open-skill"]'));
  const editorForm = node(".skill-editor form");
  await act(async () => {
    editorForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    editorForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(invoke.mock.calls.filter(([channel]) => channel === "skills.save")).toHaveLength(1);
  expect((node('[data-action="save-skill"]') as HTMLButtonElement).disabled).toBe(true);
  await act(async () => reject(veraError("DENIED")));
  await settle();
  expect((node('[data-action="save-skill"]') as HTMLButtonElement).disabled).toBe(false);
});

it("allows refresh and instruction viewing in read-only workbenches, never mutations", async () => {
  mockSkills();
  await mount(true);
  expect((node('[data-action="new-skill"]') as HTMLButtonElement).disabled).toBe(true);
  expect((node('input[role="switch"]') as HTMLInputElement).disabled).toBe(true);
  await click(node('[data-action="refresh-skills"]'));
  await click(getByRole(container, "button", { name: i18n.t("skills.viewNamed", { name: "reader" }) }));
  expect((node("[data-skill-content]") as HTMLTextAreaElement).readOnly).toBe(true);
  expect(node('[data-action="save-skill"]')).toBeNull();
  expect(container.textContent).toContain(i18n.t("skills.readOnlyWorkbench"));
  expect(invoke.mock.calls.every(([channel]) => ["skills.list", "skills.open"].includes(channel))).toBe(true);
});
