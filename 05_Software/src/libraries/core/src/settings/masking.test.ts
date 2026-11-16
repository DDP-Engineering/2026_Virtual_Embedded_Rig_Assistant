import { existsSync } from "node:fs";
import { defaultSettings, type Settings, workbenchSchema } from "@vera/shared";
import { beforeAll, expect, it } from "vitest";

let createMaskingResolver: typeof import("./masking.js").createMaskingResolver;
beforeAll(async () => {
  expect(existsSync(new URL("./masking.ts", import.meta.url)), "masking resolver exists").toBe(true);
  ({ createMaskingResolver } = await import("./masking.js"));
});
const areas = ["display", "runs", "agent", "exports"] as const;
const base = { format: 1, id: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C", name: "Masking" };
for (const area of areas)
  for (const app of [false, true])
    it.each(["default", "on", "off"] as const)(`${area}: app ${app}, workbench %s`, (choice) => {
      const maskingFor = createMaskingResolver(() => ({ privacy: { mask: { [area]: app } } }));
      const workbench = workbenchSchema.parse({ ...base, privacy: { mask: { [area]: choice } } });
      expect(maskingFor(workbench, area)).toBe(choice === "default" ? app : choice === "on");
    });

it("resolves omitted blocks and fields to the documented defaults", () => {
  for (const app of [{}, { privacy: {} }, { privacy: { mask: {} } }]) {
    const maskingFor = createMaskingResolver(() => app);
    for (const privacy of [undefined, {}, { mask: {} }, { mask: { display: "default" } }]) {
      const workbench = workbenchSchema.parse({ ...base, privacy });
      expect(areas.map((area) => maskingFor(workbench, area))).toEqual([false, false, true, true]);
    }
  }
});

it("reads live app settings and keeps explicit choices and workbenches independent", () => {
  let app: Pick<Settings, "privacy"> = defaultSettings("00000000-0000-4000-8000-000000000001");
  const maskingFor = createMaskingResolver(() => app);
  const inherited = workbenchSchema.parse(base);
  const explicit = workbenchSchema.parse({ ...base, privacy: { mask: { display: "off", agent: "on" } } });
  expect(maskingFor(inherited, "display")).toBe(false);
  app = { privacy: { mask: { display: true, agent: false } } };
  expect(maskingFor(inherited, "display")).toBe(true);
  expect(maskingFor(inherited, "agent")).toBe(false);
  expect(maskingFor(explicit, "display")).toBe(false);
  expect(maskingFor(explicit, "agent")).toBe(true);
});
