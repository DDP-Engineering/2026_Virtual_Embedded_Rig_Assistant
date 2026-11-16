// The motor_drives write tool (spec REQ-DATA-79118f9a): compares starting and drive methods per motor against a
// CURRENT stored protection-coordination result (and the network result it names), sizes the proposed assembly from
// one industrial catalog and prepares ONE new result file through the write flow. The model, the catalog and every
// device are only read; no drive is configured or parameterised.
import { type ElectricalModel, type ElectricalResult, electricalModelPath } from "@vera/shared";
import type { PreparedChange } from "../tools/changes.js";
import {
  type ToolContext,
  type ToolDefinition,
  toolExcludedRoots,
  toolPathGuard,
  toolSignal,
} from "../tools/context.js";
import { readCatalogFile } from "./catalog-tool.js";
import { analyzeMotorDrives, motorDrivesRequestSchema } from "./motor-drives.js";
import { newRun, prepareResultChange } from "./result-change.js";
import { resultFreshness } from "./results.js";
import { readModelFile, readResultFile } from "./tools.js";

/** A stored result of the named producer that is current against the model; refused otherwise. */
async function currentResult(
  root: string,
  runId: string,
  model: ElectricalModel,
  plugin: string,
  operation: string,
  rerun: string,
  excludedRoots: readonly string[] = [],
): Promise<ElectricalResult> {
  const result = await readResultFile(root, runId, excludedRoots);
  if (result.producer.plugin !== plugin || result.producer.operation !== operation)
    throw Error(`The result ${runId} was not produced by ${plugin}.`);
  const fresh = resultFreshness(result, model);
  if (fresh.freshness === "stale")
    throw Error(
      `The ${plugin} result ${runId} is stale (changed: ${fresh.changed.join(", ") || "none"}; removed: ${fresh.removed.join(", ") || "none"}): run ${rerun} again.`,
    );
  return result;
}

/** Runs the engine and prepares the new result file; nothing is written before the change is applied. */
export async function prepareMotorDrives(
  ctx: ToolContext,
  raw: unknown,
  signal: AbortSignal,
): Promise<PreparedChange> {
  signal = toolSignal(ctx, signal);
  signal.throwIfAborted();
  const request = motorDrivesRequestSchema.parse(raw);
  const host = ctx.change;
  if (!host) throw Error("Workbench write host is unavailable.");
  host.assertWritable?.();
  const inputGuard = await toolPathGuard(ctx);
  const file = await readModelFile(ctx.root, toolExcludedRoots(ctx));
  if (!file) throw Error(`The workbench has no electrical model (${electricalModelPath}).`);
  const protection = await currentResult(
    ctx.root,
    request.protection,
    file.model,
    "protection-coordination",
    "protection",
    "protection_coordination",
    toolExcludedRoots(ctx),
  );
  const networkRun = protection.conditions.networkRun;
  if (!networkRun || !("text" in networkRun))
    throw Error(`The protection result ${request.protection} names no network run.`);
  const network = await currentResult(
    ctx.root,
    networkRun.text,
    file.model,
    "electrical-network",
    "network",
    "electrical_network",
    toolExcludedRoots(ctx),
  );
  const { catalog, stamp } = await readCatalogFile(
    ctx.root,
    request.catalog,
    toolExcludedRoots(ctx),
    inputGuard,
  );
  signal.throwIfAborted();
  const { runId, now } = newRun();
  const result = analyzeMotorDrives({
    model: file.model,
    modelPath: electricalModelPath,
    modelSha256: file.sha256,
    protection,
    network,
    catalog,
    catalogStamp: stamp,
    request,
    runId,
    now,
  });
  return prepareResultChange({
    ctx,
    signal,
    tool: "motor_drives",
    args: request,
    result,
    model: file.model,
    label: "motor drives",
  });
}

export const motorDrivesTool: ToolDefinition = {
  name: "motor_drives",
  class: "write",
  description:
    "Per motor, compare DOL, reversing, star-delta, softstarter and VFD against the process function and limits (current A, times s, panel °C/m) from model nameplate, load torque and inertia; propose the simplest feasible method, size its contactors, overload relay, softstarter or drive from a catalog and return a logical connection/interlock scheme. Needs a current protection_coordination result. Stores a new result after approval; never configures a device; missing data is unknown.",
  params: motorDrivesRequestSchema,
  prepare: (ctx, args, signal) => prepareMotorDrives(ctx, args, signal),
  execute: async (ctx, args, signal) => (await prepareMotorDrives(ctx, args, signal)).apply(signal),
};
