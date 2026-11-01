import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
it("refuses unsafe and oversized packages without installing anything", async () => {
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
    { "big.bin": new Uint8Array(64 * 1024 * 1024 + 1) },
  ])
    await expectInvalid(f.store.install(await f.zip({ ...files, ...extra })));
  await expectInvalid(f.store.install(await f.folder(packageFiles({ "install.json": "{}" }))));
  await expectInvalid(
    f.store.install(
      await f.folder(packageFiles({ "plugin.yaml": `${stringify(manifest)}#${"x".repeat(256 * 1024)}\n` })),
    ),
    { issue: "manifest" },
  );
  const large = join(f.root, "large.zip");
  const handle = await open(large, "w");
  await handle.truncate(64 * 1024 * 1024 + 1);
  await handle.close();
  await expectInvalid(f.store.install(large));
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

/** Rewrites every local and central uncompressed-size field of a zip to 0. */
function hideSizes(zip: Uint8Array): Uint8Array {
  const copy = new Uint8Array(zip);
  const view = new DataView(copy.buffer);
  for (let i = 0; i + 4 <= copy.length; i++) {
    const signature = view.getUint32(i, true);
    if (signature === 0x04034b50) view.setUint32(i + 22, 0, true);
    if (signature === 0x02014b50) view.setUint32(i + 24, 0, true);
  }
  return copy;
}

// REQ-SEC-9b266629
it("refuses a zip whose directory hides stored sizes and folder names that collide by case", async () => {
  const f = await fixture();
  const files = Object.fromEntries(Object.entries(packageFiles()).map(([k, v]) => [k, Buffer.from(v)]));
  const lying = join(f.root, "lying.zip");
  await writeFile(lying, hideSizes(zipSync({ ...files, "blob.bin": new Uint8Array(1024) }, { level: 0 })));
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
