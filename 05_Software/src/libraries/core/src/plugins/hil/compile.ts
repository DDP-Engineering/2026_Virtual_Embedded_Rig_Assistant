import { createHash } from "node:crypto";
import { lstat, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  HIL_PLAN_BYTES,
  type HilCleanupStep,
  type HilPlan,
  type HilProblem,
  type HilStep,
  hilPlanProblems,
  hilPlanSchema,
  type PluginRisk,
  programCommandLine,
  serialPortKey,
} from "@vera/shared";
import { PathGuard } from "../../workbench/path-guard.js";
import type { LeaseClaim } from "../leases.js";
import type { ProgramChangeRequest } from "../program-request.js";
import type { PreparedCall } from "../program-tools.js";
import type { ProgramResource } from "../resource-registry.js";
import { serialPorts } from "../runner.js";
import { type HilAdapter, type HilAwaitParams, type HilEvaluateParams, hilAdapter } from "./adapters.js";

/** Firmware and plan files larger than this are refused. */
export const HIL_FIRMWARE_BYTES = 64 * 1024 * 1024;
/** A generated lab-validate request is at most this long (JSON). */
const REQUEST_BYTES = 1024 * 1024;
const RISKS: readonly PluginRisk[] = ["safe", "device-read", "device-write", "irreversible", "blocked"];
export const higherRisk = (a: PluginRisk, b: PluginRisk): PluginRisk =>
  RISKS.indexOf(a) >= RISKS.indexOf(b) ? a : b;

/** A plan VERA refuses, with every problem's path into the plan. */
export class HilPlanError extends Error {
  constructor(readonly problems: readonly HilProblem[]) {
    super(problems.map((problem) => (problem.path ? `${problem.path}: ` : "") + problem.message).join(" "));
    this.name = "HilPlanError";
  }
}

export type HilGroup = "steps" | "cleanup";
export interface HilBoundFile {
  readonly path: string;
  readonly sha256: string;
  readonly use: string;
}
export interface HilOperation {
  readonly id: string;
  readonly group: HilGroup;
  readonly index: number;
  readonly phase: "setup" | "test" | "cleanup";
  readonly use: string;
  readonly step: HilStep | HilCleanupStep;
  readonly adapter: HilAdapter;
  // biome-ignore lint/suspicious/noExplicitAny: the adapter's own parameter type.
  readonly params: any;
  /** The prepared program call; absent for executor steps (`await`). */
  readonly call?: PreparedCall | undefined;
  readonly risk: PluginRisk;
  /** Seconds: the step's timeout, else the operation's cap (for `await`, the awaited step's). */
  readonly timeout: number;
  readonly repeat: number;
  readonly retries: number;
  readonly background: boolean;
  /** Resource keys the operation uses (registry identities, serial ports, probes). */
  readonly keys: readonly string[];
  /** Workbench-relative folder of the step's own results. */
  readonly folder: string;
  /** `lab-validate.compare`: sources bound to earlier capture steps, by source id. */
  readonly sources?: Readonly<Record<string, string>>;
  /** `lab-validate.compare`: sha256 of path sources, by source id. */
  readonly sourceHashes?: Readonly<Record<string, string>>;
}
export interface CompiledHilPlan {
  readonly runId: string;
  readonly plan: HilPlan;
  readonly planPath: string;
  readonly planSha256: string;
  readonly planBytes: Buffer;
  readonly firmware: HilPlan["firmware"];
  readonly steps: readonly HilOperation[];
  readonly cleanup: readonly HilOperation[];
  /** The `hil report` call run after the plan. */
  readonly report: PreparedCall;
  readonly risk: PluginRisk;
  readonly trial: boolean;
  readonly confirm: string | null;
  /** A step flashes or resets the target, so the firmware runs. */
  readonly startsFirmware: boolean;
  readonly files: readonly HilBoundFile[];
  readonly resources: readonly ProgramResource[];
  readonly registry?: { readonly path: string; readonly sha256: string } | undefined;
  readonly claims: readonly LeaseClaim[];
  readonly cleanupSeconds: number;
}
export interface HilCompileInput {
  readonly workbench: string;
  /** The `hil run|check` call itself (risk, trial and file binding of its own arguments). */
  readonly own: PreparedCall;
  readonly planArg: string;
  readonly runId: string;
  /** Prepares one program call exactly as run_program does; throws an Error naming the problem. */
  prepare(program: string, args: string[]): Promise<PreparedCall>;
  /** A program call's timeout cap in seconds. */
  cap(call: PreparedCall): number;
  readonly signal?: AbortSignal | undefined;
}

