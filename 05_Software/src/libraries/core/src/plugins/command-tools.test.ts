import { mkdir, mkdtemp, readFile, realpath, rename, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PermissionMode } from "@vera/shared";
import { builtinToolNames, settingsPatchSchema } from "@vera/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ToolContext } from "../tools/context.js";
import { ToolRegistry } from "../tools/registry.js";
import { runCommandTool } from "./command-tools.js";
import { FakeHost } from "./fake-process-host.test-support.js";
import { ProgramSession, programOutputTool, programStopTool } from "./program-tools.js";
import { ProgramRunner } from "./runner.js";

let root: string;
let host: FakeHost;
let runner: ProgramRunner;
let ctx: ToolContext;
let mode: PermissionMode;
let epoch: AbortController;
let shell: string;
const consume = vi.fn();
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "vera-command-")));
  await mkdir(join(root, ".vera"));
  await mkdir(join(root, "cwd"));
  host = new FakeHost();
  runner = new ProgramRunner({ host, clock: { sleep: async () => {} }, killGraceMs: 0 });
  mode = "ask";
  epoch = new AbortController();
  shell = "/bin/bash";
  consume.mockReset();
  ctx = {
    root,
    lastReads: new Map(),
    permissionMode: () => mode,
    bypassSignal: () => epoch.signal,
    programs: {
      sessionId: "ses_1",
      turnId: "turn_1",
      callId: "call_1",
      session: new ProgramSession(),
      consume,
      host: {
        runner,
        clock: { sleep: async () => {} },
        plugins: async () => [],
        resolver: { resolve: async () => undefined },
        shell: {
          resolve: async () => ({ executable: shell, kind: "bash" }),
          environment: () => ({ PATH: "/bin", USER_FLAG: "yes" }),
        },
      },
    },
  };
});
afterEach(async () => {
  await runner.stopAll();
  await rm(root, { recursive: true, force: true });
});
const signal = () => new AbortController().signal;
const prepare = (args: unknown, lifetime = signal()) =>
  runCommandTool.prepare?.(ctx, args, lifetime).then((prepared) => {
    if (!prepared) throw Error("Missing prepared command");
    return prepared;
  }) as NonNullable<ReturnType<NonNullable<typeof runCommandTool.prepare>>>;

it("offers the built-in shell command and accepts a user shell setting", () => {
  expect(builtinToolNames).toContain("run_command");
  expect(new ToolRegistry().available().some((tool) => tool.name === "run_command")).toBe(true);
  expect(settingsPatchSchema.safeParse({ shell: "pwsh" }).success).toBe(true);
});

it("carries host-owned Cmd quoting through the runner without adding model-controlled flags", async () => {
  if (!ctx.programs?.host.shell) throw Error("Missing shell host");
  ctx.programs.host.shell.resolve = async () => ({
    executable: "C:\\Windows\\System32\\cmd.exe",
    kind: "cmd",
  });
  const command = 'echo "A&B"';
  const call = await prepare({ command, background: true });
  const result = await call.apply(signal());
  expect(host.programs[0]?.options.windowsVerbatimArguments).toBe(true);
  expect(call.request).toMatchObject({ executableArgs: ["/d", "/s", "/c", `"${command}"`] });
  await runner.stopRun(root, String(result.handle));
});

it("records explicit command identity and canonical cwd, and shares UI Stop with the agent handle", async () => {
  const command = "echo 'ready'";
  const call = await prepare({ command, cwd: "cwd", background: true });
  const result = await call.apply(signal());
  expect(await runner.list(root)).toMatchObject([
    { command: { text: command, cwd: join(root, "cwd") }, state: "running" },
  ]);
  host.programs[0]?.print("ready\n");
  await runner.stopRun(root, String(result.handle));
  expect(await programOutputTool.execute(ctx, { handle: result.handle }, signal())).toMatchObject({
    running: false,
    stopped: true,
  });
  expect(await runner.list(root)).toMatchObject([
    { command: { text: command, cwd: join(root, "cwd") }, state: "stopped", durationMs: expect.any(Number) },
  ]);
});

it("keeps the longest accepted command in the run list and refuses commands exceeding its record limit", async () => {
  const command = "x".repeat(4096);
  const call = await prepare({ command, background: true });
  const run = await call.apply(signal());
  expect(await runner.list(root)).toMatchObject([{ id: run.handle, args: [command] }]);
  await runner.stopRun(root, String(run.handle));
  expect(await runner.list(root)).toMatchObject([{ id: run.handle, args: [command], state: "stopped" }]);
  expect(runCommandTool.params.safeParse({ command: "x".repeat(4097) }).success).toBe(false);
});

it("returns foreground exit, tail and complete log, inheriting only the host-filtered environment", async () => {
  const call = await prepare({ command: "echo 'hello; $HOME'", cwd: "cwd" });
  const result = call.apply(signal());
  await vi.waitFor(() => expect(host.programs).toHaveLength(1));
  const child = host.programs[0];
  expect(child?.args).toEqual(["-lc", "echo 'hello; $HOME'"]);
  expect(child?.options).toMatchObject({ cwd: join(root, "cwd"), env: { PATH: "/bin", USER_FLAG: "yes" } });
  expect(child?.options.input).toBeUndefined();
  child?.print("a".repeat(13_000));
  child?.finish({ code: 7, signal: null });
  const output = await result;
  expect(output).toMatchObject({ exitCode: 7, output: "a".repeat(12_000), truncated: true });
  expect(await readFile(join(root, String(output.log)), "utf8")).toBe("a".repeat(13_000));
  expect(consume).toHaveBeenCalledOnce();
  await expect(call.apply(signal())).rejects.toThrow("already used");
});

