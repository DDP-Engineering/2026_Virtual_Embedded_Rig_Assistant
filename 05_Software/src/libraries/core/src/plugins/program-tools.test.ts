import { writeFileSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type PermissionMode, pluginManifestSchema, veraError } from "@vera/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestSha256 } from "../agent/approvals.js";
import type { ToolContext } from "../tools/context.js";
import { FakeHost } from "./fake-process-host.test-support.js";
import type { ProgramChangeRequest } from "./program-request.js";
import {
  type ProgramHost,
  type ProgramResolver,
  ProgramSession,
  programOutputTool,
  programPromptEntries,
  programStopTool,
  programTimeout,
  runProgramTool,
} from "./program-tools.js";
import { ProgramRunner } from "./runner.js";
import { type LoadedPlugin, PluginStore } from "./store.js";

const program = (extra: Record<string, unknown> = {}) => ({
  install: { pip: "echo" },
  version: { args: ["--version"], match: "(\\d+)" },
  ...extra,
});
function loaded(
  id: string,
  programs: Record<string, unknown>,
  rules: Record<string, unknown>[] = [],
  versions: Record<string, string> = {},
): LoadedPlugin {
  return {
    folder: `/plugins/${id}`,
    manifest: pluginManifestSchema.parse({
      format: 1,
      id,
      version: "1.0.0",
      name: id,
      description: `${id} tools.`,
      ecosystem: "general",
      platforms: ["windows-x64", "linux-x64"],
      programs,
      rules,
    }),
    record: {
      format: 1,
      id,
      version: "1.0.0",
      tier: "local",
      source: { kind: "folder", path: `/src/${id}` },
      sha256: "c".repeat(64),
      installedAt: "2026-11-02T00:00:00.000Z",
      programs: versions,
    },
  };
}
const echoRules = [
  { match: "echo version", risk: "safe" },
  { match: "echo write *", risk: "device-write", note: "Writes the device." },
  { match: "echo burn *", risk: "blocked" },
  { match: "echo slow *", risk: "safe", timeout: 30 },
];

let root = "";
let host: FakeHost;
let runner: ProgramRunner;
let plugins: LoadedPlugin[];
let resolver: ProgramResolver;
let mode: PermissionMode;
let consumed: ProgramChangeRequest[];
let approved: ProgramChangeRequest | undefined;
let ctx: ToolContext;
let onSleep: (() => void) | undefined;
const signal = () => new AbortController().signal;
/** Runs `step` on the `count`th poll sleep of program_output. */
function onPoll(count: number, step: () => void) {
  let polls = 0;
  onSleep = () => {
    if (++polls === count) step();
  };
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "vera-program-tools-")));
  await mkdir(join(root, ".vera"));
  await mkdir(join(root, "build"));
  await writeFile(join(root, "build/app.bin"), "image");
  host = new FakeHost();
  runner = new ProgramRunner({ host, clock: { sleep: async () => {} } });
  plugins = [loaded("echo-tools", { echo: program() }, echoRules, { echo: "1.2.3" })];
  resolver = { resolve: async () => ({ executable: "/usr/bin/echo-tool" }) };
  mode = "ask";
  consumed = [];
  approved = undefined;
  onSleep = undefined;
  const programHost: ProgramHost = {
    runner,
    clock: {
      sleep: async () => {
        onSleep?.();
        await new Promise((done) => setTimeout(done, 1));
      },
    },
    plugins: async () => plugins,
    resolver: { resolve: (plugin, name, signal) => resolver.resolve(plugin, name, signal) },
  };
  ctx = {
    root,
    lastReads: new Map(),
    permissionMode: () => mode,
    programs: {
      host: programHost,
      session: new ProgramSession(),
      sessionId: "ses_1",
      turnId: "turn_1",
      callId: "call_1",
      // Mirrors the gate: only the request that was approved consumes.
      consume: (request) => {
        if (approved && requestSha256(request) !== requestSha256(approved)) throw veraError("CONFLICT");
        consumed.push(request);
      },
    },
  };
});
afterEach(async () => {
  await runner.stopAll();
  await rm(root, { recursive: true, force: true });
});

async function prepare(args: Record<string, unknown>) {
  const prepared = await runProgramTool.prepare?.(ctx, args, signal());
  if (!prepared) throw Error("run_program must prepare.");
  approved = prepared.request as ProgramChangeRequest;
  return prepared;
}
async function spawned(count: number) {
  await vi.waitFor(() => expect(host.programs.length).toBe(count));
  return host.programs[count - 1] as NonNullable<(typeof host.programs)[number]>;
}

