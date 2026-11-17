import { generateKeyPairSync } from "node:crypto";
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CatalogChannel } from "@vera/shared";
import { afterEach, expect, it, vi } from "vitest";
import { parse, stringify } from "yaml";
import { PluginCatalog } from "./catalog.js";
import { buildCatalogRelease, signCatalogRelease } from "./catalog-source.js";
import { PluginStore } from "./store.js";

const official = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../plugins");
/** A throwaway signing key pair: releases are signed with it and the client pins its public key. */
const pair = (key = generateKeyPairSync("ed25519")) => ({
  privatePem: key.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  publicPem: key.publicKey.export({ type: "spki", format: "pem" }).toString(),
});
const keys = pair();
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
    stringify({
      format: 1,
      official: ["serial-monitor", "esp32-esptool"],
      reviewed: [],
      metadata: {
        "serial-monitor": {
          activities: ["communication", "debug"],
          keywords: ["UART", "console"],
          addedAt: "2024-02-29",
          updatedAt: "2026-11-03",
        },
        "esp32-esptool": { activities: ["flash"], keywords: ["Espressif"] },
      },
    }),
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
  await signCatalogRelease(out, keys.privatePem);
  return out;
}
/** A loopback catalog host serving `state.folder`; `state.requests` records every path. */
async function host() {
  const state = { folder: "", requests: [] as string[], status: 200, failing: "" };
  const server = createServer(async (request, response) => {
    const name = decodeURIComponent((request.url ?? "/").split("/").at(-1) ?? "");
    state.requests.push(name);
    try {
      if (state.status !== 200 || name === state.failing) throw new Error("status");
      const body = await readFile(join(state.folder, name));
      response.writeHead(200, { "content-length": body.length }).end(body);
    } catch {
      response.writeHead(name === state.failing ? 503 : state.status === 200 ? 404 : state.status).end();
    }
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/vera/catalog`;
  return { state, server, url };
}
async function fixture(
  options: {
    location?: string;
    bundled?: string;
    finalUrl?: string;
    channel?: CatalogChannel;
    publicKey?: string | null;
  } = {},
) {
  const data = await temp("data");
  const store = new PluginStore({ root: join(data, "plugins") });
  let location = options.location;
  // Most tests read the 0.x plugins, so the fixture defaults to the channel that lists them.
  let channel = options.channel ?? "pre-release";
  const publicKey = options.publicKey === undefined ? keys.publicPem : options.publicKey;
  const catalog = new PluginCatalog({
    store,
    root: join(data, "plugins", "catalog"),
    location: () => location,
    channel: () => channel,
    ...(publicKey !== null ? { publicKey } : {}),
    ...(options.bundled ? { bundled: options.bundled } : {}),
    now: () => new Date("2026-11-03T12:00:00.000Z"),
    fetch: async (url, init) => {
      const response = await fetch(url, init.signal ? { signal: init.signal } : {});
      if (options.finalUrl) Object.defineProperty(response, "url", { value: options.finalUrl });
      return response;
    },
  });
  const kept = async () => readdir(join(data, "plugins", "catalog")).catch(() => [] as string[]);
  return {
    data,
    store,
    catalog,
    kept,
    setLocation: (value: string | undefined) => (location = value),
    setChannel: (value: CatalogChannel) => (channel = value),
  };
}
const sha = (folder: string) => async (name: string) => {
  const index = JSON.parse(await readFile(join(folder, "index.json"), "utf8"));
  return index.plugins.find((plugin: { id: string }) => plugin.id === name);
};
/** Edits the bundled and the pre-release index (the fixture's channel) and signs the release again. */
async function rewriteIndex(folder: string, edit: (index: { plugins: Record<string, unknown>[] }) => void) {
  for (const name of ["index.json", "index-pre-release.json"]) {
    const path = join(folder, name);
    const index = JSON.parse(await readFile(path, "utf8"));
    edit(index);
    await writeFile(path, JSON.stringify(index));
  }
  await signCatalogRelease(folder, keys.privatePem);
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
  expect(remote.plugins.find((p) => p.id === "serial-monitor")).toMatchObject({
    activities: ["communication", "debug"],
    keywords: ["UART", "console"],
    addedAt: "2024-02-29",
    updatedAt: "2026-11-03",
  });
  expect(remote.plugins.find((p) => p.id === "esp32-esptool")).not.toHaveProperty("addedAt");
  expect(remote.plugins.map((plugin) => [plugin.id, plugin.version, plugin.tier])).toEqual([
    ["esp32-esptool", "0.2.1", "official"],
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
  expect(missing.plugins.find((plugin) => plugin.id === "serial-monitor")?.version).toBe("0.2.0");

  state.status = 200;
  await writeFile(join(served, "index-pre-release.json"), "{ not json");
  await signCatalogRelease(served, keys.privatePem);
  expect(await catalog.view({ refresh: true })).toMatchObject({ source: "bundled", problem: "invalid" });

  setLocation("http://127.0.0.1:1/vera/");
  expect(await catalog.view({ refresh: false })).toMatchObject({ source: "bundled", problem: "unreachable" });

  setLocation(undefined);
  const offline = await catalog.view({ refresh: false });
  expect(offline.source).toBe("bundled");
  expect(offline.problem).toBeUndefined();
  expect(offline.plugins.find((p) => p.id === "serial-monitor")).toMatchObject({
    activities: ["communication", "debug"],
    keywords: ["UART", "console"],
    addedAt: "2024-02-29",
    updatedAt: "2026-11-03",
  });
  expect(offline.plugins.find((p) => p.id === "esp32-esptool")).not.toHaveProperty("updatedAt");

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

it("treats a catalog read that never answers as unreachable when its timeout ends", async () => {
  const data = await temp("data");
  const timeout = new AbortController();
  const timer = vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
  try {
    const catalog = new PluginCatalog({
      store: new PluginStore({ root: join(data, "plugins") }),
      root: join(data, "plugins", "catalog"),
      location: () => "https://catalog.example.test/vera/",
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
          timeout.abort();
        }),
    });
    expect(await catalog.view({ refresh: true })).toMatchObject({ source: "none", problem: "unreachable" });
    expect(timer).toHaveBeenCalledWith(30_000);
  } finally {
    timer.mockRestore();
  }
});

// REQ-FUNC-f244f8f6
it("installs a reviewed catalog plugin with its tier and the catalog source, once per review", async () => {
  const { state, url } = await host();
  state.folder = await release();
  const { catalog, store, kept, data } = await fixture({ location: url });
  await catalog.view({ refresh: true });
  const timer = vi.spyOn(AbortSignal, "timeout");
  const reviewed = await catalog.review("serial-monitor");
  // A package download gets a far longer limit than the index reads, so a slow connection still completes.
  expect(timer).toHaveBeenLastCalledWith(15 * 60_000);
  timer.mockRestore();
  expect(reviewed).toMatchObject({
    id: "serial-monitor",
    version: "0.2.0",
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
  expect(record.source).toEqual({ kind: "catalog", path: `${url}/serial-monitor-0.2.0.zip` });
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
  expect((await catalog.review("serial-monitor")).version).toBe(manifest.version);
});

// REQ-SEC-69f9d44d - a pre-release plugin lowered from 1.0.0 is reinstalled, never migrated.
it("keeps refusing a lowered plugin as an update and installs it after an uninstall", async () => {
  const { state, url } = await host();
  state.folder = await release();
  const { catalog, store } = await fixture({ location: url });
  const manifest = parse(await readFile(join(official, "serial-monitor", "plugin.yaml"), "utf8"));
  expect(manifest.version).toMatch(/^0\./);
  const old = join(await temp("old"), "serial-monitor");
  await cp(join(official, "serial-monitor"), old, { recursive: true });
  await writeFile(join(old, "plugin.yaml"), stringify({ ...manifest, version: "1.0.0" }));
  await store.install(old);

  const view = await catalog.view({ refresh: true });
  expect(view.plugins.find((plugin) => plugin.id === "serial-monitor")).toMatchObject({
    version: manifest.version,
    installed: { version: "1.0.0" },
    update: false,
  });
  const downgrade = { code: "CONFLICT", messageKey: "plugins.catalogError.downgrade" };
  await expect(catalog.review("serial-monitor")).rejects.toMatchObject(downgrade);
  await expect(catalog.install("serial-monitor", "0".repeat(64))).rejects.toMatchObject(downgrade);
  expect((await store.list())[0]?.version).toBe("1.0.0");

  await store.uninstall("serial-monitor");
  const review = await catalog.review("serial-monitor");
  expect(review.version).toBe(manifest.version);
  await catalog.install("serial-monitor", review.review.sha256);
  expect(await store.list()).toMatchObject([
    { id: "serial-monitor", version: manifest.version, tier: "official" },
  ]);
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
    installed: { version: "0.2.0", tier: "local" },
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
  expect((await store.list())[0]?.version).toBe("0.2.0");
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

// REQ-FUNC-b7ff35bf
it("reads the selected channel's index from a remote catalog and every plugin from the bundled one", async () => {
  const bundled = await release();
  const { state, url } = await host();
  state.folder = await release((manifest) => {
    manifest.version = "1.0.1";
  });
  const { catalog, setChannel, setLocation } = await fixture({ location: url, bundled, channel: "stable" });
  const ids = async (refresh: boolean) =>
    (await catalog.view({ refresh })).plugins.map((plugin) => [plugin.id, plugin.version]);

  expect(await ids(true)).toEqual([["serial-monitor", "1.0.1"]]);
  expect(state.requests).toEqual(["index-stable.json", "index-stable.json.sig"]);
  setChannel("pre-release");
  expect(await ids(false)).toEqual([
    ["esp32-esptool", "0.2.1"],
    ["serial-monitor", "1.0.1"],
  ]);
  expect(state.requests.slice(2)).toEqual(["index-pre-release.json", "index-pre-release.json.sig"]);

  setChannel("stable");
  setLocation(undefined);
  expect(await ids(false)).toEqual([
    ["esp32-esptool", "0.2.1"],
    ["serial-monitor", "0.2.0"],
  ]);
});

// REQ-SEC-3e11ffe4
it("refuses a remote index without a signature and shows the bundled catalog", async () => {
  const bundled = await release();
  const { state, url } = await host();
  state.folder = await release((manifest) => {
    manifest.version = "1.0.1";
  });
  const { catalog, setLocation } = await fixture({ location: url, bundled });
  expect(await catalog.view({ refresh: true })).toMatchObject({ source: "remote" });

  // A signature the server fails to send is a transfer problem, not a missing signature.
  state.failing = "index-pre-release.json.sig";
  expect(await catalog.view({ refresh: true })).toMatchObject({ source: "bundled", problem: "unreachable" });
  state.failing = "";
  await rm(join(state.folder, "index-pre-release.json.sig"));
  const unsigned = await catalog.view({ refresh: true });
  expect(unsigned).toMatchObject({ source: "bundled", problem: "unsigned" });
  expect(unsigned.plugins.find((plugin) => plugin.id === "serial-monitor")?.version).toBe("0.2.0");
  await expect(catalog.review("serial-monitor")).resolves.toMatchObject({ version: "0.2.0" });

  // Offline, without a remote catalog, the bundled release needs no signature.
  setLocation(undefined);
  const offline = await catalog.view({ refresh: true });
  expect(offline.source).toBe("bundled");
  expect(offline.problem).toBeUndefined();
});

// REQ-SEC-d96c5192
it("refuses a remote index changed after signing or signed with another key", async () => {
  const bundled = await release();
  const { state, url } = await host();
  state.folder = await release();
  const changed = await fixture({ location: url, bundled });
  expect(await changed.catalog.view({ refresh: true })).toMatchObject({ source: "remote" });

  const path = join(state.folder, "index-pre-release.json");
  const index = JSON.parse(await readFile(path, "utf8"));
  index.plugins[0].sha256 = "0".repeat(64);
  await writeFile(path, `${JSON.stringify(index, null, 2)}\n`);
  expect(await changed.catalog.view({ refresh: true })).toMatchObject({
    source: "bundled",
    problem: "untrusted",
  });

  await signCatalogRelease(state.folder, pair().privatePem);
  expect(await changed.catalog.view({ refresh: true })).toMatchObject({ problem: "untrusted" });

  await signCatalogRelease(state.folder, keys.privatePem);
  expect(await changed.catalog.view({ refresh: true })).toMatchObject({ source: "remote" });
  await writeFile(join(state.folder, "index-pre-release.json.sig"), "not base64 at all\n");
  expect(await changed.catalog.view({ refresh: true })).toMatchObject({ problem: "untrusted" });

  // Another channel's signed index served under this channel's name: the signed channel field differs.
  await signCatalogRelease(state.folder, keys.privatePem);
  const stable = await fixture({ location: url, bundled, channel: "stable" });
  expect(await stable.catalog.view({ refresh: true })).toMatchObject({ source: "remote" });
  for (const suffix of ["", ".sig"])
    await writeFile(
      join(state.folder, `index-stable.json${suffix}`),
      await readFile(join(state.folder, `index-pre-release.json${suffix}`)),
    );
  expect(await stable.catalog.view({ refresh: true })).toMatchObject({
    source: "bundled",
    problem: "untrusted",
  });

  const unpinned = await fixture({ location: url, publicKey: null });
  expect(await unpinned.catalog.view({ refresh: true })).toMatchObject({
    source: "none",
    problem: "untrusted",
  });
});

it("previews a catalog plugin in memory without disturbing the zip of a review in progress", async () => {
  const { state, url } = await host();
  state.folder = await release();
  const { catalog, store, kept } = await fixture({ location: url });
  await catalog.view({ refresh: true });
  const reviewed = await catalog.review("serial-monitor");
  const before = await kept();
  const preview = await catalog.preview("esp32-esptool");
  expect(preview.manifest?.id).toBe("esp32-esptool");
  expect(preview.issues).toEqual([]);
  expect(await kept()).toEqual(before);
  await expect(catalog.install("serial-monitor", reviewed.review.sha256)).resolves.toMatchObject({
    id: "serial-monitor",
  });
  expect((await store.list()).map((plugin) => plugin.id)).toEqual(["serial-monitor"]);
  await rewriteIndex(state.folder, (index) => {
    const entry = index.plugins.find((plugin) => plugin.id === "esp32-esptool") as Record<string, unknown>;
    entry.sha256 = "0".repeat(64);
  });
  await catalog.view({ refresh: true });
  await expect(catalog.preview("esp32-esptool")).rejects.toMatchObject({
    messageKey: "plugins.catalogError.sha256",
  });
});
