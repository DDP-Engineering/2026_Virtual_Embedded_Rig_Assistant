import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CATALOG_LIMITS, catalogIndexSchema } from "@vera/shared";
import { afterEach, expect, it } from "vitest";
import { stringify } from "yaml";
import { buildCatalogRelease, checkCatalogSource } from "./catalog-source.js";
import { PluginStore } from "./store.js";

const official = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../plugins");
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const plugin = (id: string, more: Record<string, unknown> = {}) => ({
  format: 1,
  id,
  version: "1.0.0",
  name: `Plugin ${id}`,
  description: "A test plugin.",
  ecosystem: "test",
  platforms: ["windows-x64", "linux-x64"],
  programs: { tool: { install: { pip: "tool" }, version: { args: ["--version"], match: "(\\S+)" } } },
  rules: [{ match: "tool *", risk: "device-write" }],
  ...more,
});
interface Source {
  plugins?: Record<string, unknown>;
  packs?: unknown;
  catalog?: unknown;
  files?: Record<string, string>;
}
async function source({
  plugins = { alpha: plugin("alpha"), beta: plugin("beta", { requires: ["alpha"] }) },
  packs = [
    { id: "test", name: "Test", groups: [{ name: "Core", plugins: ["alpha", "beta"], default: true }] },
  ],
  catalog = { format: 1, official: ["alpha"] },
  files = {},
}: Source = {}) {
  const root = await mkdtemp(join(tmpdir(), "vera-catalog-source-"));
  roots.push(root);
  const write = async (path: string, text: string) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  };
  for (const [folder, manifest] of Object.entries(plugins))
    await write(`${folder}/plugin.yaml`, typeof manifest === "string" ? manifest : stringify(manifest));
  // null leaves the file out (undefined takes the default).
  if (packs !== null) await write("packs.yaml", stringify(packs));
  if (catalog !== undefined) await write("catalog.yaml", stringify(catalog));
  for (const [path, text] of Object.entries(files)) await write(path, text);
  return root;
}
const codes = (issues: { where: string; code: string }[]) =>
  issues.map(({ where, code }) => `${where} ${code}`);

// REQ-FUNC-3b9f62f8
it("finds no issue in the official plugins folder and ignores other root files and dot folders", async () => {
  expect(await checkCatalogSource(official)).toEqual([]);
  const root = await source({
    files: { "CONTRIBUTING.md": "# Contributing\n", ".ci/catalog.yml": "on: push\n" },
  });
  expect(await checkCatalogSource(root)).toEqual([]);
});

// REQ-FUNC-3b9f62f8
it("reports source files, manifests and references that are missing or invalid", async () => {
  const duplicate = await source({ plugins: { alpha: plugin("alpha"), copy: plugin("alpha") }, packs: [] });
  const issues = await checkCatalogSource(duplicate);
  expect(codes(issues)).toEqual(["copy manifest"]);
  expect(issues[0]?.detail).toContain("id");

  const broken = await source({
    plugins: { alpha: "format: 1\nid: [unclosed\n", beta: plugin("beta", { version: "one" }) },
    packs: null,
  });
  expect(codes(await checkCatalogSource(broken))).toEqual([
    "packs.yaml source",
    "alpha manifest",
    "beta manifest",
  ]);

  const dangling = await source({
    plugins: { alpha: plugin("alpha", { requires: ["ghost"] }) },
    packs: [{ id: "test", name: "Test", groups: [{ name: "Core", plugins: ["alpha", "phantom"] }] }],
    catalog: { format: 1, official: ["spectre"], reviewed: [{ plugin: "alpha", match: "tool * burn *" }] },
  });
  const found = await checkCatalogSource(dangling);
  expect(codes(found)).toEqual([
    "alpha reference",
    "packs.yaml reference",
    "catalog.yaml reference",
    "catalog.yaml reference",
  ]);
  expect(found.map((issue) => issue.detail).join("\n")).toMatch(
    /ghost[\s\S]*phantom[\s\S]*spectre[\s\S]*tool \* burn \*/,
  );

  const invalid = await source({ catalog: { format: 1, tiers: {} } });
  expect(codes(await checkCatalogSource(invalid))).toEqual(["catalog.yaml source"]);
});

