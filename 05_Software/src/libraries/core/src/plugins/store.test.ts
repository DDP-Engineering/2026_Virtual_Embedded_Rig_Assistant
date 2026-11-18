import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  symlink,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyCommand, PLUGIN_LIMITS, pluginOperations } from "@vera/shared";
import { zipSync } from "fflate";
import { afterEach, expect, it } from "vitest";
import { stringify } from "yaml";
import { PluginStore, pluginIntegrity } from "./store.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const manifest = {
  format: 1,
  id: "esp32-esptool",
  version: "1.2.0",
  name: "ESP32 esptool",
  summary: "Fixture summary.",
  description: "Identify, flash, erase and read Espressif chips over a serial port.",
  ecosystem: "esp32",
  platforms: ["windows-x64", "linux-x64"],
  requires: ["serial-monitor"],
  programs: {
    esptool: {
      install: { pip: "esptool>=5,<6" },
      version: { args: ["version"], match: "v(\\d+.\\d+.\\d+)" },
      timeout: 120,
    },
    helper: { install: { script: "scripts/helper.py" }, version: { args: ["--version"], match: "(\\S+)" } },
  },
  rules: [{ match: "esptool version", risk: "safe" }],
  docs: ["README.md", "https://docs.espressif.com/projects/esptool/en/latest/"],
};
type Files = Record<string, string | Uint8Array>;
const packageFiles = (overrides: Files = {}): Files => ({
  "plugin.yaml": stringify(manifest),
  "skills/esp32-flash/SKILL.md": "---\nname: esp32-flash\ndescription: Flash an ESP32.\n---\n# Flash\n",
  "scripts/helper.py": "print('1.0')\n",
  "README.md": "# esptool\n",
  ...overrides,
});
const bytes = (files: Files) =>
  new Map(
    Object.entries(files).map(([path, value]) => [
      path,
      typeof value === "string" ? Buffer.from(value) : value,
    ]),
  );

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "vera-plugins-"));
  roots.push(root);
  const pluginsRoot = join(root, "data", "plugins");
  const create = () =>
    new PluginStore({ root: pluginsRoot, now: () => new Date("2026-11-01T10:00:00.000Z") });
  const folder = async (files: Files, name = "esp32-esptool") => {
    const dir = join(root, "src", `${Math.random().toString(36).slice(2)}`, name);
    for (const [path, value] of Object.entries(files)) {
      await mkdir(dirname(join(dir, path)), { recursive: true });
      await writeFile(join(dir, path), value);
    }
    return dir;
  };
  const zip = async (entries: Record<string, Uint8Array | string>) => {
    const path = join(root, `${Math.random().toString(36).slice(2)}.zip`);
    await writeFile(
      path,
      zipSync(
        Object.fromEntries(
          Object.entries(entries).map(([k, v]) => [k, typeof v === "string" ? Buffer.from(v) : v]),
        ),
        { level: 1 },
      ),
    );
    return path;
  };
  const installed = join(pluginsRoot, "installed");
  const entries = async () => (existsSync(installed) ? (await readdir(installed)).sort() : []);
  return { root, pluginsRoot, installed, store: create(), create, folder, zip, entries };
}
const expectInvalid = async (promise: Promise<unknown>, params?: Record<string, unknown>) =>
  expect(promise).rejects.toMatchObject({ code: "INVALID", ...(params ? { params } : {}) });

// REQ-FUNC-6dd00f25
it("installs a plugin folder with install.json and lists it valid after a restart", async () => {
  const f = await fixture();
  const files = packageFiles();
  const source = await f.folder(files);
  const summary = await f.store.install(source);
  const sha256 = pluginIntegrity(bytes(files));
  expect(summary).toEqual({
    id: "esp32-esptool",
    issues: [],
    version: "1.2.0",
    name: "ESP32 esptool",
    description: manifest.description,
    ecosystem: "esp32",
    platforms: ["windows-x64", "linux-x64"],
    irreversible: [],
    manifest: (await f.store.load("esp32-esptool")).manifest,
    composition: { skills: [{ name: "esp32-flash", description: "Flash an ESP32." }], files: [] },
    tier: "local",
    source: "folder",
    sha256,
    installedAt: "2026-11-01T10:00:00.000Z",
  });
  expect(await f.create().list()).toEqual([summary]);
  const target = join(f.installed, "esp32-esptool");
  expect(JSON.parse(await readFile(join(target, "install.json"), "utf8"))).toEqual({
    format: 1,
    id: "esp32-esptool",
    version: "1.2.0",
    tier: "local",
    source: { kind: "folder", path: source },
    sha256,
    installedAt: "2026-11-01T10:00:00.000Z",
    programs: {},
  });
  for (const [path, value] of Object.entries(files))
    expect(await readFile(join(target, path), "utf8")).toBe(value);
  await expectInvalid(f.store.install(await f.folder(files, "other-name")), { issue: "id" });
});