describe("run_program foreground (REQ-FUNC-bce7d786)", () => {
  it("returns exit code, duration, risk, output and log after the approval is consumed", async () => {
    const prepared = await prepare({ program: "echo", args: ["version"] });
    const result = prepared.apply(signal());
    const process = await spawned(1);
    process.print("echo 1.2.3\n");
    process.finish({ code: 3, signal: null });
    const value = await result;
    expect(value).toMatchObject({ exitCode: 3, risk: "safe", output: "echo 1.2.3\n", truncated: false });
    expect(value.log).toMatch(/^\.vera\/runs\/[0-9A-HJKMNP-TV-Z]{26}\.log$/);
    expect(typeof value.durationMs).toBe("number");
    expect(consumed).toHaveLength(1);
  });
  it("keeps the last 12 000 characters of a long output", async () => {
    const prepared = await prepare({ program: "echo", args: ["version"] });
    const result = prepared.apply(signal());
    const process = await spawned(1);
    process.print("x".repeat(50_000));
    process.finish({ code: 0, signal: null });
    const value = await result;
    expect(value).toMatchObject({ truncated: true });
    expect(String(value.output)).toHaveLength(12_000);
  });
});

describe("command line (REQ-FUNC-8e22989a)", () => {
  it("guards opt-in Git diff execution while retaining raw classification, approval and run-record args", async () => {
    plugins = [
      loaded("git", { git: program({ optionSyntax: "git", prefix: ["-c", "diff.external="] }) }, [
        { match: "git diff *", risk: "safe" },
      ]),
    ];
    const raw = ["-P", "diff", "--staged", "--", "build/app.bin"];
    const prepared = await prepare({ program: "git", args: raw });
    expect(prepared.request).toMatchObject({ args: raw, risk: "safe" });
    const result = prepared.apply(signal());
    const process = await spawned(1);
    expect(process.args).toEqual([
      "-c",
      "diff.external=",
      "-P",
      "diff",
      "--no-ext-diff",
      "--staged",
      "--",
      "build/app.bin",
    ]);
    process.finish({ code: 0, signal: null });
    const { log } = (await result) as { log: string };
    expect(JSON.parse(await readFile(join(root, log.replace(/\.log$/, ".json")), "utf8"))).toMatchObject({
      args: raw,
    });
  });
  // REQ-PLAT-e0d8f3cf
  it("passes the desktop's display variables only to a program that declares windows (gui: true)", async () => {
    (host.env as Record<string, string>).DISPLAY = ":0";
    (host.env as Record<string, string>).XAUTHORITY = "/home/u/.Xauthority";
    const rules = [{ match: "{echo,editor} status *", risk: "safe" }];
    plugins = [
      loaded("echo-tools", { echo: program(), editor: program({ gui: true }) }, rules, {
        echo: "1",
        editor: "1",
      }),
    ];
    for (const [name, expected] of [
      ["echo", false],
      ["editor", true],
    ] as const) {
      const result = (await prepare({ program: name, args: ["status"] })).apply(signal());
      const process = await spawned(name === "echo" ? 1 : 2);
      if (expected)
        expect(process.options.env).toMatchObject({ DISPLAY: ":0", XAUTHORITY: "/home/u/.Xauthority" });
      else {
        expect(process.options.env).not.toHaveProperty("DISPLAY");
        expect(process.options.env).not.toHaveProperty("XAUTHORITY");
      }
      process.finish({ code: 0, signal: null });
      await result;
    }
  });
  it("joins resolver prefix, manifest prefix and agent arguments with expanded env and cwd", async () => {
    plugins = [
      loaded(
        "echo-tools",
        {
          echo: program({
            // biome-ignore lint/suspicious/noTemplateCurlyInString: manifest placeholders.
            prefix: ["${pluginDir}/echo.mjs"],
            // biome-ignore lint/suspicious/noTemplateCurlyInString: manifest placeholders.
            env: { ROOT: "${workbench}", DIR: "${pluginDir}" },
          }),
        },
        [
          { match: "echo status *", risk: "safe" },
          { match: "echo --no-warnings *", risk: "blocked" },
        ],
      ),
    ];
    resolver = { resolve: async () => ({ executable: "node", prefix: ["--no-warnings"] }) };
    const prepared = await prepare({ program: "echo", args: ["status", "a b"], cwd: "build" });
    expect(prepared.request).toMatchObject({ risk: "safe", cwd: "build", executableArgs: ["--no-warnings"] });
    const result = prepared.apply(signal());
    const process = await spawned(1);
    expect(process.executable).toBe("node");
    expect(process.args).toEqual(["--no-warnings", "/plugins/echo-tools/echo.mjs", "status", "a b"]);
    expect(process.options.env).toMatchObject({ ROOT: root, DIR: "/plugins/echo-tools" });
    expect(process.options.cwd).toBe(join(root, "build"));
    process.finish({ code: 0, signal: null });
    const { log } = (await result) as { log: string };
    // REQ-DATA-f563074f: the run record names the plugin, program and only the agent's arguments.
    expect(JSON.parse(await readFile(join(root, log.replace(/\.log$/, ".json")), "utf8"))).toMatchObject({
      plugin: "echo-tools",
      program: "echo",
      args: ["status", "a b"],
    });
  });
});

