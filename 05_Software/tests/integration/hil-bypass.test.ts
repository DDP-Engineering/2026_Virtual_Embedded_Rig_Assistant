import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeProcessHost } from "@vera/core";
import { type PermissionMode, validatePluginManifest } from "@vera/shared";
import { afterEach, beforeEach, expect, it } from "vitest";
import { parse } from "yaml";
import { requestSha256 } from "../../src/libraries/core/src/agent/approvals.js";
import type { ProgramChangeRequest } from "../../src/libraries/core/src/plugins/program-request.js";
import { ProgramSession, runProgramTool } from "../../src/libraries/core/src/plugins/program-tools.js";
import { ProgramRunner } from "../../src/libraries/core/src/plugins/runner.js";
import type { LoadedPlugin } from "../../src/libraries/core/src/plugins/store.js";
import type { ToolContext } from "../../src/libraries/core/src/tools/context.js";

const plugins = fileURLToPath(new URL("../../plugins/", import.meta.url));
const python = spawnSync(
  process.platform === "win32" ? "python" : "python3",
  ["-c", "import sys; print(sys.executable)"],
  { encoding: "utf8" },
).stdout.trim();
const script = join(plugins, "lab-validation/scripts/lab_validate.py");
let scratch: string, root: string, outside: string, managed: string;
let mode: PermissionMode;
let epoch: AbortController;
let runner: ProgramRunner;
let ctx: ToolContext;
let approved: ProgramChangeRequest;
let onVerify: (() => Promise<void>) | undefined;
const signal = () => new AbortController().signal;
const hash = (bytes: string) => createHash("sha256").update(bytes).digest("hex");
const request = (path: string) => ({
  format: 1,
  title: "Owned sibling capture",
  decisionRule: "simple",
  missingData: "incomplete",
  sources: {
    s: {
      importer: "csv",
      path,
      time: { column: "t", unit: "s" },
      columns: { v: { column: "v", unit: "V" } },
      bandwidth: "1 kHz",
    },
  },
  signals: { v: { source: "s", channel: "v" } },
  measurements: [{ id: "mean", signal: "v", metric: "mean", window: { from: "0 s", to: "1 ms" } }],
  criteria: [{ id: "limit", value: "mean", op: "<=", limit: "2 V", uncertainty: "0 V" }],
});
async function load(id: string): Promise<LoadedPlugin> {
  const folder = join(plugins, id);
  const checked = validatePluginManifest(parse(await readFile(join(folder, "plugin.yaml"), "utf8")));
  if (!checked.manifest) throw Error(JSON.stringify(checked.issues));
  return {
    folder,
    verify: async () => onVerify?.(),
    manifest: checked.manifest,
    record: {
      format: 1,
      id,
      version: checked.manifest.version,
      tier: "official",
      source: { kind: "folder", path: folder },
      sha256: hash(id),
      installedAt: "2026-11-16T00:00:00Z",
      programs: {},
    },
  };
}
beforeEach(async () => {
  scratch = await realpath(await mkdtemp(join(tmpdir(), "vera-hil-real-")));
  root = join(scratch, "bench");
  outside = join(scratch, "sibling");
  managed = join(scratch, "data");
  for (const path of [root, outside, managed]) await mkdir(path);
  await writeFile(join(outside, "capture.csv"), "t,v\n0,1\n0.0005,1\n0.001,1\n");
  await writeFile(join(outside, "image.elf"), "owned firmware");
  const loaded = await Promise.all([load("hil-testing"), load("lab-validation")]);
  mode = "bypass";
  epoch = new AbortController();
  onVerify = undefined;
  runner = new ProgramRunner({
    host: new NodeProcessHost(spawn),
    clock: { sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) },
  });
  ctx = {
    root,
    lastReads: new Map(),
    managedRoots: [managed],
    permissionMode: () => mode,
    bypassSignal: () => epoch.signal,
    programs: {
      session: new ProgramSession(),
      sessionId: "session",
      turnId: "turn",
      callId: "call",
      consume: (current) => {
        if (requestSha256(current) !== requestSha256(approved)) throw Error("Approval changed");
      },
      host: {
        runner,
        clock: { sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) },
        plugins: async () => loaded,
        resolver: {
          resolve: async (_plugin, name) => ({
            executable: python,
            prefix: [name === "lab-validate" ? script : join(plugins, "hil-testing/scripts/hil_tool.py")],
            env: { PYTHONDONTWRITEBYTECODE: "1" },
          }),
        },
      },
    },
  };
});
afterEach(async () => {
  await runner.stopAll();
  await rm(scratch, { recursive: true, force: true });
});
async function plan(path = "capture.csv") {
  await writeFile(
    join(outside, "plan.json"),
    JSON.stringify({
      format: 1,
      id: "outside",
      title: "Owned HIL sources",
      setup: {
        board: "fixture",
        revision: "A",
        description: "No hardware",
        wiring: [],
        firmwareEffect: "device-read",
        effectNote: "No firmware executes",
      },
      firmware: { path: "image.elf", sha256: hash("owned firmware"), format: "elf" },
      budget: { seconds: 10 },
      steps: [{ id: "compare", use: "lab-validate.compare", with: { request: request(path) } }],
    }),
  );
}
async function prepare() {
  const change = await runProgramTool.prepare?.(
    ctx,
    { program: "hil", cwd: outside, args: ["run", "plan.json"] },
    signal(),
  );
  if (!change) throw Error("Missing HIL preparation");
  approved = change.request as ProgramChangeRequest;
  return change;
}
it("runs the real HIL validation helper on sibling cwd, plan, firmware and source with fixed output ownership", async () => {
  await plan();
  mode = "ask";
  await expect(prepare()).rejects.toThrow();
  mode = "bypass";
  const change = await prepare();
  expect(approved.cwd).toBe(outside.replaceAll("\\", "/"));
  expect(JSON.stringify(approved.plan)).toContain(join(outside, "capture.csv").replaceAll("\\", "/"));
  const result = await change.apply(signal());
  expect(result.exitCode).toBe(0);
  const folder = join(root, result.result as string);
  const stored = JSON.parse(await readFile(join(folder, "result.json"), "utf8"));
  expect(stored.status).toBe("pass");
  const generated = JSON.parse(await readFile(join(folder, "steps/compare.request.json"), "utf8"));
  expect(generated.sources.s.path).toBe(join(outside, "capture.csv").replaceAll("\\", "/"));
  expect(stored.steps[0].attempts[0].exitCode).toBe(0);
  await expect(readFile(join(outside, ".vera/runs"))).rejects.toBeDefined();
  if (process.env.VERA_BYP02_EVIDENCE_DIR) {
    const evidence = join(process.env.VERA_BYP02_EVIDENCE_DIR, "hil-real");
    await mkdir(evidence, { recursive: true });
    await cp(folder, join(evidence, "result"), { recursive: true });
    await cp(join(root, ".vera/runs"), join(evidence, "logs"), { recursive: true });
  }
});
it("passes canonical sources to the real helper after the original alias is replaced", async () => {
  const alias = join(outside, "alias");
  await mkdir(join(outside, "capture"));
  await writeFile(join(outside, "capture/data.csv"), "t,v\n0,1\n0.0005,1\n0.001,1\n");
  await symlink(join(outside, "capture"), alias, process.platform === "win32" ? "junction" : "dir");
  await plan("alias/data.csv");
  const change = await prepare();
  // Replacement after initial approval forces recompilation refusal before any process.
  await rm(alias);
  await symlink(managed, alias, process.platform === "win32" ? "junction" : "dir");
  await expect(change.apply(signal())).rejects.toThrow();
});
it("keeps standalone source confinement and enforces host exclusions in the actual helper", async () => {
  const path = join(outside, "capture.csv");
  await writeFile(join(root, "request.json"), JSON.stringify(request(path)));
  const run = (policy?: unknown) =>
    spawnSync(python, [script, "compare", "--request", "request.json"], {
      cwd: root,
      env: {
        ...process.env,
        PYTHONDONTWRITEBYTECODE: "1",
        ...(policy === undefined ? {} : { VERA_HIL_INPUT_POLICY: JSON.stringify(policy) }),
      },
      encoding: "utf8",
    });
  expect(run().status).toBe(2);
  expect(run({ scope: "filesystem", excludedRoots: [managed] }).status).toBe(0);
  const alias = join(root, "private");
  await symlink(outside, alias, process.platform === "win32" ? "junction" : "dir");
  await writeFile(join(root, "request.json"), JSON.stringify(request(join(alias, "capture.csv"))));
  for (const scope of ["workbench", "filesystem"]) {
    const denied = run({ scope, excludedRoots: [outside] });
    expect(denied.status).toBe(2);
    expect(denied.stdout).toContain("VERA application data");
  }
});

