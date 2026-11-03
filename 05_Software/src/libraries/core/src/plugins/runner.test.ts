import { mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeHost } from "./fake-process-host.test-support.js";
import { ProgramRunner, type ProgramRunnerOptions, programEnvironment, type RunRequest } from "./runner.js";

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
let root = "";
let host: FakeHost;
let runner: ProgramRunner;
const request = (overrides: Partial<RunRequest> = {}): RunRequest => ({
  sessionId: "s1",
  workbench: root,
  executable: "/opt/tool",
  args: [],
  ...overrides,
});
const runners: ProgramRunner[] = [];
function make(options: ProgramRunnerOptions) {
  const created = new ProgramRunner(options);
  runners.push(created);
  return created;
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "vera-runner-")));
  await mkdir(join(root, ".vera"));
  host = new FakeHost();
  runner = make({ host, clock: { sleep: async () => {} } });
});
afterEach(async () => {
  await Promise.all(runners.splice(0).map((created) => created.stopAll()));
  await rm(root, { recursive: true, force: true });
});

describe("environment", () => {
  it("copies only allowlisted Windows variables case-insensitively, then program env, then the fixed two", async () => {
    host = new FakeHost("win32", {
      OPENAI_API_KEY: "sk-secret",
      VERA_TOKEN: "t",
      Path: "C:\\sys",
      SystemRoot: "C:\\Windows",
      USERPROFILE: "C:\\Users\\me",
      TEMP: "C:\\t",
      TMP: "C:\\t2",
      LANG: "ro_RO.UTF-8",
      LC_ALL: "C",
      ComSpec: "C:\\Windows\\cmd.exe",
    });
    runner = make({ host, clock: { sleep: async () => {} }, toolPaths: ["C:\\a", "C:\\b"] });
    const run = await runner.start(request({ env: { MY_VAR: "1", PYTHONUTF8: "0" } }));
    host.programs[0]?.finish({ code: 0, signal: null });
    await run.done;
    expect(host.programs[0]?.options.env).toEqual({
      PATH: "C:\\a;C:\\b;C:\\sys",
      SystemRoot: "C:\\Windows",
      USERPROFILE: "C:\\Users\\me",
      TEMP: "C:\\t",
      TMP: "C:\\t2",
      LANG: "ro_RO.UTF-8",
      LC_ALL: "C",
      MY_VAR: "1",
      PYTHONUTF8: "1",
      NO_COLOR: "1",
    });
  });

  it("keeps one PATH key on Windows when the program declares Path", async () => {
    host = new FakeHost("win32", { PATH: "C:\\sys" });
    runner = make({ host, clock: { sleep: async () => {} } });
    const run = await runner.start(request({ env: { Path: "C:\\own" } }));
    host.programs[0]?.finish({ code: 0, signal: null });
    await run.done;
    const env = host.programs[0]?.options.env ?? {};
    expect(Object.keys(env).filter((name) => name.toUpperCase() === "PATH")).toEqual(["Path"]);
    expect(env.Path).toBe("C:\\own");
  });

  it("matches names exactly on Linux and joins PATH with colons", async () => {
    host = new FakeHost("linux", {
      PATH: "/usr/bin",
      path: "/nope",
      HOME: "/home/me",
      TMPDIR: "/tmp/x",
      LANGUAGE: "de",
      LC_CTYPE: "C.UTF-8",
      AWS_SECRET_ACCESS_KEY: "x",
      ANTHROPIC_API_KEY: "y",
    });
    runner = make({ host, clock: { sleep: async () => {} }, toolPaths: ["/opt/t"] });
    const run = await runner.start(request());
    host.programs[0]?.finish({ code: 0, signal: null });
    await run.done;
    expect(host.programs[0]?.options.env).toEqual({
      PATH: "/opt/t:/usr/bin",
      HOME: "/home/me",
      TMPDIR: "/tmp/x",
      LANGUAGE: "de",
      LC_CTYPE: "C.UTF-8",
      PYTHONUTF8: "1",
      NO_COLOR: "1",
    });
  });
});

