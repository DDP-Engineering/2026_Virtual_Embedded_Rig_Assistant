import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeHost, type FakeProcess } from "./fake-process-host.test-support.js";
import { type LeaseClaim, ResourceLeases } from "./leases.js";
import { ProgramRunner, type RunRequest, serialPorts } from "./runner.js";

let root = "";
let leaseFolder = "";
let host: FakeHost;
let leases: ResourceLeases;
let runner: ProgramRunner;
const runners: ProgramRunner[] = [];
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw Error("timed out waiting");
    await wait(5);
  }
}

const claim = (fields: Partial<LeaseClaim> = {}): LeaseClaim => ({
  kind: "visa",
  alias: "psu",
  resource: "USB0::0x1AB1::0x0E11::DP8C1::INSTR",
  keys: ["usb:1ab1:0e11:dp8c1", "serial-number:dp8c1"],
  actuates: true,
  ...fields,
});
const request = (overrides: Partial<RunRequest> = {}): RunRequest => ({
  sessionId: "s1",
  workbench: root,
  executable: "/opt/uv",
  args: ["run", "scpi.py", "output", "--instrument", "psu"],
  lease: {
    claims: [claim()],
    graceMs: 40,
    cleanup: {
      args: ["run", "scpi.py", "close", "--instrument", "psu"],
      shown: ["close", "--instrument", "psu"],
      timeoutMs: 80,
    },
  },
  ...overrides,
});
function make(options: Partial<ConstructorParameters<typeof ProgramRunner>[0]> = {}) {
  const created = new ProgramRunner({ host, clock: { sleep: async () => {} }, leases, ...options });
  runners.push(created);
  return created;
}
/** What the scpi helper writes to its control folder. */
async function report(process: FakeProcess, phase: string, physical: string) {
  const folder = process.options.env.VERA_RUN_CONTROL as string;
  await writeFile(join(folder, "state.json"), JSON.stringify({ format: 1, phase, physical }));
}
const program = (index = 0) => host.programs[index] as FakeProcess;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "vera-runner-leases-")));
  await mkdir(join(root, ".vera"));
  leaseFolder = join(root, "leases");
  host = new FakeHost();
  leases = new ResourceLeases({ root: leaseFolder, app: "test", pid: 4242, alive: () => true });
  runner = make();
});
afterEach(async () => {
  for (const created of runners.splice(0)) {
    for (const process of host.programs) process.finish({ code: 0, signal: null });
    await created.stopAll();
  }
  await rm(root, { recursive: true, force: true });
});

describe("resource leases in one runner", () => {
  it("refuses a second holder through any alias or session before spawning", async () => {
    const run = await runner.start(request({ background: true }));
    const attempts = [
      request({ sessionId: "s2" }),
      request({
        lease: {
          claims: [claim({ alias: "psu-lan", keys: ["tcpip:10.0.0.5", "serial-number:dp8c1"] })],
          graceMs: 40,
        },
      }),
      request({ lease: { claims: [claim({ actuates: false })], graceMs: 40 } }),
    ];
    for (const attempt of attempts)
      await expect(runner.start(attempt)).rejects.toMatchObject({
        code: "BUSY",
        params: { handle: run.id, resource: expect.stringMatching(/^psu/) },
      });
    expect(host.programs).toHaveLength(1);
    const other = await runner.start(
      request({ lease: { claims: [claim({ alias: "dmm", keys: ["usb:2a8d:1301:my1"] })], graceMs: 40 } }),
    );
    expect(host.programs).toHaveLength(2);
    program(1).finish({ code: 0, signal: null });
    await other.done;
  });

  it("makes serial-port runs and ASRL instruments exclude each other", async () => {
    const serial = await runner.start(
      request({ lease: undefined, args: ["capture", "--port", "COM3"], background: true }),
    );
    const asrl = request({
      lease: { claims: [claim({ alias: "meter", keys: ["serial:COM3"] })], graceMs: 40 },
    });
    await expect(runner.start(asrl)).rejects.toMatchObject({
      code: "BUSY",
      params: { handle: serial.id, resource: "meter" },
    });
    program(0).finish({ code: 0, signal: null });
    await serial.done;
    const instrument = await runner.start({ ...asrl, background: true });
    await expect(
      runner.start(request({ lease: undefined, args: ["capture", "--port=com3"] })),
    ).rejects.toMatchObject({
      code: "BUSY",
      params: { handle: instrument.id, port: "COM3" },
    });
  });

  it("reads serial ports inside sigrok driver specifications", () => {
    expect(serialPorts(["--driver", "scpi-pps:conn=COM7:serialcomm=9600/8n1"])).toEqual(["COM7"]);
    expect(serialPorts(["-d", "korad-kaxxxxp:conn=/dev/ttyACM0"])).toEqual(["/dev/ttyACM0"]);
    expect(serialPorts(["--driver=rigol-ds:conn=tcp-raw/10.0.0.5/5555"])).toEqual([]);
  });

  it("refuses a lease when the runner has no lease registry", async () => {
    const bare = make({ leases: undefined });
    await expect(bare.start(request())).rejects.toMatchObject({
      code: "DENIED",
      params: { reason: "leases" },
    });
    expect(host.programs).toHaveLength(0);
  });
});

