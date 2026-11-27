import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { programPolicy } from "@vera/shared";
import { unzipSync } from "fflate";
import { afterEach, expect, it, vi } from "vitest";
import { stringify } from "yaml";
import { SkillCatalog } from "../skills/catalog.js";
import { createToolContext } from "../tools/context.js";
import { ToolRegistry } from "../tools/registry.js";
import { WriteQueue } from "../workbench/write-queue.js";
import { plugin } from "./program-fixtures.test-support.js";
import * as packages from "./store.js";
import { PluginStore } from "./store.js";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "vera-builder-"));
  roots.push(root);
  const draft = join(root, "workbench/plugins/fixture-cli");
  await mkdir(draft, { recursive: true });
  const manifest = plugin("fixture-cli", ["fixture"]).manifest;
  manifest.programs.fixture = {
    install: { find: { windows: ["%PATH%"], linux: ["$PATH"] } },
    version: { args: ["--help"], match: "fixture (\\d+)" },
  };
  manifest.rules = [{ match: "fixture send *", risk: "safe" }];
  const save = () => writeFile(join(draft, "plugin.yaml"), stringify(manifest));
  await save();
  const store = new PluginStore({ root: join(root, "data/plugins") });
  const ctx = { ...createToolContext(join(root, "workbench")), pluginBuilder: store };
  return { root, draft, manifest, save, store, ctx, registry: new ToolRegistry() };
}
const signal = () => new AbortController().signal;
const change = () => ({
  db: undefined as never,
  queue: new WriteQueue(),
  sessionId: "ses",
  turnId: "turn",
  callId: "call",
  now: () => new Date().toISOString(),
  recorded: () => undefined,
});
it("validates drafts and returns schema errors separately from authoring warnings", async () => {
  const f = await fixture();
  const result = await f.registry.execute(
    f.ctx,
    "plugin_validate",
    { path: "plugins/fixture-cli" },
    signal(),
  );
  expect(result.isError).toBe(false);
  expect(JSON.parse(result.text)).toMatchObject({
    errors: [],
    warnings: [{ code: "token" }, { code: "hint" }],
  });
  f.manifest.rules = [{ match: "fixture send *", risk: "device-write" }];
  const program = f.manifest.programs.fixture;
  if (program && "find" in program.install) program.install.hint = "Install the fixture CLI.";
  await f.save();
  const classified = await f.registry.execute(
    f.ctx,
    "plugin_validate",
    { path: "plugins/fixture-cli" },
    signal(),
  );
  expect(JSON.parse(classified.text)).toMatchObject({ errors: [], warnings: [] });
  f.manifest.rules = [];
  await f.save();
  const noRules = await f.registry.execute(
    f.ctx,
    "plugin_validate",
    { path: "plugins/fixture-cli" },
    signal(),
  );
  expect(JSON.parse(noRules.text).warnings).toContainEqual(expect.objectContaining({ code: "rules" }));
  await writeFile(join(f.draft, "plugin.yaml"), "format: 2\n");
  const invalid = await f.registry.execute(
    f.ctx,
    "plugin_validate",
    { path: "plugins/fixture-cli" },
    signal(),
  );
  expect(JSON.parse(invalid.text).errors.length).toBeGreaterThan(0);
});