describe("timeout cap (REQ-FUNC-90a95bef)", () => {
  it("clamps the agent's timeout to the rule, then program, then 600 s cap", () => {
    expect(programTimeout({ rule: 30, program: 120, requested: 500, background: false })).toBe(30_000);
    expect(programTimeout({ rule: null, program: 120, background: false })).toBe(120_000);
    expect(programTimeout({ rule: null, background: false })).toBe(600_000);
    expect(programTimeout({ rule: null, program: 120, background: true })).toBeUndefined();
    expect(programTimeout({ rule: null, program: 120, requested: 5000, background: true })).toBe(120_000);
  });
  it("stops a foreground run at its timeout and reports timedOut", async () => {
    const prepared = await prepare({ program: "echo", args: ["slow", "x"], timeout: 1 });
    const result = prepared.apply(signal());
    await spawned(1);
    expect(await result).toMatchObject({ timedOut: true, exitCode: null });
  });
  it("passes the rule timeout to the runner", async () => {
    const start = vi.spyOn(runner, "start");
    const prepared = await prepare({ program: "echo", args: ["slow", "x"], timeout: 3600 });
    const result = prepared.apply(signal());
    (await spawned(1)).finish({ code: 0, signal: null });
    await result;
    expect(start.mock.calls[0]?.[0].timeoutMs).toBe(30_000);
  });
});

describe("refusals before approval", () => {
  it.each([
    ["undeclared", { program: "other" }, /not declared/],
    ["ambiguous", { program: "echo" }, /more than one enabled plugin/],
    ["unresolved", { program: "echo" }, /not available/],
  ])("refuses a %s program (REQ-SEC-affac265)", async (label, args, message) => {
    if (label === "ambiguous") plugins.push(loaded("echo-more", { echo: program() }));
    if (label === "unresolved") resolver = { resolve: async () => undefined };
    await expect(runProgramTool.prepare?.(ctx, { ...args, args: ["version"] }, signal())).rejects.toThrow(
      message,
    );
    expect(host.programs).toHaveLength(0);
  });
  it("names risk and mode when the policy refuses (REQ-SEC-08f730b3)", async () => {
    mode = "read-only";
    await expect(prepare({ program: "echo", args: ["write", "x"] })).rejects.toThrow(
      /device-write.*read-only/,
    );
    mode = "bypass";
    await expect(prepare({ program: "echo", args: ["burn", "x"] })).rejects.toThrow(/blocked.*bypass/);
    mode = "read-only";
    plugins = [
      {
        ...loaded("echo-tools", { echo: program() }, echoRules),
        record: { ...loaded("echo-tools", {}).record, tier: "trial" },
      },
    ];
    await expect(prepare({ program: "echo", args: ["version"] })).rejects.toThrow(
      /safe commands of trial plugin echo-tools.*read-only/,
    );
    plugins = [loaded("echo-tools", { echo: program() }, echoRules)];
    mode = "read-only";
    await expect(prepare({ program: "echo", args: ["version"] })).resolves.toBeDefined();
  });
  it("names the argument a refusal is about", async () => {
    await expect(prepare({ program: "echo", args: ["write", "@args.txt"] })).rejects.toThrow(/Argument 1/);
  });
});

