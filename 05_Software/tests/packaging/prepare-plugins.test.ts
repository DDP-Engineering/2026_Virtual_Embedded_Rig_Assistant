import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    ["binutils", "official"],
    ["esp32-esptool", "official"],
    ["esp32-idf", "official"],
    ["probe-rs", "official"],
    ["serial-monitor", "official"],
  ]);
  expect(JSON.parse(await readFile(join(target, "index.json"), "utf8"))).toEqual(index);
  await expect(checkBundledPlugins(target)).resolves.toEqual(index);
  const zip = join(target, index.plugins[0].url);
  await writeFile(zip, Buffer.concat([await readFile(zip), Buffer.from([0])]));
  await expect(checkBundledPlugins(target)).rejects.toThrow(/bundled plugin integrity/);
  // A second preparation replaces the folder as a whole.
  await expect(prepareBundledPlugins({ target })).resolves.toEqual(index);
}, 120_000);
