// Replay-provider sessions that run the echo-tools fixture plugin end to end through the approval gate,
// the program tools and the runner; a scripted ProcessHost stands in for real processes.
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PermissionMode, SessionEvent } from "@vera/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSystemPrompt } from "../agent/prompt.js";
import * as core from "../index.js";
import type { LlmRequest } from "../llm/gateway.js";
import { ReplayGateway } from "../llm/replay.js";
import { FakeHost } from "../plugins/fake-process-host.test-support.js";
import { type ProgramHost, programPromptEntries } from "../plugins/program-tools.js";
import { ProgramRunner } from "../plugins/runner.js";
import { type LoadedPlugin, PluginStore } from "../plugins/store.js";
import { SkillCatalog } from "../skills/catalog.js";

const fixture = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../tests/fixtures/plugins/echo-tools",
);
const HANDLE = "01JB8Z6Q4M7N2K5R9T3V8X1Y0C";
const closes: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of closes.splice(0).reverse()) await close();
});

type Script = Record<string, unknown>[];
async function setup(
  options: {
    mode?: PermissionMode;
    programs?: boolean;
    scrub?: string;
    disabled?: string[];
    permissions?: core.PermissionEngine;
  } = {},
) {
  const base = await realpath(await mkdtemp(join(tmpdir(), "vera-programs-")));
  closes.push(() => rm(base, { recursive: true, force: true }));
  const root = join(base, "bench");
  await mkdir(join(root, ".vera"), { recursive: true });
  await mkdir(join(root, "build"));
  await mkdir(join(base, "scripts"));
  await writeFile(join(root, "build/app.bin"), "image");
  const store = new PluginStore({ root: join(base, "data/plugins") });
  await store.install(fixture);
  const enabled: string[] = ["echo-tools"];
  const plugins = async () => {
    const loaded: LoadedPlugin[] = [];
    for (const id of enabled) loaded.push(await store.load(id));
    return loaded;
  };
  const processes = new FakeHost();
  let ids = 0;
  const runner = new ProgramRunner({
    host: processes,
    clock: { sleep: async () => {} },
    id: () => (ids++ === 0 ? HANDLE : `01JB8Z6Q4M7N2K5R9T3V8X1Y${String(ids).padStart(2, "0")}`),
  });
  closes.push(() => runner.stopAll());
  // Each program_output poll runs the scripted step, so output timing never races real time.
  const hooks: { sleep?: () => void } = {};
  const programs: ProgramHost = {
    runner,
    clock: {
      sleep: async () => {
        hooks.sleep?.();
        await new Promise((done) => setTimeout(done, 1));
      },
    },
    plugins,
    resolver: { resolve: async () => ({ executable: "node" }) },
  };
  const skills = new SkillCatalog({
    root,
    disabled: () => [],
    plugins: async () => (await plugins()).map((p) => ({ id: p.manifest.id, folder: p.folder })),
  });
  const handle = await core.openDb(join(root, ".vera/vera.db"), { workbenchId: "wb_test", appVersion: "0" });
  closes.push(async () => handle.close());
  const catalogs: string[][] = [];
  let gateway: ReplayGateway | undefined;
  let script = "run";
  const scripts = async (name: string, steps: Script) => {
    await writeFile(
      join(base, "scripts", `${name}.jsonl`),
      steps.map((step) => JSON.stringify(step)).join("\n"),
    );
    gateway = new ReplayGateway({ dir: join(base, "scripts"), now: () => Date.now() });
    await gateway.models("replay", new AbortController().signal);
    script = name;
  };
  const host: core.SessionHost = {
    root,
    db: handle.db,
    gateway: {
      selectedModel: (id) => gateway?.selectedModel(id) ?? "",
      capabilities: (model) => (gateway as ReplayGateway).capabilities(model),
      models: (id, signal) => (gateway as ReplayGateway).models(id, signal),
      async *stream(request: LlmRequest) {
        catalogs.push(request.tools?.map((t) => t.name) ?? []);
        yield* (gateway as ReplayGateway).stream(request);
      },
    },
    clock: { now: () => new Date(), sleep: async () => {} },
    model: () => `replay/${script}`,
    prompt: () => "Test",
    skills,
    ...(options.programs === false ? {} : { programs }),
    ...(options.disabled ? { disabledTools: options.disabled } : {}),
    ...(options.permissions ? { permissions: options.permissions } : {}),
    ...(options.scrub
      ? { scrub: (text: string) => text.replaceAll(options.scrub as string, "[REDACTED]") }
      : {}),
  };
  const service = new core.SessionService(host);
  closes.push(() => service.close());
  await service.waitReady();
  const session = service.create(null, options.mode ?? "ask");
  const events: SessionEvent[] = [];
  service.subscribe(session.id, 0, (_seq, event) => events.push(event));
  const toolResults = () =>
    events.flatMap((event) => (event.type === "tool.done" ? [{ ok: event.ok, summary: event.summary }] : []));
  return {
    hooks,
    base,
    root,
    store,
    enabled,
    plugins,
    processes,
    runner,
    programs,
    skills,
    handle,
    service,
    session,
    events,
    toolResults,
    scripts,
    catalogs,
  };
}
type Rig = Awaited<ReturnType<typeof setup>>;
const run = (args: Record<string, unknown>) => ({
  toolCalls: [{ name: "run_program", args: { program: "echo", ...args } }],
});
async function pending(rig: Rig) {
  await expect
    .poll(() => rig.service.get(rig.session.id).snapshot.approvals.find((a) => !a.decision), {
      timeout: 2000,
    })
    .toBeDefined();
  return rig.service.get(rig.session.id).snapshot.approvals.find((a) => !a.decision) as {
    approvalId: string;
    requestSha256: string;
  };
}
async function spawned(rig: Rig, count = 1) {
  await vi.waitFor(() => expect(rig.processes.programs.length).toBe(count), { timeout: 2000 });
  return rig.processes.programs[count - 1] as NonNullable<(typeof rig.processes.programs)[number]>;
}
const approvals = (rig: Rig) =>
  rig.handle.db.prepare("SELECT decision, decided_by, consumed_at FROM approvals").all() as {
    decision: string | null;
    decided_by: string | null;
    consumed_at: string | null;
  }[];