// REQ-SEC-dfc6a26d
it("reports a program that no rule names", async () => {
  const programs = {
    tool: { install: { pip: "tool" }, version: { args: ["--version"], match: "(\\S+)" } },
    other: { install: { pip: "other" }, version: { args: ["--version"], match: "(\\S+)" } },
  };
  const root = await source({
    plugins: { alpha: plugin("alpha", { programs }), beta: plugin("beta", { programs }) },
    catalog: { format: 1 },
    packs: [],
  });
  await writeFile(
    join(root, "beta", "plugin.yaml"),
    stringify(plugin("beta", { programs, rules: [{ match: "{tool,other} *", risk: "safe" }] })),
  );
  const issues = await checkCatalogSource(root);
  expect(codes(issues)).toEqual(["alpha rules"]);
  expect(issues[0]?.detail).toContain("other");
});

// REQ-SEC-5fa5cd5e
it("reports dangerous tokens below device-write unless a maintainer marked the rule reviewed", async () => {
  const rules = [
    { match: "tool * burn *", risk: "device-read" },
    { match: "tool * BLOCK *", risk: "safe" },
    { match: "tool * send *", risk: "device-write" },
    { match: "tool * efuse *", risk: "blocked" },
    { match: "tool * lock *", risk: "safe" },
  ];
  const root = await source({
    plugins: { alpha: plugin("alpha", { rules }) },
    packs: [],
    catalog: { format: 1, reviewed: [{ plugin: "alpha", match: "tool * lock *" }] },
  });
  const issues = await checkCatalogSource(root);
  expect(codes(issues)).toEqual(["alpha token", "alpha token"]);
  expect(issues.map((issue) => issue.detail)).toEqual([
    expect.stringMatching(/burn.*tool \* burn \*/),
    expect.stringMatching(/lock.*tool \* BLOCK \*/),
  ]);
});

// REQ-FUNC-f4381792
it("builds deterministic zips and an index that the store installs", async () => {
  const root = await source();
  const out = join(root, "..", `${Math.random().toString(36).slice(2)}-release`);
  roots.push(out);
  const first = await buildCatalogRelease(root, out);
  expect(first.issues).toEqual([]);
  const index = catalogIndexSchema.parse(JSON.parse(await readFile(join(out, "index.json"), "utf8")));
  expect(index).toEqual(first.index);
  expect(index.plugins.map(({ id, tier, url, requires }) => ({ id, tier, url, requires }))).toEqual([
    { id: "alpha", tier: "official", url: "alpha-1.0.0.zip", requires: [] },
    { id: "beta", tier: "community", url: "beta-1.0.0.zip", requires: ["alpha"] },
  ]);
  expect(index.packs).toEqual([
    { id: "test", name: "Test", groups: [{ name: "Core", plugins: ["alpha", "beta"], default: true }] },
  ]);
  for (const entry of index.plugins) {
    const zip = await readFile(join(out, entry.url));
    expect(zip.length).toBe(entry.bytes);
    expect(createHash("sha256").update(zip).digest("hex")).toBe(entry.sha256);
  }
  const again = join(root, "..", `${Math.random().toString(36).slice(2)}-release`);
  roots.push(again);
  await buildCatalogRelease(root, again);
  expect(await readFile(join(again, "alpha-1.0.0.zip"))).toEqual(
    await readFile(join(out, "alpha-1.0.0.zip")),
  );

  const data = join(root, "..", `${Math.random().toString(36).slice(2)}-data`);
  roots.push(data);
  const store = new PluginStore({ root: data });
  for (const entry of index.plugins)
    expect(await store.install(join(out, entry.url))).toMatchObject({
      id: entry.id,
      version: entry.version,
      issues: [],
    });
});

