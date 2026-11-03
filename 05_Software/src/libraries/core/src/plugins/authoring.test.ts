import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PLUGIN_LIMITS, programPolicy } from "@vera/shared";
import * as archive from "fflate";
import { unzipSync } from "fflate";
import { afterEach, expect, it, vi } from "vitest";
import { stringify } from "yaml";
import { SkillCatalog } from "../skills/catalog.js";
import { createToolContext } from "../tools/context.js";
import { ToolRegistry } from "../tools/registry.js";
import { WriteQueue } from "../workbench/write-queue.js";
import { plugin } from "./program-fixtures.test-support.js";
import { PluginStore } from "./store.js";

vi.mock("fflate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fflate")>();
  return { ...actual, zipSync: vi.fn(actual.zipSync) };
});

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
    change: {
      db: undefined as never,
      queue: new WriteQueue(),
      sessionId: "ses",
      turnId: "turn",
      callId: "call",
      now: () => new Date().toISOString(),
      recorded: () => undefined,
    },
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
it("refuses an exported zip beyond the established import byte cap", async () => {
  const f = await fixture();
  const installed = await f.store.install(f.draft);
  vi.mocked(archive.zipSync).mockReturnValueOnce(new Uint8Array(PLUGIN_LIMITS.zipBytes + 1));
  const outcome = await f.store.export("fixture-cli", installed.sha256 ?? "").then(
    () => "exported",
    (error: { code: string }) => error.code,
  );
  expect(outcome).toBe("INVALID");
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
