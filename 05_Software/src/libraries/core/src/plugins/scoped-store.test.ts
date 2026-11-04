// REQ-FUNC-13ab0001 REQ-SEC-13ab0002 REQ-SEC-13ab0003 REQ-SEC-13ab0004 REQ-FUNC-13ab0005
import { cp, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { SkillCatalog } from "../skills/catalog.js";
import { FakeHost } from "./fake-process-host.test-support.js";
import { type ProgramHost, programPromptEntries } from "./program-tools.js";
import { Provisioner } from "./provisioning.js";
import { PluginStore } from "./store.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "vera-scoped-store-"));
  roots.push(root);
  const bench = join(root, "bench"),
    source = join(bench, ".vera/plugins/echo-tools"),
    data = join(root, "data/plugins");
  await mkdir(join(bench, ".vera/plugins"), { recursive: true });
  await cp("tests/fixtures/plugins/echo-tools", source, { recursive: true });
  const global = new PluginStore({ root: data });
  // Constructor option is exercised first: older stores silently ignore the workbench and miss the package.
  const store = new PluginStore({ root: data, workbench: bench });
  return { root, bench, source, data, global, store };
}
it("discovers an untrusted scoped package and permits no load or skill before user hash trust", async () => {
  const f = await fixture();
  expect(await f.store.list()).toMatchObject([
    { id: "echo-tools", source: "workbench", issues: [{ code: "untrusted" }] },
  ]);
  await expect(f.store.load("echo-tools")).rejects.toMatchObject({ code: "DENIED" });
  const skills = new SkillCatalog({
    root: f.bench,
    disabled: () => [],
    plugins: async () => {
      try {
        const p = await f.store.load("echo-tools");
        return [{ id: p.manifest.id, folder: p.folder }];
      } catch {
        return [];
      }
    },
  });
  expect((await skills.list()).filter((s) => s.source === "plugin")).toEqual([]);
  let resolutions = 0;
  const host = {
    plugins: async () => {
      try {
        return [await f.store.load("echo-tools")];
      } catch {
        return [];
      }
    },
    resolver: {
      resolve: async () => {
        resolutions++;
        return { executable: process.execPath };
      },
    },
  } as unknown as ProgramHost;
  expect(await programPromptEntries(host, await skills.list())).toEqual([]);
  expect(resolutions).toBe(0);
  const review = await f.store.reviewScoped("echo-tools");
  await f.store.trustScoped("echo-tools", review.sha256);
  expect(await programPromptEntries(host, await skills.list())).toMatchObject([
    { name: "echo", plugin: "echo-tools", skills: ["echo-guide"] },
  ]);
  const p = await f.store.load("echo-tools");
  expect(p.folder.startsWith(f.data)).toBe(true);
  expect((await skills.list()).some((s) => s.name === "echo-guide")).toBe(true);
  expect((await new PluginStore({ root: f.data, workbench: f.bench }).load("echo-tools")).record.sha256).toBe(
    review.sha256,
  );
  const clone = join(f.root, "clone");
  await cp(f.bench, clone, { recursive: true });
  await expect(new PluginStore({ root: f.data, workbench: clone }).load("echo-tools")).rejects.toMatchObject({
    code: "DENIED",
  });
  await expect(
    new PluginStore({ root: join(f.root, "machine2/plugins"), workbench: f.bench }).load("echo-tools"),
  ).rejects.toMatchObject({ code: "DENIED" });
}, 30000);
it("rejects stale reviews, changed helper/skill bytes, deleted sources and final consumption", async () => {
  const f = await fixture(),
    review = await f.store.reviewScoped("echo-tools");
  await writeFile(join(f.source, "helper.txt"), "first");
  await expect(f.store.trustScoped("echo-tools", review.sha256)).rejects.toMatchObject({ code: "CONFLICT" });
  const fresh = await f.store.reviewScoped("echo-tools");
  await f.store.trustScoped("echo-tools", fresh.sha256);
  const loaded = await f.store.load("echo-tools");
  await writeFile(join(f.source, "helper.txt"), "second");
  await expect(loaded.verify?.()).rejects.toMatchObject({ code: "CONFLICT" });
  expect((await f.store.list())[0]?.issues).toContainEqual({ code: "changed" });
  await expect(f.store.load("echo-tools")).rejects.toMatchObject({ code: "DENIED" });
  const next = await f.store.reviewScoped("echo-tools");
  await f.store.trustScoped("echo-tools", next.sha256);
  await writeFile(join(f.source, "skills/echo-guide/SKILL.md"), "changed instructions");
  await expect(f.store.load("echo-tools")).rejects.toMatchObject({ code: "DENIED" });
  await rm(f.source, { recursive: true });
  await expect(f.store.load("echo-tools")).rejects.toBeDefined();
}, 30000);
it("blocks id collisions without fallback and never treats cloned install.json as trust", async () => {
  const f = await fixture(),
    review = await f.store.reviewScoped("echo-tools");
  await f.store.trustScoped("echo-tools", review.sha256);
  await f.global.install(f.source);
  expect((await f.store.list())[0]?.issues).toContainEqual({ code: "collision" });
  await expect(f.store.load("echo-tools")).rejects.toMatchObject({ code: "DENIED" });
  await f.global.uninstall("echo-tools");
  const p = await f.store.load("echo-tools");
  await writeFile(join(f.source, "install.json"), await readFile(join(p.folder, "install.json")));
  await expect(f.store.reviewScoped("echo-tools")).rejects.toMatchObject({ code: "INVALID" });
  await expect(f.store.load("echo-tools")).rejects.toBeDefined();
}, 30000);
it("rejects linked scoped directories and linked package entries", async () => {
  const f = await fixture();
  await symlink(
    f.source,
    join(f.bench, ".vera/plugins/linked-tools"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await expect(f.store.reviewScoped("linked-tools")).rejects.toMatchObject({ code: "DENIED" });
  const external = join(f.root, "external");
  await mkdir(external);
  await symlink(external, join(f.source, "linked-entry"), process.platform === "win32" ? "junction" : "dir");
  await expect(f.store.reviewScoped("echo-tools")).rejects.toMatchObject({ code: "DENIED" });
  await rm(join(f.source, "linked-entry"), { recursive: true });
  await expect(f.store.reviewScoped("../external")).rejects.toMatchObject({ code: "INVALID" });
  await cp(f.source, join(external, "echo-tools"), { recursive: true });
  await rm(join(f.bench, ".vera/plugins"), { recursive: true });
  await symlink(external, join(f.bench, ".vera/plugins"), process.platform === "win32" ? "junction" : "dir");
  await expect(f.store.load("echo-tools")).rejects.toMatchObject({ code: "DENIED" });
}, 30000);

it("keeps same-id snapshots and managed tool roots separate across workbenches", async () => {
  const f = await fixture(),
    clone = join(f.root, "clone");
  await cp(f.bench, clone, { recursive: true });
  const second = new PluginStore({ root: f.data, workbench: clone });
  await f.store.trustScoped("echo-tools", (await f.store.reviewScoped("echo-tools")).sha256);
  await second.trustScoped("echo-tools", (await second.reviewScoped("echo-tools")).sha256);
  const a = await f.store.load("echo-tools"),
    b = await second.load("echo-tools");
  expect(a.folder).not.toBe(b.folder);
  expect(a.runtimeKey).not.toBe(b.runtimeKey);
  await writeFile(join(f.source, "helper.txt"), "only first changed");
  await expect(f.store.load("echo-tools")).rejects.toBeDefined();
  await expect(second.load("echo-tools")).resolves.toMatchObject({ record: { sha256: b.record.sha256 } });
}, 30000);
it.skipIf(process.platform !== "win32")(
  "reserves Windows case aliases without falling back to a global plugin",
  async () => {
    const f = await fixture();
    await f.global.install(f.source);
    await rename(f.source, join(f.bench, ".vera/plugins/ECHO-TOOLS"));
    expect((await f.store.list()).every((p) => p.source === "workbench")).toBe(true);
    await expect(f.store.load("echo-tools")).rejects.toBeDefined();
    await expect(
      f.store.trustScoped("echo-tools", (await f.global.load("echo-tools")).record.sha256),
    ).rejects.toBeDefined();
  },
  30000,
);

it("invalidates a loaded snapshot when the workbench root is redirected to an unreviewed clone", async () => {
  const f = await fixture(),
    clone = join(f.root, "clone"),
    previous = join(f.root, "previous");
  await cp(f.bench, clone, { recursive: true });
  await f.store.trustScoped("echo-tools", (await f.store.reviewScoped("echo-tools")).sha256);
  const loaded = await f.store.load("echo-tools");
  await rename(f.bench, previous);
  await symlink(clone, f.bench, process.platform === "win32" ? "junction" : "dir");
  await expect(loaded.verify?.()).rejects.toMatchObject({ code: "CONFLICT" });
}, 30000);

it("fails closed when scoped discovery overflows instead of loading a hidden global collision", async () => {
  const f = await fixture();
  await f.global.install(f.source);
  for (let batch = 0; batch < 32; batch++)
    await Promise.all(
      Array.from({ length: 32 }, (_, i) =>
        mkdir(join(f.bench, ".vera/plugins", `a${String(batch * 32 + i).padStart(4, "0")}`)),
      ),
    );
  await expect(f.store.load("echo-tools")).rejects.toMatchObject({ code: "INVALID" });
  await expect(f.store.list()).rejects.toMatchObject({ code: "INVALID" });
}, 30000);
it("retains hash-addressed code and managed runtime identity after a later user review", async () => {
  const f = await fixture();
  const first = (await f.store.reviewScoped("echo-tools")).sha256;
  await f.store.trustScoped("echo-tools", first);
  const old = await f.store.load("echo-tools");
  const original = await readFile(join(old.folder, "echo.mjs"), "utf8");
  await writeFile(join(f.source, "echo.mjs"), "console.log('NEW HASH CODE');");
  const next = (await f.store.reviewScoped("echo-tools")).sha256;
  await f.store.trustScoped("echo-tools", next);
  const current = await f.store.load("echo-tools");
  expect(current.folder).not.toBe(old.folder);
  expect(current.runtimeKey).not.toBe(old.runtimeKey);
  const provisioner = new Provisioner({
    store: f.store,
    root: join(f.root, "runtime"),
    host: new FakeHost(),
    clock: { sleep: async () => {} },
    platform: "linux-x64",
    settings: () => undefined,
    fetch: async () => {
      throw Error("No download");
    },
  });
  expect(provisioner.uvEnvironment(current).UV_TOOL_DIR).not.toBe(provisioner.uvEnvironment(old).UV_TOOL_DIR);
  expect(await readFile(join(old.folder, "echo.mjs"), "utf8")).toBe(original);
  expect(await readFile(join(current.folder, "echo.mjs"), "utf8")).toContain("NEW HASH CODE");
  await writeFile(join(f.source, "echo.mjs"), original);
  await expect(f.store.load("echo-tools")).rejects.toMatchObject({ code: "DENIED" });
  await f.store.trustScoped("echo-tools", first);
  expect((await f.store.load("echo-tools")).folder).toBe(old.folder);
}, 30000);

it("refuses a combined global/scoped view beyond the IPC limit", async () => {
  const f = await fixture(),
    installed = join(f.data, "installed");
  await mkdir(installed, { recursive: true });
  for (let batch = 0; batch < 32; batch++)
    await Promise.all(
      Array.from({ length: 32 }, (_, i) =>
        mkdir(join(installed, `g${String(batch * 32 + i).padStart(4, "0")}`)),
      ),
    );
  await expect(f.store.ids()).rejects.toMatchObject({ code: "INVALID" });
  await expect(f.store.list()).rejects.toMatchObject({ code: "INVALID" });
}, 30000);