describe("working directory", () => {
  it("resolves a workbench-relative cwd and defaults to the root", async () => {
    await mkdir(join(root, "sub"));
    await runner.start(request({ cwd: "sub" }));
    await runner.start(request());
    expect(host.programs.map((process) => process.options.cwd)).toEqual([join(root, "sub"), root]);
  });

  it.each([
    ["..", undefined],
    ["outside", undefined],
    ["secret", "secret/\n"],
    ["file.txt", undefined],
  ])("refuses cwd %s with DENIED and spawns nothing", async (cwd, ignore) => {
    await writeFile(join(root, "file.txt"), "x");
    await mkdir(join(root, "secret"));
    if (ignore) await writeFile(join(root, ".vera", ".veraignore"), ignore);
    const outside = await mkdtemp(join(tmpdir(), "vera-outside-"));
    const value = cwd === "outside" ? outside : cwd;
    await expect(runner.start(request({ cwd: value }))).rejects.toMatchObject({ code: "DENIED" });
    expect(host.processes).toEqual([]);
    await rm(outside, { recursive: true, force: true });
  });
});

describe("process tree", () => {
  it("starts Linux programs as group leaders and Windows programs without a group", async () => {
    await runner.start(request());
    host = new FakeHost("win32", { SystemRoot: "C:\\Windows" });
    runner = make({ host, clock: { sleep: async () => {} } });
    await runner.start(request());
    expect(host.programs[0]?.options.group).toBe(false);
  });

  it("kills the tree when the timeout elapses and not before", async () => {
    const run = await runner.start(request({ timeoutMs: 400 }));
    expect(host.programs[0]?.options.group).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(host.signals).toEqual([]);
    const result = await run.done;
    expect(result.timedOut).toBe(true);
    expect(result.stopped).toBe(false);
    expect(host.signals[0]).toEqual([-100, "SIGTERM"]);
  });

  it("kills the tree on Stop", async () => {
    const run = await runner.start(request({ background: true }));
    const result = await run.stop();
    expect(result).toMatchObject({ stopped: true, timedOut: false, exitCode: null, signal: "SIGTERM" });
    await vi.waitFor(() => expect(host.signals).toHaveLength(2));
    expect(host.signals).toEqual([
      [-100, "SIGTERM"],
      [-100, "SIGKILL"],
    ]);
  });

  it("kills the tree when the caller's signal aborts", async () => {
    const controller = new AbortController();
    const running = runner.run(request({ signal: controller.signal }));
    await tick();
    controller.abort();
    expect(await running).toMatchObject({ stopped: true });
  });

  it("uses taskkill on Windows", async () => {
    host = new FakeHost("win32", { SystemRoot: "C:\\Windows" });
    runner = make({ host, clock: { sleep: async () => {} } });
    const run = await runner.start(request({ background: true }));
    const result = await run.stop();
    expect(result.stopped).toBe(true);
    const kill = host.processes.find((process) => process.executable.endsWith("taskkill.exe"));
    expect(kill?.executable).toBe("C:\\Windows\\System32\\taskkill.exe");
    expect(kill?.args).toEqual(["/T", "/F", "/PID", "100"]);
  });
});