describe("approval binding", () => {
  it("prepares again and refuses a run whose file changed after approval (REQ-SEC-c730711e)", async () => {
    const prepared = await prepare({ program: "echo", args: ["write", "build/app.bin"] });
    await writeFile(join(root, "build/app.bin"), "rebuilt");
    await expect(prepared.apply(signal())).rejects.toThrow(/changed after approval/);
    expect(consumed).toHaveLength(0);
    expect(host.programs).toHaveLength(0);
  });
  it("refuses a run whose plugin was disabled while waiting", async () => {
    const prepared = await prepare({ program: "echo", args: ["version"] });
    plugins = [];
    await expect(prepared.apply(signal())).rejects.toThrow(/not declared/);
    expect(host.programs).toHaveLength(0);
  });
  it("re-checks file hashes right before spawn (REQ-SEC-370f2d9b)", async () => {
    const programs = ctx.programs;
    if (!programs) throw Error("Programs must exist.");
    const consume = programs.consume;
    // The file changes after the approval is consumed and before the process would start.
    programs.consume = (request) => {
      consume?.(request);
      writeFileSync(join(root, "build/app.bin"), "swapped");
    };
    const prepared = await prepare({ program: "echo", args: ["write", "build/app.bin"] });
    await expect(prepared.apply(signal())).rejects.toThrow(/changed after approval/);
    expect(consumed).toHaveLength(1);
    expect(host.programs).toHaveLength(0);
    const [log] = await readdir(join(root, ".vera/runs"));
    expect(await readFile(join(root, ".vera/runs", log ?? ""), "utf8")).toContain(
      "[VERA] The program did not start",
    );
  });
  it("never runs without the session's approval path", async () => {
    const programs = ctx.programs as NonNullable<ToolContext["programs"]>;
    delete programs.consume;
    await expect(
      runProgramTool.prepare?.(ctx, { program: "echo", args: ["version"] }, signal()),
    ).rejects.toThrow(/unavailable/);
    await expect(
      runProgramTool.execute(ctx, { program: "echo", args: ["version"] }, signal()),
    ).rejects.toThrow(/approval path/);
    expect(host.programs).toHaveLength(0);
  });
  it("runs one prepared request once", async () => {
    const prepared = await prepare({ program: "echo", args: ["version"] });
    const result = prepared.apply(signal());
    (await spawned(1)).finish({ code: 0, signal: null });
    await result;
    await expect(prepared.apply(signal())).rejects.toThrow(/already/);
  });
});

