// The protection_coordination write tool (spec REQ-DATA-a5673202): evaluates candidate fuses and breakers of one
// industrial catalog against a CURRENT stored electrical-network result and prepares ONE new result file through the
// write flow. The model, the catalog and every device are only read; nothing is configured.
import { electricalModelPath } from "@vera/shared";
import type { PreparedChange } from "../tools/changes.js";
import {
  type ToolContext,
  type ToolDefinition,
  toolExcludedRoots,
  toolPathGuard,
  toolSignal,
} from "../tools/context.js";
import type { PathGuard } from "../workbench/path-guard.js";
import { readCableTableFile } from "./cable-table.js";
import { readCatalogFile } from "./catalog-tool.js";
import { analyzeProtection, protectionRequestSchema } from "./protection.js";
import { newRun, prepareResultChange } from "./result-change.js";
import { resultFreshness } from "./results.js";
import { readModelFile, readResultFile } from "./tools.js";

/** k of the cable table the network result names, if that table is unchanged since the network run. */
async function cableK(
  root: string,
  text: string | undefined,
  excludedRoots: readonly string[] = [],
  inputGuard?: PathGuard,
): Promise<{ k: number | null; text: string }> {
  const match = text ? /^(\S+) .+ sha256 ([0-9a-f]{16})$/.exec(text) : null;
  if (!match) return { k: null, text: "the network result names no cable table" };
  const [, id, prefix] = match as unknown as [string, string, string];
  try {
    const { table, stamp } = await readCableTableFile(root, id, excludedRoots, inputGuard);
    if (stamp.sha256.slice(0, 16) !== prefix)
      return { k: null, text: `cable table ${id} changed since the network run` };
    return {
      k: table.cable.k,
      text: table.cable.k === null ? `cable table ${id} gives no k` : `${text} (k ${table.cable.k})`,
    };
  } catch (error) {
    return {
      k: null,
      text: `cable table ${id} cannot be read: ${error instanceof Error ? error.message : error}`,
    };
  }
}

/** Runs the engine and prepares the new result file; nothing is written before the change is applied. */
export async function prepareProtectionCoordination(
  ctx: ToolContext,
  raw: unknown,
  signal: AbortSignal,
): Promise<PreparedChange> {
  signal = toolSignal(ctx, signal);
  signal.throwIfAborted();
  const request = protectionRequestSchema.parse(raw);
  const host = ctx.change;
  if (!host) throw Error("Workbench write host is unavailable.");
  host.assertWritable?.();
  const inputGuard = await toolPathGuard(ctx);
  const file = await readModelFile(ctx.root, toolExcludedRoots(ctx));
  if (!file) throw Error(`The workbench has no electrical model (${electricalModelPath}).`);
  const network = await readResultFile(ctx.root, request.network, toolExcludedRoots(ctx));
  if (network.producer.plugin !== "electrical-network" || network.producer.operation !== "network")
    throw Error(`The result ${request.network} was not produced by electrical-network.`);
  const fresh = resultFreshness(network, file.model);
  if (fresh.freshness === "stale")
    throw Error(
      `The network result ${request.network} is stale (changed: ${fresh.changed.join(", ") || "none"}; removed: ${fresh.removed.join(", ") || "none"}): run electrical_network again.`,
    );
  const { catalog, stamp } = await readCatalogFile(
    ctx.root,
    request.catalog,
    toolExcludedRoots(ctx),
    inputGuard,
  );
  const condition = network.conditions.cableTable;
  const cable = await cableK(
    ctx.root,
    condition && "text" in condition ? condition.text : undefined,
    toolExcludedRoots(ctx),
    inputGuard,
  );
  signal.throwIfAborted();
  const { runId, now } = newRun();
  const result = analyzeProtection({
    model: file.model,
    modelPath: electricalModelPath,
    modelSha256: file.sha256,
    network,
    catalog,
    catalogStamp: stamp,
    cable,
    request,
    runId,
    now,
  });
  return prepareResultChange({
    ctx,
    signal,
    tool: "protection_coordination",
    args: request,
    result,
    model: file.model,
    label: "protection",
  });
}

export const protectionCoordinationTool: ToolDefinition = {
  name: "protection_coordination",
  class: "write",
  description:
    "Check candidate fuses and breakers of an industrial catalog per circuit against a current electrical_network result: voltage, poles, breaking capacity of the named kind, Ib <= In <= Iz, I2 <= 1.45 Iz, disconnection, let-through energy, RCD; selectivity, cascading and starters only from manufacturer tables. Units: setting A, times s, residualCurrentMax mA. Stores a new result after approval; missing data is unknown, never pass.",
  params: protectionRequestSchema,
  prepare: (ctx, args, signal) => prepareProtectionCoordination(ctx, args, signal),
  execute: async (ctx, args, signal) =>
    (await prepareProtectionCoordination(ctx, args, signal)).apply(signal),
};