// REQ-FUNC-6db9dc8f
it("installs a zip with the package at its root or under one top folder named as the id", async () => {
  const f = await fixture();
  const files = packageFiles();
  const sha256 = pluginIntegrity(bytes(files));
  for (const entries of [
    files,
    Object.fromEntries(Object.entries(files).map(([k, v]) => [`esp32-esptool/${k}`, v])),
  ]) {
    const summary = await f.store.install(await f.zip({ ...entries, "esp32-esptool/": new Uint8Array() }));
    expect(summary).toMatchObject({ id: "esp32-esptool", issues: [], source: "zip", sha256 });
    expect(await f.create().list()).toEqual([summary]);
  }
  const nested = (top: string) =>
    Object.fromEntries(Object.entries(files).map(([k, v]) => [`${top}/${k}`, v]));
  await expectInvalid(f.store.install(await f.zip(nested("other"))), { issue: "id" });
  await expectInvalid(f.store.install(await f.zip({ ...nested("esp32-esptool"), "extra/x.txt": "x" })), {
    issue: "manifest",
  });
  await expectInvalid(f.store.install(await f.zip({ "README.md": "x" })), { issue: "manifest" });
  await writeFile(join(f.root, "broken.zip"), "not a zip");
  await expectInvalid(f.store.install(join(f.root, "broken.zip")));
});

// REQ-FUNC-77843ccc
it("refuses an invalid manifest and leaves the installed plugins unchanged", async () => {
  const f = await fixture();
  const valid = await f.store.install(await f.folder(packageFiles()));
  const { "plugin.yaml": _manifest, ...withoutManifest } = packageFiles();
  const cases: [Files, Record<string, unknown>][] = [
    [withoutManifest, { issue: "manifest" }],
    [packageFiles({ "plugin.yaml": "format: 1\nid: [esp32-esptool\n" }), { issue: "yaml" }],
    [packageFiles({ "plugin.yaml": "format: 1\nformat: 1\n" }), { issue: "yaml" }],
    [packageFiles({ "plugin.yaml": Buffer.from([0xff, 0xfe, 0x00]) }), { issue: "manifest" }],
    [
      packageFiles({
        "plugin.yaml": stringify({
          ...manifest,
          programs: { esptool: { ...manifest.programs.esptool, timeout: 4000 } },
        }),
      }),
      { issue: "field", path: "programs.esptool.timeout" },
    ],
    [
      Object.fromEntries(Object.entries(packageFiles()).filter(([k]) => k !== "scripts/helper.py")),
      { issue: "field", path: "programs.helper.install.script" },
    ],
  ];
  const before = await readdir(join(f.installed, "esp32-esptool"), { recursive: true });
  for (const [files, params] of cases) await expectInvalid(f.store.install(await f.folder(files)), params);
  expect(await f.store.list()).toEqual([valid]);
  expect(await readdir(join(f.installed, "esp32-esptool"), { recursive: true })).toEqual(before);
  expect(await f.entries()).toEqual(["esp32-esptool"]);
});

