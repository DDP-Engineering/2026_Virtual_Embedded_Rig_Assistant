import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type PermissionMode, pluginManifestSchema, veraError } from "@vera/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestSha256 } from "../agent/approvals.js";
import type { ToolContext } from "../tools/context.js";
import { FakeHost, type FakeProcess } from "./fake-process-host.test-support.js";
import { ResourceLeases } from "./leases.js";
import { type ProgramChangeRequest, programApproval, verifyProgramFiles } from "./program-request.js";
import { type ProgramHost, ProgramSession, programStopTool, runProgramTool } from "./program-tools.js";
import { ProgramRunner } from "./runner.js";
import type { LoadedPlugin } from "./store.js";

const rules = [
  { match: "scpi identify *", risk: "device-read" },
  { match: "scpi close *", risk: "device-write" },
  { match: "scpi output *", risk: "irreversible" },
  { match: "scpi capabilities *", risk: "safe" },
];
const scpi: LoadedPlugin = {
  folder: "/plugins/lab",
  manifest: pluginManifestSchema.parse({
    format: 1,
    id: "lab",
    version: "1.0.0",
    name: "lab",
    description: "Lab tools.",
    ecosystem: "lab",
    platforms: ["windows-x64", "linux-x64"],
    programs: {
      scpi: {
        install: { script: "scripts/scpi.py" },
        version: { args: ["--version"], match: "(\\d+)" },
        resources: {
          option: "--instrument",
          kinds: ["visa"],
          grace: 1,
          cleanup: ["close"],
          cleanupTimeout: 1,
        },
      },
    },
    rules,
  }),
  record: {
    format: 1,
    id: "lab",
    version: "1.0.0",
    tier: "local",
    source: { kind: "folder", path: "/src/lab" },
    sha256: "c".repeat(64),
    installedAt: "2026-11-02T00:00:00.000Z",
    programs: { scpi: "1.0.0" },
  },
};
const registry = {
  format: 1,
  resources: [
    {
      alias: "psu",
      kind: "visa",
      resource: "USB0::0x1AB1::0x0E11::DP8C1::INSTR",
      serial: "DP8C1",
      profile: "rigol-dp800",
    },
    { alias: "scope", kind: "visa", resource: "TCPIP0::10.0.0.5::INSTR", profile: "rigol-ds1000z" },
  ],
};

let root = "";
let host: FakeHost;
let runner: ProgramRunner;
let mode: PermissionMode;
let approved: ProgramChangeRequest | undefined;
let ctx: ToolContext;
const signal = () => new AbortController().signal;
const writeRegistry = (value: unknown) =>
  writeFile(join(root, "lab", "resources.json"), typeof value === "string" ? value : JSON.stringify(value));

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "vera-program-resources-")));
  await mkdir(join(root, ".vera"));
  await mkdir(join(root, "lab"));
  await writeRegistry(registry);
  host = new FakeHost();
  runner = new ProgramRunner({
    host,
    clock: { sleep: async () => {} },
    leases: new ResourceLeases({ root: join(root, "leases"), app: "test", pid: 4242, alive: () => true }),
  });
  mode = "ask";
  approved = undefined;
  const programHost: ProgramHost = {
    runner,
    clock: { sleep: async () => {} },
    plugins: async () => [scpi],
    resolver: {
      resolve: async () => ({
        executable: "/opt/uv",
        prefix: ["run", "--script", "/plugins/lab/scripts/scpi.py"],
      }),
    },
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
      consume: (request) => {
        if (approved && requestSha256(request) !== requestSha256(approved)) throw veraError("CONFLICT");
      },
    },
  };
});
afterEach(async () => {
  for (const process of host.programs) process.finish({ code: 0, signal: null });
  await runner.stopAll();
  await rm(root, { recursive: true, force: true });
});

async function prepare(args: Record<string, unknown>) {
  const prepared = await runProgramTool.prepare?.(ctx, args, signal());
  if (!prepared) throw Error("run_program must prepare.");
  approved = prepared.request as ProgramChangeRequest;
  return prepared;
}
async function spawned(count: number): Promise<FakeProcess> {
  await vi.waitFor(() => expect(host.programs.length).toBe(count));
  return host.programs[count - 1] as FakeProcess;
}