export const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
async function hashFile(path: string, limit: number): Promise<string> {
  const info = await stat(path);
  if (!info.isFile()) throw Error("not a regular file");
  if (info.size > limit) throw Error(`larger than ${limit} bytes`);
  return sha256(await readFile(path));
}

/** The first key repeated inside one object of a JSON text, or undefined; the text must already parse. */
export function duplicateJsonKey(text: string): string | undefined {
  const frames: (Set<string> | null)[] = [];
  let expectKey = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      let end = index + 1;
      while (text[end] !== '"') end += text[end] === "\\" ? 2 : 1;
      const frame = frames[frames.length - 1];
      if (expectKey && frame) {
        const key = JSON.parse(text.slice(index, end + 1)) as string;
        if (frame.has(key)) return key;
        frame.add(key);
        expectKey = false;
      }
      index = end;
    } else if (char === "{") {
      frames.push(new Set());
      expectKey = true;
    } else if (char === "[") frames.push(null);
    else if (char === "}" || char === "]") frames.pop();
    else if (char === ",") expectKey = frames[frames.length - 1] instanceof Set;
  }
  return undefined;
}

/** Reads and validates a plan document; HilPlanError with every problem. */
export async function readHilPlan(
  workbench: string,
  planArg: string,
): Promise<{ plan: HilPlan; path: string; bytes: Buffer; sha256: string }> {
  const refuse = (message: string, path = ""): never => {
    throw new HilPlanError([{ path, message }]);
  };
  const guard = await PathGuard.create(workbench);
  let absolute = "";
  let relative = "";
  try {
    const resolved = await guard.resolve(planArg);
    absolute = resolved.absolute;
    relative = resolved.relative;
  } catch {
    refuse(`The plan ${planArg} is not a workbench file VERA may read.`);
  }
  let bytes: Buffer;
  try {
    const info = await lstat(absolute);
    if (!info.isFile()) refuse(`The plan ${planArg} is not a regular file.`);
    if (info.size > HIL_PLAN_BYTES) refuse(`The plan is larger than ${HIL_PLAN_BYTES} bytes.`);
    bytes = await readFile(absolute);
  } catch (error) {
    if (error instanceof HilPlanError) throw error;
    return refuse(`The plan ${planArg} cannot be read.`);
  }
  let value: unknown;
  let text = "";
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    value = JSON.parse(text);
  } catch {
    refuse("The plan is not valid UTF-8 JSON.");
  }
  const duplicate = duplicateJsonKey(text);
  if (duplicate !== undefined) refuse(`The key ${duplicate} appears twice in one object.`);
  const problems = hilPlanProblems(value);
  if (problems.length > 0) throw new HilPlanError(problems);
  return { plan: hilPlanSchema.parse(value), path: relative, bytes, sha256: sha256(bytes) };
}

/**
 * Compiles a plan into its operations (spec REQ-DATA-5f714098 §4): every refusal before any process starts. The
 * same run id compiles the same requests, so an approval can be re-checked when it is consumed.
 */
