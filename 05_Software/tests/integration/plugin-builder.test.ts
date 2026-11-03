// REQ-FUNC-ef7d2de3 REQ-FUNC-01ec1dbd REQ-SEC-72b2eb0b: real process + SQLite + replay.
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  NodeProcessHost,
  openDb,
  PluginStore,
  ProgramRunner,
  SessionService,
  SkillCatalog,
} from "@vera/core";
import { afterEach, expect, it } from "vitest";
import { stringify } from "yaml";
import { ReplayGateway } from "../../src/libraries/core/src/llm/replay.js";

const cli = fileURLToPath(new URL("../fixtures/plugin-builder/cli.mjs", import.meta.url));
const closes: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of closes.splice(0).reverse()) await close();
});
it("drafts from CLI help, reviews a trial, approves bypass runs and promotes only through the user", async () => {
  const base = await mkdtemp(join(tmpdir(), "vera-builder-flow-"));
  closes.push(() => rm(base, { recursive: true, force: true }));
  const root = join(base, "bench"),
    data = join(base, "data");
  await mkdir(join(root, ".vera"), { recursive: true });
  await mkdir(join(base, "replay"));
  const help = (await promisify(execFile)(process.execPath, [cli, "--help"])).stdout;
  await writeFile(join(root, "manual.txt"), help);
  const manifest = {
    format: 1,
    id: "fixture-cli",
    version: "1.0.0",
    name: "Fixture CLI",
    description: "Inspect a virtual device using the documented CLI.",
    ecosystem: "general",
    platforms: ["windows-x64", "linux-x64"],
    programs: {
      "fixture-cli": {
        install: { find: { windows: ["%PATH%"], linux: ["$PATH"] }, hint: "Install the fixture CLI." },
        version: { args: ["--help"], match: "fixture-cli (\\d+\\.\\d+\\.\\d+)" },
      },
    },
    rules: [
      { match: "fixture-cli --help", risk: "safe" },
      { match: "fixture-cli inspect", risk: "safe" },
      { match: "fixture-cli burn", risk: "irreversible", note: "Virtual permanent write." },
    ],
  };
  const draft = "plugins/fixture-cli";
  await writeFile(
    join(base, "replay/build.jsonl"),
    [
      {
        match: "build",
        toolCalls: [
          { name: "load_skill", args: { name: "create-plugin" } },
          { name: "read", args: { path: "manual.txt" } },
        ],
      },
      {
        toolCalls: [{ name: "write", args: { path: `${draft}/plugin.yaml`, content: stringify(manifest) } }],
      },
      {
        toolCalls: [
          {
            name: "write",
            args: {
              path: `${draft}/skills/fixture-use/SKILL.md`,
              content:
                "---\nname: fixture-use\ndescription: Inspect the virtual CLI.\n---\nUse run_program after --help.\n",
            },
          },
        ],
      },
      { toolCalls: [{ name: "plugin_validate", args: { path: draft } }] },
      { toolCalls: [{ name: "plugin_install", args: { path: draft } }] },
      { text: "Ask the user to enable it." },
    ]
      .map((s) => JSON.stringify(s))
      .join("\n"),
  );
  await writeFile(
    join(base, "replay/inspect.jsonl"),
    [
      {
        match: "inspect",
        toolCalls: [{ name: "run_program", args: { program: "fixture-cli", args: ["inspect"] } }],
      },
      { text: "Inspected." },
    ]
      .map((s) => JSON.stringify(s))
      .join("\n"),
  );
  await writeFile(
    join(base, "replay/attack.jsonl"),
    [
      {
        match: "attack",
        toolCalls: [
          { name: "plugin_promote", args: { id: "fixture-cli" } },
          { name: "plugins.toggle", args: { id: "fixture-cli", enabled: true } },
          { name: "session.mode.set", args: { mode: "bypass" } },
          { name: "plugin_install", args: { path: draft, tier: "local", enabled: true } },
          {
            name: "write",
            args: { path: join(data, "plugins/installed/fixture-cli/plugin.yaml"), content: "hacked" },
          },
          {
            name: "write",
            args: { path: ".vera/workbench.yaml", content: "agent: {permission_mode: bypass}" },
          },
        ],
      },
      { text: "Refused." },
    ]
      .map((s) => JSON.stringify(s))
      .join("\n"),
  );
  const db = await openDb(join(root, ".vera/vera.db"), { workbenchId: "wb_test", appVersion: "0" });
  closes.push(() => db.close());
  const store = new PluginStore({ root: join(data, "plugins") });
  const runner = new ProgramRunner({
    host: new NodeProcessHost(spawn),
    clock: { sleep: (ms) => new Promise((done) => setTimeout(done, ms)) },
  });
  closes.push(() => runner.stopAll());
  const enabled: string[] = [];
  const gateway = new ReplayGateway({ dir: join(base, "replay"), now: () => Date.now() });
  await gateway.models("replay", new AbortController().signal);
  let model = "build";
  const service = new SessionService({
    root,
    db: db.db,
    gateway,
    clock: { now: () => new Date(), sleep: async () => {} },
    model: () => `replay/${model}`,
    prompt: () => "Fixture authoring acceptance",
    skills: new SkillCatalog({ root, disabled: () => [] }),
    pluginBuilder: store,
    managedRoots: [data],
    programs: {
      runner,
      clock: { sleep: (ms) => new Promise((done) => setTimeout(done, ms)) },
      plugins: async () => Promise.all(enabled.map((id) => store.load(id))),
      resolver: { resolve: async () => ({ executable: process.execPath, prefix: [cli], version: "1.0.0" }) },
    },
  });
  closes.push(() => service.close());
  await service.waitReady();
  const s = service.create(null, "bypass");
  const pending = () => service.get(s.id).snapshot.approvals.find((a) => !a.decision);
  const decide = () => {
    const a = pending();
    if (!a) throw Error("No pending approval");
    service.decideApproval({
      sessionId: s.id,
      approvalId: a.approvalId,
      requestSha256: a.requestSha256,
      decision: "approved",
    });
  };
  service.send(s.id, "build from the CLI help");
  await expect.poll(() => pending()?.tool, { timeout: 10000 }).toBe("plugin_install");
  expect(await store.ids()).toEqual([]);
  expect(pending()?.diff).toContain("irreversible");
  decide();
  await service.waitIdle(s.id);
  expect((await store.load("fixture-cli")).record.tier).toBe("trial");
  expect(enabled).toEqual([]);
  const toolRows = db.db.prepare("SELECT name,status FROM tool_calls").all();
  expect(toolRows).toContainEqual({ name: "plugin_validate", status: "ok" });
  enabled.push("fixture-cli"); // User action, outside the agent tool registry.
  model = "inspect";
  service.send(s.id, "inspect");
  await expect.poll(() => pending()?.tool, { timeout: 10000 }).toBe("run_program");
  expect((await runner.list(root)).length).toBe(0);
  decide();
  await service.waitIdle(s.id);
  expect((await runner.list(root))[0]?.exitCode).toBe(0);
  expect(
    await readFile(join(root, ".vera/runs", `${(await runner.list(root))[0]?.id}.log`), "utf8"),
  ).toContain("virtual device: ready");
  const loaded = await store.load("fixture-cli");
  await store.promote("fixture-cli", loaded.record.sha256); // User button's host operation.
  const before = service.get(s.id).snapshot.approvals.length;
  service.send(s.id, "inspect");
  await service.waitIdle(s.id);
  expect(service.get(s.id).snapshot.approvals.length).toBe(before);
  expect((await runner.list(root)).length).toBe(2);
  model = "attack";
  service.send(s.id, "attack");
  await service.waitIdle(s.id);
  const attack = db.db.prepare("SELECT status FROM tool_calls ORDER BY rowid DESC LIMIT 6").all();
  expect(attack).toEqual(Array.from({ length: 6 }, () => ({ status: "error" })));
  expect((await store.load("fixture-cli")).record.tier).toBe("local");
  expect(service.get(s.id).snapshot.mode).toBe("bypass");
}, 30000);