// REQ-SEC-9b266629
it("refuses unsafe packages without installing anything", async () => {
  const f = await fixture();
  const files = packageFiles();
  for (const extra of [
    { "../x.txt": "x" },
    { "C:/x.txt": "x" },
    { "/abs.txt": "x" },
    { "a/CON": "x" },
    { "a/b./c": "x" },
    { "A.txt": "x", "a.txt": "y" },
    { "install.json": "{}" },
    Object.fromEntries(Array.from({ length: 4096 }, (_, i) => [`f/${i}.txt`, "x"])),
  ])
    await expectInvalid(f.store.install(await f.zip({ ...files, ...extra })));
  await expectInvalid(f.store.install(await f.folder(packageFiles({ "install.json": "{}" }))));
  await expectInvalid(
    f.store.install(
      await f.folder(packageFiles({ "plugin.yaml": `${stringify(manifest)}#${"x".repeat(256 * 1024)}\n` })),
    ),
    { issue: "manifest" },
  );
  await expect(f.store.install(join(f.root, "missing-folder"))).rejects.toMatchObject({ code: "NOT_FOUND" });
  const linked = await f.folder(files);
  await mkdir(join(f.root, "elsewhere"));
  await symlink(
    join(f.root, "elsewhere"),
    join(linked, "link"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await expect(f.store.install(linked)).rejects.toMatchObject({ code: "DENIED" });
  expect(await f.entries()).toEqual([]);
  const limit = Object.fromEntries(Array.from({ length: 4092 }, (_, i) => [`f/${i}.txt`, "x"]));
  expect((await f.store.install(await f.zip({ ...files, ...limit }))).issues).toEqual([]);
  expect(await f.entries()).toEqual(["esp32-esptool"]);
  expect(
    existsSync(join(f.pluginsRoot, "staging")) ? await readdir(join(f.pluginsRoot, "staging")) : [],
  ).toEqual([]);
}, 60_000);

// REQ-FUNC-deaa76d1
it("replaces the whole installation on reinstall", async () => {
  const f = await fixture();
  await f.store.install(await f.folder(packageFiles({ "extra.txt": "old" })));
  const next = packageFiles({ "plugin.yaml": stringify({ ...manifest, version: "1.3.0" }) });
  const summary = await f.store.install(await f.folder(next));
  expect(summary).toMatchObject({ version: "1.3.0", issues: [], sha256: pluginIntegrity(bytes(next)) });
  expect(existsSync(join(f.installed, "esp32-esptool", "extra.txt"))).toBe(false);
  expect(await f.create().list()).toEqual([summary]);
});

it("puts back a plugin whose reinstall was interrupted and sweeps old staging leftovers on first use", async () => {
  const f = await fixture();
  // Installed through another root, so this root's first use is the list below.
  const elsewhere = new PluginStore({ root: join(f.root, "elsewhere") });
  const summary = await elsewhere.install(await f.folder(packageFiles()));
  const staging = join(f.pluginsRoot, "staging");
  await mkdir(staging, { recursive: true });
  await mkdir(f.installed);
  await rename(join(f.root, "elsewhere", "installed", "esp32-esptool"), join(staging, "one.previous"));
  await mkdir(join(staging, "stale"));
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
  await utimes(join(staging, "stale"), old, old);
  await mkdir(join(staging, "recent"));
  expect(await f.store.list()).toEqual([summary]);
  expect(await readdir(staging)).toEqual(["recent"]);
});

// REQ-FUNC-f003e3e5
it("lists every installed folder sorted with metadata and all of its issues", async () => {
  const f = await fixture();
  await f.store.install(await f.folder(packageFiles()));
  const broken = packageFiles({
    "plugin.yaml": stringify({ ...manifest, id: "broken", name: "", ecosystem: "Bad Tag" }),
  });
  const brokenDir = join(f.installed, "broken");
  for (const [path, value] of Object.entries(broken)) {
    await mkdir(dirname(join(brokenDir, path)), { recursive: true });
    await writeFile(join(brokenDir, path), value);
  }
  await writeFile(
    join(brokenDir, "install.json"),
    JSON.stringify({
      format: 1,
      id: "broken",
      version: "1.2.0",
      tier: "local",
      source: { kind: "folder", path: f.root },
      sha256: pluginIntegrity(bytes(broken)),
      installedAt: "2026-11-01T10:00:00.000Z",
      programs: {},
    }),
  );
  const other = packageFiles({ "plugin.yaml": stringify({ ...manifest, id: "norecord" }) });
  await f.store.install(await f.folder(other, "norecord"));
  await unlink(join(f.installed, "norecord", "install.json"));
  await f.store.install(
    await f.folder(packageFiles({ "plugin.yaml": stringify({ ...manifest, id: "renamed" }) }), "renamed"),
  );
  await rm(join(f.installed, "renamed"), { recursive: true });
  await rename(join(f.installed, "esp32-esptool"), join(f.installed, "renamed"));
  await f.store.install(await f.folder(packageFiles()));
  const listed = await f.create().list();
  expect(listed.map((p) => p.id)).toEqual(["broken", "esp32-esptool", "norecord", "renamed"]);
  expect(await f.store.ids()).toEqual(["broken", "esp32-esptool", "norecord", "renamed"]);
  expect(listed[0]).toEqual({
    id: "broken",
    issues: [
      { code: "field", path: "name", issue: "too_small" },
      { code: "field", path: "ecosystem", issue: "invalid_format" },
    ],
    tier: "local",
    source: "folder",
    sha256: pluginIntegrity(bytes(broken)),
    installedAt: "2026-11-01T10:00:00.000Z",
  });
  expect(listed[1]?.issues).toEqual([]);
  expect(listed[2]).toMatchObject({ issues: [{ code: "record" }], name: "ESP32 esptool", version: "1.2.0" });
  expect(listed[2]?.tier).toBeUndefined();
  expect(listed[3]?.issues).toContainEqual({ code: "id", path: "id" });
});

// REQ-SEC-892a67e8
it("lists a plugin whose files changed as changed since review and refuses to load it", async () => {
  const f = await fixture();
  await f.store.install(await f.folder(packageFiles()));
  const dir = join(f.installed, "esp32-esptool");
  const skill = join(dir, "skills/esp32-flash/SKILL.md");
  const original = await readFile(skill);
  const changes: [() => Promise<void>, () => Promise<void>][] = [
    [() => writeFile(skill, `${original}x`), () => writeFile(skill, original)],
    [() => writeFile(join(dir, "added.txt"), "x"), () => unlink(join(dir, "added.txt"))],
    [() => unlink(skill), () => writeFile(skill, original)],
    [
      () => rename(skill, join(dir, "skills/esp32-flash/OTHER.md")),
      () => rename(join(dir, "skills/esp32-flash/OTHER.md"), skill),
    ],
  ];
  for (const [change, restore] of changes) {
    await change();
    expect((await f.store.list())[0]?.issues).toContainEqual({ code: "changed" });
    await expectInvalid(f.store.load("esp32-esptool"));
    await restore();
    expect((await f.store.list())[0]?.issues).toEqual([]);
  }
});

// REQ-FUNC-1d6999a7
it("loads only an installed plugin without issues", async () => {
  const f = await fixture();
  await f.store.install(await f.folder(packageFiles()));
  const loaded = await f.create().load("esp32-esptool");
  expect(loaded.folder).toBe(join(f.installed, "esp32-esptool"));
  expect(loaded.manifest.programs.esptool?.install).toEqual({ pip: "esptool>=5,<6" });
  expect(loaded.manifest.rules).toEqual([{ match: "esptool version", risk: "safe" }]);
  expect(loaded.record.sha256).toBe(pluginIntegrity(bytes(packageFiles())));
  for (const id of ["ghost", "../esp32-esptool", "Bad"])
    await expect(f.store.load(id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  await writeFile(join(f.installed, "esp32-esptool", "plugin.yaml"), "format: 2\n");
  await expectInvalid(f.store.load("esp32-esptool"));
  await f.store.install(await f.folder(packageFiles()));
  await unlink(join(f.installed, "esp32-esptool", "install.json"));
  await expectInvalid(f.store.load("esp32-esptool"));
});

// REQ-FUNC-9ba5f19c
it("uninstalls a plugin and reports NOT_FOUND for one that is not installed", async () => {
  const f = await fixture();
  await f.store.install(await f.folder(packageFiles()));
  await f.store.uninstall("esp32-esptool");
  expect(await f.store.list()).toEqual([]);
  expect(await f.create().list()).toEqual([]);
  expect(existsSync(join(f.installed, "esp32-esptool"))).toBe(false);
  await expect(f.store.uninstall("esp32-esptool")).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(f.store.uninstall("../x")).rejects.toMatchObject({ code: "NOT_FOUND" });
});

/** Rewrites every local and central uncompressed-size field of a zip to `size`. */
function declareSizes(zip: Uint8Array, size: number): Uint8Array {
  const copy = new Uint8Array(zip);
  const view = new DataView(copy.buffer);
  for (let i = 0; i + 4 <= copy.length; i++) {
    const signature = view.getUint32(i, true);
    if (signature === 0x04034b50) view.setUint32(i + 22, size, true);
    if (signature === 0x02014b50) view.setUint32(i + 24, size, true);
  }
  return copy;
}

// REQ-SEC-9b266629
it("refuses a zip whose directory hides stored sizes and folder names that collide by case", async () => {
  const f = await fixture();
  const files = Object.fromEntries(Object.entries(packageFiles()).map(([k, v]) => [k, Buffer.from(v)]));
  const lying = join(f.root, "lying.zip");
  await writeFile(
    lying,
    declareSizes(zipSync({ ...files, "blob.bin": new Uint8Array(1024) }, { level: 0 }), 0),
  );
  await expectInvalid(f.store.install(lying));
  for (const extra of [
    { "Docs/a.md": "a", "docs/b.md": "b" },
    { a: "file", "a/b": "nested" },
  ])
    await expectInvalid(f.store.install(await f.zip({ ...packageFiles(), ...extra })));
  await expectInvalid(
    f.store.install(
      await f.folder(packageFiles({ "plugin.yaml": `x: &a 1\ny: *a\n${stringify(manifest)}` })),
    ),
    { issue: "yaml" },
  );
  expect(await f.entries()).toEqual([]);
});

it("refuses a zip whose directory declares a file or a package over the inflated-size limits", async () => {
  const f = await fixture();
  const files = Object.fromEntries(Object.entries(packageFiles()).map(([k, v]) => [k, Buffer.from(v)]));
  const bomb = join(f.root, "bomb.zip");
  await writeFile(bomb, declareSizes(zipSync(files, { level: 1 }), PLUGIN_LIMITS.inflatedFileBytes + 1));
  await expectInvalid(f.store.install(bomb));
  // Six files, each under the file limit, together over the package limit.
  const many = { ...files, "a.bin": Buffer.from("a"), "b.bin": Buffer.from("b") };
  await writeFile(bomb, declareSizes(zipSync(many, { level: 1 }), PLUGIN_LIMITS.inflatedBytes / 5));
  await expectInvalid(f.store.install(bomb));
  expect(await f.entries()).toEqual([]);
});

// REQ-DATA-3f62c8c1
it("lists the irreversible rules of a plugin without issues in manifest order", async () => {
  const f = await fixture();
  const rules = [
    { match: "esptool version", risk: "safe" },
    { match: "esptool * burn-key *", risk: "irreversible", note: "Burns a key permanently." },
    { match: "esptool * write-flash *", risk: "device-write", note: "Overwrites firmware." },
    { match: "esptool * burn-efuse *", risk: "irreversible" },
  ];
  await f.store.install(await f.folder(packageFiles({ "plugin.yaml": stringify({ ...manifest, rules }) })));
  const [summary] = await f.store.list();
  expect(summary?.irreversible).toEqual([
    { match: "esptool * burn-key *", note: "Burns a key permanently." },
    { match: "esptool * burn-efuse *" },
  ]);
  await writeFile(join(f.installed, "esp32-esptool", "README.md"), "# edited\n");
  const [changed] = await f.store.list();
  expect(changed?.issues).toEqual([{ code: "changed" }]);
  expect(changed).not.toHaveProperty("irreversible");
});

// REQ-FUNC-86daf060
it("records program versions in install.json only while the installed hash still matches", async () => {
  const { store, folder, installed } = await fixture();
  const installedPlugin = await store.install(await folder(packageFiles()));
  const sha256 = installedPlugin.sha256 as string;
  await store.recordPrograms("esp32-esptool", sha256, { esptool: "5.6.0" });
  await store.recordPrograms("esp32-esptool", sha256, { helper: "1.0" });
  const loaded = await store.load("esp32-esptool");
  expect(loaded.record.programs).toEqual({ esptool: "5.6.0", helper: "1.0" });
  expect((await store.list())[0]?.issues).toEqual([]);
  expect(
    (await readdir(join(installed, "esp32-esptool"))).filter((name) => name.includes("install")),
  ).toEqual(["install.json"]);
  await expect(store.recordPrograms("esp32-esptool", "f".repeat(64), { esptool: "1" })).rejects.toMatchObject(
    {
      code: "CONFLICT",
    },
  );
  await expect(store.recordPrograms("missing", sha256, {})).rejects.toMatchObject({ code: "NOT_FOUND" });
  await store.install(await folder(packageFiles()));
  expect((await store.load("esp32-esptool")).record.programs).toEqual({});
});

// REQ-FUNC-a5be5e53
it("reviews a package without installing it and reports its hash, manifest, issues and installed version", async () => {
  const f = await fixture();
  const files = packageFiles();
  const source = await f.folder(files);
  const review = await f.store.review(source);
  expect(review).toMatchObject({
    path: source,
    kind: "folder",
    sha256: pluginIntegrity(bytes(files)),
    issues: [],
    manifest: { id: "esp32-esptool", version: "1.2.0", rules: manifest.rules },
  });
  expect(review.manifest?.programs.esptool?.install).toEqual({ pip: "esptool>=5,<6" });
  expect(review.installed).toBeUndefined();
  expect(await f.entries()).toEqual([]);
  const installed = await f.store.install(source, review.sha256);
  expect((await f.store.review(source)).installed).toEqual({ version: "1.2.0" });
  expect(installed.sha256).toBe(review.sha256);

  const broken = await f.folder(
    packageFiles({
      "plugin.yaml": stringify({ ...manifest, rules: [{ match: "esptool x", risk: "dangerous" }] }),
    }),
  );
  const refused = await f.store.review(broken);
  expect(refused.issues).toEqual([{ code: "field", path: "rules.0.risk", issue: "invalid_value" }]);
  expect(refused.manifest).toBeUndefined();
  const zipped = await f.store.review(await f.zip(files));
  expect(zipped).toMatchObject({ kind: "zip", sha256: review.sha256, issues: [] });
  await expect(f.store.review(join(f.root, "missing"))).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(await f.entries()).toEqual(["esp32-esptool"]);
});

// REQ-SEC-8e281f52
it("refuses to install a package that changed since its review", async () => {
  const f = await fixture();
  const source = await f.folder(packageFiles());
  const { sha256 } = await f.store.review(source);
  await writeFile(join(source, "README.md"), "# changed\n");
  await expect(f.store.install(source, sha256)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await f.entries()).toEqual([]);
  const current = await f.store.review(source);
  expect((await f.store.install(source, current.sha256)).sha256).toBe(current.sha256);
});

// REQ-DATA-b065d2a4
it("carries the skills and data files of a package in its review and its installed listing", async () => {
  const f = await fixture();
  const files = packageFiles({
    "skills/a-skill/SKILL.md": "---\nname: a-skill\ndescription: Does A.\n---\n# A\n",
    "skills/a-skill/templates/t.md": "x",
    "skills/broken/SKILL.md": "# no front matter\n",
    "scripts/support/lib.py": "",
    "profiles/p.json": "{}",
    "data/x.csv": "a,b\n",
  });
  const composition = {
    skills: [
      { name: "a-skill", description: "Does A." },
      { name: "broken" },
      { name: "esp32-flash", description: "Flash an ESP32." },
    ],
    files: ["data/x.csv", "profiles/p.json"],
  };
  const source = await f.folder(files);
  expect((await f.store.review(source)).composition).toEqual(composition);
  await f.store.install(source);
  const [listed] = await f.store.list();
  expect(listed?.composition).toEqual(composition);
  expect(listed?.manifest).toEqual((await f.store.load("esp32-esptool")).manifest);
  await writeFile(join(f.installed, "esp32-esptool", "README.md"), "# edited\n");
  const [changed] = await f.store.list();
  expect(changed).not.toHaveProperty("manifest");
  expect(changed).not.toHaveProperty("composition");
});

// REQ-FUNC-8af265ac
it("lists the operations of official bus-tools from the rules its approvals classify with", async () => {
  const f = await fixture();
  const official = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../plugins/bus-tools");
  // Its help pages are listed as help languages, not as data files.
  expect((await f.store.review(official)).composition).toEqual(
    expect.objectContaining({
      skills: [
        { name: "bus-profiles", description: expect.stringContaining("bus profile") },
        { name: "bus-transactions", description: expect.any(String) },
      ],
      files: ["profiles/bme280-i2c.json", "profiles/uart-console.json", "profiles/w25q-spi.json"],
    }),
  );
  await f.store.install(official);
  const [listed] = await f.store.list();
  const { manifest } = await f.store.load("bus-tools");
  expect(listed?.manifest?.rules).toEqual(manifest.rules);
  const groups = pluginOperations(listed?.manifest?.rules ?? []);
  expect(groups.map(({ risk, rules }) => [risk, rules.length])).toEqual([
    ["safe", 2],
    ["device-read", 1],
    ["device-write", 3],
    ["irreversible", 1],
  ]);
  const approval = classifyCommand(manifest.rules, "bus-tool", ["identify", "--adapter", "bp"]);
  const [identify] = groups.find((group) => group.risk === "device-read")?.rules ?? [];
  expect(approval.risk).toBe("device-read");
  expect(approval.notes).toEqual([identify?.note]);
});

// REQ-DATA-af8807e1
it("reports an invalid settings entry as a field issue and keeps a manifest without settings valid", async () => {
  const f = await fixture();
  const plain = await f.store.review(await f.folder(packageFiles()));
  expect(plain.issues).toEqual([]);
  expect(plain.manifest?.settings).toBeUndefined();
  const bad = packageFiles({
    "plugin.yaml": stringify({
      ...manifest,
      settings: { registry: { kind: "workbench-file", path: "../x.json" } },
    }),
  });
  expect((await f.store.review(await f.folder(bad))).issues).toEqual([
    { code: "field", path: "settings.registry.path", issue: "custom" },
    { code: "field", path: "settings.registry.description", issue: "invalid_type" },
  ]);
});

// REQ-DATA-7c79b1b5
it("declares the parameters of the official plugins in their manifests", async () => {
  const f = await fixture();
  const plugins = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../plugins");
  const declared = async (id: string) => {
    const review = await f.store.review(join(plugins, id));
    expect(review.issues).toEqual([]);
    return Object.entries(review.manifest?.settings ?? {}).map(([name, setting]) => {
      const { description, ...rest } = setting;
      expect(description.length).toBeGreaterThan(20);
      return { name, ...rest };
    });
  };
  const registry = {
    name: "lab-resources",
    kind: "workbench-file",
    path: "lab/resources.json",
    format: "lab-resources",
  };
  expect(await declared("mqtt-tools")).toEqual([
    { name: "broker-credential", kind: "secret", scope: "mqtt" },
  ]);
  expect(await declared("wokwi")).toEqual([{ name: "wokwi-token", kind: "secret", scope: "wokwi" }]);
  expect(await declared("parts-search")).toEqual([{ name: "supplier-keys", kind: "secret", scope: "parts" }]);
  for (const id of ["bus-tools", "ble-tools", "scpi-instruments", "power-profiler"])
    expect(await declared(id)).toEqual([registry]);
  for (const id of ["gdb-debug", "platformio", "zephyr"])
    expect(await declared(id)).toEqual([{ ...registry, optional: true }]);
  expect(await declared("raspberry-pi-linux")).toEqual([
    registry,
    { name: "pi-project", kind: "workbench-file", path: "*/vera-pi.json", format: "json", optional: true },
    { name: "ssh-agent", kind: "value", value: expect.stringContaining("SSH agent") },
  ]);
  expect(await declared("kicad")).toEqual([]);
});

// REQ-DATA-9cdef3e8
it("lists the languages of a package's help and keeps help out of its data files", async () => {
  const f = await fixture();
  const source = await f.folder(
    packageFiles({
      "help/en.md": "# Help\n\nText.\n",
      "help/fr.md": "# Aide\n\nTexte.\n",
      "data/x.csv": "a\n",
    }),
  );
  const { composition } = await f.store.review(source);
  expect(composition?.help).toEqual(["en", "fr"]);
  expect(composition?.files).toEqual(["data/x.csv"]);
});
