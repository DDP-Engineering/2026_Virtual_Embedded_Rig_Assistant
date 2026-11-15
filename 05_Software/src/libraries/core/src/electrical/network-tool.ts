// The electrical_network write tool (spec REQ-DATA-42ce122f): runs the radial LV network engine on the workbench's
// model and a cable table, and prepares ONE new result file electrical-automation-results/<run-id>/result.json
// through the write flow (approval, before hash = absent, write queue). The model is only read.
import { electricalModelPath } from "@vera/shared";
import type { PreparedChange } from "../tools/changes.js";
import type { ToolContext, ToolDefinition } from "../tools/context.js";
import { readCableTableFile } from "./cable-table.js";
import { analyzeNetwork, networkRequestSchema } from "./network.js";
import { newRun, prepareResultChange } from "./result-change.js";
import { readModelFile } from "./tools.js";

/** Runs the engine and prepares the new result file; nothing is written before the change is applied. */
export async function prepareElectricalNetwork(
  ctx: ToolContext,
  raw: unknown,
  signal: AbortSignal,
): Promise<PreparedChange> {
  signal.throwIfAborted();
  const request = networkRequestSchema.parse(raw);
  const host = ctx.change;
  if (!host) throw Error("Workbench write host is unavailable.");
  host.assertWritable?.();
  const file = await readModelFile(ctx.root);
  if (!file) throw Error(`The workbench has no electrical model (${electricalModelPath}).`);
  const { table, stamp } = await readCableTableFile(ctx.root, request.cableTable);
  signal.throwIfAborted();
  const { runId, now } = newRun();
  const result = analyzeNetwork({
    model: file.model,
    modelPath: electricalModelPath,
    modelSha256: file.sha256,
    table,
    tableStamp: stamp,
    request,
    runId,
    now,
  });
  return prepareResultChange({
    ctx,
    signal,
    tool: "electrical_network",
    args: request,
    result,
    model: file.model,
    label: "network",
  });
}

export const electricalNetworkTool: ToolDefinition = {
  name: "electrical_network",
  class: "write",
  description:
    "Calculate a radial LV network of the workbench's electrical model (one transformer or LV supply point, three-phase AC up to 1000 V): P/Q/S balance per scenario with simultaneity and load factors, phase and neutral currents, design currents, cable sections checked or proposed from a cable table in electrical-automation-tables/ (installation method, ambient temperature and grouping from the cable), single- and three-phase voltage drop against the limits, and maximum/minimum fault currents by the impedance method after IEC 60909-0:2016. The result is stored as a new electrical-automation-results/<run-id>/result.json after approval like a write; the model is never changed. assumedReactance (Ω/km) stands in for conductors whose table gives no reactance and is recorded as an assumption. Missing data gives unknown, unsupported sources or topologies not-evaluated - never pass. Returns the report; electrical_model view report shows it again with its freshness.",
  params: networkRequestSchema,
  prepare: (ctx, args, signal) => prepareElectricalNetwork(ctx, args, signal),
  execute: async (ctx, args, signal) => (await prepareElectricalNetwork(ctx, args, signal)).apply(signal),
};
