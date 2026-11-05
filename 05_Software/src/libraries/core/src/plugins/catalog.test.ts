import { cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { PluginCatalog } from "./catalog.js";
import { buildCatalogRelease } from "./catalog-source.js";
import { PluginStore } from "./store.js";

const official = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../plugins");
const roots: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function temp(name: string) {
  const root = await mkdtemp(join(tmpdir(), `vera-catalog-${name}-`));
  roots.push(root);
  return root;
}
type Manifest = Record<string, unknown> & {
  rules: Record<string, unknown>[];
  programs: Record<string, never>;
};
/** A small real two-plugin catalog; full official inventory is verified by packaging tests. */
async function release(edit: (manifest: Manifest) => void = () => {}) {
  const source = await temp("source");
  for (const id of ["serial-monitor", "esp32-esptool"])
    await cp(join(official, id), join(source, id), { recursive: true });
  await writeFile(
    join(source, "catalog.yaml"),
    stringify({ format: 1, official: ["serial-monitor", "esp32-esptool"], reviewed: [] }),
  );
  await writeFile(
    join(source, "packs.yaml"),
    stringify([
      {
        id: "esp32",
        name: "ESP32",
        groups: [{ name: "Core", plugins: ["serial-monitor", "esp32-esptool"], default: true }],
      },
    ]),
  );
  const path = join(source, "serial-monitor", "plugin.yaml");
  const manifest = parse(await readFile(path, "utf8")) as Manifest;
  edit(manifest);
  await writeFile(path, stringify(manifest));
  const out = join(await temp("release"), "out");
  const built = await buildCatalogRelease(source, out);
  expect(built.issues).toEqual([]);
  return out;
}
/** A loopback catalog host serving `state.folder`; `state.requests` records every path. */
async function host() {
  const state = { folder: "", requests: [] as string[], status: 200 };
  const server = createServer(async (request, response) => {
    const name = decodeURIComponent((request.url ?? "/").split("/").at(-1) ?? "");
    state.requests.push(name);
    try {
      if (state.status !== 200) throw new Error("status");
      const body = await readFile(join(state.folder, name));
      response.writeHead(200, { "content-length": body.length }).end(body);
    } catch {
      response.writeHead(state.status === 200 ? 404 : state.status).end();
    }
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/vera/catalog`;
  return { state, server, url };
}
async function fixture(options: { location?: string; bundled?: string; finalUrl?: string } = {}) {
  const data = await temp("data");
  const store = new PluginStore({ root: join(data, "plugins") });
  let location = options.location;
  const catalog = new PluginCatalog({
    store,
    root: join(data, "plugins", "catalog"),
    location: () => location,
    ...(options.bundled ? { bundled: options.bundled } : {}),
    now: () => new Date("2026-11-03T12:00:00.000Z"),
    fetch: async (url, init) => {
      const response = await fetch(url, init.signal ? { signal: init.signal } : {});
      if (options.finalUrl) Object.defineProperty(response, "url", { value: options.finalUrl });
      return response;
    },
  });
  const kept = async () => readdir(join(data, "plugins", "catalog")).catch(() => [] as string[]);
  return { data, store, catalog, kept, setLocation: (value: string | undefined) => (location = value) };
}
const sha = (folder: string) => async (name: string) => {
  const index = JSON.parse(await readFile(join(folder, "index.json"), "utf8"));
  return index.plugins.find((plugin: { id: string }) => plugin.id === name);
};
async function rewriteIndex(folder: string, edit: (index: { plugins: Record<string, unknown>[] }) => void) {
  const path = join(folder, "index.json");
  const index = JSON.parse(await readFile(path, "utf8"));
  edit(index);
  await writeFile(path, JSON.stringify(index));
}

// REQ-FUNC-98ded47a
it("reads the configured catalog and falls back to the bundled one when it is unreachable or invalid", async () => {
  const bundled = await release();
  const served = await release((manifest) => {
    manifest.version = "1.0.1";
  });
  const { state, url } = await host();
  state.folder = served;
  const { catalog, setLocation } = await fixture({ location: url, bundled });

  const remote = await catalog.view({ refresh: true });
  expect(remote).toMatchObject({ source: "remote", url: `${url}/`, checkedAt: "2026-11-03T12:00:00.000Z" });
  expect(remote.problem).toBeUndefined();
  expect(remote.plugins.map((plugin) => [plugin.id, plugin.version, plugin.tier])).toEqual([
    ["esp32-esptool", "1.0.0", "official"],
    ["serial-monitor", "1.0.1", "official"],
  ]);
  expect(remote.packs[0]?.groups[0]).toEqual({
    name: "Core",
    plugins: ["serial-monitor", "esp32-esptool"],
    default: true,
  });

  state.status = 404;
  const missing = await catalog.view({ refresh: true });
  expect(missing).toMatchObject({ source: "bundled", problem: "unreachable" });
  expect(missing.plugins.find((plugin) => plugin.id === "serial-monitor")?.version).toBe("1.0.0");

  state.status = 200;
  await writeFile(join(served, "index.json"), "{ not json");
  expect(await catalog.view({ refresh: true })).toMatchObject({ source: "bundled", problem: "invalid" });

  setLocation("http://127.0.0.1:1/vera/");
  expect(await catalog.view({ refresh: false })).toMatchObject({ source: "bundled", problem: "unreachable" });

  setLocation(undefined);
  const offline = await catalog.view({ refresh: false });
  expect(offline.source).toBe("bundled");
  expect(offline.problem).toBeUndefined();

  const none = await (await fixture()).catalog.view({ refresh: true });
  expect(none).toMatchObject({ source: "none", plugins: [], packs: [] });
});

// REQ-SEC-a3c31442
it("treats a read redirected away from https or loopback http as unreachable", async () => {
  const { state, url } = await host();
  state.folder = await release();
  const { catalog } = await fixture({ location: url, finalUrl: "http://mirror.example.test/index.json" });
  expect(await catalog.view({ refresh: true })).toMatchObject({ source: "none", problem: "unreachable" });
  const secure = await fixture({ location: url, finalUrl: "https://objects.example.test/x?sig=1" });
  expect((await secure.catalog.view({ refresh: true })).source).toBe("remote");
  const ignored = await fixture({ location: "http://mirror.example.test/" });
  expect((await ignored.catalog.view({ refresh: true })).source).toBe("none");
});

// REQ-FUNC-f244f8f6
it("installs a reviewed catalog plugin with its tier and the catalog source, once per review", async () => {
  const { state, url } = await host();
  state.folder = await release();
  const { catalog, store, kept, data } = await fixture({ location: url });
  await catalog.view({ refresh: true });
  const reviewed = await catalog.review("serial-monitor");
  expect(reviewed).toMatchObject({
    id: "serial-monitor",
    version: "1.0.0",
    tier: "official",
    required: true,
  });
  expect(reviewed.review.manifest?.id).toBe("serial-monitor");
  expect(await kept()).toEqual([`${(await sha(state.folder)("serial-monitor")).sha256}.zip`]);

  const installed = await catalog.install("serial-monitor", reviewed.review.sha256);
  expect(installed).toMatchObject({
    id: "serial-monitor",
    tier: "official",
    source: "catalog",
    sha256: reviewed.review.sha256,
    issues: [],
  });
  expect(await kept()).toEqual([]);
  const record = JSON.parse(
    await readFile(join(data, "plugins", "installed", "serial-monitor", "install.json"), "utf8"),
  );
  expect(record.source).toEqual({ kind: "catalog", path: `${url}/serial-monitor-1.0.0.zip` });
  await expect(catalog.install("serial-monitor", reviewed.review.sha256)).rejects.toMatchObject({
    code: "CONFLICT",
  });

  const again = await catalog.review("esp32-esptool");
  const zip = join(data, "plugins", "catalog", (await kept())[0] ?? "");
  await writeFile(zip, Buffer.concat([await readFile(zip), Buffer.from("x")]));
  await expect(catalog.install("esp32-esptool", again.review.sha256)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  expect((await store.list()).map((plugin) => plugin.id)).toEqual(["serial-monitor"]);
});

// REQ-SEC-449e334b
it("refuses a zip whose hash or size differs from its entry and keeps nothing of it", async () => {
  const { state, url } = await host();
  state.folder = await release();
  await rewriteIndex(state.folder, (index) => {
    const entry = index.plugins.find((plugin) => plugin.id === "serial-monitor") as Record<string, unknown>;
    entry.sha256 = "0".repeat(64);
  });
  const { catalog, store, kept } = await fixture({ location: url });
  await catalog.view({ refresh: true });
  await expect(catalog.review("serial-monitor")).rejects.toMatchObject({
    code: "INVALID",
    messageKey: "plugins.catalogError.sha256",
  });
  expect(await kept()).toEqual([]);
  expect(await store.list()).toEqual([]);

  const longer = await release();
  state.folder = longer;
  const entry = await sha(longer)("serial-monitor");
  await writeFile(
    join(longer, entry.url),
    Buffer.concat([await readFile(join(longer, entry.url)), Buffer.from([0])]),
  );
  await catalog.view({ refresh: true });
  await expect(catalog.review("serial-monitor")).rejects.toMatchObject({
    messageKey: "plugins.catalogError.sha256",
  });
  expect(await kept()).toEqual([]);
  await expect(catalog.review("ghost")).rejects.toMatchObject({ code: "NOT_FOUND" });
});

// REQ-SEC-6305d7b7
it("refuses a zip whose package does not match its entry and removes it", async () => {
  const { state, url } = await host();
  state.folder = await release();
  await rewriteIndex(state.folder, (index) => {
    const entry = index.plugins.find((plugin) => plugin.id === "serial-monitor") as Record<string, unknown>;
    entry.version = "9.9.9";
  });
  const { catalog, kept } = await fixture({ location: url });
  await catalog.view({ refresh: true });
  await expect(catalog.review("serial-monitor")).rejects.toMatchObject({
    code: "INVALID",
    messageKey: "plugins.catalogError.mismatch",
  });
  expect(await kept()).toEqual([]);
});

// REQ-SEC-69f9d44d
it("refuses to replace an installed plugin with a lower catalog version", async () => {
  const { state, url } = await host();
  state.folder = await release();
  const { catalog, store } = await fixture({ location: url });
  const newer = join(await temp("newer"), "serial-monitor");
  await cp(join(official, "serial-monitor"), newer, { recursive: true });
  const manifest = parse(await readFile(join(newer, "plugin.yaml"), "utf8"));
  await writeFile(join(newer, "plugin.yaml"), stringify({ ...manifest, version: "1.1.0" }));
  await store.install(newer);
  await catalog.view({ refresh: true });
  await expect(catalog.review("serial-monitor")).rejects.toMatchObject({
    code: "CONFLICT",
    messageKey: "plugins.catalogError.downgrade",
  });
  expect((await store.list())[0]?.version).toBe("1.1.0");

  await store.install(join(official, "serial-monitor"));
  expect((await catalog.review("serial-monitor")).version).toBe("1.0.0");
});

// REQ-FUNC-46079512
it("requires a review for a first install and for updates that change programs or rules", async () => {
  const { state, url } = await host();
  state.folder = await release();
  const { catalog, store } = await fixture({ location: url });
  await catalog.view({ refresh: true });
  const first = await catalog.review("serial-monitor");
  expect(first.required).toBe(true);
  await catalog.install("serial-monitor", first.review.sha256);

  state.folder = await release((manifest) => {
    manifest.version = "1.0.1";
    manifest.description = "A clearer description.";
  });
  await catalog.view({ refresh: true });
  const text = await catalog.review("serial-monitor");
  expect(text.required).toBe(false);
  await catalog.install("serial-monitor", text.review.sha256);
  expect((await store.list())[0]?.version).toBe("1.0.1");

  state.folder = await release((manifest) => {
    manifest.version = "1.0.2";
    (manifest.rules[0] as { risk: string }).risk = "device-read";
  });
  await catalog.view({ refresh: true });
  expect((await catalog.review("serial-monitor")).required).toBe(true);

  state.folder = await release((manifest) => {
    manifest.version = "1.0.2";
    const programs = manifest.programs as Record<string, { install: unknown }>;
    const [name] = Object.keys(programs);
    if (name) (programs[name] as { install: unknown }).install = { pip: "pyserial-tools" };
  });
  await catalog.view({ refresh: true });
  expect((await catalog.review("serial-monitor")).required).toBe(true);
});

// REQ-FUNC-ce542246
it("marks installed plugins with a higher catalog version as updates without fetching any zip", async () => {
  const { state, url } = await host();
  state.folder = await release();
  const { catalog, store } = await fixture({ location: url });
  await store.install(join(official, "serial-monitor"));
  const same = await catalog.view({ refresh: true });
  expect(same.plugins.find((plugin) => plugin.id === "serial-monitor")).toMatchObject({
    installed: { version: "1.0.0", tier: "local" },
    update: false,
  });
  expect(same.plugins.find((plugin) => plugin.id === "esp32-esptool")).toMatchObject({ update: false });
  expect(same.plugins.find((plugin) => plugin.id === "esp32-esptool")?.installed).toBeUndefined();

  state.folder = await release((manifest) => {
    manifest.version = "1.0.1";
  });
  const newer = await catalog.view({ refresh: true });
  expect(newer.plugins.find((plugin) => plugin.id === "serial-monitor")?.update).toBe(true);
  expect(state.requests.filter((name) => name.endsWith(".zip"))).toEqual([]);
  expect((await store.list())[0]?.version).toBe("1.0.0");
});

// REQ-PLAT-720aa4f2
it("installs from the bundled catalog without any network", async () => {
  const bundled = await release();
  const { catalog, kept } = await fixture({ bundled });
  const view = await catalog.view({ refresh: false });
  expect(view.source).toBe("bundled");
  // A review the user cancelled leaves nothing behind once the next review starts.
  const cancelled = await catalog.review("esp32-esptool");
  const reviewed = await catalog.review("serial-monitor");
  expect(await kept()).toEqual([`${(await sha(bundled)("serial-monitor")).sha256}.zip`]);
  await expect(catalog.install("esp32-esptool", cancelled.review.sha256)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  expect(await catalog.install("serial-monitor", reviewed.review.sha256)).toMatchObject({
    tier: "official",
    source: "catalog",
  });
  // Overlapping calls run one after another: each review finishes before the next one clears the folder.
  const [first, second] = await Promise.all([
    catalog.review("esp32-esptool"),
    catalog.review("serial-monitor"),
  ]);
  expect([first.id, second.id]).toEqual(["esp32-esptool", "serial-monitor"]);
  expect(await kept()).toEqual([`${(await sha(bundled)("serial-monitor")).sha256}.zip`]);
});
