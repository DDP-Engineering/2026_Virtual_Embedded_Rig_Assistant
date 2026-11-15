// The electrical_network write tool (spec REQ-DATA-42ce122f): runs the radial LV network engine on the workbench's
// model and a cable table, and prepares ONE new result file electrical-automation-results/<run-id>/result.json
// through the write flow (approval, before hash = absent, write queue). The model is only read.
import { createHash, randomBytes } from "node:crypto";
import {
  electricalLimits,
  electricalModelPath,
  electricalResultFile,
  electricalResultsDir,
} from "@vera/shared";
import { assertAgentWritable, commitChange, type PreparedChange } from "../tools/changes.js";
import type { ToolContext, ToolDefinition } from "../tools/context.js";
import { toolPathGuard } from "../tools/context.js";
import { PathGuard } from "../workbench/path-guard.js";
import { readCableTableFile } from "./cable-table.js";
import { analyzeNetwork, networkRequestSchema } from "./network.js";
import { renderResultReport } from "./report.js";
import { checkResult } from "./results.js";
import { fileDiff, readModelFile } from "./tools.js";

const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const two = (value: number) => String(value).padStart(2, "0");

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
  const now = new Date();
  const runId = `${now.getUTCFullYear()}${two(now.getUTCMonth() + 1)}${two(now.getUTCDate())}-${two(now.getUTCHours())}${two(now.getUTCMinutes())}${two(now.getUTCSeconds())}-${randomBytes(2).toString("hex")}`;
  const result = analyzeNetwork({
    model: file.model,
    modelPath: electricalModelPath,
    modelSha256: file.sha256,
    table,
    tableStamp: stamp,
    request,
    runId,
    now: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
  });
  const checked = checkResult(result, runId);
  if ("problem" in checked)
    throw Error(
      `The network result is not a valid result (${checked.problem.path}: ${checked.problem.message}).`,
    );
  const path = `${electricalResultsDir}/${runId}/${electricalResultFile}`;
  const inside = await (await PathGuard.create(ctx.root)).resolve(path);
  const target = await (await toolPathGuard(ctx)).resolve(path);
  if (target.key !== inside.key) throw Error("The result must be inside the workbench.");
  await assertAgentWritable(ctx, target);
  const output = `${JSON.stringify(result, null, 2)}\n`;
  const after = Buffer.from(output, "utf8");
  if (after.length > electricalLimits.resultBytes)
    throw Error("The network result is larger than 4 MiB: analyse a smaller network.");
  const afterSha256 = hash(after);
  const { diff, added, removed } = fileDiff(inside.relative, "", output);
  const criteria: Record<string, number> = {};
  for (const entry of result.criteria) criteria[entry.verdict] = (criteria[entry.verdict] ?? 0) + 1;
  const report = renderResultReport(result, { freshness: "current", changed: [], removed: [] }, file.model);
  const changeRequest = Object.freeze({
    workbench: ctx.root,
    sessionId: host.sessionId,
    turnId: host.turnId,
    callId: host.callId,
    tool: "electrical_network" as const,
    path: inside.relative,
    args: Object.freeze({ ...request }),
    existed: false,
    beforeSha256: null,
    afterSha256,
    diff,
    bytes: after.length,
    protected: false,
  });
  return Object.freeze({
    request: changeRequest,
    apply: commitChange({
      ctx,
      signal,
      target,
      path,
      before: null,
      beforeSha256: null,
      after,
      afterSha256,
      changePath: inside.relative,
      diff,
      added,
      removed,
      result: {
        path: inside.relative,
        runId,
        sha256: afterSha256,
        bytes: after.length,
        status: result.status,
        criteria,
        report,
      },
    }),
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
