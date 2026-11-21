// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import {
  defaultSettings,
  mergeWorkbench,
  type WorkbenchSnapshot,
  workbenchPatchSchema,
  workbenchSchema,
} from "@vera/shared";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../api/index.js";
import i18n from "../i18n.js";
import { WorkbenchEditor } from "./workbench-editor.js";

vi.mock("../api/index.js", () => ({ api: { invoke: vi.fn(), getSettings: vi.fn() } }));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open");
};
let root: Root, container: HTMLDivElement, client: QueryClient;
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  client?.clear();
  vi.clearAllMocks();
});
const settings = (agent = true) => ({
  settings: { ...defaultSettings("1b9dc50c-d87d-484b-88e6-04cb5f7c5a19"), privacy: { mask: { agent } } },
});
const wb = (readOnly = false): WorkbenchSnapshot => ({
  folder: "/bench",
  indexLease: 1,
  readOnly,
  warnings: [],
  config: workbenchSchema.parse({
    format: 1,
    id: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C",
    name: "Privacy bench",
    privacy: { mask: { agent: "on" } },
    vendor: { retained: true },
  }),
});
async function mount(workbench = wb(), cached = true, read = Promise.resolve(settings(false))) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  if (cached) client.setQueryData(["app.settings"], settings(false));
  vi.mocked(api.getSettings).mockReturnValue(read);
  vi.mocked(api.invoke).mockImplementation((async (channel: string, request: { patch: unknown }) => {
    if (channel === "workbench.pinned.get") return { content: "Instructions", oversized: false };
    if (channel === "workbench.additionalFolders.list" || channel === "skills.list") return [];
    if (channel === "workbench.config.get") return workbench;
    if (channel === "workbench.config.update")
      return {
        ...workbench,
        config: mergeWorkbench(workbench.config, workbenchPatchSchema.parse(request.patch)),
      };
    throw Error(`Unexpected ${channel}`);
  }) as never);
  const saved = vi.fn(),
    close = vi.fn();
  await act(async () =>
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(WorkbenchEditor, { workbench, saved, close }),
      ),
    ),
  );
  await click('[data-project-section="privacy"]');
  return { saved, close };
}
const pick = (area: string) =>
  container.querySelector<HTMLSelectElement>(`[data-mask-area="${area}"] select`) as HTMLSelectElement;
async function click(selector: string) {
  const target = document.querySelector<HTMLElement>(selector);
  expect(target, selector).not.toBeNull();
  await act(async () => userEvent.setup().click(target as HTMLElement));
}
async function choose(area: string, value: string) {
  await act(async () => userEvent.setup().selectOptions(pick(area), value));
}
const updates = () =>
  vi.mocked(api.invoke).mock.calls.filter(([channel]) => channel === "workbench.config.update");

it.each(["en", "ro", "de", "fr"])(
  "confirms inherited agent disabling as a draft with Cancel/Escape focus in %s",
  async (language) => {
    await i18n.changeLanguage(language);
    const { saved } = await mount();
    expect(pick("agent").options[0]?.textContent).toBe(
      i18n.t("privacy.default", { value: i18n.t("privacy.off") }),
    );
    await choose("agent", "default");
    expect(pick("agent").value).toBe("on");
    expect(document.querySelector("dialog")?.textContent).toContain(i18n.t("privacy.warning"));
    await click('[data-action="cancel-mask-off"]');
    expect(pick("agent").value).toBe("on");
    expect(document.activeElement).toBe(pick("agent"));
    await choose("agent", "off");
    await act(async () => {
      document.querySelector("dialog")?.dispatchEvent(new Event("cancel", { cancelable: true }));
    });
    expect(pick("agent").value).toBe("on");
    expect(document.activeElement).toBe(pick("agent"));
    await choose("agent", "default");
    await click('[data-action="confirm-mask-off"]');
    expect(pick("agent").value).toBe("default");
    expect(updates()).toHaveLength(0);
    await click("[data-project-save]");
    expect(updates()[0]?.[1]).toMatchObject({ patch: { privacy: { mask: { agent: "default" } } } });
    expect(saved.mock.calls[0]?.[0].config).toMatchObject({ vendor: { retained: true } });
  },
);