it("names an unusable skill in draft validation without invalidating other plugin content", async () => {
  const f = await fixture();
  const folder = join(f.draft, "skills", "guide");
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, "SKILL.md"), "# Guide without front matter\n");
  const result = await f.registry.execute(
    f.ctx,
    "plugin_validate",
    { path: "plugins/fixture-cli" },
    signal(),
  );
  expect(JSON.parse(result.text)).toMatchObject({
    errors: [],
    warnings: expect.arrayContaining([
      { code: "skill-metadata", path: "skills/guide/SKILL.md", detail: expect.any(String) },
    ]),
  });
});
it("warns authors to verify subcommand help before dispatch (REQ-FUNC-8f4df41b)", async () => {
  const f = await fixture();
  f.manifest.programs.fixture!.subcommandHelp = { flag: "--help", commands: ["send"] };
  f.manifest.rules = [{ match: "fixture send *", risk: "device-write" }];
  await f.save();
  const result = await f.registry.execute(
    f.ctx,
    "plugin_validate",
    { path: "plugins/fixture-cli" },
    signal(),
  );
  expect(JSON.parse(result.text)).toMatchObject({
    errors: [],
    warnings: expect.arrayContaining([
      {
        code: "subcommand-help",
        path: "programs.fixture.subcommandHelp",
        detail: expect.stringContaining("prints help and exits before dispatch"),
      },
    ]),
  });
});
it("promotes only an unchanged trial and exports a portable package", async () => {
  const f = await fixture();
  const reviewed = await f.store.review(f.draft);
  const trial = await f.store.installTrial(f.draft, reviewed.sha256);
  expect(trial.tier).toBe("trial");
  expect(programPolicy("bypass", "safe", trial.tier === "trial")).toBe("user");
  await expect(f.store.promote("fixture-cli", "0".repeat(64))).rejects.toMatchObject({ code: "CONFLICT" });
  const local = await f.store.promote("fixture-cli", reviewed.sha256);
  expect(local.tier).toBe("local");
  expect(programPolicy("bypass", "safe", local.tier === "trial")).toBe("run");
  await expect(f.store.installTrial(f.draft, reviewed.sha256)).rejects.toMatchObject({ code: "DENIED" });
  const zip = await f.store.export("fixture-cli", reviewed.sha256);
  expect(Object.keys(unzipSync(zip))).toEqual(["plugin.yaml"]);
  const path = join(f.root, "export.zip");
  await writeFile(path, zip);
  expect((await f.store.review(path)).sha256).toBe(reviewed.sha256);
  const loaded = await f.store.load("fixture-cli");
  await writeFile(join(loaded.folder, "plugin.yaml"), "changed");
  await expect(f.store.export("fixture-cli", reviewed.sha256)).rejects.toBeDefined();
});
it("binds a trial install to the reviewed draft, rejects changed bytes and prevents direct execution", async () => {
  const f = await fixture();
  const ctx = {
    ...f.ctx,
    change: change(),
  };
  const prepared = await f.registry.prepare(ctx, "plugin_install", { path: "plugins/fixture-cli" }, signal());
  expect(prepared.request).toMatchObject({ tool: "plugin_install", protected: true });
  f.manifest.description = "Changed after review";
  await f.save();
  await expect(prepared.apply(signal())).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await f.store.ids()).toEqual([]);
  const next = await f.registry.prepare(ctx, "plugin_install", { path: "plugins/fixture-cli" }, signal());
  const abort = new AbortController();
  abort.abort();
  await expect(next.apply(abort.signal)).rejects.toBeDefined();
  expect(await f.store.ids()).toEqual([]);
  expect(
    (await f.registry.execute(ctx, "plugin_install", { path: "plugins/fixture-cli" }, signal())).isError,
  ).toBe(true);
  expect((await f.registry.execute(ctx, "plugin_validate", { path: "../data" }, signal())).isError).toBe(
    true,
  );
});

it("refuses to prepare replacement of a trusted plugin and rechecks trial eligibility after preparation", async () => {
  const f = await fixture();
  const ctx = { ...f.ctx, change: change() };
  const args = { path: "plugins/fixture-cli" };
  const hash = (await f.store.review(f.draft)).sha256;
  await f.store.installTrial(f.draft, hash);
  const fullReview = vi.spyOn(f.store, "review");
  const prepared = await f.registry.prepare(ctx, "plugin_install", args, signal());
  expect(fullReview).not.toHaveBeenCalled();
  await f.store.promote("fixture-cli", hash);
  await expect(f.registry.prepare(ctx, "plugin_install", args, signal())).rejects.toThrow(
    /cannot be replaced as a trial/,
  );
  await expect(prepared.apply(signal())).rejects.toMatchObject({ code: "DENIED" });
  expect((await f.store.load("fixture-cli")).record.tier).toBe("local");
});