describe("resource leases across runners", () => {
  it("refuses a key that another process's runner holds", async () => {
    const cliLeases = new ResourceLeases({ root: leaseFolder, app: "cli", pid: 777, alive: () => true });
    const cli = make({ leases: cliLeases });
    const run = await runner.start(request({ background: true }));
    await expect(cli.start(request({ sessionId: "cli" }))).rejects.toMatchObject({
      code: "BUSY",
      params: { resource: "psu", holder: "process 4242" },
    });
    await report(program(), "released", "confirmed");
    program().finish({ code: 0, signal: null });
    await run.done;
    const next = await cli.start(request({ sessionId: "cli" }));
    await report(program(1), "released", "confirmed");
    program(1).finish({ code: 0, signal: null });
    await next.done;
  });
});

describe("supervised stop and cleanup", () => {
  it("asks the program to stop and does not kill it when it exits within the grace period", async () => {
    const run = await runner.start(request({ background: true }));
    const control = program().options.env.VERA_RUN_CONTROL as string;
    expect(control.startsWith(leaseFolder)).toBe(true);
    const stopping = run.stop();
    await until(() => existsSync(join(control, "stop")));
    expect(host.signals).toEqual([]);
    await report(program(), "released", "confirmed");
    program().finish({ code: 0, signal: null });
    const result = await stopping;
    expect(result).toMatchObject({ stopped: true, physical: "confirmed", cleanup: "none" });
    expect(host.signals).toEqual([]);
    expect(host.programs).toHaveLength(1);
    expect(existsSync(control)).toBe(false);
    expect((await readdir(leaseFolder)).filter((name) => name.endsWith(".lease"))).toEqual([]);
  });

  it("kills a program that stays past the grace period, then runs the declared cleanup once", async () => {
    const run = await runner.start(request({ background: true }));
    const result = run.stop();
    await until(() => host.signals.length > 0);
    expect(host.signals[0]).toEqual([-(program().pid as number), "SIGTERM"]);
    await until(() => host.programs.length === 2);
    const cleanup = program(1);
    expect(cleanup.args).toEqual(["run", "scpi.py", "close", "--instrument", "psu"]);
    expect(cleanup.options.env.VERA_CLEANUP_OF).toBe(run.id);
    await report(cleanup, "released", "confirmed");
    cleanup.print("all outputs off\n");
    cleanup.finish({ code: 0, signal: null });
    expect(await result).toMatchObject({ stopped: true, physical: "confirmed", cleanup: "separate" });
    const log = await readFile(join(root, ".vera", "runs", `${run.id}.log`), "utf8");
    expect(log).toContain("[VERA] Cleanup: close --instrument psu");
    expect(log).toContain("all outputs off");
    expect(log).toContain("[VERA] Physical state: confirmed");
  });

  it("treats a timeout like Stop: stop request, grace, kill and cleanup", async () => {
    const run = await runner.start(request({ timeoutMs: 20 }));
    const control = program().options.env.VERA_RUN_CONTROL as string;
    await until(() => existsSync(join(control, "stop")));
    expect(readFileSync(join(control, "stop"), "utf8")).toBe("timedOut");
    await until(() => host.signals.length > 0);
    await until(() => host.programs.length === 2);
    await report(program(1), "released", "confirmed");
    program(1).finish({ code: 0, signal: null });
    expect(await run.done).toMatchObject({ timedOut: true, physical: "confirmed", cleanup: "separate" });
  });

  it("reports the physical state to a background run's final read", async () => {
    const run = await runner.start(request({ background: true }));
    await report(program(), "released", "confirmed");
    program().finish({ code: 0, signal: null });
    await run.done;
    expect(run.read()).toMatchObject({ running: false, exitCode: 0, physical: "confirmed", cleanup: "none" });
  });

  it("cleans up after a crash and records unknown when the cleanup cannot confirm", async () => {
    const run = await runner.start(request());
    program().finish({ code: 3, signal: null });
    await until(() => host.programs.length === 2);
    // The cleanup hangs: it is killed at its timeout.
    const result = await run.done;
    expect(result).toMatchObject({ exitCode: 3, physical: "unknown", cleanup: "failed" });
    expect(host.signals.some(([pid]) => pid === -(program(1).pid as number))).toBe(true);
    const next = await runner.start(request());
    expect(JSON.parse(program(2).options.env.VERA_RESOURCE_STATE as string)).toEqual({
      psu: expect.objectContaining({ state: "unknown", runId: run.id, reason: "cleanup-failed" }),
    });
    await report(program(2), "released", "confirmed");
    program(2).finish({ code: 0, signal: null });
    expect(await next.done).toMatchObject({ physical: "confirmed" });
    const after = await runner.start(request());
    expect(program(3).options.env.VERA_RESOURCE_STATE).toBeUndefined();
    await report(program(3), "released", "confirmed");
    program(3).finish({ code: 0, signal: null });
    await after.done;
  });

  it("needs no cleanup for a read-only run or a run that never started", async () => {
    const read = await runner.start(
      request({
        lease: {
          claims: [claim({ actuates: false })],
          graceMs: 20,
          cleanup: { args: ["close"], timeoutMs: 50 },
        },
      }),
    );
    program().finish({ code: 3, signal: null });
    expect(await read.done).toMatchObject({ physical: "unchanged", cleanup: "none" });
    expect(host.programs).toHaveLength(1);
    const controller = new AbortController();
    controller.abort();
    const never = await runner.run(request({ signal: controller.signal }));
    expect(never).toMatchObject({ stopped: true, physical: "unchanged", cleanup: "none" });
    expect(host.programs).toHaveLength(1);
  });

  it("reports unknown without a cleanup declaration and a run that reports it", async () => {
    const run = await runner.start(request({ lease: { claims: [claim()], graceMs: 20 } }));
    await report(program(), "released", "unknown");
    program().finish({ code: 3, signal: null });
    expect(await run.done).toMatchObject({ physical: "unknown", cleanup: "failed" });
  });
});