describe("the echo-tools plugin in each permission mode", () => {
  it.each([
    ["read-only", "refused"],
    ["ask", "user"],
    ["auto-edit", "user"],
    ["bypass", "mode"],
  ] as const)("device-write in %s is %s (REQ-FUNC-bce7d786, REQ-SEC-08f730b3)", async (mode, outcome) => {
    const rig = await setup({ mode });
    await rig.scripts("write", [
      { match: "flash", ...run({ args: ["write", "build/app.bin"] }) },
      { text: "Done" },
    ]);
    rig.service.send(rig.session.id, "flash it");
    if (outcome === "user") {
      const approval = await pending(rig);
      rig.service.decideApproval({ sessionId: rig.session.id, ...approval, decision: "approved" });
    }
    if (outcome !== "refused") {
      const process = await spawned(rig);
      expect(process.executable).toBe("node");
      expect(process.args).toEqual([
        `${join(rig.base, "data/plugins/installed/echo-tools")}/echo.mjs`,
        "write",
        "build/app.bin",
      ]);
      process.print('{"command":"write"}\n');
      process.finish({ code: 0, signal: null });
    }
    expect(await rig.service.waitIdle(rig.session.id)).toEqual({ stopReason: "end" });
    const [result] = rig.toolResults();
    if (outcome === "refused") {
      expect(result).toMatchObject({ ok: false, summary: expect.stringMatching(/device-write.*read-only/) });
      expect(approvals(rig)).toEqual([]);
      expect(rig.processes.programs).toHaveLength(0);
      return;
    }
    expect(result?.ok).toBe(true);
    expect(JSON.parse(result?.summary ?? "{}")).toMatchObject({
      exitCode: 0,
      risk: "device-write",
      output: '{"command":"write"}\n',
      log: expect.stringMatching(/^\.vera\/runs\/.+\.log$/),
    });
    expect(approvals(rig)).toEqual([
      { decision: "approved", decided_by: outcome, consumed_at: expect.any(String) },
    ]);
  });
  it("runs a safe command in read-only without an approval record", async () => {
    const rig = await setup({ mode: "read-only" });
    await rig.scripts("version", [run({ args: ["version"] }), { text: "Done" }]);
    rig.service.send(rig.session.id, "version");
    (await spawned(rig)).finish({ code: 0, signal: null });
    await rig.service.waitIdle(rig.session.id);
    expect(rig.toolResults()[0]?.ok).toBe(true);
    expect(approvals(rig)).toEqual([]);
  });
  it("refuses a blocked command in bypass", async () => {
    const rig = await setup({ mode: "bypass" });
    await rig.scripts("monitor", [run({ args: ["monitor", "COM3"] }), { text: "Done" }]);
    rig.service.send(rig.session.id, "monitor");
    await rig.service.waitIdle(rig.session.id);
    expect(rig.toolResults()[0]).toMatchObject({
      ok: false,
      summary: expect.stringMatching(/blocked.*bypass/),
    });
    expect(approvals(rig)).toEqual([]);
    expect(rig.processes.programs).toHaveLength(0);
  });
  it("refuses an unknown program before any approval (REQ-SEC-affac265)", async () => {
    const rig = await setup();
    await rig.scripts("unknown", [
      { toolCalls: [{ name: "run_program", args: { program: "esptool" } }] },
      { text: "Done" },
    ]);
    rig.service.send(rig.session.id, "x");
    await rig.service.waitIdle(rig.session.id);
    expect(rig.toolResults()[0]).toMatchObject({ ok: false, summary: expect.stringMatching(/not declared/) });
    expect(approvals(rig)).toEqual([]);
  });
});

