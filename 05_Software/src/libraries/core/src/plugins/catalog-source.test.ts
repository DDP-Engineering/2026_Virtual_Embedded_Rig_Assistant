import { createHash, createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CATALOG_LIMITS, catalogIndexSchema } from "@vera/shared";
import { unzipSync } from "fflate";
import { afterEach, expect, it } from "vitest";
import { stringify } from "yaml";
import {
  buildCatalogRelease,
  checkCatalogSource,
  generateCatalogKeys,
  signCatalogRelease,
} from "./catalog-source.js";
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
  summary: `Test plugin ${id}.`,
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

it("reports each plugin of a requires cycle and no plugin outside it", async () => {
  const root = await source({
    plugins: {
      alpha: plugin("alpha", { requires: ["gamma"] }),
      beta: plugin("beta", { requires: ["alpha"] }),
      delta: plugin("delta", { requires: ["beta"] }),
      gamma: plugin("gamma", { requires: ["beta"] }),
    },
    packs: [],
  });
  const issues = await checkCatalogSource(root);
  expect(codes(issues)).toEqual(["alpha reference", "beta reference", "gamma reference"]);
  expect(issues[0]?.detail).toBe("requires gamma, which requires alpha again");
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

it("requires an exact maintainer review for dangerous tokens in effective subcommand help", async () => {
  const base = plugin("alpha");
  const root = await source({
    plugins: {
      alpha: {
        ...base,
        programs: {
          tool: {
            ...base.programs.tool,
            subcommandHelp: { flag: "--help", commands: ["burn", "burn-other", "scan"] },
          },
        },
        rules: [...base.rules, { match: "tool burn-other *", risk: "blocked" }],
      },
    },
    packs: [],
  });
  expect(await checkCatalogSource(root)).toEqual([
    { where: "alpha", code: "token", detail: 'burn in "tool burn --help" at safe' },
  ]);
  await writeFile(
    join(root, "catalog.yaml"),
    stringify({ format: 1, reviewed: [{ plugin: "alpha", match: "tool burn --help" }] }),
  );
  expect(await checkCatalogSource(root)).toEqual([]);
});

// REQ-FUNC-f4381792
it("builds deterministic zips and an index that the store installs", async () => {
  const root = await source({
    plugins: {
      alpha: plugin("alpha"),
      beta: plugin("beta", {
        requires: ["alpha"],
        rules: [
          { match: "tool *", risk: "safe" },
          { match: "tool burn *", risk: "irreversible" },
          { match: "tool shell", risk: "blocked" },
        ],
      }),
    },
  });
  const out = join(root, "..", `${Math.random().toString(36).slice(2)}-release`);
  roots.push(out);
  const first = await buildCatalogRelease(root, out);
  expect(first.issues).toEqual([]);
  const index = catalogIndexSchema.parse(JSON.parse(await readFile(join(out, "index.json"), "utf8")));
  expect(index).toEqual(first.index);
  expect(
    index.plugins.map(({ id, tier, url, requires, summary, risk }) => ({
      id,
      tier,
      url,
      requires,
      summary,
      risk,
    })),
  ).toEqual([
    {
      id: "alpha",
      tier: "official",
      url: "alpha-1.0.0.zip",
      requires: [],
      summary: "Test plugin alpha.",
      risk: "device-write",
    },
    {
      id: "beta",
      tier: "community",
      url: "beta-1.0.0.zip",
      requires: ["alpha"],
      summary: "Test plugin beta.",
      risk: "irreversible",
    },
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

// REQ-DATA-defb1bf4, REQ-FUNC-60329be6
it("writes each entry's dependency summary and requires a vendor guide for find programs", async () => {
  const sha = "b".repeat(64);
  const version = () => ({ args: ["--version"], match: "(\\S+)" });
  const programs = {
    tool: { install: { pip: "tool>=1" }, version: version() },
    cli: {
      install: { download: { "linux-x64": { url: "https://h.test/cli", sha256: sha, bytes: 7 } } },
      version: version(),
    },
  };
  const root = await source({
    plugins: {
      alpha: plugin("alpha", { programs, rules: [{ match: "{tool,cli} *", risk: "safe" }] }),
      beta: plugin("beta", { requires: ["alpha"] }),
    },
  });
  const out = join(root, "..", `${Math.random().toString(36).slice(2)}-release`);
  roots.push(out);
  const built = await buildCatalogRelease(root, out);
  expect(built.issues).toEqual([]);
  const index = catalogIndexSchema.parse(JSON.parse(await readFile(join(out, "index.json"), "utf8")));
  expect(index.plugins.map(({ id, requires, dependencies }) => ({ id, requires, dependencies }))).toEqual([
    {
      id: "alpha",
      requires: [],
      dependencies: [
        {
          name: "cli",
          kind: "download",
          automatic: true,
          downloads: [{ platform: "linux-x64", sha256: sha, bytes: 7 }],
        },
        { name: "tool", kind: "pip", automatic: true, pip: "tool>=1" },
      ],
    },
    {
      id: "beta",
      requires: ["alpha"],
      dependencies: [{ name: "tool", kind: "pip", automatic: true, pip: "tool" }],
    },
  ]);
  // The summary is part of the index format: an entry without one is not a valid index.
  const [first] = index.plugins;
  const { dependencies: _omitted, ...bare } = first as NonNullable<typeof first>;
  expect(catalogIndexSchema.safeParse({ ...index, plugins: [bare] }).success).toBe(false);

  const vendor = await source({
    plugins: {
      alpha: plugin("alpha", {
        programs: { tool: { install: { find: { linux: ["$PATH"] } }, version: version() } },
      }),
    },
    packs: [],
    catalog: { format: 1 },
  });
  expect(await checkCatalogSource(vendor)).toEqual([
    { where: "alpha", code: "dependency", detail: "program tool has no vendor guide" },
  ]);
  const refused = join(vendor, "..", `${Math.random().toString(36).slice(2)}-release`);
  expect((await buildCatalogRelease(vendor, refused)).index).toBeUndefined();
});

// REQ-DATA-defb1bf4
it("summarises the official arduino-cli and KiCad dependencies in the release index", async () => {
  const out = join(tmpdir(), `vera-official-${Math.random().toString(36).slice(2)}`);
  roots.push(out);
  const { issues, index } = await buildCatalogRelease(official, out);
  expect(issues).toEqual([]);
  const arduino = index?.plugins.find((entry) => entry.id === "arduino-cli");
  expect(arduino?.requires).toEqual(["serial-monitor"]);
  expect(arduino?.dependencies).toEqual([
    {
      name: "arduino-cli",
      kind: "download",
      automatic: true,
      downloads: [
        {
          platform: "windows-x64",
          sha256: "2769b9b282ce597db9679d8ec14d726d57004ca4205ef4d7a795bf36b6cdc9d8",
          bytes: 20404890,
        },
        {
          platform: "linux-x64",
          sha256: "321ee249f44c78053234fec0f36101092bc6021bf24939e15e0cc2449c5ed250",
          bytes: 20111675,
        },
      ],
      find: ["windows", "linux"],
      range: ">=1.6,<2",
      guide: expect.stringContaining("https://arduino.github.io/arduino-cli/latest/installation/"),
    },
    { name: "arduino-tool", kind: "script", automatic: true, script: "scripts/arduino_tool.py" },
  ]);
  // REQ-DATA-d10bb593: settings or program credentials mark an entry configurable; others omit it.
  const configurable = (id: string) => index?.plugins.find((entry) => entry.id === id)?.configurable;
  expect(configurable("wokwi")).toBe(true);
  expect(configurable("gdb-debug")).toBe(true);
  expect(configurable("kicad")).toBeUndefined();
  const kicad = index?.plugins.find((entry) => entry.id === "kicad");
  expect(kicad?.dependencies.find((item) => item.name === "kicad-cli")).toEqual({
    name: "kicad-cli",
    kind: "find",
    automatic: false,
    find: ["windows", "linux"],
    range: ">=10.0,<11",
    guide: expect.stringContaining("https://www.kicad.org/download/"),
  });
});

const releaseOut = (root: string) => {
  const out = join(root, "..", `${Math.random().toString(36).slice(2)}-release`);
  roots.push(out);
  return out;
};
const readIndex = async (out: string, name: string) =>
  catalogIndexSchema.parse(JSON.parse(await readFile(join(out, name), "utf8")));

// REQ-DATA-78f62129
it("writes a stable channel index with the 1.0.0 plugins and a pre-release index with every plugin", async () => {
  const root = await source({
    plugins: {
      alpha: plugin("alpha"),
      beta: plugin("beta", { version: "0.2.0" }),
      gamma: plugin("gamma", { version: "1.1.0-rc.1" }),
    },
    packs: [
      {
        id: "test",
        name: "Test",
        groups: [
          { name: "Core", plugins: ["alpha", "beta"], default: true },
          { name: "Extra", plugins: ["gamma"] },
        ],
      },
      { id: "early", name: "Early", groups: [{ name: "Core", plugins: ["beta"] }] },
    ],
  });
  const out = releaseOut(root);
  expect((await buildCatalogRelease(root, out)).issues).toEqual([]);
  expect((await readdir(out)).sort()).toEqual([
    "alpha-1.0.0.zip",
    "beta-0.2.0.zip",
    "gamma-1.1.0-rc.1.zip",
    "index-pre-release.json",
    "index-stable.json",
    "index.json",
  ]);
  const all = await readIndex(out, "index.json");
  expect(await readIndex(out, "index-pre-release.json")).toEqual({ ...all, channel: "pre-release" });
  const stable = await readIndex(out, "index-stable.json");
  expect(stable.channel).toBe("stable");
  expect(stable.plugins).toEqual(all.plugins.filter((entry) => entry.id === "alpha"));
  expect(stable.packs).toEqual([
    { id: "test", name: "Test", groups: [{ name: "Core", plugins: ["alpha"], default: true }] },
  ]);

  const early = await source({
    plugins: { beta: plugin("beta", { version: "0.1.0" }) },
    packs: [],
    catalog: { format: 1, official: ["beta"] },
  });
  const earlyOut = releaseOut(early);
  expect((await buildCatalogRelease(early, earlyOut)).issues).toEqual([]);
  expect(await readIndex(earlyOut, "index-stable.json")).toEqual({
    format: 1,
    channel: "stable",
    plugins: [],
    packs: [],
  });
});

// REQ-SEC-bd56a6c0
it("generates an Ed25519 key pair and never overwrites an existing key file", async () => {
  const folder = await mkdtemp(join(tmpdir(), "vera-catalog-keys-"));
  roots.push(folder);
  const privatePath = join(folder, "private.pem");
  const publicPath = join(folder, "public.pem");
  await generateCatalogKeys(privatePath, publicPath);
  const privatePem = await readFile(privatePath, "utf8");
  const publicPem = await readFile(publicPath, "utf8");
  expect(privatePem).toContain("BEGIN PRIVATE KEY");
  expect(publicPem).toContain("BEGIN PUBLIC KEY");
  expect(createPublicKey(publicPem).asymmetricKeyType).toBe("ed25519");
  expect(createPublicKey(privatePem).export({ type: "spki", format: "pem" })).toBe(publicPem);
  await expect(generateCatalogKeys(privatePath, join(folder, "other.pem"))).rejects.toThrow();
  await expect(generateCatalogKeys(join(folder, "other.pem"), publicPath)).rejects.toThrow();
  expect(await readFile(privatePath, "utf8")).toBe(privatePem);
  expect((await readdir(folder)).sort()).toEqual(["private.pem", "public.pem"]);
});

// REQ-SEC-daf01d33
it("signs both channel indexes of a release and refuses a key that is not the pinned one", async () => {
  const root = await source();
  const out = releaseOut(root);
  expect((await buildCatalogRelease(root, out)).issues).toEqual([]);
  const pem = (key: ReturnType<typeof generateKeyPairSync>) => ({
    privatePem: key.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicPem: key.publicKey.export({ type: "spki", format: "pem" }).toString(),
  });
  const pair = pem(generateKeyPairSync("ed25519"));
  const other = pem(generateKeyPairSync("ed25519"));

  await expect(signCatalogRelease(out, pair.privatePem, other.publicPem)).rejects.toThrow(/public key/);
  expect((await readdir(out)).filter((name) => name.endsWith(".sig"))).toEqual([]);

  expect(await signCatalogRelease(out, pair.privatePem, pair.publicPem)).toEqual([
    "index-stable.json",
    "index-pre-release.json",
  ]);
  for (const name of ["index-stable.json", "index-pre-release.json"]) {
    const signature = await readFile(join(out, `${name}.sig`), "utf8");
    expect(signature).toMatch(/^[A-Za-z0-9+/]+=*\n$/);
    const bytes = await readFile(join(out, name));
    expect(verify(null, bytes, pair.publicPem, Buffer.from(signature, "base64"))).toBe(true);
    expect(verify(null, bytes, other.publicPem, Buffer.from(signature, "base64"))).toBe(false);
  }
  await expect(readFile(join(out, "index.json.sig"))).rejects.toMatchObject({ code: "ENOENT" });

  const empty = await mkdtemp(join(tmpdir(), "vera-catalog-empty-"));
  roots.push(empty);
  await expect(signCatalogRelease(empty, pair.privatePem)).rejects.toThrow(/index-stable.json/);
  expect(await readdir(empty)).toEqual([]);
});

// REQ-DATA-b8d0a387, REQ-DATA-9cdef3e8
it("packs plugin help into the zip and carries catalog translations into the index", async () => {
  const translations = { fr: { summary: "Plugin de test alpha.", description: "Un plugin de test." } };
  const root = await source({
    plugins: { alpha: plugin("alpha", { translations }), beta: plugin("beta", { requires: ["alpha"] }) },
    files: { "alpha/help/en.md": "# Alpha\n\nHelp.\n", "alpha/help/fr.md": "# Alpha\n\nAide.\n" },
  });
  const out = join(root, "..", `${Math.random().toString(36).slice(2)}-release`);
  roots.push(out);
  const release = await buildCatalogRelease(root, out);
  expect(release.issues).toEqual([]);
  const alpha = release.index?.plugins.find((entry) => entry.id === "alpha");
  expect(alpha?.translations).toEqual(translations);
  expect(release.index?.plugins.find((entry) => entry.id === "beta")).not.toHaveProperty("translations");
  const files = Object.keys(unzipSync(await readFile(join(out, "alpha-1.0.0.zip"))));
  expect(files).toEqual(expect.arrayContaining(["alpha/help/en.md", "alpha/help/fr.md"]));
});
