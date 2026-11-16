// The lighting_design write tool (spec REQ-DATA-affb2e6b): reads the electrical model, one lighting project, the
// photometry files its types name, optionally one industrial catalog and (level verification) one report record with
// its evidence file, runs the engine and prepares ONE new result file through the write flow. Every input file is only
// read; no photometric engine is started.
import { electricalModelPath } from "@vera/shared";
import type { PreparedChange } from "../tools/changes.js";
import {
  type ToolContext,
  type ToolDefinition,
  toolExcludedRoots,
  toolPathGuard,
  toolSignal,
} from "../tools/context.js";
import { readCatalogFile } from "./catalog-tool.js";
import { analyzeLighting, lightingRequestSchema } from "./lighting.js";
import {
  hashEvidenceFile,
  readLightingProject,
  readLightingReport,
  readPhotometryFile,
} from "./lighting-files.js";
import { newRun, prepareResultChange } from "./result-change.js";
import { readModelFile } from "./tools.js";

/** Runs the engine and prepares the new result file; nothing is written before the change is applied. */
export async function prepareLightingDesign(
  ctx: ToolContext,
  raw: unknown,
  signal: AbortSignal,
): Promise<PreparedChange> {
  signal = toolSignal(ctx, signal);
  signal.throwIfAborted();
  const request = lightingRequestSchema.parse(raw);
  const host = ctx.change;
  if (!host) throw Error("Workbench write host is unavailable.");
  host.assertWritable?.();
  const inputGuard = await toolPathGuard(ctx);
  const file = await readModelFile(ctx.root, toolExcludedRoots(ctx));
  if (!file) throw Error(`The workbench has no electrical model (${electricalModelPath}).`);
  const { project, stamp: projectStamp } = await readLightingProject(
    ctx.root,
    request.project,
    toolExcludedRoots(ctx),
    inputGuard,
  );
  const photometry = new Map<string, Awaited<ReturnType<typeof readPhotometryFile>>>();
  for (const type of project.types)
    photometry.set(
      type.id,
      await readPhotometryFile(ctx.root, type.photometry, toolExcludedRoots(ctx), inputGuard),
    );
  const catalogFile = request.catalog
    ? await readCatalogFile(ctx.root, request.catalog, toolExcludedRoots(ctx), inputGuard)
    : null;
  let report = null;
  if (request.report) {
    const read = await readLightingReport(ctx.root, request.report, toolExcludedRoots(ctx), inputGuard);
    if (read.report.project !== project.id)
      throw Error(
        `The report record ${request.report} belongs to ${read.report.project}, not to ${project.id}.`,
      );
    const evidenceSha256 = read.report.evidence
      ? await hashEvidenceFile(ctx.root, read.report.evidence.path, toolExcludedRoots(ctx), inputGuard)
      : null;
    report = { ...read, evidenceSha256 };
  }
  signal.throwIfAborted();
  const { runId, now } = newRun();
  const result = analyzeLighting({
    model: file.model,
    modelPath: electricalModelPath,
    modelSha256: file.sha256,
    project,
    projectStamp,
    photometry,
    catalog: catalogFile?.catalog ?? null,
    catalogStamp: catalogFile?.stamp ?? null,
    report,
    request,
    signal,
    runId,
    now,
  });
  return prepareResultChange({
    ctx,
    signal,
    tool: "lighting_design",
    args: request,
    result,
    model: file.model,
    label: "lighting",
  });
}

export const lightingDesignTool: ToolDefinition = {
  name: "lighting_design",
  class: "write",
  description:
    "Interior lighting from a lighting project (electrical-automation-lighting/<id>.json: room, reflectances, plane, luminaires with IES/LDT photometry, scenarios, MF, requirements). preliminary: lumen-method estimate with cited UF plus direct component on the grid, with scale/units/orientation diagnostics; verification: maps a photometric engine report record (e.g. DIALux evo) for Em, uniformity, UGR. Stores a new result after approval; runs no engine.",
  params: lightingRequestSchema,
  prepare: (ctx, args, signal) => prepareLightingDesign(ctx, args, signal),
  execute: async (ctx, args, signal) => (await prepareLightingDesign(ctx, args, signal)).apply(signal),
};
