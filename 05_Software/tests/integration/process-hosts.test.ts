import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ProcessHost, ProgramRunner, ProgramRunnerOptions, RunRequest } from "@vera/core";
import { buildSync } from "esbuild";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Real processes through each app's compiled ProcessHost and the core runner, on the echo-program fixture.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const echo = join(root, "tests/fixtures/echo-program/echo.mjs");
const temporary: string[] = [];
type Runner = new (options: ProgramRunnerOptions) => ProgramRunner;

async function compileHost(host: "cli" | "desktop") {
  const out = await mkdtemp(join(root, "node_modules/.cache/vera-process-host-"));
  temporary.push(out);
  buildSync({
    entryPoints: {
      "process-host": join(
        root,
        host === "cli" ? "src/apps/cli/src" : "src/apps/desktop/src/main",
        "process-host.ts",
      ),
      runner: join(root, "src/libraries/core/src/plugins/runner.ts"),
    },
    outdir: out,
    platform: "node",
    format: "esm",
    bundle: true,
    alias: {
      "@vera/core": join(root, "src/libraries/core/src/plugins/node-process-host.ts"),
      "@vera/shared": join(root, "src/libraries/shared/src/index.ts"),
    },
    target: "node24",
  });
  const adapter = (await import(pathToFileURL(join(out, "process-host.js")).href)) as Record<
    string,
    (() => ProcessHost) | undefined
  >;
  const factory = adapter[host === "cli" ? "createCliProcessHost" : "createDesktopProcessHost"];
  if (!factory) throw Error("Host factory must exist.");
  const { ProgramRunner } = (await import(pathToFileURL(join(out, "runner.js")).href)) as {
    ProgramRunner: Runner;
  };
  return { factory, ProgramRunner };
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

beforeAll(async () => {
  await mkdir(join(root, "node_modules/.cache"), { recursive: true });
});
afterAll(async () => {
  await Promise.all(temporary.map((path) => rm(path, { recursive: true, force: true })));
});

describe.each(["cli", "desktop"] as const)("%s process host", (name) => {
  let runner: ProgramRunner;
  let workbench = "";
  const request = (env: Record<string, string>, args: string[] = [], extra: Partial<RunRequest> = {}) => ({
    sessionId: "s",
    workbench,
    executable: process.execPath,
    args: [echo, ...args],
    env,
    timeoutMs: 20_000,
    ...extra,
  });

  beforeAll(async () => {
    const { factory, ProgramRunner } = await compileHost(name);
    workbench = await realpath(await mkdtemp(join(tmpdir(), `vera-run-${name}-`)));
    temporary.push(workbench);
    await mkdir(join(workbench, "sub"));
    runner = new ProgramRunner({
      host: factory(),
      clock: { sleep: (ms) => new Promise((done) => setTimeout(done, ms)) },
    });
  });
  afterAll(async () => {
    await runner.stopAll();
  });

  it("passes spaces, quotes, Unicode, empty strings and shell fragments unchanged", async () => {
    const args = [
      "a b",
      'q"uote',
      'two "quoted" words',
      "żółw 漢字",
      "",
      "&echo x",
      "%PATH%",
      "$HOME",
      "C:\\dir\\",
      "a|b>c",
    ];
    const result = await runner.run(request({ ECHO_MODE: "argv" }, args, { cwd: "sub" }));
    expect(result).toMatchObject({ exitCode: 0, timedOut: false });
    expect(JSON.parse(result.output)).toEqual({ args, cwd: join(workbench, "sub") });
    const root = await runner.run(request({ ECHO_MODE: "argv" }));
    expect(JSON.parse(root.output)).toEqual({ args: [], cwd: workbench });
  });

  it("closes stdin so a reading program ends instead of waiting", async () => {
    const result = await runner.run(request({ ECHO_MODE: "stdin" }, [], { timeoutMs: 10_000 }));
    expect(result).toMatchObject({ exitCode: 0, timedOut: false });
    expect(JSON.parse(result.output)).toEqual({ bytes: 0 });
  });

  it("gives the program the minimal environment without VERA's credentials", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test-not-forwarded");
    try {
      const result = await runner.run(request({ ECHO_MODE: "env", OWN: "yes" }));
      const env = JSON.parse(result.output) as Record<string, string>;
      expect(env.OPENAI_API_KEY).toBeUndefined();
      expect(env).toMatchObject({ OWN: "yes", PYTHONUTF8: "1", NO_COLOR: "1" });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("caps the result while the log keeps the full output", async () => {
    const result = await runner.run(request({ ECHO_MODE: "flood", ECHO_COUNT: "50000" }));
    expect(result.output).toHaveLength(12_000);
    expect(result.output.endsWith("END")).toBe(true);
    expect(result.truncated).toBe(true);
    expect(await readFile(join(workbench, result.log), "utf8")).toHaveLength(50_000);
  });

  it("removes ANSI escapes from both streams", async () => {
    const result = await runner.run(request({ ECHO_MODE: "ansi" }));
    expect(result.output).toContain("red plain\n");
    expect(result.output).toContain("warn\n");
    expect(result.output).not.toContain("\x1b");
  });

  it("reports an executable that cannot start", async () => {
    const result = await runner.run({ ...request({}), executable: join(workbench, "missing-program.exe") });
    expect(result).toMatchObject({ exitCode: null, error: "ENOENT" });
    expect(await readFile(join(workbench, result.log), "utf8")).toContain("ENOENT");
    expect(runner.get(result.runId)).toBeUndefined();
  });

  it("finishes when the program exits while a descendant keeps its output open", async () => {
    const pidfile = join(workbench, "orphan.pid");
    const result = await runner.run(request({ ECHO_MODE: "orphan", ECHO_PIDFILE: pidfile }));
    const grandchild = Number(await readFile(pidfile, "utf8"));
    try {
      expect(result).toMatchObject({ exitCode: 0, timedOut: false, stopped: false });
      expect(result.durationMs).toBeLessThan(15_000);
    } finally {
      if (alive(grandchild)) process.kill(grandchild);
    }
  }, 30_000);

  it("kills a grandchild process when the timeout elapses", async () => {
    const pidfile = join(workbench, "timeout.pid");
    const result = await runner.run(
      request({ ECHO_MODE: "grandchild", ECHO_PIDFILE: pidfile }, [], { timeoutMs: 3_000 }),
    );
    expect(result.timedOut).toBe(true);
    const grandchild = Number(await readFile(pidfile, "utf8"));
    await vi.waitFor(() => expect(alive(grandchild)).toBe(false), { timeout: 5_000 });
  }, 30_000);

  it("kills a grandchild process on Stop", async () => {
    const pidfile = join(workbench, "stop.pid");
    const run = await runner.start(
      request({ ECHO_MODE: "grandchild", ECHO_PIDFILE: pidfile }, [], { background: true }),
    );
    const grandchild = await vi.waitFor(
      () => {
        const pid = existsSync(pidfile) ? Number(readFileSync(pidfile, "utf8")) : 0;
        expect(pid).toBeGreaterThan(0);
        return pid;
      },
      { timeout: 10_000 },
    );
    expect(alive(grandchild)).toBe(true);
    const result = await run.stop();
    expect(result.stopped).toBe(true);
    await vi.waitFor(() => expect(alive(grandchild)).toBe(false), { timeout: 5_000 });
  }, 30_000);
});