describe("declared resources in run_program", () => {
  it("binds the alias, its keys and the registry hash into the request and the approval", async () => {
    const prepared = await prepare({ program: "scpi", args: ["identify", "--instrument", "psu"] });
    const request = prepared.request as ProgramChangeRequest;
    const bytes = await readFile(join(root, "lab", "resources.json"));
    const { createHash } = await import("node:crypto");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    expect(request.resources).toEqual([
      {
        alias: "psu",
        kind: "visa",
        resource: "USB0::0x1AB1::0x0E11::DP8C1::INSTR",
        keys: ["usb:1ab1:0e11:dp8c1", "serial-number:dp8c1"],
      },
    ]);
    expect(request.registry).toEqual({ path: "lab/resources.json", sha256 });
    expect(programApproval(request)).toMatchObject({
      resources: [{ alias: "psu", kind: "visa", resource: "USB0::0x1AB1::0x0E11::DP8C1::INSTR" }],
      registry: { path: "lab/resources.json", sha256 },
    });
    const result = prepared.apply(signal());
    const process = await spawned(1);
    expect(process.options.env.VERA_RUN_CONTROL).toContain("leases");
    // REQ-SEC-80fa1675: the helper checks the registry against the approved hash.
    expect(process.options.env.VERA_REGISTRY_SHA256).toBe(sha256);
    process.finish({ code: 0, signal: null });
    expect(await result).toMatchObject({ exitCode: 0, risk: "device-read", physical: "unchanged" });
  });

  it("accepts --instrument=alias and claims nothing without the option", async () => {
    const equals = await prepare({ program: "scpi", args: ["identify", "--instrument=scope"] });
    expect((equals.request as ProgramChangeRequest).resources?.map((resource) => resource.alias)).toEqual([
      "scope",
    ]);
    const none = await prepare({ program: "scpi", args: ["capabilities", "--profile", "rigol-dp800"] });
    expect((none.request as ProgramChangeRequest).resources).toBeUndefined();
    expect(programApproval(none.request as ProgramChangeRequest)).not.toHaveProperty("resources");
    const result = none.apply(signal());
    const process = await spawned(1);
    expect(process.options.env.VERA_RUN_CONTROL).toBeUndefined();
    process.finish({ code: 0, signal: null });
    await result;
  });

  it("refuses bad registries and aliases before any approval", async () => {
    const cases: [unknown, string[], RegExp][] = [
      [registry, ["identify", "--instrument", "dmm"], /alias dmm is not declared in lab\/resources\.json/],
      [registry, ["identify", "--instrument", "psu", "--instrument", "scope"], /once/],
      [registry, ["identify", "--instrument"], /needs an alias/],
      ["{not json", ["identify", "--instrument", "psu"], /lab\/resources\.json is not valid/],
      [
        { format: 1, resources: [registry.resources[0], registry.resources[0]] },
        ["identify", "--instrument", "psu"],
        /lab\/resources\.json is not valid/,
      ],
      ["x".repeat(256 * 1024 + 1), ["identify", "--instrument", "psu"], /larger than 256 KiB/],
    ];
    for (const [value, args, message] of cases) {
      await writeRegistry(value);
      await expect(runProgramTool.prepare?.(ctx, { program: "scpi", args }, signal())).rejects.toThrow(
        message,
      );
    }
    await rm(join(root, "lab", "resources.json"));
    await expect(
      runProgramTool.prepare?.(ctx, { program: "scpi", args: ["identify", "--instrument", "psu"] }, signal()),
    ).rejects.toThrow(/lab\/resources\.json is missing/);
    await mkdir(join(root, "lab", "resources.json"));
    await expect(
      runProgramTool.prepare?.(ctx, { program: "scpi", args: ["identify", "--instrument", "psu"] }, signal()),
    ).rejects.toThrow(/not a regular file/);
    expect(host.programs).toHaveLength(0);
  });

  it("ends the call when the registry changes after approval", async () => {
    const prepared = await prepare({ program: "scpi", args: ["identify", "--instrument", "psu"] });
    await writeRegistry({
      ...registry,
      resources: [{ ...registry.resources[0], resource: "TCPIP0::10.0.0.9::INSTR" }],
    });
    await expect(prepared.apply(signal())).rejects.toThrow(/changed after approval/);
    expect(host.programs).toHaveLength(0);
    const request = approved as ProgramChangeRequest;
    await expect(verifyProgramFiles(request)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("composes the authorized cleanup and marks an actuating run", async () => {
    mode = "bypass";
    const prepared = await prepare({
      program: "scpi",
      args: ["output", "--instrument", "psu", "--channel", "CH1", "--hold", "5"],
      background: true,
    });
    const started = (await prepared.apply(signal())) as { handle: string };
    const helper = await spawned(1);
    expect(helper.args).toEqual([
      "run",
      "--script",
      "/plugins/lab/scripts/scpi.py",
      "output",
      "--instrument",
      "psu",
      "--channel",
      "CH1",
      "--hold",
      "5",
    ]);
    const lease = JSON.parse(
      await readFile(
        join(root, "leases", (await import("./leases.js")).leaseFileName("usb:1ab1:0e11:dp8c1")),
        "utf8",
      ),
    );
    expect(lease).toMatchObject({ actuates: true, alias: "psu", runId: started.handle });
    // The helper crashes; the runner runs `close --instrument psu` with the same prefix.
    helper.finish({ code: 1, signal: null });
    const cleanup = await spawned(2);
    // REQ-SEC-80fa1675: the cleanup run checks the same approved registry.
    const { createHash } = await import("node:crypto");
    const approvedHash = createHash("sha256")
      .update(await readFile(join(root, "lab", "resources.json")))
      .digest("hex");
    expect(cleanup.options.env.VERA_REGISTRY_SHA256).toBe(approvedHash);
    expect(cleanup.args).toEqual([
      "run",
      "--script",
      "/plugins/lab/scripts/scpi.py",
      "close",
      "--instrument",
      "psu",
    ]);
    await writeFile(
      join(cleanup.options.env.VERA_RUN_CONTROL as string, "state.json"),
      JSON.stringify({ format: 1, phase: "released", physical: "confirmed" }),
    );
    cleanup.finish({ code: 0, signal: null });
    const stopped = await programStopTool.execute(ctx, { handle: started.handle }, signal());
    expect(stopped).toMatchObject({ physical: "confirmed", cleanup: "separate" });
    expect(existsSync(join(root, "leases", "runs", started.handle))).toBe(false);
  });
});