export async function compileHilPlan(input: HilCompileInput): Promise<CompiledHilPlan> {
  const {
    plan,
    path: planPath,
    bytes,
    sha256: planSha256,
  } = await readHilPlan(input.workbench, input.planArg);
  const problems: HilProblem[] = [];
  const problem = (path: string, message: string) => problems.push({ path, message });
  const guard = await PathGuard.create(input.workbench);

  // Firmware: a workbench file whose bytes match the plan's hash.
  let firmwarePath = plan.firmware.path;
  try {
    const resolved = await guard.resolve(plan.firmware.path);
    firmwarePath = resolved.relative;
    // The adapters pass the path as an argument: one that reads as an option is never a file to them.
    if (firmwarePath.startsWith("-"))
      problem("firmware.path", "The firmware path must not start with '-'; rename the file or its folder.");
    const digest = await hashFile(resolved.absolute, HIL_FIRMWARE_BYTES);
    if (digest !== plan.firmware.sha256)
      problem(
        "firmware.sha256",
        `The firmware's SHA-256 is ${digest}, not the plan's ${plan.firmware.sha256}.`,
      );
  } catch (error) {
    input.signal?.throwIfAborted();
    problem(
      "firmware.path",
      `The firmware ${plan.firmware.path} cannot be used: ${(error as Error).message}.`,
    );
  }
  if (problems.length > 0) throw new HilPlanError(problems);
  const firmware = { ...plan.firmware, path: firmwarePath };
  const files: HilBoundFile[] = [
    { path: planPath, sha256: planSha256, use: "plan" },
    { path: firmwarePath, sha256: plan.firmware.sha256, use: "firmware" },
  ];

  const operations: HilOperation[] = [];
  const background = new Map<string, HilOperation>();
  const awaitedIds = new Set<string>();
  const groups: [HilGroup, readonly (HilStep | HilCleanupStep)[]][] = [
    ["steps", plan.steps],
    ["cleanup", plan.cleanup ?? []],
  ];
  for (const [group, steps] of groups) {
    for (const [index, step] of steps.entries()) {
      const at = `${group}.${index}`;
      // Cleanup steps carry none of the step-only fields (the schema refuses them).
      const full = step as HilStep;
      const adapter = hilAdapter(step.use);
      if (!adapter) {
        problem(`${at}.use`, `Unknown step kind ${step.use}; VERA runs only registered adapters.`);
        continue;
      }
      const parsed = adapter.params.safeParse(step.with ?? {});
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          const keys = issue.code === "unrecognized_keys" ? issue.keys : [undefined];
          for (const key of keys)
            problem(
              [at, "with", ...issue.path.map(String), ...(key === undefined ? [] : [key])].join("."),
              key === undefined ? issue.message : `Unknown parameter ${key}.`,
            );
        }
        continue;
      }
      const params = parsed.data;
      const repeat = full.repeat ?? 1;
      const retries = full.retries ?? 0;
      if ((full.repeat !== undefined || full.retries !== undefined) && !adapter.repeatable(params))
        problem(at, `${step.use} runs once: retries and repeat are refused for it.`);
      if (full.background && !adapter.background)
        problem(`${at}.background`, `${step.use} cannot run in the background.`);
      if (group === "cleanup" && adapter.use === "await")
        problem(`${at}.use`, "A cleanup step cannot await.");
      if (adapter.formats && !adapter.formats.includes(plan.firmware.format))
        problem(at, `${step.use} does not take a ${plan.firmware.format} image.`);
      if (step.expect !== undefined)
        try {
          new RegExp(step.expect, "m");
        } catch {
          problem(`${at}.expect`, "expect is not a valid regular expression (JavaScript syntax).");
        }
      const folder = `embedded-lab-results/${input.runId}/steps/${step.id}`;
      const phase = group === "cleanup" ? "cleanup" : (full.phase ?? "test");

      if (adapter.use === "await") {
        const target = (params as HilAwaitParams).step;
        const awaited = background.get(target);
        if (!awaited || awaitedIds.has(target)) {
          problem(`${at}.with.step`, `${target} is not an earlier background step that is still running.`);
          continue;
        }
        awaitedIds.add(target);
        background.delete(target);
        if (step.timeout !== undefined && step.timeout > awaited.timeout)
          problem(`${at}.timeout`, `An await waits at most its step's ${awaited.timeout} s.`);
        operations.push({
          id: step.id,
          group,
          index,
          phase,
          use: step.use,
          step,
          adapter,
          params,
          risk: "safe",
          timeout: step.timeout ?? awaited.timeout,
          repeat: 1,
          retries: 0,
          background: false,
          keys: [],
          folder,
        });
        continue;
      }

      // Bind lab-validate sources: earlier capture steps or hashed workbench files and run folders.
      let sources: Record<string, string> | undefined;
      let sourceHashes: Record<string, string> | undefined;
      if (adapter.use === "lab-validate.compare") {
        const request = (params as HilEvaluateParams).request;
        if (JSON.stringify(request).length > REQUEST_BYTES)
          problem(`${at}.with.request`, "The request is larger than 1 MiB.");
        const declared = request.sources;
        if (!declared || typeof declared !== "object" || Array.isArray(declared)) {
          problem(`${at}.with.request.sources`, "The request needs its sources.");
          continue;
        }
        sources = {};
        sourceHashes = {};
        for (const [id, source] of Object.entries(declared as Record<string, unknown>)) {
          const where = `${at}.with.request.sources.${id}`;
          if (!source || typeof source !== "object" || Array.isArray(source)) {
            problem(where, "A source is an object.");
            continue;
          }
          const fields = source as Record<string, unknown>;
          if ((fields.step === undefined) === (fields.path === undefined)) {
            problem(where, "A source names either step or path.");
            continue;
          }
          if (fields.step !== undefined) {
            const earlier = operations.find((op) => op.group === "steps" && op.id === fields.step);
            if (group !== "steps" || earlier?.use !== "scpi.capture") {
              problem(`${where}.step`, `${String(fields.step)} is not an earlier scpi.capture step.`);
              continue;
            }
            if (fields.sha256 !== undefined)
              problem(`${where}.sha256`, "A step source is hashed when it exists.");
            sources[id] = earlier.id;
            continue;
          }
          if (typeof fields.path !== "string") {
            problem(`${where}.path`, "A path is text.");
            continue;
          }
          try {
            const resolved = await guard.resolve(fields.path);
            const info = await stat(resolved.absolute);
            const target = info.isDirectory() ? join(resolved.absolute, "result.json") : resolved.absolute;
            const digest = await hashFile(target, HIL_FIRMWARE_BYTES);
            if (fields.sha256 !== undefined && fields.sha256 !== digest)
              problem(`${where}.sha256`, `The source's SHA-256 is ${digest}.`);
            sourceHashes[id] = digest;
            files.push({
              path: info.isDirectory() ? `${resolved.relative}/result.json` : resolved.relative,
              sha256: digest,
              use: `source ${step.id}.${id}`,
            });
          } catch (error) {
            input.signal?.throwIfAborted();
            problem(
              `${where}.path`,
              `The source ${fields.path} cannot be used: ${(error as Error).message}.`,
            );
          }
        }
      }

      const args = adapter.args(params, { firmware, folder });
      let call: PreparedCall;
      try {
        call = await input.prepare(adapter.program as string, args);
      } catch (error) {
        input.signal?.throwIfAborted();
        problem(at, (error as Error).message);
        continue;
      }
      const risk = call.prepared.risk;
      if (risk === "blocked") {
        problem(
          at,
          `${programCommandLine(call.prepared.program, args)} is rated blocked by ${call.plugin.manifest.id}.`,
        );
        continue;
      }
      const cap = input.cap(call);
      if (step.timeout !== undefined && step.timeout > cap)
        problem(`${at}.timeout`, `${step.use} allows at most ${cap} s.`);
      const keys = [
        ...(call.prepared.resources ?? []).flatMap((resource) => resource.keys),
        ...serialPorts(args).map(serialPortKey),
        ...adapter.probes(params).map((selector) => `probe:${selector.toLowerCase()}`),
      ];
      // No interleaving: a still-running background step's resources belong to it.
      if (group === "steps")
        for (const [id, other] of background) {
          const shared = keys.find((key) => other.keys.includes(key));
          if (shared)
            problem(at, `${step.id} uses ${shared}, which background step ${id} still uses; await it first.`);
        }
      for (const file of call.prepared.files)
        if (!files.some((bound) => bound.path === file.path && bound.use === `step ${step.id}`))
          files.push({ path: file.path, sha256: file.sha256, use: `step ${step.id}` });
      const operation: HilOperation = {
        id: step.id,
        group,
        index,
        phase,
        use: step.use,
        step,
        adapter,
        params,
        call,
        risk,
        timeout: Math.min(step.timeout ?? cap, cap),
        repeat,
        retries,
        background: full.background === true,
        keys: [...new Set(keys)],
        folder,
        ...(sources && sourceHashes ? { sources, sourceHashes } : {}),
      };
      operations.push(operation);
      if (operation.background) background.set(step.id, operation);
    }
    // Background steps still running at the end of the steps are stopped before the cleanup.
    background.clear();
  }

  // One registry for the whole plan.
  const registries = new Set(
    operations.flatMap((op) => (op.call?.prepared.registry ? [op.call.prepared.registry.sha256] : [])),
  );
  if (registries.size > 1)
    problem("", "lab/resources.json changed while the plan was compiled; check it again.");
  if (problems.length > 0) throw new HilPlanError(problems);

  const steps = operations.filter((op) => op.group === "steps");
  const cleanup = operations.filter((op) => op.group === "cleanup");
  const startsFirmware = operations.some((op) => op.adapter.flashes || op.adapter.resets(op.params));
  let risk = higherRisk(
    input.own.prepared.risk,
    operations.reduce<PluginRisk>((max, op) => higherRisk(max, op.risk), "safe"),
  );
  if (startsFirmware) risk = higherRisk(risk, plan.setup.firmwareEffect);
  const trial = input.own.prepared.trial || operations.some((op) => op.call?.prepared.trial === true);

  const resources: ProgramResource[] = [];
  for (const op of operations)
    for (const resource of op.call?.prepared.resources ?? [])
      if (!resources.some((known) => known.alias === resource.alias)) resources.push(resource);
  const registry = operations.find((op) => op.call?.prepared.registry)?.call?.prepared.registry;

  const actuates = risk === "device-write" || risk === "irreversible";
  const claims: LeaseClaim[] = [...resources.map((resource) => ({ ...resource, actuates }))];
  const known = new Set(claims.flatMap((claim) => claim.keys));
  for (const op of operations)
    for (const key of op.keys) {
      if (known.has(key)) continue;
      known.add(key);
      const [kind, ...rest] = key.split(":");
      const name = rest.join(":");
      claims.push({ kind: kind ?? "key", alias: name, resource: name, keys: [key], actuates });
    }

  const report = await input.prepare("hil", ["report", "--run", `embedded-lab-results/${input.runId}`]);
  return {
    runId: input.runId,
    plan,
    planPath,
    planSha256,
    planBytes: bytes,
    firmware,
    steps,
    cleanup,
    report,
    risk,
    trial,
    confirm: risk === "irreversible" ? plan.id : null,
    startsFirmware,
    files,
    resources,
    registry,
    claims,
    cleanupSeconds: cleanup.reduce((sum, op) => sum + op.timeout, 0),
  };
}