describe("background runs (REQ-FUNC-9b38f5a8, REQ-FUNC-da3adc80, REQ-FUNC-b70bb17e)", () => {
  it("reads a background run with until and stops it", async () => {
    const rig = await setup();
    await rig.scripts("serve", [
      run({ args: ["serve"], background: true }),
      { toolCalls: [{ name: "program_output", args: { handle: HANDLE, until: "READY", waitMs: 5000 } }] },
      { toolCalls: [{ name: "program_stop", args: { handle: HANDLE } }] },
      { text: "Done" },
    ]);
    rig.service.send(rig.session.id, "serve");
    const process = await spawned(rig);
    process.print("boot\n");
    let polls = 0;
    rig.hooks.sleep = () => {
      if (++polls === 3) process.print("READY\n");
    };
    expect(await rig.service.waitIdle(rig.session.id)).toEqual({ stopReason: "end" });
    const [started, output, stopped] = rig.toolResults().map((result) => JSON.parse(result.summary));
    expect(started).toEqual({ handle: HANDLE, risk: "safe", log: `.vera/runs/${HANDLE}.log` });
    expect(output).toMatchObject({ output: "boot\nREADY\n", running: true, matched: true });
    expect(stopped).toMatchObject({ stopped: true, log: `.vera/runs/${HANDLE}.log` });
    expect(process.exited).toBe(true);
  });
  it("reads a background run in a later turn and stops only this session's runs (REQ-FUNC-ea2dfb26)", async () => {
    const rig = await setup();
    await rig.scripts("serve", [run({ args: ["serve"], background: true }), { text: "Started" }]);
    rig.service.send(rig.session.id, "serve");
    const process = await spawned(rig);
    await rig.service.waitIdle(rig.session.id);
    expect(process.exited).toBe(false);
    process.print("later\n");
    await rig.scripts("read", [
      { toolCalls: [{ name: "program_output", args: { handle: HANDLE } }] },
      { text: "Read" },
    ]);
    rig.service.send(rig.session.id, "read");
    await rig.service.waitIdle(rig.session.id);
    expect(JSON.parse(rig.toolResults()[1]?.summary ?? "{}")).toMatchObject({
      output: "later\n",
      running: true,
    });
    const other = rig.service.create(null, "ask");
    await rig.scripts("serve", [run({ args: ["serve"], background: true }), { text: "Started" }]);
    rig.service.send(other.id, "serve");
    const otherProcess = await spawned(rig, 2);
    await rig.service.waitIdle(other.id);
    rig.service.stop(rig.session.id);
    await vi.waitFor(() => expect(process.exited).toBe(true));
    expect(otherProcess.exited).toBe(false);
    await rig.scripts("stop", [
      { toolCalls: [{ name: "program_stop", args: { handle: HANDLE } }] },
      { text: "Stopped" },
    ]);
    rig.service.send(rig.session.id, "stop");
    await rig.service.waitIdle(rig.session.id);
    expect(JSON.parse(rig.toolResults()[2]?.summary ?? "{}")).toMatchObject({ stopped: true });
  });
  it("stops a deleted session's background runs", async () => {
    const rig = await setup();
    await rig.scripts("serve", [run({ args: ["serve"], background: true }), { text: "Started" }]);
    rig.service.send(rig.session.id, "serve");
    const process = await spawned(rig);
    await rig.service.waitIdle(rig.session.id);
    await rig.service.delete(rig.session.id);
    expect(process.exited).toBe(true);
  });
});