describe("output, log and retention", () => {
  it("returns a 12 000-character tail while the ULID log keeps everything", async () => {
    const run = await runner.start(request());
    const full = `${"x".repeat(25_000)}${"\x1b[31my\x1b[0m".repeat(1)}${"z".repeat(24_998)}END`;
    host.programs[0]?.print(full.slice(0, 30_000));
    host.programs[0]?.print(full.slice(30_000), "stderr");
    host.programs[0]?.finish({ code: 3, signal: null });
    const result = await run.done;
    const clean = `${"x".repeat(25_000)}y${"z".repeat(24_998)}END`;
    expect(result.runId).toMatch(ULID);
    expect(result).toMatchObject({ exitCode: 3, truncated: true, log: `.vera/runs/${result.runId}.log` });
    expect(result.output).toBe(clean.slice(-12_000));
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(await readFile(join(root, result.log), "utf8")).toBe(clean);
  });

  it("returns the whole output untruncated when it is short", async () => {
    const run = await runner.start(request());
    host.programs[0]?.print("a".repeat(100));
    host.programs[0]?.finish({ code: 0, signal: null });
    expect(await run.done).toMatchObject({ output: "a".repeat(100), truncated: false, exitCode: 0 });
  });

  it("keeps the newest 200 ULID logs, the active run's log and other files", async () => {
    const ids = ["00000000000000000000000000", "7ZZZZZZZZZZZZZZZZZZZZZZZZZ"];
    runner = make({ host, clock: { sleep: async () => {} }, id: () => ids.shift() ?? "" });
    const active = await runner.start(request({ background: true }));
    const runs = join(root, ".vera", "runs");
    const seeded = Array.from({ length: 205 }, (_, index) => `01J${String(index).padStart(23, "0")}.log`);
    for (const name of seeded) await writeFile(join(runs, name), "old");
    await writeFile(join(runs, "keep.txt"), "x");
    const latest = await runner.start(request());
    const names = (await readdir(runs)).sort();
    expect(names).toContain(`${active.id}.log`);
    expect(names).toContain(`${latest.id}.log`);
    expect(names).toContain("keep.txt");
    expect(names.filter((name) => name.endsWith(".log"))).toHaveLength(201);
    expect(names).not.toContain(seeded[5]);
    expect(names).toContain(seeded[6]);
  });

  it("keeps starting runs when an old log cannot be deleted", async () => {
    const runs = join(root, ".vera", "runs");
    await mkdir(join(runs, "00000000000000000000000000.log"), { recursive: true });
    runner = make({ host, clock: { sleep: async () => {} }, logsKept: 1 });
    const run = await runner.start(request());
    host.programs[0]?.finish({ code: 0, signal: null });
    expect(await run.done).toMatchObject({ exitCode: 0 });
  });

  it("refuses a run log folder that is a link", async () => {
    const elsewhere = await mkdtemp(join(tmpdir(), "vera-runs-target-"));
    await symlink(elsewhere, join(root, ".vera", "runs"), "junction");
    await expect(runner.start(request())).rejects.toMatchObject({ code: "DENIED" });
    expect(host.processes).toEqual([]);
    expect(await readdir(elsewhere)).toEqual([]);
    await rm(elsewhere, { recursive: true, force: true });
  });

  it("reports a program that cannot start in the result and the log", async () => {
    host.failNext = "ENOENT";
    const run = await runner.start(request());
    const result = await run.done;
    expect(result).toMatchObject({ exitCode: null, error: "ENOENT", stopped: false });
    expect(await readFile(join(root, result.log), "utf8")).toContain("ENOENT");
    expect(runner.get(run.id)).toBeUndefined();
  });
});

describe("background runs", () => {
  it("returns at once and reads output incrementally", async () => {
    const run = await runner.start(request({ background: true }));
    expect(runner.get(run.id)).toBe(run);
    host.programs[0]?.print("one\n");
    expect(run.read()).toEqual({ output: "one\n", truncated: false, running: true });
    host.programs[0]?.print("two\n");
    expect(run.read()).toEqual({ output: "two\n", truncated: false, running: true });
    host.programs[0]?.finish({ code: 0, signal: null });
    await run.done;
    expect(run.read()).toEqual({ output: "", truncated: false, running: false, exitCode: 0 });
  });

  it("refuses a fifth background run in a session with BUSY", async () => {
    const first = await runner.start(request({ background: true }));
    for (let index = 0; index < 3; index++) await runner.start(request({ background: true }));
    await expect(runner.start(request({ background: true }))).rejects.toMatchObject({
      code: "BUSY",
      params: { limit: 4 },
    });
    expect(host.programs).toHaveLength(4);
    await runner.start(request({ sessionId: "s2", background: true }));
    await runner.start(request());
    host.programs[0]?.finish({ code: 0, signal: null });
    await first.done;
    await runner.start(request({ background: true }));
    expect(host.programs).toHaveLength(7);
  });

  it("stops the runs of a session, of a workbench, or all of them", async () => {
    const other = await realpath(await mkdtemp(join(tmpdir(), "vera-runner-b-")));
    const a1 = await runner.start(request({ sessionId: "a", background: true }));
    const a2 = await runner.start(request({ sessionId: "a" }));
    const b1 = await runner.start(request({ sessionId: "b", background: true }));
    const c1 = await runner.start(request({ sessionId: "c", workbench: other, background: true }));
    const d1 = await runner.start(request({ sessionId: "d", workbench: other }));
    await runner.stopSession("a");
    expect((await a1.done).stopped && (await a2.done).stopped).toBe(true);
    expect(b1.read().running && c1.read().running).toBe(true);
    await runner.stopWorkbench(other);
    expect((await c1.done).stopped && (await d1.done).stopped).toBe(true);
    expect(b1.read().running).toBe(true);
    await runner.stopAll();
    expect((await b1.done).stopped).toBe(true);
    await rm(other, { recursive: true, force: true });
  });
});

