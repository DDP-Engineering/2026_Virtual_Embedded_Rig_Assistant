import { generateKeyPairSync } from "node:crypto";
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PluginCatalog, PluginStore, SkillCatalog, signCatalogRelease } from "@vera/core";
import { afterAll, expect, it } from "vitest";

// @ts-expect-error Native ESM build helper.
import * as bundledPlugins from "../../../02_Tools/environment/prepare-plugins.mjs";

const { checkBundledPlugins, prepareBundledPlugins } = bundledPlugins;

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
    ["arduino-cli", "official"],
    ["binutils", "official"],
    ["ble-tools", "official"],
    ["bus-tools", "official"],
    ["can-dbc", "official"],
    ["can-python", "official"],
    ["circuitpython", "official"],
    ["electrical-documentation", "official"],
    ["electrical-network", "official"],
    ["electronics-calc", "official"],
    ["esp32-efuse", "official"],
    ["esp32-esptool", "official"],
    ["esp32-idf", "official"],
    ["freerouting", "official"],
    ["gdb-debug", "official"],
    ["git", "official"],
    ["hil-testing", "official"],
    ["industrial-catalog", "official"],
    ["kicad", "official"],
    ["kicad-layout", "official"],
    ["lab-validation", "official"],
    ["lighting-design", "official"],
    ["ltspice", "official"],
    ["microchip-pymcuprog", "official"],
    ["micropython", "official"],
    ["motor-drives", "official"],
    ["mqtt-tools", "official"],
    ["ngspice", "official"],
    ["panel-engineering", "official"],
    ["parts-search", "official"],
    ["platformio", "official"],
    ["power-profiler", "official"],
    ["power-quality-pfc", "official"],
    ["probe-rs", "official"],
    ["protection-coordination", "official"],
    ["qelectrotech", "official"],
    ["raspberry-pi-linux", "official"],
    ["renode", "official"],
    ["scpi-instruments", "official"],
    ["serial-monitor", "official"],
    ["sigrok", "official"],
    ["stm32-cubeprog", "official"],
    ["wireshark-tshark", "official"],
    ["wokwi", "official"],
    ["zephyr", "official"],
  ]);
  expect(JSON.parse(await readFile(join(target, "index.json"), "utf8"))).toEqual(index);
  expect(index.plugins.find((plugin: { id: string }) => plugin.id === "serial-monitor")).toMatchObject({
    activities: ["communication", "debug"],
    keywords: ["serial", "UART", "console", "COM", "pyserial"],
  });
  // REQ-DATA-0f278063
  expect(index.plugins.find((plugin: { id: string }) => plugin.id === "electronics-calc")).toMatchObject({
    activities: ["design"],
    ecosystem: "electronics",
    version: "0.3.0",
  });
  // REQ-DATA-ece2d69c
  expect(index.plugins.find((plugin: { id: string }) => plugin.id === "kicad")).toMatchObject({
    activities: ["design"],
    ecosystem: "electronics",
    version: "0.3.0",
  });
  for (const plugin of index.plugins) {
    expect(plugin.activities.length).toBeGreaterThan(0);
    expect(plugin.keywords.length).toBeGreaterThan(0);
    expect(plugin).not.toHaveProperty("addedAt");
    expect(plugin).not.toHaveProperty("updatedAt");
  }
  await expect(checkBundledPlugins(target)).resolves.toEqual(index);
  // REQ-DATA-78f62129: the release carries both channel indexes; only ltspice is stable today.
  const channel = async (name: string) => JSON.parse(await readFile(join(target, name), "utf8"));
  expect(await channel("index-pre-release.json")).toEqual({ ...index, channel: "pre-release" });
  const stable = await channel("index-stable.json");
  expect(
    stable.plugins.map((plugin: { id: string; version: string }) => [plugin.id, plugin.version]),
  ).toEqual([["ltspice", "1.0.0"]]);
  for (const pack of stable.packs)
    for (const group of pack.groups) expect(group.plugins).toEqual(["ltspice"]);
  // PLG-07-A: the signed release folder, served as a plain copy by a loopback mirror, installs.
  const key = generateKeyPairSync("ed25519");
  await signCatalogRelease(target, key.privateKey.export({ type: "pkcs8", format: "pem" }).toString());
  const server = createServer(async (request, response) => {
    try {
      const body = await readFile(
        join(target, decodeURIComponent((request.url ?? "/").split("/").at(-1) ?? "")),
      );
      response.writeHead(200, { "content-length": body.length }).end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  try {
    const mirror = `http://127.0.0.1:${(server.address() as AddressInfo).port}/vera/`;
    const store = new PluginStore({ root: join(target, "mirror-installed") });
    const catalog = new PluginCatalog({
      store,
      root: join(target, "mirror-catalog"),
      location: () => mirror,
      publicKey: key.publicKey.export({ type: "spki", format: "pem" }).toString(),
      fetch: (url, init) => fetch(url, init.signal ? { signal: init.signal } : {}),
    });
    const view = await catalog.view({ refresh: true });
    expect(view).toMatchObject({ source: "remote", url: mirror });
    expect(view.problem).toBeUndefined();
    expect(view.plugins.map((plugin) => plugin.id)).toEqual(["ltspice"]);
    const reviewed = await catalog.review("ltspice");
    await catalog.install("ltspice", reviewed.review.sha256);
    expect((await store.list()).map((plugin) => [plugin.id, plugin.version, plugin.tier])).toEqual([
      ["ltspice", "1.0.0", "official"],
    ]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
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