it("shares handles with output/until and stop, survives a completed tool turn, and stops with its session", async () => {
  const turn = new AbortController();
  const call = await prepare({ command: "server", background: true }, turn.signal);
  const result = await call.apply(turn.signal);
  turn.abort();
  expect(host.programs[0]?.exited).toBe(false);
  host.programs[0]?.print("ready on port 1234\n");
  expect(
    await programOutputTool.execute(ctx, { handle: result.handle, until: "ready on", waitMs: 100 }, signal()),
  ).toMatchObject({ matched: true, running: true });
  expect(await programStopTool.execute(ctx, { handle: result.handle }, signal())).toMatchObject({
    stopped: true,
  });
  const next = await prepare({ command: "server", background: true });
  await next.apply(signal());
  await runner.stopSession("ses_1");
  expect(host.programs.every((child) => child.exited)).toBe(true);
});

it("hides and refuses commands in Read-only", async () => {
  mode = "read-only";
  expect(new ToolRegistry().bind(ctx).some((tool) => tool.name === "run_command")).toBe(false);
  await expect(prepare({ command: "echo nope" })).rejects.toThrow("Read-only");
  expect(host.programs).toHaveLength(0);
});

it("binds shell resolution and cwd before consuming an approval", async () => {
  const call = await prepare({ command: "echo yes", cwd: "cwd" });
  shell = "/different/bash";
  await expect(call.apply(signal())).rejects.toMatchObject({ code: "CONFLICT" });
  expect(consume).not.toHaveBeenCalled();
});

it("revalidates the original cwd input immediately before spawn", async () => {
  const call = await prepare({ command: "echo yes", cwd: "cwd" });
  await rename(join(root, "cwd"), join(root, "old"));
  await expect(call.apply(signal())).rejects.toThrow();
  expect(host.programs).toHaveLength(0);
});

it("refuses an original cwd redirected into protected data during runner admission", async () => {
  mode = "bypass";
  const protectedRoot = join(root, "protected");
  await mkdir(protectedRoot);
  ctx.managedRoots = [protectedRoot];
  const call = await prepare({ command: "echo no", cwd: "cwd" });
  const start = runner.start.bind(runner);
  vi.spyOn(runner, "start").mockImplementationOnce(async (request) => {
    await rename(join(root, "cwd"), join(root, "old-cwd"));
    await symlink(protectedRoot, join(root, "cwd"), process.platform === "win32" ? "junction" : "dir");
    return start(request);
  });
  await expect(call.apply(signal())).rejects.toMatchObject({ code: "DENIED" });
  expect(host.programs).toHaveLength(0);
  expect(consume).not.toHaveBeenCalled();
});

it("refuses outside folders without Bypass and protected application-data cwd in every mode", async () => {
  await expect(prepare({ command: "echo no", cwd: tmpdir() })).rejects.toThrow();
  ctx.managedRoots = [join(root, "cwd")];
  for (const value of ["ask", "auto-edit", "bypass"] as const) {
    mode = value;
    await expect(prepare({ command: "echo no", cwd: "cwd" })).rejects.toThrow("application data");
  }
});

it("accepts Bypass outside cwd and stops background commands on epoch revocation", async () => {
  mode = "bypass";
  const call = await prepare({ command: "server", cwd: tmpdir(), background: true });
  await call.apply(signal());
  expect(host.programs[0]?.options.cwd).toBe(await realpath(tmpdir()));
  mode = "ask";
  epoch.abort();
  await vi.waitFor(() => expect(host.programs[0]?.exited).toBe(true));
});

it("rejects a prepared Bypass request after downgrade and kills a timed-out command", async () => {
  mode = "bypass";
  const revoked = await prepare({ command: "echo yes" });
  epoch.abort();
  mode = "ask";
  await expect(revoked.apply(signal())).rejects.toThrow();
  const timed = await prepare({ command: "sleep", timeout: 1, background: true });
  const result = await timed.apply(signal());
  await vi.waitFor(() => expect(host.programs[0]?.exited).toBe(true), { timeout: 2000 });
  expect(await programOutputTool.execute(ctx, { handle: result.handle }, signal())).toMatchObject({
    running: false,
  });
});

// REQ-SEC-f0170302, REQ-SEC-f0170303
it("accepts an added sibling cwd and refuses pending commands after removal at apply and spawn", async () => {
  const sibling = await mkdtemp(join(tmpdir(), "vera-command-sibling-"));
  let folders = [sibling];
  ctx.additionalFolders = () => folders;
  try {
    const call = await prepare({ command: "echo sibling", cwd: sibling, background: true });
    await call.apply(signal());
    expect(host.programs[0]?.options.cwd).toBe(await realpath(sibling));
    const pending = await prepare({ command: "echo pending", cwd: sibling, background: true });
    folders = [];
    await expect(pending.apply(signal())).rejects.toThrow();
    expect(host.programs).toHaveLength(1);
    folders = [sibling];
    const next = await prepare({ command: "echo late", cwd: sibling, background: true });
    const start = runner.start.bind(runner);
    vi.spyOn(runner, "start").mockImplementationOnce(async (request) => {
      folders = [];
      return start(request);
    });
    await expect(next.apply(signal())).rejects.toThrow();
    expect(host.programs).toHaveLength(1);
  } finally {
    await runner.stopAll();
    await rm(sibling, { recursive: true, force: true });
  }
});