describe("serial-port guard", () => {
  it.each([
    [["--port", "COM3"], ["--port=com3"], "COM3", ["--port", "COM4"]],
    [["-p", "\\\\.\\COM12"], ["COM12"], "COM12", ["COM1"]],
    [["/dev/ttyUSB0"], ["--port=/dev/ttyUSB0"], "/dev/ttyUSB0", ["/dev/ttyUSB1"]],
    [["/dev/serial/by-id/usb-x"], ["/dev/serial/by-id/usb-x"], "/dev/serial/by-id/usb-x", ["/dev/ttyACM0"]],
  ])("refuses %j while a background run holds it", async (held, second, port, free) => {
    const monitor = await runner.start(request({ sessionId: "m", background: true, args: held }));
    await expect(runner.start(request({ args: second }))).rejects.toMatchObject({
      code: "BUSY",
      params: { handle: monitor.id, port },
    });
    expect(host.programs).toHaveLength(1);
    await runner.start(request({ args: free }));
    await monitor.stop();
    await runner.start(request({ args: second }));
    expect(host.programs).toHaveLength(3);
  });

  it("does not hold a port for a foreground run", async () => {
    await runner.start(request({ args: ["COM3"] }));
    await runner.start(request({ args: ["COM3"], background: true }));
    expect(host.programs).toHaveLength(2);
  });
});

describe("settlement", () => {
  it("spawns nothing when the caller's signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runner.run(request({ signal: controller.signal }));
    expect(result).toMatchObject({ stopped: true, exitCode: null, durationMs: 0 });
    expect(host.processes).toEqual([]);
    expect(await readFile(join(root, result.log), "utf8")).toBe("");
  });

  it("spawns nothing when Stop arrives while the run is being prepared", async () => {
    const starting = runner.start(request({ sessionId: "early" }));
    const stopping = runner.stopSession("early");
    const run = await starting;
    await stopping;
    expect(await run.done).toMatchObject({ stopped: true, exitCode: null });
    expect(host.processes).toEqual([]);
    expect(runner.get(run.id)).toBeUndefined();
  });

  it("forgets a refused run so later stops and limits ignore it", async () => {
    await expect(runner.start(request({ cwd: "..", background: true }))).rejects.toMatchObject({
      code: "DENIED",
    });
    await runner.stopAll();
    for (let index = 0; index < 4; index++) await runner.start(request({ background: true }));
    expect(host.programs).toHaveLength(4);
  });
});