it.each(["plugin_validate", "plugin_install"])("stops %s while reading the draft", async (tool) => {
  const f = await fixture();
  const controller = new AbortController();
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  const read = vi.spyOn(packages, "readPluginPackage").mockImplementationOnce(async () => {
    await held;
    throw Error("Read finished after Stop.");
  });
  const args = { path: "plugins/fixture-cli" };
  const ctx = { ...f.ctx, change: change() };
  const pending =
    tool === "plugin_validate"
      ? f.registry.execute(ctx, tool, args, controller.signal).then((result) => result.isError)
      : f.registry.prepare(ctx, tool, args, controller.signal).then(
          () => false,
          (error: unknown) => error === controller.signal.reason,
        );
  try {
    await vi.waitFor(() => expect(read).toHaveBeenCalledWith(f.draft, controller.signal));
    controller.abort();
    expect(await pending).toBe(true);
  } finally {
    release();
  }
});

it("cleans a cancelled staged trial and keeps the previous installed package", async () => {
  const f = await fixture();
  const first = (await f.store.review(f.draft)).sha256;
  await f.store.installTrial(f.draft, first);
  f.manifest.version = "1.2.3";
  await f.save();
  const next = (await f.store.review(f.draft)).sha256;
  const controller = new AbortController();
  let ids = 0;
  const store = new PluginStore({
    root: f.store.root,
    uuid: () => {
      if (++ids === 2) controller.abort();
      return `cancel-fixture-${ids}`;
    },
  });
  await expect(store.installTrial(f.draft, next, undefined, controller.signal)).rejects.toMatchObject({
    name: "AbortError",
  });
  expect((await f.store.load("fixture-cli")).record.sha256).toBe(first);
  expect(await readdir(join(f.store.root, "staging"))).toEqual([]);
});
it("ships an immutable official create-plugin skill and keeps disabling available", async () => {
  const f = await fixture();
  const disabled: string[] = [];
  const catalog = new SkillCatalog({ root: f.ctx.root, disabled: () => disabled });
  expect(await catalog.list()).toContainEqual(
    expect.objectContaining({ name: "create-plugin", source: "official" }),
  );
  const loaded = await catalog.load("create-plugin", undefined, signal());
  for (const word of [
    "search_docs",
    "web_read",
    "plugin_validate",
    "plugin_install",
    "CONTRIBUTING",
    "operations",
  ])
    expect(loaded.text).toContain(word);
  disabled.push("create-plugin");
  await expect(catalog.load("create-plugin", undefined, signal())).rejects.toMatchObject({ code: "DENIED" });
  expect(await readFile(join(f.draft, "plugin.yaml"), "utf8")).toContain("fixture-cli");
});

// REQ-SEC-3856567c
it("refuses application-data draft access without affecting internal plugin review", async () => {
  const f = await fixture();
  const ctx = { ...f.ctx, managedRoots: [f.draft], permissionMode: () => "bypass" as const };
  const outcome = await f.registry.execute(ctx, "plugin_validate", { path: "plugins/fixture-cli" }, signal());
  expect(outcome.isError).toBe(true);
  expect(outcome.text).toContain("VERA application data");
  expect((await f.store.review(f.draft)).manifest?.id).toBe("fixture-cli");
});

it("validates and installs an outside draft only in Bypass, records absolute source and retains revocation", async () => {
  const f = await fixture();
  const outside = join(f.root, "outside", "fixture-cli");
  await cp(f.draft, outside, { recursive: true });
  let mode: "ask" | "bypass" = "ask";
  let epoch = new AbortController();
  const ctx = {
    ...f.ctx,
    permissionMode: () => mode,
    bypassSignal: () => epoch.signal,
    change: change(),
  };
  expect((await f.registry.execute(ctx, "plugin_validate", { path: outside }, signal())).isError).toBe(true);
  await expect(f.registry.prepare(ctx, "plugin_install", { path: outside }, signal())).rejects.toThrow();
  mode = "bypass";
  expect((await f.registry.execute(ctx, "plugin_validate", { path: outside }, signal())).isError).toBe(false);
  const revoked = await f.registry.prepare(ctx, "plugin_install", { path: outside }, signal());
  expect(revoked.request).toMatchObject({ path: outside.replaceAll("\\", "/") });
  epoch.abort();
  mode = "ask";
  epoch = new AbortController();
  mode = "bypass";
  await expect(revoked.apply(signal())).rejects.toThrow();
  expect(await f.store.ids()).toEqual([]);
  const install = await f.registry.prepare(ctx, "plugin_install", { path: outside }, signal());
  expect((await install.apply(signal())).enabledByInstall).toBe(false);
  expect(await f.store.ids()).toEqual(["fixture-cli"]);
  expect((await f.store.load("fixture-cli")).folder.startsWith(f.store.root)).toBe(true);
});