it("consumes the canonical source after a raw alias is retargeted at the actual spawn boundary", async () => {
  await mkdir(join(outside, "capture"));
  await writeFile(join(outside, "capture/data.csv"), "t,v\n0,1\n0.0005,1\n0.001,1\n");
  await writeFile(join(managed, "data.csv"), "PRIVATE_APPLICATION_BYTES");
  const alias = join(outside, "alias");
  await symlink(join(outside, "capture"), alias, process.platform === "win32" ? "junction" : "dir");
  await plan("alias/data.csv");
  const change = await prepare();
  let swapped = false;
  onVerify = async () => {
    if (swapped) return;
    swapped = true;
    await rm(alias);
    await symlink(managed, alias, process.platform === "win32" ? "junction" : "dir");
  };
  const result = await change.apply(signal());
  expect(swapped).toBe(true);
  expect(result.exitCode).toBe(0);
  const generated = JSON.parse(
    await readFile(join(root, result.result as string, "steps/compare.request.json"), "utf8"),
  );
  expect(generated.sources.s.path).toBe(join(outside, "capture/data.csv").replaceAll("\\", "/"));
  expect(JSON.stringify(result)).not.toContain("PRIVATE_APPLICATION_BYTES");
});

it("retains lexical application-data exclusions across a managed junction with an outward child junction", async () => {
  const configured = join(root, "configured-managed");
  await symlink(managed, configured, process.platform === "win32" ? "junction" : "dir");
  await symlink(outside, join(managed, "outward"), process.platform === "win32" ? "junction" : "dir");
  await writeFile(
    join(root, "request.json"),
    JSON.stringify(request(join(configured, "outward/capture.csv"))),
  );
  for (const scope of ["filesystem", "workbench"]) {
    const result = spawnSync(python, [script, "compare", "--request", "request.json"], {
      cwd: root,
      env: {
        ...process.env,
        PYTHONDONTWRITEBYTECODE: "1",
        VERA_HIL_INPUT_POLICY: JSON.stringify({ scope, excludedRoots: [configured] }),
      },
      encoding: "utf8",
    });
    expect(result.status).toBe(2);
    expect(result.stdout).toContain("VERA application data");
  }
});