describe("beforeSpawn (REQ-SEC-370f2d9b)", () => {
  it("runs after the log opens and right before spawn; a failure starts nothing", async () => {
    const logs: string[][] = [];
    await expect(
      runner.start(
        request({
          beforeSpawn: async () => {
            logs.push(await readdir(join(root, ".vera/runs")));
            throw { code: "CONFLICT", messageKey: "errors.CONFLICT" };
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(logs[0]?.[0]).toMatch(/\.log$/);
    expect(host.programs).toHaveLength(0);
    const run = await runner.start(request({ beforeSpawn: async () => {} }));
    expect(host.programs).toHaveLength(1);
    host.programs[0]?.finish({ code: 0, signal: null });
    expect((await run.done).exitCode).toBe(0);
  });
});

describe("per-drive directories (REQ-SEC-0e45a496)", () => {
  it("never pass =X: variables, so drive-relative paths resolve from the run's cwd or the drive root", () => {
    const host = new FakeHost("win32", { "=C:": "C:/Users/me", "=F:": "F:/x", Path: "C:/bin" });
    const env = programEnvironment(host, []);
    expect(Object.keys(env).filter((name) => name.startsWith("="))).toEqual([]);
  });
});

describe("run records, list, log and stop (spec REQ-DATA-f563074f)", () => {
  const label = { plugin: "echo-tools", program: "echo", args: ["serve", "--port", "COM3"] };
  const now = () => new Date("2026-11-03T10:00:00.000Z");
  const record = async (id: string) =>
    JSON.parse(await readFile(join(root, ".vera", "runs", `${id}.json`), "utf8")) as Record<string, unknown>;

  // REQ-DATA-f563074f
  it("records the plugin, program, agent arguments and start, then the end of each run", async () => {
    runner = make({ host, clock: { sleep: async () => {} }, now });
    const run = await runner.start(request({ label, background: true, executable: "/opt/node" }));
    expect(await record(run.id)).toEqual({
      format: 1,
      id: run.id,
      sessionId: "s1",
      plugin: "echo-tools",
      program: "echo",
      args: ["serve", "--port", "COM3"],
      background: true,
      startedAt: "2026-11-03T10:00:00.000Z",
    });
    host.programs[0]?.finish({ code: 3, signal: null });
    await run.done;
    expect(await record(run.id)).toMatchObject({
      end: "exited",
      exitCode: 3,
      durationMs: expect.any(Number),
    });

    const stopped = await runner.start(request({ label, background: true }));
    await stopped.stop();
    expect(await record(stopped.id)).toMatchObject({ end: "stopped", exitCode: null });

    host.failNext = "ENOENT";
    const failed = await runner.start(request({ label }));
    await failed.done;
    expect(await record(failed.id)).toMatchObject({ end: "exited", exitCode: null, error: "ENOENT" });

    const timed = await runner.start(request({ label, timeoutMs: 10 }));
    await timed.done;
    expect(await record(timed.id)).toMatchObject({ end: "timedOut" });
  });

  // REQ-DATA-f563074f
  it("prunes a run's record together with its log", async () => {
    runner = make({ host, clock: { sleep: async () => {} }, logsKept: 2 });
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const run = await runner.start(request({ label }));
      host.programs.at(-1)?.finish({ code: 0, signal: null });
      await run.done;
      ids.push(run.id);
    }
    await runner.start(request({ label }));
    const names = await readdir(join(root, ".vera", "runs"));
    expect(names.filter((name) => name.startsWith(ids[0] as string))).toEqual([]);
    expect(names).toContain(`${ids[2]}.json`);
  });

  // REQ-FUNC-39617f81
  it("lists one workbench's runs newest first, running, ended or interrupted, at most 50", async () => {
    const other = await realpath(await mkdtemp(join(tmpdir(), "vera-runner-other-")));
    await mkdir(join(other, ".vera"));
    runner = make({ host, clock: { sleep: async () => {} }, now });
    const ended = await runner.start(request({ label }));
    host.programs[0]?.finish({ code: 0, signal: null });
    await ended.done;
    const running = await runner.start(request({ label, background: true }));
    await runner.start(request({ label, background: true, workbench: other, sessionId: "s2" }));
    const runs = join(root, ".vera", "runs");
    const interrupted = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
    await writeFile(
      join(runs, `${interrupted}.json`),
      JSON.stringify({
        format: 1,
        id: interrupted,
        sessionId: "s0",
        args: [],
        background: true,
        startedAt: "2026-11-01T00:00:00.000Z",
      }),
    );
    await writeFile(join(runs, "01ARZ3NDEKTSV4RRFFQ69G5FAW.json"), "{not json");
    const listed = await runner.list(root);
    expect(listed.map((run) => [run.id, run.state])).toEqual([
      [running.id, "running"],
      [ended.id, "exited"],
      [interrupted, "interrupted"],
    ]);
    expect(listed[0]).toMatchObject({
      program: "echo",
      args: label.args,
      log: `.vera/runs/${running.id}.log`,
    });
    expect((await runner.list(other)).map((run) => run.sessionId)).toEqual(["s2"]);

    for (let i = 0; i < 55; i++) {
      const id = `01ARZ3NDEKTSV4RRFFQ69G${String(i).padStart(4, "0")}`;
      await writeFile(
        join(runs, `${id}.json`),
        JSON.stringify({
          format: 1,
          id,
          sessionId: "s0",
          args: [],
          background: false,
          startedAt: "2026-11-01T00:00:00.000Z",
          end: "exited",
          exitCode: 0,
          durationMs: 1,
        }),
      );
    }
    expect(await runner.list(root)).toHaveLength(50);
    expect(await runner.list(join(root, "missing"))).toEqual([]);
    await runner.stopAll();
    await rm(other, { recursive: true, force: true });
  });

  // REQ-FUNC-f024d73c
  it("reads the tail of a run log with whether it was truncated and is running", async () => {
    runner = make({ host, clock: { sleep: async () => {} } });
    const run = await runner.start(request({ label, background: true }));
    host.programs[0]?.print("boot\nREADY\n");
    await vi.waitFor(async () =>
      expect(await runner.log(root, run.id)).toEqual({
        id: run.id,
        text: "boot\nREADY\n",
        truncated: false,
        running: true,
      }),
    );
    host.programs[0]?.print("x".repeat(30));
    await run.stop();
    const tail = await runner.log(root, run.id, 16);
    expect(tail).toMatchObject({ truncated: true, running: false });
    expect(tail.text).toHaveLength(16);
    await expect(runner.log(root, "01ARZ3NDEKTSV4RRFFQ69G5FAV")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(runner.log(root, "../secret")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // REQ-FUNC-8c38d223
  it("stops a running run of the workbench and refuses a run that is not running there", async () => {
    const other = await realpath(await mkdtemp(join(tmpdir(), "vera-runner-other-")));
    runner = make({ host, clock: { sleep: async () => {} } });
    const run = await runner.start(request({ label, background: true }));
    await expect(runner.stopRun(other, run.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await runner.stopRun(root, run.id);
    expect(host.signals[0]).toEqual([-100, "SIGTERM"]);
    expect(await record(run.id)).toMatchObject({ end: "stopped" });
    expect((await runner.list(root))[0]?.state).toBe("stopped");
    await expect(runner.stopRun(root, run.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await rm(other, { recursive: true, force: true });
  });
});

describe("review round 1 (spec REQ-DATA-f563074f)", () => {
  // REQ-FUNC-8c38d223: a stop that lands while the record is written before spawn still prevents the spawn.
  it("never spawns a run stopped during its pre-spawn record write", async () => {
    runner = make({ host, clock: { sleep: async () => {} } });
    for (let attempt = 0; attempt < 20; attempt++) {
      const run = await runner.start(
        request({
          background: true,
          beforeSpawn: async () => {
            setImmediate(() => void runner.stopSession("s1"));
          },
        }),
      );
      expect(await run.done).toMatchObject({ stopped: true });
    }
    expect(host.programs).toEqual([]);
  });

  // REQ-FUNC-f024d73c: a truncated tail starts at a line boundary, never inside a line.
  it("starts a truncated log tail after its first line break", async () => {
    runner = make({ host, clock: { sleep: async () => {} } });
    const run = await runner.start(request({ background: true }));
    host.programs[0]?.print("aaaa\nbbbb\ncccc\n");
    await run.stop();
    expect(await runner.log(root, run.id, 7)).toMatchObject({ text: "cccc\n", truncated: true });
    expect(await runner.log(root, run.id)).toMatchObject({ text: "aaaa\nbbbb\ncccc\n", truncated: false });
  });
});