describe("session safeguards", () => {
  it("aborts a foreground run when the session stops (REQ-FUNC-ea2dfb26)", async () => {
    const rig = await setup();
    await rig.scripts("long", [run({ args: ["serve"] }), { text: "Done" }]);
    rig.service.send(rig.session.id, "long");
    const process = await spawned(rig);
    rig.service.stop(rig.session.id);
    expect(await rig.service.waitIdle(rig.session.id)).toEqual({ stopReason: "aborted" });
    expect(process.exited).toBe(true);
  });
  it("refuses a request holding a known credential (REQ-SEC-b9d4244f)", async () => {
    const rig = await setup({ scrub: "s3cret", mode: "bypass" });
    await rig.scripts("secret", [run({ args: ["write", "--token", "s3cret"] }), { text: "Done" }]);
    rig.service.send(rig.session.id, "secret");
    await rig.service.waitIdle(rig.session.id);
    expect(rig.toolResults()[0]).toMatchObject({
      ok: false,
      summary: expect.stringMatching(/protected credential/),
    });
    expect(approvals(rig)).toEqual([]);
    expect(rig.processes.programs).toHaveLength(0);
    await rig.scripts("public", [run({ args: ["write", "--token", "public"] }), { text: "Done" }]);
    rig.service.send(rig.session.id, "public");
    (await spawned(rig)).finish({ code: 0, signal: null });
    await rig.service.waitIdle(rig.session.id);
    expect(rig.toolResults()[1]?.ok).toBe(true);
  });
  it("runs nothing when a named file changes while the approval waits (REQ-SEC-c730711e)", async () => {
    const rig = await setup();
    await rig.scripts("write", [run({ args: ["write", "build/app.bin"] }), { text: "Done" }]);
    rig.service.send(rig.session.id, "write");
    const approval = await pending(rig);
    await writeFile(join(rig.root, "build/app.bin"), "rebuilt");
    rig.service.decideApproval({ sessionId: rig.session.id, ...approval, decision: "approved" });
    await rig.service.waitIdle(rig.session.id);
    expect(rig.toolResults()[0]).toMatchObject({
      ok: false,
      summary: expect.stringMatching(/changed after approval/),
    });
    expect(approvals(rig)).toEqual([{ decision: "approved", decided_by: "user", consumed_at: null }]);
    expect(rig.processes.programs).toHaveLength(0);
  });
  it("runs only the exact request a host permission engine allowed (REQ-SEC-c730711e)", async () => {
    let root = "";
    const rig = await setup({
      permissions: {
        allow: async () => {
          await writeFile(join(root, "build/app.bin"), "rebuilt");
          return true;
        },
      },
    });
    root = rig.root;
    await rig.scripts("write", [run({ args: ["write", "build/app.bin"] }), { text: "Done" }]);
    rig.service.send(rig.session.id, "write");
    await rig.service.waitIdle(rig.session.id);
    expect(rig.toolResults()[0]).toMatchObject({
      ok: false,
      summary: expect.stringMatching(/changed after approval/),
    });
    expect(rig.processes.programs).toHaveLength(0);
  });
  it("loads the plugin skill with load_skill (REQ-FUNC-6d88d2ec)", async () => {
    const rig = await setup();
    await rig.scripts("skill", [
      { toolCalls: [{ name: "load_skill", args: { name: "echo-guide" } }] },
      { text: "Done" },
    ]);
    rig.service.send(rig.session.id, "skill");
    await rig.service.waitIdle(rig.session.id);
    expect(rig.toolResults()[0]).toMatchObject({
      ok: true,
      summary: expect.stringContaining("Run `echo version` first."),
    });
  });
});

describe("tool catalog and prompt (REQ-FUNC-29dd2b92, REQ-FUNC-fa6222a5)", () => {
  const programTools = ["run_program", "program_output", "program_stop"];
  it("offers the program tools with a program host, in read-only too, and never without one", async () => {
    for (const [mode, programs, expected, disabled] of [
      ["ask", true, programTools, []],
      ["read-only", true, ["run_program", "program_output", "program_stop"], []],
      ["ask", false, [], []],
      ["ask", true, ["program_output", "program_stop"], ["run_program"]],
    ] as const) {
      const rig = await setup({ mode, programs, disabled: [...disabled] });
      await rig.scripts("hello", [{ text: "Hi" }]);
      rig.service.send(rig.session.id, "hello");
      await rig.service.waitIdle(rig.session.id);
      expect(rig.catalogs[0]?.filter((name) => programTools.includes(name))).toEqual([...expected]);
      if (mode === "read-only") expect(rig.catalogs[0]).not.toContain("write");
    }
  });
  it("lists the program in the prompt only while its plugin is enabled", async () => {
    const rig = await setup();
    const prompt = async () =>
      buildSystemPrompt({
        workbench: { name: "Bench" },
        pinned: "",
        skills: [],
        programs: await programPromptEntries(rig.programs, await rig.skills.list()),
        env: {
          clock: { now: () => new Date(0), sleep: async () => {} },
          osFamily: "windows",
          veraVersion: "1",
          permissionMode: "ask",
          indexedDocuments: 0,
        },
      }).text;
    expect(await prompt()).toContain(
      "<programs>\n- echo (plugin echo-tools): Echo arguments and print test output. Use to exercise plugin program runs. Skill: echo-guide.\n</programs>",
    );
    rig.enabled.length = 0;
    expect(await prompt()).not.toContain("<programs>");
  });
});