describe("background runs", () => {
  async function background() {
    const prepared = await prepare({ program: "echo", args: ["version"], background: true });
    const value = await prepared.apply(signal());
    return { value, process: await spawned(1) };
  }
  it("returns a handle and keeps running (REQ-FUNC-9b38f5a8)", async () => {
    const { value, process } = await background();
    expect(value).toEqual({
      handle: expect.any(String),
      risk: "safe",
      log: `.vera/runs/${value.handle}.log`,
    });
    expect(process.exited).toBe(false);
  });
  it("reads output since the previous read, then the exit code (REQ-FUNC-e54f89a4)", async () => {
    const { value, process } = await background();
    process.print("one\n");
    expect(await programOutputTool.execute(ctx, { handle: value.handle }, signal())).toEqual({
      output: "one\n",
      truncated: false,
      running: true,
    });
    process.print("two\n");
    expect(await programOutputTool.execute(ctx, { handle: value.handle }, signal())).toMatchObject({
      output: "two\n",
      running: true,
    });
    process.print("y".repeat(13_000));
    const long = await programOutputTool.execute(ctx, { handle: value.handle }, signal());
    expect(long).toMatchObject({ truncated: true });
    expect(String(long.output)).toHaveLength(12_000);
    process.finish({ code: 0, signal: null });
    await vi.waitFor(async () =>
      expect(await programOutputTool.execute(ctx, { handle: value.handle }, signal())).toMatchObject({
        running: false,
        exitCode: 0,
      }),
    );
  });
  it("waits for until and reports whether it matched (REQ-FUNC-da3adc80)", async () => {
    const { value, process } = await background();
    process.print("boot\n");
    onPoll(3, () => process.print("READY\n"));
    expect(
      await programOutputTool.execute(
        ctx,
        { handle: value.handle, until: "^READY$", waitMs: 5000 },
        signal(),
      ),
    ).toEqual({ output: "boot\nREADY\n", truncated: false, running: true, matched: true });
    expect(
      await programOutputTool.execute(ctx, { handle: value.handle, until: "NEVER", waitMs: 50 }, signal()),
    ).toMatchObject({ matched: false, running: true });
    expect(programOutputTool.params.safeParse({ handle: value.handle, waitMs: 30_001 }).success).toBe(false);
    onPoll(2, () => process.finish({ code: 2, signal: null }));
    expect(
      await programOutputTool.execute(ctx, { handle: value.handle, waitMs: 5000 }, signal()),
    ).toMatchObject({ running: false, exitCode: 2 });
  });
  it("refuses an invalid or slow until pattern (REQ-SEC-e9bc4628)", async () => {
    const { value, process } = await background();
    await expect(
      programOutputTool.execute(ctx, { handle: value.handle, until: "(" }, signal()),
    ).rejects.toThrow(/not a valid regular expression/);
    process.print("a".repeat(40));
    const started = Date.now();
    await expect(
      programOutputTool.execute(ctx, { handle: value.handle, until: "(a|a)*b" }, signal()),
    ).rejects.toThrow(/100 ms/);
    expect(Date.now() - started).toBeLessThan(1000);
    process.print("ok");
    expect(
      await programOutputTool.execute(ctx, { handle: value.handle, until: "ok" }, signal()),
    ).toMatchObject({
      matched: true,
    });
  });
  it("stops a run and forgets its handle (REQ-FUNC-b70bb17e, REQ-FUNC-c6761a12)", async () => {
    const { value, process } = await background();
    process.print("tail\n");
    const stopped = await programStopTool.execute(ctx, { handle: value.handle }, signal());
    expect(stopped).toMatchObject({ stopped: true, output: "tail\n", log: value.log });
    expect(process.exited).toBe(true);
    await expect(programOutputTool.execute(ctx, { handle: value.handle }, signal())).rejects.toThrow(
      /Unknown program handle/,
    );
    await expect(programStopTool.execute(ctx, { handle: value.handle }, signal())).rejects.toThrow(
      /Unknown program handle/,
    );
  });
  it("never returns another session's run (REQ-FUNC-c6761a12)", async () => {
    const { value, process } = await background();
    const other = {
      ...ctx,
      programs: { ...(ctx.programs as NonNullable<ToolContext["programs"]>), session: new ProgramSession() },
    };
    await expect(programOutputTool.execute(other, { handle: value.handle }, signal())).rejects.toThrow(
      /Unknown program handle/,
    );
    await expect(programStopTool.execute(other, { handle: value.handle }, signal())).rejects.toThrow(
      /Unknown program handle/,
    );
    for (const tool of [programOutputTool, programStopTool])
      await expect(tool.execute(ctx, { handle: "01JB8Z6Q4M7N2K5R9T3V8X1Y0C" }, signal())).rejects.toThrow(
        /Unknown program handle/,
      );
    expect(process.exited).toBe(false);
  });
});

describe("resolver environment (REQ-FUNC-565e908d)", () => {
  it("applies the resolver's variables after the program's own env", async () => {
    plugins = [
      loaded("echo-tools", { echo: program({ env: { UV_CACHE_DIR: "from-manifest", KEEP: "kept" } }) }, [
        { match: "echo *", risk: "safe" },
      ]),
    ];
    resolver = {
      resolve: async () => ({ executable: "uv", prefix: ["run"], env: { UV_CACHE_DIR: "/runtime/cache" } }),
    };
    const result = (await prepare({ program: "echo", args: ["status"] })).apply(signal());
    const process = await spawned(1);
    expect(process.args).toEqual(["run", "status"]);
    expect(process.options.env).toMatchObject({ UV_CACHE_DIR: "/runtime/cache", KEEP: "kept" });
    process.finish({ code: 0, signal: null });
    await result;
  });
});

