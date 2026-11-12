import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PluginStore, SkillCatalog } from "@vera/core";
import { afterAll, expect, it } from "vitest";

// @ts-expect-error Native ESM build helper.
import { checkBundledPlugins, prepareBundledPlugins } from "../../scripts/prepare-plugins.mjs";

const target = join(tmpdir(), `vera-bundled-plugins-${process.pid}`);
afterAll(async () => {
  await rm(target, { recursive: true, force: true });
});

// REQ-PLAT-720aa4f2
it("builds the official plugins into a bundled catalog release and checks it against its index", async () => {
  // The shared CLI build (npm run vera, other suites) is never rewritten underneath them.
  const shared = join(import.meta.dirname, "../../src/apps/cli/dist/index.js");
  const before = await stat(shared).then(
    (info) => info.mtimeMs,
    () => undefined,
  );
  const index = await prepareBundledPlugins({ target });
  expect(
    await stat(shared).then(
      (info) => info.mtimeMs,
      () => undefined,
    ),
  ).toBe(before);
  expect(index.plugins.map((plugin: { id: string; tier: string }) => [plugin.id, plugin.tier])).toEqual([
    ["analysis-skills", "official"],
    ["binutils", "official"],
    ["can-dbc", "official"],
    ["can-python", "official"],
    ["esp32-efuse", "official"],
    ["esp32-esptool", "official"],
    ["esp32-idf", "official"],
    ["git", "official"],
    ["microchip-pymcuprog", "official"],
    ["probe-rs", "official"],
    ["serial-monitor", "official"],
    ["sigrok", "official"],
    ["stm32-cubeprog", "official"],
    ["wireshark-tshark", "official"],
  ]);
  expect(JSON.parse(await readFile(join(target, "index.json"), "utf8"))).toEqual(index);
  expect(index.plugins.find((plugin: { id: string }) => plugin.id === "serial-monitor")).toMatchObject({
    activities: ["communication", "debug"],
    keywords: ["serial", "UART", "console", "COM", "pyserial"],
  });
  for (const plugin of index.plugins) {
    expect(plugin.activities.length).toBeGreaterThan(0);
    expect(plugin.keywords.length).toBeGreaterThan(0);
    expect(plugin).not.toHaveProperty("addedAt");
    expect(plugin).not.toHaveProperty("updatedAt");
  }
  await expect(checkBundledPlugins(target)).resolves.toEqual(index);
  const analysis = index.plugins.find((plugin: { id: string }) => plugin.id === "analysis-skills");
  expect(analysis).toBeDefined();
  const store = new PluginStore({ root: join(target, "installed") });
  await store.install(join(target, analysis.url));
  const installed = await store.load("analysis-skills");
  const skills = new SkillCatalog({
    root: target,
    disabled: () => [],
    plugins: async () => [{ id: "analysis-skills", folder: installed.folder }],
  });
  expect(await skills.list()).toContainEqual(
    expect.objectContaining({ name: "firmware-comparator", source: "plugin" }),
  );
  expect(
    await skills.load("firmware-comparator", "templates/comparison.md", new AbortController().signal),
  ).toMatchObject({ text: expect.stringContaining("## Recommended checks") });
  expect(await skills.list()).toContainEqual(
    expect.objectContaining({ name: "test-planner", source: "plugin" }),
  );
  expect(await skills.load("test-planner", undefined, new AbortController().signal)).toMatchObject({
    text: expect.stringContaining("observation-only"),
  });
  expect(
    await skills.load("test-planner", "templates/test-plan.md", new AbortController().signal),
  ).toMatchObject({
    text: expect.stringContaining("## Results to collect"),
  });
  const zip = join(target, index.plugins[0].url);
  await writeFile(zip, Buffer.concat([await readFile(zip), Buffer.from([0])]));
  await expect(checkBundledPlugins(target)).rejects.toThrow(/bundled plugin integrity/);
  // A second preparation replaces the folder as a whole.
  await expect(prepareBundledPlugins({ target })).resolves.toEqual(index);
}, 120_000);