// REQ-FUNC-f4381792
it("writes nothing when the source has an issue or the output folder is not empty", async () => {
  const root = await source({
    plugins: { alpha: plugin("alpha", { rules: [{ match: "tool burn", risk: "safe" }] }) },
    packs: [],
  });
  const out = join(root, "..", `${Math.random().toString(36).slice(2)}-release`);
  roots.push(out);
  const refused = await buildCatalogRelease(root, out);
  expect(codes(refused.issues)).toEqual(["alpha token"]);
  expect(refused.index).toBeUndefined();
  await expect(readdir(out)).rejects.toMatchObject({ code: "ENOENT" });

  const clean = await source();
  await mkdir(out, { recursive: true });
  await writeFile(join(out, "old.txt"), "old\n");
  const busy = await buildCatalogRelease(clean, out);
  expect(codes(busy.issues)).toEqual([`${out} output`]);
  expect(await readdir(out)).toEqual(["old.txt"]);
});

// REQ-FUNC-6542e772 REQ-DATA-9b62ba69
it("publishes discovery metadata deterministically and refuses dangling metadata references", async () => {
  const metadata = {
    activities: ["communication", "debug"],
    keywords: ["UART", "console"],
    addedAt: "2024-02-29",
    updatedAt: "2026-11-11",
  };
  const root = await source({ catalog: { format: 1, official: ["alpha"], metadata: { alpha: metadata } } });
  const first = `${root}-release-a`,
    again = `${root}-release-b`;
  roots.push(first, again);
  expect(await checkCatalogSource(root)).toEqual([]);
  const built = await buildCatalogRelease(root, first);
  expect(built.issues).toEqual([]);
  expect(built.index?.plugins.find((p) => p.id === "alpha")).toMatchObject(metadata);
  const unknown = built.index?.plugins.find((p) => p.id === "beta");
  expect(unknown).toMatchObject({ activities: [], keywords: [] });
  expect(unknown).not.toHaveProperty("addedAt");
  expect(unknown).not.toHaveProperty("updatedAt");
  await buildCatalogRelease(root, again);
  expect(await readFile(join(first, "index.json"))).toEqual(await readFile(join(again, "index.json")));
  expect(await readFile(join(first, "alpha-1.0.0.zip"))).toEqual(
    await readFile(join(again, "alpha-1.0.0.zip")),
  );
  const dangling = await source({ catalog: { format: 1, metadata: { ghost: metadata } } });
  expect(await checkCatalogSource(dangling)).toContainEqual({
    where: "catalog.yaml",
    code: "reference",
    detail: "metadata names ghost",
  });
  const refusedOut = `${dangling}-refused`;
  roots.push(refusedOut);
  const refused = await buildCatalogRelease(dangling, refusedOut);
  expect(refused.index).toBeUndefined();
  await expect(readdir(refusedOut)).rejects.toMatchObject({ code: "ENOENT" });
});

// REQ-DATA-b40d3f9b REQ-DATA-9b62ba69
it("refuses a metadata-heavy UTF-8 index before writing any release output", async () => {
  const keywords = Array.from({ length: 32 }, (_, i) => `${"界".repeat(78)}${String(i).padStart(2, "0")}`);
  const plugins = Object.fromEntries(Array.from({ length: 560 }, (_, i) => [`p${i}`, plugin(`p${i}`)]));
  const metadata = Object.fromEntries(
    Object.keys(plugins).map((id) => [id, { activities: ["debug"], keywords: [...keywords] }]),
  );
  const json = JSON.stringify(metadata);
  expect(json.length).toBeLessThan(CATALOG_LIMITS.indexBytes);
  expect(Buffer.byteLength(json, "utf8")).toBeGreaterThan(CATALOG_LIMITS.indexBytes);
  const root = await source({ plugins, packs: [], catalog: { format: 1, metadata } });
  const out = `${root}-release`;
  roots.push(out);
  const result = await buildCatalogRelease(root, out);
  expect(result.index === undefined).toBe(true);
  expect(result.issues).toEqual([
    { where: "index.json", code: "source", detail: "index exceeds 4194304 bytes" },
  ]);
  await expect(readdir(out)).rejects.toMatchObject({ code: "ENOENT" });
}, 60_000);