describe("prompt entries (REQ-FUNC-fa6222a5)", () => {
  it("takes the version the resolver reports before the recorded one", async () => {
    plugins = [loaded("echo-tools", { echo: program(), found: program() }, [], { echo: "1.2.3" })];
    resolver = {
      resolve: async (_plugin, name) => ({
        executable: name,
        ...(name === "found" ? { version: "2.44.0" } : {}),
      }),
    };
    const entries = await programPromptEntries(ctx.programs?.host as ProgramHost, []);
    expect(entries.map((entry) => [entry.name, entry.version])).toEqual([
      ["echo", "1.2.3"],
      ["found", "2.44.0"],
    ]);
  });
  it("lists resolved programs of enabled plugins in id and name order, with versions and skills", async () => {
    plugins = [
      loaded("zeta-tools", { zed: program() }),
      loaded(
        "echo-tools",
        {
          echo: program(),
          beta: program(),
          idf: program({ install: { find: { linux: ["$PATH"] } }, launcher: ["eim"], launcherMode: "argv" }),
        },
        [],
        {
          echo: "1.2.3",
        },
      ),
    ];
    resolver = { resolve: async (_plugin, name) => (name === "beta" ? undefined : { executable: name }) };
    const host = ctx.programs?.host as ProgramHost;
    expect(
      await programPromptEntries(host, [
        { name: "echo-guide", source: "plugin", plugin: "echo-tools", description: "d", enabled: true },
        { name: "off", source: "plugin", plugin: "echo-tools", description: "d", enabled: false },
        { name: "mine", source: "workbench", description: "d", enabled: true },
      ]),
    ).toEqual([
      {
        name: "echo",
        version: "1.2.3",
        plugin: "echo-tools",
        description: "echo-tools tools.",
        skills: ["echo-guide"],
      },
      {
        name: "idf",
        version: null,
        plugin: "echo-tools",
        description: "echo-tools tools.",
        skills: ["echo-guide"],
      },
      { name: "zed", version: null, plugin: "zeta-tools", description: "zeta-tools tools.", skills: [] },
    ]);
  });
});

describe("launcher tools (REQ-FUNC-10e10004, REQ-SEC-10e10005)", () => {
  it("keeps direct-program resolver-prefix serial locks", async () => {
    resolver = { resolve: async () => ({ executable: "/opt/direct", prefix: ["--port", "COM3"] }) };
    const held = await prepare({ program: "echo", args: ["version"], background: true });
    const started = await held.apply(signal());
    const next = await prepare({ program: "echo", args: ["write"], background: true });
    await expect(next.apply(signal())).rejects.toThrow(
      new RegExp(`Port COM3 is held by background run ${started.handle}`),
    );
    expect(host.programs).toHaveLength(1);
  });
  function launcher(mode: "string" | "argv" = "string") {
    plugins = [
      loaded(
        "idf-tools",
        {
          "idf.py": program({
            install: { find: { linux: ["$PATH"] } },
            launcher: ["eim", "run"],
            launcherMode: mode,
          }),
        },
        [{ match: "idf.py * flash *", risk: "device-write" }],
      ),
    ];
    resolver = {
      resolve: async () => ({
        executable: "/opt/eim",
        prefix: ["run"],
        launcher: { command: "idf.py", mode, platform: "linux" },
      }),
    };
  }
  it.each(["argv", "string"] as const)(
    "runs %s launcher with original args and file hashes",
    async (mode) => {
      launcher(mode);
      const args = ["-p", "COM3", "flash", "build/app.bin", "spaced path", ""];
      const prepared = await prepare({ program: "idf.py", args });
      const request = prepared.request as ProgramChangeRequest;
      expect(request.args).toEqual(args);
      expect(request.files).toMatchObject([{ arg: 3, path: "build/app.bin" }]);
      const run = prepared.apply(signal());
      const p = await spawned(1);
      expect(p.args).toEqual(
        mode === "argv"
          ? ["run", "idf.py", ...args]
          : ["run", '"idf.py" "-p" "COM3" "flash" "build/app.bin" "spaced path" ""'],
      );
      expect(request.executableArgs).toEqual(p.args);
      p.finish({ code: 0, signal: null });
      expect(await run).toMatchObject({ risk: "device-write", exitCode: 0 });
    },
  );
  it("refuses changed launcher transport after approval", async () => {
    launcher();
    const prepared = await prepare({ program: "idf.py", args: ["flash", "build/app.bin"] });
    resolver = {
      resolve: async () => ({
        executable: "/opt/eim",
        prefix: ["run"],
        launcher: { command: "idf.py", mode: "argv", platform: "linux" },
      }),
    };
    await expect(prepared.apply(signal())).rejects.toThrow(/changed after approval/);
    expect(host.programs).toHaveLength(0);
  });
  it("rehashes original file arguments immediately before a launcher spawn", async () => {
    launcher();
    const prepared = await prepare({ program: "idf.py", args: ["flash", "build/app.bin"] });
    const start = runner.start.bind(runner);
    vi.spyOn(runner, "start").mockImplementation(async (request) => {
      await writeFile(join(root, "build/app.bin"), "rebuilt");
      return start(request);
    });
    await expect(prepared.apply(signal())).rejects.toThrow(/changed after approval/);
    expect(host.programs).toHaveLength(0);
  });
  it("refuses metacharacters before approval or process spawn", async () => {
    launcher();
    await expect(prepare({ program: "idf.py", args: ["build", "a;injection"] })).rejects.toThrow(
      /launcher|Argument/,
    );
    expect(host.programs).toHaveLength(0);
  });
  it("refuses metacharacters in the fixed program prefix", async () => {
    launcher();
    const plugin = plugins[0];
    if (!plugin) throw Error("Fixture plugin missing");
    const declared = plugin.manifest.programs["idf.py"];
    if (!declared) throw Error("Fixture program missing");
    declared.prefix = ["a;injection"];
    await expect(prepare({ program: "idf.py", args: ["build"] })).rejects.toThrow(/launcher/);
    expect(host.programs).toHaveLength(0);
  });
  it("passes original program arguments to the runner's serial guard", async () => {
    launcher();
    const background = await prepare({ program: "idf.py", args: ["-p", "COM3", "flash"], background: true });
    const started = await background.apply(signal());
    const next = await prepare({ program: "idf.py", args: ["-p", "COM3", "flash"] });
    await expect(next.apply(signal())).rejects.toThrow(
      new RegExp(`Port COM3 is held by background run ${started.handle}`),
    );
    expect(host.programs).toHaveLength(1);
  });
});