describe("plan holds and their child runs", () => {
  const planClaims = (): LeaseClaim[] => [
    claim(),
    { kind: "serial", alias: "COM5", resource: "COM5", keys: ["serial:COM5"], actuates: true },
  ];
  const hold = (target = runner, fields: Partial<Parameters<ProgramRunner["hold"]>[0]> = {}) =>
    target.hold({
      sessionId: "s1",
      workbench: root,
      claims: planClaims(),
      label: { plugin: "hil-testing", program: "hil", args: ["run", "hil/plan.json"] },
      onStop: () => {},
      ...fields,
    });

  it("lets child runs use the plan's resources and refuses everyone else", async () => {
    const plan = await hold();
    const leaseFiles = (await readdir(leaseFolder)).filter((name) => name.endsWith(".lease"));
    expect(leaseFiles).toHaveLength(3);
    // A child naming the instrument and the port starts: its claim borrows the plan's lease files.
    const child = await runner.start(
      request({ parent: plan.id, args: ["run", "scpi.py", "output", "--instrument", "psu", "COM5"] }),
    );
    expect(host.programs).toHaveLength(1);
    // The same resources outside the plan: another session, a run without the parent, a second plan.
    await expect(runner.start(request({ sessionId: "s2" }))).rejects.toMatchObject({ code: "BUSY" });
    await expect(
      runner.start({
        sessionId: "s1",
        workbench: root,
        executable: "/x",
        args: ["capture", "--port", "COM5"],
      }),
    ).rejects.toMatchObject({ code: "BUSY", params: { port: "COM5" } });
    await expect(hold(runner, { sessionId: "s2" })).rejects.toMatchObject({ code: "BUSY" });
    // Another VERA process (second runner, same lease folder) gets BUSY from the lease files.
    const other = make({
      leases: new ResourceLeases({ root: leaseFolder, app: "cli", pid: 777, alive: () => true }),
    });
    await expect(
      other.hold({ sessionId: "s9", workbench: root, claims: planClaims(), onStop: () => {} }),
    ).rejects.toMatchObject({
      code: "BUSY",
    });
    program().finish({ code: 0, signal: null });
    await report(program(), "released", "confirmed");
    await child.done;
    // The child's end never releases the plan's leases.
    expect((await readdir(leaseFolder)).filter((name) => name.endsWith(".lease"))).toHaveLength(3);
    const result = await plan.finish({ exitCode: 0 });
    expect(result.exitCode).toBe(0);
    expect((await readdir(leaseFolder)).filter((name) => name.endsWith(".lease"))).toHaveLength(0);
    const record = JSON.parse(await readFile(join(root, ".vera", "runs", `${plan.id}.json`), "utf8"));
    expect(record).toMatchObject({ plugin: "hil-testing", program: "hil", end: "exited", exitCode: 0 });
  });

  it("refuses a plan while any run, foreground included, uses one of its ports", async () => {
    const other = await runner.start({
      sessionId: "s2",
      workbench: root,
      executable: "/x",
      args: ["--port", "COM5"],
    });
    await expect(hold()).rejects.toMatchObject({
      code: "BUSY",
      params: { handle: other.id, resource: "COM5" },
    });
    program().finish({ code: 0, signal: null });
    await other.done;
    const plan = await hold();
    await plan.finish({ exitCode: 0 });
  });

  it("keeps stopping the session's other runs when a hold's stop callback throws", async () => {
    const plan = await hold(runner, {
      claims: [],
      onStop: () => {
        throw Error("owner not ready");
      },
    });
    const other = await runner.start({
      sessionId: "s1",
      workbench: root,
      executable: "/x",
      args: [],
      background: true,
    });
    await Promise.race([runner.stopSession("s1"), wait(200)]);
    expect((await other.done).stopped).toBe(true);
    await plan.finish({ exitCode: 3, stopped: true });
  });

  it("refuses a child of an unknown or foreign parent", async () => {
    const plan = await hold();
    await expect(runner.start(request({ parent: "01JUNKNOWNPARENT0000000000" }))).rejects.toMatchObject({
      code: "DENIED",
    });
    await expect(runner.start(request({ parent: plan.id, sessionId: "s2" }))).rejects.toMatchObject({
      code: "DENIED",
    });
    expect(host.programs).toHaveLength(0);
    await plan.finish({ exitCode: 0 });
  });

  it("asks its owner to stop on Stop, session stop and workbench close, and keeps output", async () => {
    let stops = 0;
    const plan: Awaited<ReturnType<typeof hold>> = await hold(runner, {
      background: true,
      onStop: () => {
        stops++;
        void plan.finish({ exitCode: 3, stopped: true, physical: "confirmed" });
      },
    });
    plan.write("[HIL] step flash: pass\n");
    expect(plan.read()).toMatchObject({ output: "[HIL] step flash: pass\n", running: true });
    await runner.stopSession("s1");
    expect(stops).toBe(1);
    const result = await plan.done;
    expect(result).toMatchObject({ exitCode: 3, stopped: true, physical: "confirmed" });
    expect(runner.get(plan.id)).toBeUndefined();
    expect(readFileSync(join(root, ".vera", "runs", `${plan.id}.log`), "utf8")).toContain("step flash");
  });

  it("counts a background hold against the session's background limit", async () => {
    const limited = make({ maxBackground: 1 });
    const plan = await hold(limited, { background: true, claims: [] });
    await expect(
      limited.start({ sessionId: "s1", workbench: root, executable: "/x", args: [], background: true }),
    ).rejects.toMatchObject({ code: "BUSY", params: { limit: 1 } });
    await plan.finish({ exitCode: 0 });
    expect(existsSync(join(root, ".vera", "runs", `${plan.id}.log`))).toBe(true);
  });
});