it("tracks live app defaults without mutating overrides, and restores clean Save after undo", async () => {
  await mount();
  await choose("display", "on");
  await act(async () => client.setQueryData(["app.settings"], settings(true)));
  await vi.waitFor(() => expect(pick("agent").options[0]?.textContent).toContain(i18n.t("privacy.on")));
  expect(pick("display").value).toBe("on");
  await choose("agent", "default");
  expect(document.querySelector("dialog")).toBeNull();
  await choose("agent", "on");
  await choose("display", "default");
  expect(container.querySelector<HTMLButtonElement>("[data-project-save]")?.disabled).toBe(true);
  expect(updates()).toHaveLength(0);
});

it("keeps all read-only choices disabled", async () => {
  await mount(wb(true));
  for (const select of container.querySelectorAll("[data-mask-area] select"))
    expect(select.matches(":disabled")).toBe(true);
  expect(container.querySelector<HTMLButtonElement>("[data-project-save]")?.disabled).toBe(true);
});

it("keeps workbench privacy selections retryable after a failed Save and cancels without storage", async () => {
  const { close } = await mount();
  await choose("display", "on");
  const original = vi.mocked(api.invoke).getMockImplementation();
  vi.mocked(api.invoke).mockImplementation(((channel: never, request: never) =>
    channel === "workbench.config.update"
      ? Promise.reject({ code: "CONFLICT", messageKey: "errors.CONFLICT" })
      : original?.(channel, request)) as never);
  await click("[data-project-save]");
  expect(pick("display").value).toBe("on");
  expect(container.querySelector<HTMLButtonElement>("[data-project-save]")?.disabled).toBe(false);
  await click("[data-project-cancel]");
  expect(close).toHaveBeenCalledOnce();
  expect(updates()).toHaveLength(1);
});

it("rejects a stale initial settings response after newer app defaults arrive", async () => {
  let resolve!: (value: ReturnType<typeof settings>) => void;
  const pending = new Promise<ReturnType<typeof settings>>((done) => {
    resolve = done;
  });
  await mount(wb(), false, pending);
  expect(container.querySelector("[data-mask-area]")).toBeNull();
  await act(async () => {
    client.setQueryData(["app.settings"], settings(true));
  });
  await vi.waitFor(() => expect(pick("agent")).not.toBeNull());
  await act(async () => {
    resolve(settings(false));
    await pending;
  });
  expect(pick("agent").options[0]?.textContent).toContain(i18n.t("privacy.on"));
  expect(client.getQueryData(["app.settings"])).toEqual(settings(true));
  expect(updates()).toHaveLength(0);
});

it("reports an initial settings failure and enables choices only after a successful retry", async () => {
  let reject!: (error: unknown) => void;
  const pending = new Promise<ReturnType<typeof settings>>((_, fail) => {
    reject = fail;
  });
  await mount(wb(), false, pending);
  await act(async () => {
    reject({ code: "IO", messageKey: "errors.IO" });
  });
  await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull());
  expect(container.querySelector("[data-mask-area]")).toBeNull();
  vi.mocked(api.getSettings).mockResolvedValue(settings(true));
  const retry = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === i18n.t("settings.retry"),
  );
  expect(retry).toBeTruthy();
  await act(async () => userEvent.setup().click(retry as HTMLButtonElement));
  await vi.waitFor(() => expect(pick("agent")).not.toBeNull());
  expect(pick("agent").disabled).toBe(false);
  expect(updates()).toHaveLength(0);
});

it("drops the previous owner's warning and draft when the keyed workbench editor changes", async () => {
  await mount();
  await choose("display", "on");
  await choose("agent", "off");
  expect(document.querySelector("dialog")).not.toBeNull();
  const other = wb();
  other.config = {
    ...other.config,
    id: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0D",
    privacy: { mask: { agent: "off" } },
  };
  other.folder = "/other";
  await act(async () =>
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(WorkbenchEditor, {
          key: other.config.id,
          workbench: other,
          saved: vi.fn(),
          close: vi.fn(),
        }),
      ),
    ),
  );
  await click('[data-project-section="privacy"]');
  expect(document.querySelector("dialog")).toBeNull();
  expect(pick("display").value).toBe("default");
  expect(pick("agent").value).toBe("off");
  expect(container.querySelector<HTMLButtonElement>("[data-project-save]")?.disabled).toBe(true);
  expect(updates()).toHaveLength(0);
});