describe("ProgramSession", () => {
  it("keeps at most 32 handles, dropping the oldest finished one first", async () => {
    const session = new ProgramSession();
    const run = (id: string, finished: boolean) =>
      ({
        id,
        done: finished ? Promise.resolve({}) : new Promise(() => {}),
        read: () => ({ output: "", truncated: false, running: !finished }),
        stop: async () => ({}),
      }) as never;
    session.add(run("running", false));
    for (let i = 0; i < 31; i++) session.add(run(`done-${i}`, true));
    await new Promise((done) => setTimeout(done, 0));
    session.add(run("last", true));
    expect(session.get("running")).toBeDefined();
    expect(session.get("done-0")).toBeUndefined();
    expect(session.get("done-1")).toBeDefined();
    expect(session.get("last")).toBeDefined();
  });
});

// REQ-SEC-13ab0003: actual scoped packages plus the normal prepare/apply/runner boundary.
it("scoped trust invalidates pending approvals and rechecks after consumption immediately before spawn", async () => {
  const source = join(root, ".vera/plugins/echo-tools");
  await mkdir(join(root, ".vera/plugins"));
  await cp("tests/fixtures/plugins/echo-tools", source, { recursive: true });
  const store = new PluginStore({ root: join(root, "machine/plugins"), workbench: root });
  const review = await store.reviewScoped("echo-tools");
  await store.trustScoped("echo-tools", review.sha256);
  const programs = ctx.programs;
  if (!programs) throw Error("missing programs");
  programs.host.plugins = async () => {
    try {
      return [await store.load("echo-tools")];
    } catch {
      return [];
    }
  };
  const prepared = await prepare({ program: "echo", args: ["write", "build/app.bin"] });
  await writeFile(join(source, "helper.txt"), "pulled");
  await expect(prepared.apply(signal())).rejects.toThrow(/not declared/);
  expect(host.programs).toHaveLength(0);
  const changed = await store.reviewScoped("echo-tools");
  await store.trustScoped("echo-tools", changed.sha256);
  const next = await runProgramTool.prepare?.(
    ctx,
    { program: "echo", args: ["write", "build/app.bin"] },
    signal(),
  );
  if (!next) throw Error("missing prepare");
  // The old request digest still has the previous whole-package hash.
  await expect(next.apply(signal())).rejects.toThrow(/changed after approval/);
  expect(host.programs).toHaveLength(0);
  programs.consume = (request) => {
    consumed.push(request);
    writeFileSync(join(source, "helper.txt"), "changed after consume");
  };
  const final = await prepare({ program: "echo", args: ["version"] });
  await expect(final.apply(signal())).rejects.toThrow(/changed after approval/);
  expect(host.programs).toHaveLength(0);
}, 30000);