/** Checks that the plan file and the firmware still have the compiled bytes; false on any difference. */
export async function planFilesUnchanged(workbench: string, compiled: CompiledHilPlan): Promise<boolean> {
  const guard = await PathGuard.create(workbench);
  for (const file of compiled.files.filter((bound) => bound.use === "plan" || bound.use === "firmware")) {
    try {
      if ((await hashFile((await guard.resolve(file.path)).absolute, HIL_FIRMWARE_BYTES)) !== file.sha256)
        return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** Run folders inside a step folder, for finding the one an attempt created. */
export async function runFolders(workbench: string, folder: string): Promise<string[]> {
  try {
    return (await readdir(join(workbench, folder), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

const describeOp = (op: HilOperation, n: number) => {
  const flags = [
    op.repeat > 1 ? `repeat ${op.repeat}` : "",
    op.retries > 0 ? `retries ${op.retries}` : "",
    op.background ? "background" : "",
    op.step.timeout !== undefined ? `timeout ${op.timeout} s` : "",
    "skip" in op.step && op.step.skip ? `skipped: ${op.step.skip}` : "",
  ].filter(Boolean);
  const command = op.call
    ? programCommandLine(op.call.prepared.program, [...op.call.prepared.args])
    : `await ${(op.params as HilAwaitParams).step}`;
  return [
    `${op.group === "steps" ? "Step" : "Cleanup"} ${n} ${op.id} [${op.phase}] ${op.risk}: ${command}${flags.length > 0 ? ` (${flags.join(", ")})` : ""}`,
    ...(op.call?.prepared.notes ?? []).map((note) => `  ${op.id}: ${note}`),
  ];
};
/** The approval notes of a compiled plan, in the spec's order (REQ-DATA-5f714098 §5). */
export function hilNotes(compiled: CompiledHilPlan): string[] {
  const { plan } = compiled;
  return [
    `HIL plan ${plan.id} (${compiled.planPath}, sha256 ${compiled.planSha256}): ${plan.title}`,
    `Setup: ${plan.setup.board} revision ${plan.setup.revision} - ${plan.setup.description}`,
    ...plan.setup.wiring.map((wire) => `Wiring: ${wire}`),
    ...(plan.setup.interlocks ?? []).map((interlock) => `Interlock: ${interlock}`),
    `Firmware effect: ${plan.setup.firmwareEffect}${compiled.startsFirmware ? " (the plan starts the firmware)" : ""} - ${plan.setup.effectNote}`,
    `Firmware: ${compiled.firmware.path} (${compiled.firmware.format}${compiled.firmware.address ? ` at ${compiled.firmware.address}` : ""}) sha256 ${compiled.firmware.sha256}`,
    `Budget: ${plan.budget.seconds} s for the steps; cleanup up to ${compiled.cleanupSeconds} s after Stop, timeout or the end`,
    ...compiled.steps.flatMap((op, index) => describeOp(op, index + 1)),
    ...(compiled.cleanup.length > 0
      ? compiled.cleanup.flatMap((op, index) => describeOp(op, index + 1))
      : ["Cleanup: none declared"]),
    `Report: ${programCommandLine("hil", [...compiled.report.prepared.args])}`,
    ...compiled.files.map((file) => `File: ${file.path} ${file.sha256} (${file.use})`),
    ...compiled.claims
      .filter((claim) => claim.kind === "serial" || claim.kind === "probe")
      .map((claim) => `Reserved ${claim.kind === "serial" ? "serial port" : "probe"}: ${claim.resource}`),
  ];
}

/** The hashed binding of a plan approval: everything the run uses beyond the call's own arguments. */
export function hilBinding(compiled: CompiledHilPlan): Readonly<Record<string, unknown>> {
  const op = (operation: HilOperation) => ({
    id: operation.id,
    use: operation.use,
    phase: operation.phase,
    timeout: operation.timeout,
    repeat: operation.repeat,
    retries: operation.retries,
    background: operation.background,
    keys: operation.keys,
    params: operation.params,
    request: operation.call?.prepared ?? null,
  });
  return {
    kind: "hil",
    runId: compiled.runId,
    path: compiled.planPath,
    sha256: compiled.planSha256,
    firmware: compiled.firmware,
    budgetSeconds: compiled.plan.budget.seconds,
    files: compiled.files,
    steps: compiled.steps.map(op),
    cleanup: compiled.cleanup.map(op),
    report: compiled.report.prepared,
    claims: compiled.claims.map((claim) => ({ kind: claim.kind, alias: claim.alias, keys: claim.keys })),
  };
}

/** The `hil check` expansion (spec REQ-DATA-5f714098 §4). */
export function hilExpansion(compiled: CompiledHilPlan): Record<string, unknown> {
  const op = (operation: HilOperation) => ({
    id: operation.id,
    phase: operation.phase,
    use: operation.use,
    ...(operation.call
      ? {
          plugin: operation.call.plugin.manifest.id,
          program: operation.call.prepared.program,
          args: operation.call.prepared.args,
          notes: operation.call.prepared.notes,
          files: operation.call.prepared.files.map(({ path, sha256 }) => ({ path, sha256 })),
        }
      : { await: (operation.params as HilAwaitParams).step }),
    risk: operation.risk,
    timeout: operation.timeout,
    repeat: operation.repeat,
    retries: operation.retries,
    background: operation.background,
    ...("expect" in operation.step && operation.step.expect ? { expect: operation.step.expect } : {}),
    ...("skip" in operation.step && operation.step.skip ? { skip: operation.step.skip } : {}),
  });
  return {
    format: 1,
    kind: "hil-plan-check",
    valid: true,
    plan: {
      id: compiled.plan.id,
      title: compiled.plan.title,
      path: compiled.planPath,
      sha256: compiled.planSha256,
    },
    setup: compiled.plan.setup,
    firmware: compiled.firmware,
    risk: compiled.risk,
    confirm: compiled.confirm,
    trial: compiled.trial,
    startsFirmware: compiled.startsFirmware,
    budgetSeconds: compiled.plan.budget.seconds,
    cleanupSeconds: compiled.cleanupSeconds,
    resources: compiled.claims.map((claim) => ({
      kind: claim.kind === "serial" || claim.kind === "probe" ? claim.kind : "registry",
      name: claim.alias,
      keys: claim.keys,
    })),
    files: compiled.files,
    steps: compiled.steps.map(op),
    cleanup: compiled.cleanup.map(op),
  };
}

/** The request a plan approval covers: the `hil run` call with the plan's risk, notes, resources and binding. */
export function hilRequest(own: ProgramChangeRequest, compiled: CompiledHilPlan): ProgramChangeRequest {
  return Object.freeze({
    ...own,
    risk: compiled.risk,
    trial: compiled.trial,
    confirm: compiled.confirm,
    notes: Object.freeze([...own.notes, ...hilNotes(compiled)]),
    ...(compiled.resources.length > 0 && compiled.registry
      ? { resources: compiled.resources, registry: compiled.registry }
      : {}),
    plan: hilBinding(compiled),
  });
}