it("leaves work files out of the package and says so", async () => {
  const f = await fixture();
  // What turns up in a draft folder while a plugin is written.
  await mkdir(join(f.draft, ".git/objects"), { recursive: true });
  await writeFile(join(f.draft, ".git/objects/ab"), "object");
  await mkdir(join(f.draft, "scripts/__pycache__"), { recursive: true });
  await writeFile(join(f.draft, "scripts/__pycache__/tool.cpython-312.pyc"), "compiled");
  await writeFile(join(f.draft, ".DS_Store"), "desktop");
  const result = await f.registry.execute(
    f.ctx,
    "plugin_validate",
    { path: "plugins/fixture-cli" },
    signal(),
  );
  const { errors, warnings } = JSON.parse(result.text) as {
    errors: unknown[];
    warnings: { code: string; path: string }[];
  };
  expect(errors).toEqual([]);
  expect(warnings.filter(({ code }) => code === "left-out").map(({ path }) => path)).toEqual([
    ".DS_Store",
    ".git",
    "scripts/__pycache__",
  ]);
  const ctx = { ...f.ctx, change: change() };
  const prepared = await f.registry.prepare(ctx, "plugin_install", { path: "plugins/fixture-cli" }, signal());
  await prepared.apply(signal());
  const installed = await f.store.load("fixture-cli");
  expect((await readdir(installed.folder)).sort()).toEqual(["install.json", "plugin.yaml"]);
});

it("explains each validation error and a draft that cannot be read", async () => {
  const f = await fixture();
  const validate = async (path = "plugins/fixture-cli") => {
    const result = await f.registry.execute(f.ctx, "plugin_validate", { path }, signal());
    return {
      failed: result.isError,
      ...(JSON.parse(result.text) as { errors?: unknown[]; error?: string }),
    };
  };
  Object.assign(f.manifest, { version: "latest", author: "me" });
  await f.save();
  expect((await validate()).errors).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: "version", detail: expect.stringMatching(/^version is not/) }),
      {
        code: "field",
        path: "author",
        issue: "unrecognized_keys",
        detail: "author is not a manifest field; remove it.",
      },
    ]),
  );
  await writeFile(join(f.draft, "plugin.yaml"), "programs: [unclosed\n");
  expect((await validate()).errors).toEqual([
    {
      code: "yaml",
      line: expect.any(Number),
      detail: expect.stringMatching(/^plugin.yaml is not valid YAML at line \d+\.$/),
    },
  ]);
  await rm(join(f.draft, "plugin.yaml"));
  expect((await validate()).errors).toEqual([
    { code: "manifest", detail: "plugin.yaml is missing, larger than 256 KiB or not UTF-8 text." },
  ]);
  await writeFile(join(f.draft, "install.json"), "{}");
  expect(await validate()).toMatchObject({
    failed: true,
    error: expect.stringContaining("install.json is written by VERA at installation"),
  });
  const missing = await validate("plugins/missing");
  expect(missing).toMatchObject({
    failed: true,
    error: expect.stringContaining("There is no folder at plugins/missing"),
  });
  expect(JSON.stringify(missing)).not.toContain(f.root);
});

it("says after the approval why a trial was not installed", async () => {
  const f = await fixture();
  const ctx = { ...f.ctx, change: change() };
  const prepared = await f.registry.prepare(ctx, "plugin_install", { path: "plugins/fixture-cli" }, signal());
  await writeFile(join(f.draft, "notes.md"), "added after the review");
  const failure = await prepared.apply(signal()).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(Error);
  expect(failure).toMatchObject({
    code: "CONFLICT",
    message: expect.stringContaining("The draft changed after it was reviewed"),
  });
});
