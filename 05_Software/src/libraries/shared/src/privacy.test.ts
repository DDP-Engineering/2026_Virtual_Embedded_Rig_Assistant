import { expect, it } from "vitest";
import { channels } from "./ipc.js";
import { defaultSettings, mergeSettings, settingsPatchSchema, settingsSchema } from "./settings.js";
import { mergeWorkbench, workbenchPatchSchema, workbenchSchema } from "./workbench.js";

const settings = defaultSettings("00000000-0000-4000-8000-000000000001");
const workbench = workbenchSchema.parse({
  format: 1,
  id: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C",
  name: "Masking",
});

it("carries masking preferences through settings and workbench IPC contracts", () => {
  const appPatch = { privacy: { mask: { display: true } } };
  const benchPatch = { privacy: { mask: { exports: "off" } } };
  expect(channels["app.settings.update"].request.parse(appPatch)).toEqual(appPatch);
  expect(channels["app.settings.get"].response.parse({ settings })).toEqual({ settings });
  expect(channels["workbench.config.update"].request.parse({ patch: benchPatch })).toEqual({
    patch: benchPatch,
  });
  expect(
    channels["workbench.create"].request.parse({ folder: "/repo", name: "Masking", config: benchPatch }),
  ).toHaveProperty("config", benchPatch);
  expect(
    channels["workbench.config.get"].response.parse({
      config: { ...workbench, ...benchPatch },
      warnings: [],
    }),
  ).toHaveProperty("config.privacy", benchPatch.privacy);
  for (const privacy of [{ mask: { typo: true } }, { mask: { agent: "invalid" } }]) {
    expect(channels["app.settings.update"].request.safeParse({ privacy }).success).toBe(false);
    expect(channels["workbench.config.update"].request.safeParse({ patch: { privacy } }).success).toBe(false);
  }
});

it("persists app masking defaults and merges individual areas", () => {
  expect(settings).toHaveProperty("privacy.mask", {
    display: false,
    runs: false,
    agent: true,
    exports: true,
  });
  const first = mergeSettings(settings, settingsPatchSchema.parse({ privacy: { mask: { display: true } } }));
  const second = mergeSettings(first, settingsPatchSchema.parse({ privacy: { mask: { agent: false } } }));
  expect(second.privacy?.mask).toEqual({ display: true, runs: false, agent: false, exports: true });
  expect(mergeSettings(second, { theme: "dark" }).privacy).toEqual(second.privacy);
  expect(settingsSchema.safeParse({ ...settings, privacy: undefined }).success).toBe(true);
});

it("rejects unknown privacy keys at the exported merge boundaries", () => {
  for (const privacy of [{ extra: true }, { mask: { typo: true } }]) {
    expect(() => mergeSettings(settings, { privacy } as never)).toThrow();
    expect(() => mergeWorkbench(workbench, { privacy } as never)).toThrow();
  }
});

it("retains empty privacy blocks when merging unrelated or empty patches", () => {
  const app = settingsSchema.parse({ ...settings, privacy: {} });
  const bench = workbenchSchema.parse({ ...workbench, privacy: {} });
  expect(mergeSettings(app, {})).toEqual(app);
  expect(mergeSettings(app, { privacy: {}, theme: "system" })).toEqual(app);
  expect(mergeWorkbench(bench, {})).toEqual(bench);
  expect(mergeWorkbench(bench, { privacy: {}, name: bench.name })).toEqual(bench);
});

it("merges workbench areas while preserving extensions, folders and command prefixes", () => {
  const base = workbenchSchema.parse({
    ...workbench,
    vendor: { preserved: true },
    additional_folders: ["/other/repo"],
    agent: { allowed_commands: ["npm test"], extension: 42 },
  });
  const first = mergeWorkbench(base, workbenchPatchSchema.parse({ privacy: { mask: { display: "on" } } }));
  const next = mergeWorkbench(first, workbenchPatchSchema.parse({ privacy: { mask: { agent: "off" } } }));
  expect(next.privacy?.mask).toEqual({ display: "on", agent: "off" });
  expect(mergeWorkbench(next, { name: "Renamed" })).toEqual({ ...next, name: "Renamed" });
  expect(next.vendor).toEqual({ preserved: true });
  expect(next.agent).toEqual(base.agent);
  expect(next.additional_folders).toEqual(base.additional_folders);
});

for (const [kind, stored, patch, base] of [
  ["app", settingsSchema, settingsPatchSchema, settings],
  ["workbench", workbenchSchema, workbenchPatchSchema, workbench],
] as const) {
  it.each([
    null,
    [],
    { extra: true },
    { mask: null },
    { mask: [] },
    { mask: { typo: "on" } },
    { mask: { display: "yes" } },
    { mask: { runs: 1 } },
    { mask: { agent: null } },
    { mask: { exports: {} } },
    { mask: { display: kind === "app" ? "on" : true } },
  ])(`rejects invalid ${kind} privacy %j in stored config and patches`, (privacy) => {
    expect(stored.safeParse({ ...base, privacy }).success).toBe(false);
    expect(patch.safeParse({ privacy }).success).toBe(false);
  });
  it(`accepts omitted ${kind} blocks and area fields`, () => {
    for (const privacy of [undefined, {}, { mask: {} }]) {
      expect(stored.safeParse({ ...base, privacy }).success).toBe(true);
      expect(patch.safeParse({ privacy }).success).toBe(true);
    }
  });
}
