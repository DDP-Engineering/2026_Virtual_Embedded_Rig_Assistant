// The power_quality write tool (spec REQ-DATA-4dc5e2c7): evaluates power factor correction at one board from an
// optional CURRENT network result, a measurement file of that board and one industrial catalog, and prepares ONE new
// result file through the write flow. The model, the measurement file and the catalog are only read; no step is
// switched and no regulator is set.
import { type ElectricalResult, electricalModelPath } from "@vera/shared";
import type { PreparedChange } from "../tools/changes.js";
import {
  type ToolContext,
  type ToolDefinition,
  toolExcludedRoots,
  toolPathGuard,
  toolSignal,
} from "../tools/context.js";
import { readCatalogFile } from "./catalog-tool.js";
import { readMeasurementFile } from "./measurements.js";
import { analyzePowerQuality, powerQualityRequestSchema } from "./power-quality.js";
import { newRun, prepareResultChange } from "./result-change.js";
import { resultFreshness } from "./results.js";
import { readModelFile, readResultFile } from "./tools.js";

/** Runs the engine and prepares the new result file; nothing is written before the change is applied. */
export async function preparePowerQuality(
  ctx: ToolContext,
  raw: unknown,
  signal: AbortSignal,
): Promise<PreparedChange> {
  signal = toolSignal(ctx, signal);
  signal.throwIfAborted();
  const request = powerQualityRequestSchema.parse(raw);
  const host = ctx.change;
  if (!host) throw Error("Workbench write host is unavailable.");
  host.assertWritable?.();
  const inputGuard = await toolPathGuard(ctx);
  const file = await readModelFile(ctx.root, toolExcludedRoots(ctx));
  if (!file) throw Error(`The workbench has no electrical model (${electricalModelPath}).`);
  let network: ElectricalResult | null = null;
  if (request.network) {
    network = await readResultFile(ctx.root, request.network, toolExcludedRoots(ctx));
    if (network.producer.plugin !== "electrical-network" || network.producer.operation !== "network")
      throw Error(`The result ${request.network} was not produced by electrical-network.`);
    const fresh = resultFreshness(network, file.model);
    if (fresh.freshness === "stale")
      throw Error(
        `The electrical-network result ${request.network} is stale (changed: ${fresh.changed.join(", ") || "none"}; removed: ${fresh.removed.join(", ") || "none"}): run electrical_network again.`,
      );
  }
  const measurements = request.measurements
    ? await readMeasurementFile(ctx.root, request.measurements, toolExcludedRoots(ctx), inputGuard)
    : null;
  if (measurements && measurements.series.file.board !== request.board)
    throw Error(
      `The measurement file ${request.measurements} measures ${measurements.series.file.board}, not ${request.board}.`,
    );
  const catalogFile = request.catalog
    ? await readCatalogFile(ctx.root, request.catalog, toolExcludedRoots(ctx), inputGuard)
    : null;
  signal.throwIfAborted();
  const { runId, now } = newRun();
  const result = analyzePowerQuality({
    model: file.model,
    modelPath: electricalModelPath,
    modelSha256: file.sha256,
    network,
    measurements,
    catalog: catalogFile?.catalog ?? null,
    catalogStamp: catalogFile?.stamp ?? null,
    request,
    runId,
    now,
  });
  return prepareResultChange({
    ctx,
    signal,
    tool: "power_quality",
    args: request,
    result,
    model: file.model,
    label: "power quality",
  });
}

export const powerQualityTool: ToolDefinition = {
  name: "power_quality",
  class: "write",
  description:
    "At one board: P, fundamental Q, displacement vs total power factor per scenario (current electrical_network result) and per interval of a measurement file (electrical-automation-measurements/<id>.json, declared units and sign conventions); kvar need to a target DPF; fixed or automatic bank with equal steps; overcompensation, cited capacitor/reactor/contactor/protection checks and resonance against measured harmonic orders. Stores a new result after approval; switches nothing; missing data is unknown.",
  params: powerQualityRequestSchema,
  prepare: (ctx, args, signal) => preparePowerQuality(ctx, args, signal),
  execute: async (ctx, args, signal) => (await preparePowerQuality(ctx, args, signal)).apply(signal),
};
