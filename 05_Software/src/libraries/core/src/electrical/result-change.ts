// Prepares ONE new electrical result file electrical-automation-results/<run-id>/result.json through the write flow
// (approval, before hash = absent, write queue) for the engines that store results: electrical_network and
// protection_coordination, motor_drives, power_quality, lighting_design, qelectrotech_check, panel_engineering_check and
// electrical_documentation_check. The model is never written here.
import { createHash, randomBytes } from "node:crypto";
import {
  type ElectricalModel,
  type ElectricalResult,
  electricalLimits,
  electricalResultFile,
  electricalResultsDir,
} from "@vera/shared";
import { assertAgentWritable, commitChange, type PreparedChange } from "../tools/changes.js";
import type { ToolContext } from "../tools/context.js";
import { toolPathGuard } from "../tools/context.js";
import { PathGuard } from "../workbench/path-guard.js";
import { renderResultReport } from "./report.js";
import { checkResult } from "./results.js";
import { fileDiff } from "./tools.js";

const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const two = (value: number) => String(value).padStart(2, "0");

/** A run ID `YYYYMMDD-HHMMSS-<4 hex>` (UTC) and the run time without milliseconds. */
export function newRun(now = new Date()): { runId: string; now: string } {
  const runId = `${now.getUTCFullYear()}${two(now.getUTCMonth() + 1)}${two(now.getUTCDate())}-${two(now.getUTCHours())}${two(now.getUTCMinutes())}${two(now.getUTCSeconds())}-${randomBytes(2).toString("hex")}`;
  return { runId, now: now.toISOString().replace(/\.\d{3}Z$/, "Z") };
}

/** Checks the result and prepares its new file; apply returns {path, runId, sha256, bytes, status, criteria, report}. */
export async function prepareResultChange(options: {
  ctx: ToolContext;
  signal: AbortSignal;
  tool:
    | "electrical_network"
    | "protection_coordination"
    | "motor_drives"
    | "power_quality"
    | "lighting_design"
    | "qelectrotech_check"
    | "panel_engineering_check"
    | "electrical_documentation_check";
  args: Record<string, unknown>;
  result: ElectricalResult;
  model: ElectricalModel;
  label: string;
}): Promise<PreparedChange> {
  const { ctx, signal, result } = options;
  const host = ctx.change;
  if (!host) throw Error("Workbench write host is unavailable.");
  const { runId } = result;
  const checked = checkResult(result, runId);
  if ("problem" in checked)
    throw Error(
      `The ${options.label} result is not a valid result (${checked.problem.path}: ${checked.problem.message}).`,
    );
  const path = `${electricalResultsDir}/${runId}/${electricalResultFile}`;
  const inside = await (await PathGuard.create(ctx.root)).resolve(path);
  const target = await (await toolPathGuard(ctx)).resolve(path);
  if (target.key !== inside.key) throw Error("The result must be inside the workbench.");
  await assertAgentWritable(ctx, target);
  const output = `${JSON.stringify(result, null, 2)}\n`;
  const after = Buffer.from(output, "utf8");
  if (after.length > electricalLimits.resultBytes)
    throw Error(
      `The ${options.label} result is larger than 4 MiB: analyse a smaller part of the project at once.`,
    );
  const afterSha256 = hash(after);
  const { diff, added, removed } = fileDiff(inside.relative, "", output);
  const criteria: Record<string, number> = {};
  for (const entry of result.criteria) criteria[entry.verdict] = (criteria[entry.verdict] ?? 0) + 1;
  const report = renderResultReport(
    result,
    { freshness: "current", changed: [], removed: [] },
    options.model,
  );
  const changeRequest = Object.freeze({
    workbench: ctx.root,
    sessionId: host.sessionId,
    turnId: host.turnId,
    callId: host.callId,
    tool: options.tool,
    path: inside.relative,
    args: Object.freeze({ ...options.args }),
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
